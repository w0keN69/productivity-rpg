-- In Track protected migration finalizer.
-- Run this SQL in Supabase SQL Editor after the main schema.sql.
create or replace function public.finalize_local_migration()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  snap jsonb;
  item jsonb;
  entry record;
  task_row record;
  row_date date;
  reward_id uuid;
  reward_cost integer;
  time_limit integer;
  expiry timestamptz;
  history_count integer := 0;
  completion_count integer := 0;
  redemption_count integer := 0;
  focus_count integer := 0;
begin
  if uid is null then raise exception 'Authentication required'; end if;

  select protected_snapshot into snap
  from public.user_migrations
  where user_id = uid and status = 'content_migrated'
  for update;

  if not found then
    if exists(select 1 from public.user_migrations where user_id=uid and status='completed') then
      return jsonb_build_object('status','completed','already_completed',true);
    end if;
    raise exception 'No content_migrated snapshot found. Start migration from In Track first.';
  end if;

  snap := coalesce(snap, '{}'::jsonb);

  insert into public.player_stats(user_id,xp,coins)
  values(uid,greatest(0,coalesce((snap->>'xp')::bigint,0)),greatest(0,coalesce((snap->>'coins')::bigint,0)))
  on conflict(user_id) do update set xp=excluded.xp,coins=excluded.coins,updated_at=now();

  insert into public.streaks(user_id,current_streak,longest_streak,last_completed_date)
  values(
    uid,
    greatest(0,coalesce((snap->>'streak')::integer,0)),
    greatest(0,coalesce((snap->>'streak')::integer,0)),
    case when coalesce(snap->>'lastComplete','') ~ '^\d{4}-\d{2}-\d{2}$' then (snap->>'lastComplete')::date else null end
  )
  on conflict(user_id) do update set
    current_streak=excluded.current_streak,
    longest_streak=greatest(public.streaks.longest_streak,excluded.longest_streak),
    last_completed_date=excluded.last_completed_date,
    updated_at=now();

  -- Restore task completion records by stable local task IDs.
  for entry in select key, value from jsonb_each_text(coalesce(snap->'completed','{}'::jsonb))
  loop
    if entry.value <> 'true' or entry.key !~ '^\d{4}-\d{2}-\d{2}_.+$' then continue; end if;
    row_date := split_part(entry.key,'_',1)::date;
    for task_row in
      select id,xp_reward,coin_reward from public.tasks
      where user_id=uid and local_id=substring(entry.key from 12) and archived=false
    loop
      insert into public.task_completions(user_id,task_id,completion_date,xp_earned,coins_earned)
      values(uid,task_row.id,row_date,greatest(0,task_row.xp_reward),greatest(0,task_row.coin_reward))
      on conflict(user_id,task_id,completion_date) do nothing;
      completion_count := completion_count + 1;
    end loop;
  end loop;

  -- Restore daily history summaries.
  for item in select value from jsonb_array_elements(coalesce(snap->'history','[]'::jsonb))
  loop
    if coalesce(item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then continue; end if;
    row_date := (item->>'date')::date;
    insert into public.daily_progress(user_id,progress_date,tasks_completed,tasks_total,xp_earned,coins_earned,streak)
    values(
      uid,row_date,
      greatest(0,coalesce((item->>'done')::integer,0)),
      greatest(0,coalesce((item->>'total')::integer,0)),
      greatest(0,coalesce((item->>'xpEarned')::integer,0)),
      greatest(0,coalesce((item->>'coinsEarned')::integer,0)),
      greatest(0,coalesce((item->>'streak')::integer,0))
    )
    on conflict(user_id,progress_date) do update set
      tasks_completed=excluded.tasks_completed,tasks_total=excluded.tasks_total,
      xp_earned=excluded.xp_earned,coins_earned=excluded.coins_earned,
      streak=excluded.streak,updated_at=now();
    history_count := history_count + 1;
  end loop;

  -- Restore reward redemptions using deterministic IDs so reruns do not duplicate rows.
  for entry in
    select value as item, ordinality as idx
    from jsonb_array_elements(coalesce(snap->'rewardHistory','[]'::jsonb)) with ordinality
  loop
    reward_cost := greatest(1,coalesce((entry.item->>'cost')::integer,1));
    time_limit := nullif(entry.item->>'timeLimit','')::integer;
    reward_id := null;
    select id into reward_id from public.rewards
    where user_id=uid and name=coalesce(entry.item->>'name','') and coin_cost=reward_cost
    order by created_at limit 1;

    expiry := null;
    select to_timestamp((active_item->>'expiresAt')::numeric / 1000) into expiry
    from jsonb_array_elements(coalesce(snap->'activeRewards','[]'::jsonb)) as active(active_item)
    where active_item->>'name'=entry.item->>'name'
      and coalesce((active_item->>'cost')::integer,-1)=reward_cost
      and coalesce(active_item->>'expiresAt','') ~ '^\d+(\.\d+)?$'
    limit 1;

    insert into public.reward_redemptions(
      id,user_id,reward_id,reward_name,coin_cost,time_limit_minutes,redeemed_at,expires_at
    ) values(
      md5(uid::text || ':local-redemption:' || entry.idx::text)::uuid,
      uid,reward_id,coalesce(nullif(entry.item->>'name',''),'Imported reward'),
      reward_cost,case when time_limit > 0 then time_limit else null end,
      case
        when coalesce(entry.item->>'redeemedAt','') <> '' then (entry.item->>'redeemedAt')::timestamptz
        when coalesce(entry.item->>'date','') ~ '^\d{4}-\d{2}-\d{2}$' then (entry.item->>'date')::date::timestamptz
        else now()
      end,
      expiry
    ) on conflict(id) do nothing;
    redemption_count := redemption_count + 1;
  end loop;

  -- Restore focus history with stable IDs.
  for entry in
    select value as item, ordinality as idx
    from jsonb_array_elements(coalesce(snap->'focusSessions','[]'::jsonb)) with ordinality
  loop
    if coalesce((entry.item->>'minutes')::integer,0) <= 0 then continue; end if;
    insert into public.focus_sessions(
      id,user_id,preset_id,focus_minutes,round_number,completed_at,xp_earned,coins_earned
    ) values(
      md5(uid::text || ':local-focus:' || entry.idx::text)::uuid,
      uid,null,greatest(1,(entry.item->>'minutes')::integer),1,
      case when coalesce(entry.item->>'date','') ~ '^\d{4}-\d{2}-\d{2}$'
        then (entry.item->>'date')::date::timestamptz + interval '12 hours' else now() end,
      greatest(0,coalesce((entry.item->>'xp')::integer,0)),
      greatest(0,coalesce((entry.item->>'coins')::integer,0))
    ) on conflict(id) do nothing;
    focus_count := focus_count + 1;
  end loop;

  -- Restore claimed achievement IDs only where definitions exist.
  insert into public.user_achievements(user_id,achievement_id,unlocked_at,reward_claimed_at)
  select uid, claimed.value, now(), now()
  from jsonb_array_elements_text(coalesce(snap->'achievementRewards','[]'::jsonb)) as claimed(value)
  join public.achievement_definitions d on d.id=claimed.value
  on conflict(user_id,achievement_id) do nothing;

  update public.user_migrations set status='completed',updated_at=now() where user_id=uid;

  return jsonb_build_object(
    'status','completed',
    'task_completions_restored',completion_count,
    'daily_history_restored',history_count,
    'reward_redemptions_restored',redemption_count,
    'focus_sessions_restored',focus_count
  );
end;
$$;

revoke all on function public.finalize_local_migration() from public;
revoke all on function public.finalize_local_migration() from anon;
grant execute on function public.finalize_local_migration() to authenticated;
