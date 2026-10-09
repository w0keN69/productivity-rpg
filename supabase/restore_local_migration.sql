-- In Track protected migration finalizer.
-- Run this file in Supabase SQL Editor after schema.sql.
create or replace function public.finalize_local_migration()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  snap jsonb;
  row_item jsonb;
  row_date date;
  item_index bigint;
  restored integer := 0;
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
    raise exception 'No content_migrated snapshot found';
  end if;

  insert into public.player_stats(user_id,xp,coins)
  values(uid,greatest(0,coalesce((snap->>'xp')::bigint,0)),greatest(0,coalesce((snap->>'coins')::bigint,0)))
  on conflict(user_id) do update set xp=excluded.xp,coins=excluded.coins,updated_at=now();

  insert into public.streaks(user_id,current_streak,longest_streak,last_completed_date)
  values(uid,greatest(0,coalesce((snap->>'streak')::integer,0)),greatest(0,coalesce((snap->>'streak')::integer,0)),
    case when (snap->>'lastComplete') ~ '^\d{4}-\d{2}-\d{2}$' then (snap->>'lastComplete')::date else null end)
  on conflict(user_id) do update set current_streak=excluded.current_streak,
    longest_streak=greatest(public.streaks.longest_streak,excluded.longest_streak),
    last_completed_date=excluded.last_completed_date,updated_at=now();

  -- Restore task completion records by their stable local task IDs.
  for row_item in select key, value from jsonb_each_text(coalesce(snap->'completed','{}'::jsonb))
  loop
    if row_item.value <> 'true' then continue; end if;
    if row_item.key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}_.+  loop
    if coalesce(row_item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then continue; end if;
    row_date := (row_item->>'date')::date;
    insert into public.daily_progress(user_id,progress_date,tasks_completed,tasks_total,xp_earned,coins_earned,streak)
    values(uid,row_date,greatest(0,coalesce((row_item->>'done')::integer,0)),
      greatest(0,coalesce((row_item->>'total')::integer,0)),
      greatest(0,coalesce((row_item->>'xpEarned')::integer,0)),
      greatest(0,coalesce((row_item->>'coinsEarned')::integer,0)),
      greatest(0,coalesce((row_item->>'streak')::integer,0)))
    on conflict(user_id,progress_date) do update set tasks_completed=excluded.tasks_completed,
      tasks_total=excluded.tasks_total,xp_earned=excluded.xp_earned,coins_earned=excluded.coins_earned,
      streak=excluded.streak,updated_at=now();
    restored := restored + 1;
  end loop;

  update public.user_migrations set status='completed',updated_at=now() where user_id=uid;
  return jsonb_build_object('status','completed','daily_history_restored',restored);
end;
$$;
revoke all on function public.finalize_local_migration() from public;
revoke all on function public.finalize_local_migration() from anon;
grant execute on function public.finalize_local_migration() to authenticated;
 then continue; end if;
    row_date := split_part(row_item.key,'_',1)::date;
    insert into public.task_completions(user_id,task_id,completion_date,xp_earned,coins_earned)
    select uid,t.id,row_date,t.xp_reward,t.coin_reward
    from public.tasks t
    where t.user_id=uid and t.local_id=substring(row_item.key from 12) and t.archived=false
    on conflict (user_id,task_id,completion_date) do nothing;
  end loop;

  for row_item in select value from jsonb_array_elements(coalesce(snap->'history','[]'::jsonb))
  loop
    if coalesce(row_item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then continue; end if;
    row_date := (row_item->>'date')::date;
    insert into public.daily_progress(user_id,progress_date,tasks_completed,tasks_total,xp_earned,coins_earned,streak)
    values(uid,row_date,greatest(0,coalesce((row_item->>'done')::integer,0)),
      greatest(0,coalesce((row_item->>'total')::integer,0)),
      greatest(0,coalesce((row_item->>'xpEarned')::integer,0)),
      greatest(0,coalesce((row_item->>'coinsEarned')::integer,0)),
      greatest(0,coalesce((row_item->>'streak')::integer,0)))
    on conflict(user_id,progress_date) do update set tasks_completed=excluded.tasks_completed,
      tasks_total=excluded.tasks_total,xp_earned=excluded.xp_earned,coins_earned=excluded.coins_earned,
      streak=excluded.streak,updated_at=now();
    restored := restored + 1;
  end loop;

  update public.user_migrations set status='completed',updated_at=now() where user_id=uid;
  return jsonb_build_object('status','completed','daily_history_restored',restored);
end;
$$;
revoke all on function public.finalize_local_migration() from public;
revoke all on function public.finalize_local_migration() from anon;
grant execute on function public.finalize_local_migration() to authenticated;
