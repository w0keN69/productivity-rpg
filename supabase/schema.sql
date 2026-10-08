-- In Track Cloud Database
-- Target: Supabase PostgreSQL
-- This migration creates the cloud data model and Row Level Security (RLS).
-- It is intentionally separate from the live app until authentication/sync is implemented.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Shared timestamp helper
-- ------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- ------------------------------------------------------------
-- Profiles
-- ------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ------------------------------------------------------------
-- User settings
-- ------------------------------------------------------------

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'dark' check (theme in ('dark', 'light', 'system')),
  timezone text not null default 'UTC',
  daily_goal integer not null default 3 check (daily_goal between 1 and 100),
  notifications_enabled boolean not null default true,
  sound_enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ------------------------------------------------------------
-- Player / RPG state
-- ------------------------------------------------------------

create table if not exists public.player_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  xp bigint not null default 0 check (xp >= 0),
  coins bigint not null default 0 check (coins >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.streaks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_streak integer not null default 0 check (current_streak >= 0),
  longest_streak integer not null default 0 check (longest_streak >= 0),
  last_completed_date date,
  updated_at timestamptz not null default timezone('utc', now())
);

-- ------------------------------------------------------------
-- Productivity
-- ------------------------------------------------------------

create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  sort_order integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists routines_user_idx
  on public.routines(user_id, sort_order);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_id uuid not null references public.routines(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  priority text not null default 'medium'
    check (priority in ('high', 'medium', 'low')),
  difficulty text not null default 'easy'
    check (difficulty in ('easy', 'medium', 'hard')),
  xp_reward integer not null default 5 check (xp_reward >= 0),
  coin_reward integer not null default 0 check (coin_reward >= 0),
  sort_order integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists tasks_user_idx
  on public.tasks(user_id, routine_id, sort_order);

create table if not exists public.task_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  completed_at timestamptz not null default timezone('utc', now()),
  completion_date date not null default current_date,
  xp_earned integer not null default 0 check (xp_earned >= 0),
  coins_earned integer not null default 0 check (coins_earned >= 0)
);

create index if not exists task_completions_user_date_idx
  on public.task_completions(user_id, completion_date desc);

create index if not exists task_completions_task_idx
  on public.task_completions(task_id, completion_date desc);

create table if not exists public.daily_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  progress_date date not null,
  tasks_completed integer not null default 0 check (tasks_completed >= 0),
  tasks_total integer not null default 0 check (tasks_total >= 0),
  xp_earned integer not null default 0 check (xp_earned >= 0),
  coins_earned integer not null default 0 check (coins_earned >= 0),
  streak integer not null default 0 check (streak >= 0),
  daily_quest_completed boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(user_id, progress_date)
);

create index if not exists daily_progress_user_date_idx
  on public.daily_progress(user_id, progress_date desc);

-- ------------------------------------------------------------
-- Quests
-- ------------------------------------------------------------

create table if not exists public.quests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('daily', 'weekly', 'special')),
  title text not null check (char_length(trim(title)) between 1 and 160),
  target integer not null check (target > 0),
  progress integer not null default 0 check (progress >= 0),
  xp_reward integer not null default 0 check (xp_reward >= 0),
  coin_reward integer not null default 0 check (coin_reward >= 0),
  start_date date not null,
  end_date date not null,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  check (end_date >= start_date),
  check (progress <= target)
);

create index if not exists quests_user_dates_idx
  on public.quests(user_id, start_date desc, end_date desc);

-- ------------------------------------------------------------
-- Achievements
-- Definitions are app-controlled. User progress is user-owned.
-- ------------------------------------------------------------

create table if not exists public.achievement_definitions (
  id text primary key,
  name text not null,
  description text not null,
  requirement_type text not null,
  requirement_value integer not null default 1 check (requirement_value >= 1),
  xp_reward integer not null default 0 check (xp_reward >= 0),
  coin_reward integer not null default 0 check (coin_reward >= 0),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null references public.achievement_definitions(id) on delete restrict,
  unlocked_at timestamptz not null default timezone('utc', now()),
  reward_claimed_at timestamptz,
  primary key (user_id, achievement_id)
);

create index if not exists user_achievements_user_idx
  on public.user_achievements(user_id, unlocked_at desc);

-- ------------------------------------------------------------
-- Rewards
-- ------------------------------------------------------------

create table if not exists public.rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  coin_cost integer not null check (coin_cost > 0),
  time_limit_minutes integer check (time_limit_minutes is null or time_limit_minutes > 0),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists rewards_user_idx
  on public.rewards(user_id, active);

create table if not exists public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_id uuid references public.rewards(id) on delete set null,
  reward_name text not null,
  coin_cost integer not null check (coin_cost > 0),
  time_limit_minutes integer check (time_limit_minutes is null or time_limit_minutes > 0),
  redeemed_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz
);

create index if not exists reward_redemptions_user_idx
  on public.reward_redemptions(user_id, redeemed_at desc);

-- ------------------------------------------------------------
-- Focus
-- ------------------------------------------------------------

create table if not exists public.focus_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  focus_minutes integer not null check (focus_minutes between 1 and 180),
  break_minutes integer not null default 0 check (break_minutes between 0 and 60),
  rounds integer not null default 1 check (rounds between 1 and 20),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists focus_presets_user_idx
  on public.focus_presets(user_id, created_at);

create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  preset_id uuid references public.focus_presets(id) on delete set null,
  focus_minutes integer not null check (focus_minutes > 0),
  round_number integer not null default 1 check (round_number > 0),
  completed_at timestamptz not null default timezone('utc', now()),
  xp_earned integer not null default 0 check (xp_earned >= 0),
  coins_earned integer not null default 0 check (coins_earned >= 0)
);

create index if not exists focus_sessions_user_idx
  on public.focus_sessions(user_id, completed_at desc);

-- ------------------------------------------------------------
-- Sticky Notes
-- ------------------------------------------------------------

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 120),
  body text not null default '',
  pinned boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists notes_user_idx
  on public.notes(user_id, pinned desc, updated_at desc);

-- ------------------------------------------------------------
-- Automatic profile + default records for new auth users
-- ------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(user_id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', '')
  )
  on conflict (user_id) do nothing;

  insert into public.user_settings(user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.player_stats(user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.streaks(user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ------------------------------------------------------------
-- updated_at triggers
-- ------------------------------------------------------------

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists user_settings_updated_at on public.user_settings;
create trigger user_settings_updated_at before update on public.user_settings
for each row execute procedure public.set_updated_at();

drop trigger if exists player_stats_updated_at on public.player_stats;
create trigger player_stats_updated_at before update on public.player_stats
for each row execute procedure public.set_updated_at();

drop trigger if exists streaks_updated_at on public.streaks;
create trigger streaks_updated_at before update on public.streaks
for each row execute procedure public.set_updated_at();

drop trigger if exists routines_updated_at on public.routines;
create trigger routines_updated_at before update on public.routines
for each row execute procedure public.set_updated_at();

drop trigger if exists tasks_updated_at on public.tasks;
create trigger tasks_updated_at before update on public.tasks
for each row execute procedure public.set_updated_at();

drop trigger if exists daily_progress_updated_at on public.daily_progress;
create trigger daily_progress_updated_at before update on public.daily_progress
for each row execute procedure public.set_updated_at();

drop trigger if exists rewards_updated_at on public.rewards;
create trigger rewards_updated_at before update on public.rewards
for each row execute procedure public.set_updated_at();

drop trigger if exists focus_presets_updated_at on public.focus_presets;
create trigger focus_presets_updated_at before update on public.focus_presets
for each row execute procedure public.set_updated_at();

drop trigger if exists notes_updated_at on public.notes;
create trigger notes_updated_at before update on public.notes
for each row execute procedure public.set_updated_at();

-- ------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.player_stats enable row level security;
alter table public.streaks enable row level security;
alter table public.routines enable row level security;
alter table public.tasks enable row level security;
alter table public.task_completions enable row level security;
alter table public.daily_progress enable row level security;
alter table public.quests enable row level security;
alter table public.achievement_definitions enable row level security;
alter table public.user_achievements enable row level security;
alter table public.rewards enable row level security;
alter table public.reward_redemptions enable row level security;
alter table public.focus_presets enable row level security;
alter table public.focus_sessions enable row level security;
alter table public.notes enable row level security;

-- Profiles
create policy "Users can view own profile"
on public.profiles for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can update own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Settings
create policy "Users can view own settings"
on public.user_settings for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can update own settings"
on public.user_settings for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Player stats
create policy "Users can view own player stats"
on public.player_stats for select
to authenticated
using ((select auth.uid()) = user_id);

-- Player XP/coins are intentionally not client-writable.
-- They will be changed through trusted server-side gameplay RPCs.

-- Streaks
create policy "Users can view own streak"
on public.streaks for select
to authenticated
using ((select auth.uid()) = user_id);

-- Streaks are intentionally not client-writable.
-- They will be calculated by trusted server-side gameplay logic.

-- User-owned CRUD tables
create policy "Users can manage own routines"
on public.routines for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can manage own tasks"
on public.tasks for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can view own task completions"
on public.task_completions for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can view own daily progress"
on public.daily_progress for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can view own quests"
on public.quests for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can view own user achievements"
on public.user_achievements for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can manage own rewards"
on public.rewards for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can view own reward redemptions"
on public.reward_redemptions for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can manage own focus presets"
on public.focus_presets for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can view own focus sessions"
on public.focus_sessions for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can manage own notes"
on public.notes for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Achievement definitions are readable but app-controlled.
create policy "Authenticated users can read achievement definitions"
on public.achievement_definitions for select
to authenticated
using (true);

-- No public INSERT/UPDATE/DELETE policies are intentionally created for
-- achievement definitions. They should be managed by trusted migrations/admin tooling.

-- ------------------------------------------------------------
-- Helpful starter achievement definitions
-- ------------------------------------------------------------

insert into public.achievement_definitions
  (id, name, description, requirement_type, requirement_value, xp_reward, coin_reward)
values
  ('first-quest', 'First Step', 'Complete your first meaningful day of progress.', 'days_completed', 1, 10, 5),
  ('level-2', 'Level Up', 'Reach level 2.', 'level', 2, 20, 10),
  ('100-xp', 'Getting Started', 'Earn 100 XP.', 'xp', 100, 25, 15),
  ('500-xp', 'Momentum', 'Earn 500 XP.', 'xp', 500, 50, 30),
  ('3-day-streak', 'Consistency Begins', 'Maintain a 3-day streak.', 'streak', 3, 25, 10),
  ('10-day-streak', 'In The Zone', 'Maintain a 10-day streak.', 'streak', 10, 75, 30),
  ('1000-xp', 'Dedicated', 'Earn 1,000 XP.', 'xp', 1000, 100, 50)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- Recommended grants
-- ------------------------------------------------------------

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.set_updated_at() to authenticated;

-- Gameplay/event tables are read-only from the client. Server-side RPCs will
-- atomically validate the action and update XP, coins, streaks and history.
-- This prevents clients from simply granting themselves rewards.

-- The new-user trigger is SECURITY DEFINER and is invoked by auth.users.
-- Do not grant direct execution of handle_new_user to normal clients.


-- ------------------------------------------------------------
-- Local migration support
-- ------------------------------------------------------------
-- local_id lets the browser safely repeat a migration without
-- creating duplicate routines/tasks/rewards/notes/presets.
alter table public.routines add column if not exists local_id text;
alter table public.tasks add column if not exists local_id text;
alter table public.rewards add column if not exists local_id text;
alter table public.focus_presets add column if not exists local_id text;
alter table public.notes add column if not exists local_id text;

create unique index if not exists routines_user_local_id_idx
  on public.routines(user_id, local_id);
create unique index if not exists tasks_user_local_id_idx
  on public.tasks(user_id, local_id);
create unique index if not exists rewards_user_local_id_idx
  on public.rewards(user_id, local_id);
create unique index if not exists focus_presets_user_local_id_idx
  on public.focus_presets(user_id, local_id);
create unique index if not exists notes_user_local_id_idx
  on public.notes(user_id, local_id);

create table if not exists public.user_migrations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  source_app text not null default 'In Track',
  source_version integer not null default 1,
  status text not null default 'pending'
    check (status in ('pending','content_migrated','completed')),
  protected_snapshot jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.user_migrations enable row level security;

create policy "Users can view own migration"
on public.user_migrations for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create own migration"
on public.user_migrations for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update own migration"
on public.user_migrations for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop trigger if exists user_migrations_updated_at on public.user_migrations;
create trigger user_migrations_updated_at before update on public.user_migrations
for each row execute procedure public.set_updated_at();


-- ------------------------------------------------------------
-- Trusted gameplay RPCs
-- ------------------------------------------------------------
-- The browser calls these functions instead of directly changing
-- player_stats, streaks, or task_completions.

create or replace function public.complete_task(
  p_task_id uuid,
  p_completion_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_task public.tasks%rowtype;
  v_existing public.task_completions%rowtype;
  v_xp integer;
  v_coins integer;
  v_completed integer;
  v_total integer;
  v_daily_bonus integer := 0;
  v_streak_bonus integer := 0;
  v_streak integer;
  v_last date;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  select * into v_task
  from public.tasks
  where id = p_task_id and user_id = v_user and archived = false;

  if not found then
    raise exception 'Task not found';
  end if;

  v_xp := v_task.xp_reward;
  v_coins := v_task.coin_reward;

  select * into v_existing
  from public.task_completions
  where user_id = v_user
    and task_id = p_task_id
    and completion_date = p_completion_date
  limit 1;

  if found then
    delete from public.task_completions where id = v_existing.id;
    update public.player_stats
      set xp = greatest(0, xp - v_xp),
          coins = greatest(0, coins - v_coins)
      where user_id = v_user;

    update public.daily_progress
      set tasks_completed = greatest(0, tasks_completed - 1),
          xp_earned = greatest(0, xp_earned - v_xp),
          coins_earned = greatest(0, coins_earned - v_coins)
      where user_id = v_user and progress_date = p_completion_date;

    return jsonb_build_object(
      'completed', false,
      'xp_gain', -v_xp,
      'coin_gain', -v_coins
    );
  end if;

  insert into public.task_completions(
    user_id, task_id, completed_at, completion_date, xp_earned, coins_earned
  )
  values(v_user, p_task_id, timezone('utc', now()), p_completion_date, v_xp, v_coins);

  update public.player_stats
    set xp = xp + v_xp,
        coins = coins + v_coins
    where user_id = v_user;

  select count(*) into v_completed
  from public.task_completions tc
  join public.tasks t on t.id = tc.task_id
  where tc.user_id = v_user
    and tc.completion_date = p_completion_date
    and t.archived = false;

  select count(*) into v_total
  from public.tasks
  where user_id = v_user and archived = false;

  insert into public.daily_progress(
    user_id, progress_date, tasks_completed, tasks_total, xp_earned, coins_earned
  )
  values(v_user, p_completion_date, 1, v_total, v_xp, v_coins)
  on conflict(user_id, progress_date) do update set
    tasks_completed = v_completed,
    tasks_total = v_total,
    xp_earned = public.daily_progress.xp_earned + v_xp,
    coins_earned = public.daily_progress.coins_earned + v_coins,
    updated_at = timezone('utc', now());

  -- Daily completion bonus is awarded only once when every active task
  -- has been completed for the date.
  if v_completed = v_total and v_total > 0 then
    select * into v_existing
    from public.task_completions
    where user_id = v_user
      and completion_date = p_completion_date
    order by completed_at desc
    limit 1;

    select last_completed_date,current_streak into v_last,v_streak
    from public.streaks
    where user_id = v_user
    for update;

    if v_last is distinct from p_completion_date then
      v_daily_bonus := 25;
      if v_last = p_completion_date - 1 then
        v_streak := coalesce(v_streak,0) + 1;
      else
        v_streak := 1;
      end if;

      v_streak_bonus := case v_streak
        when 3 then 10
        when 7 then 25
        when 14 then 50
        when 30 then 100
        else 0
      end;

      update public.streaks
        set current_streak = v_streak,
            longest_streak = greatest(longest_streak, v_streak),
            last_completed_date = p_completion_date
        where user_id = v_user;

      update public.player_stats
        set coins = coins + v_daily_bonus + v_streak_bonus
        where user_id = v_user;

      update public.daily_progress
        set daily_quest_completed = true,
            coins_earned = coins_earned + v_daily_bonus + v_streak_bonus,
            streak = v_streak
        where user_id = v_user and progress_date = p_completion_date;
    end if;
  end if;

  return jsonb_build_object(
    'completed', true,
    'xp_gain', v_xp,
    'coin_gain', v_coins + v_daily_bonus + v_streak_bonus,
    'daily_bonus', v_daily_bonus,
    'streak_bonus', v_streak_bonus
  );
end;
$$;

revoke all on function public.complete_task(uuid,date) from public;
grant execute on function public.complete_task(uuid,date) to authenticated;

create or replace function public.get_player_state()
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'xp', coalesce((select xp from public.player_stats where user_id = auth.uid()),0),
    'coins', coalesce((select coins from public.player_stats where user_id = auth.uid()),0),
    'streak', coalesce((select current_streak from public.streaks where user_id = auth.uid()),0),
    'longest_streak', coalesce((select longest_streak from public.streaks where user_id = auth.uid()),0)
  );
$$;

grant execute on function public.get_player_state() to authenticated;


-- ------------------------------------------------------------
-- Secure rewards, focus and achievement gameplay
-- ------------------------------------------------------------

create or replace function public.redeem_reward(p_reward_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_reward public.rewards%rowtype;
  v_coins bigint;
  v_redemption uuid;
  v_expires timestamptz;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select * into v_reward from public.rewards
  where id=p_reward_id and user_id=v_user and active=true;
  if not found then raise exception 'Reward not found'; end if;

  select coins into v_coins from public.player_stats where user_id=v_user for update;
  if coalesce(v_coins,0) < v_reward.coin_cost then raise exception 'Not enough coins'; end if;

  if v_reward.time_limit_minutes is not null then
    v_expires:=timezone('utc',now()) + make_interval(mins=>v_reward.time_limit_minutes);
  end if;

  update public.player_stats set coins=coins-v_reward.coin_cost where user_id=v_user;

  insert into public.reward_redemptions(
    user_id,reward_id,reward_name,coin_cost,time_limit_minutes,expires_at
  ) values(
    v_user,p_reward_id,v_reward.name,v_reward.coin_cost,v_reward.time_limit_minutes,v_expires
  ) returning id into v_redemption;

  return jsonb_build_object(
    'id',v_redemption,'name',v_reward.name,'cost',v_reward.coin_cost,
    'time_limit',v_reward.time_limit_minutes,'redeemed_at',timezone('utc',now()),
    'expires_at',v_expires
  );
end;
$$;

revoke all on function public.redeem_reward(uuid) from public;
grant execute on function public.redeem_reward(uuid) to authenticated;

create or replace function public.complete_focus_session(
  p_preset_id uuid default null,
  p_minutes integer default 25,
  p_round integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_xp integer := 15;
  v_coins integer := 5;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_minutes < 1 or p_minutes > 180 then raise exception 'Invalid focus duration'; end if;
  if p_round < 1 then raise exception 'Invalid round'; end if;

  if p_preset_id is not null and not exists(
    select 1 from public.focus_presets where id=p_preset_id and user_id=v_user
  ) then raise exception 'Focus preset not found'; end if;

  insert into public.focus_sessions(
    user_id,preset_id,focus_minutes,round_number,completed_at,xp_earned,coins_earned
  ) values(
    v_user,p_preset_id,p_minutes,p_round,timezone('utc',now()),v_xp,v_coins
  ) returning id into v_id;

  update public.player_stats
    set xp=xp+v_xp,coins=coins+v_coins
    where user_id=v_user;

  return jsonb_build_object(
    'id',v_id,'minutes',p_minutes,'round',p_round,
    'xp_gain',v_xp,'coin_gain',v_coins
  );
end;
$$;

revoke all on function public.complete_focus_session(uuid,integer,integer) from public;
grant execute on function public.complete_focus_session(uuid,integer,integer) to authenticated;

create or replace function public.unlock_achievement(p_achievement_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_def public.achievement_definitions%rowtype;
  v_xp integer;
  v_coins integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select * into v_def from public.achievement_definitions where id=p_achievement_id;
  if not found then raise exception 'Achievement not found'; end if;

  if exists(select 1 from public.user_achievements where user_id=v_user and achievement_id=p_achievement_id)
    then return jsonb_build_object('unlocked',false,'already_unlocked',true); end if;

  select xp_reward,coin_reward into v_xp,v_coins from public.achievement_definitions
  where id=p_achievement_id;

  insert into public.user_achievements(user_id,achievement_id)
  values(v_user,p_achievement_id);

  update public.player_stats
    set xp=xp+coalesce(v_xp,0),coins=coins+coalesce(v_coins,0)
    where user_id=v_user;

  return jsonb_build_object(
    'unlocked',true,'achievement_id',p_achievement_id,
    'xp_gain',coalesce(v_xp,0),'coin_gain',coalesce(v_coins,0)
  );
end;
$$;

revoke all on function public.unlock_achievement(text) from public;
grant execute on function public.unlock_achievement(text) to authenticated;


-- ------------------------------------------------------------
-- Cloud history and quest read model
-- ------------------------------------------------------------

create or replace function public.get_progress_summary(p_start date default current_date - 6)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'daily_progress', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.progress_date)
      from (
        select progress_date,tasks_completed,tasks_total,xp_earned,coins_earned,
               daily_quest_completed,streak
        from public.daily_progress
        where user_id=auth.uid() and progress_date>=p_start
        order by progress_date
      ) x
    ),'[]'::jsonb),
    'task_completions', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.completion_date,x.completed_at)
      from (
        select tc.task_id,tc.completion_date,tc.completed_at,tc.xp_earned,tc.coins_earned,
               t.local_id,t.name
        from public.task_completions tc
        join public.tasks t on t.id=tc.task_id
        where tc.user_id=auth.uid() and tc.completion_date>=p_start
        order by tc.completion_date,tc.completed_at
      ) x
    ),'[]'::jsonb),
    'reward_redemptions', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.redeemed_at desc)
      from (
        select id,reward_id,reward_name,coin_cost,time_limit_minutes,redeemed_at,expires_at
        from public.reward_redemptions
        where user_id=auth.uid()
        order by redeemed_at desc
        limit 100
      ) x
    ),'[]'::jsonb),
    'focus_sessions', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.completed_at desc)
      from (
        select id,preset_id,focus_minutes,round_number,completed_at,xp_earned,coins_earned
        from public.focus_sessions
        where user_id=auth.uid()
        order by completed_at desc
        limit 100
      ) x
    ),'[]'::jsonb),
    'achievements', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.unlocked_at desc)
      from (
        select ua.achievement_id,ua.unlocked_at,a.name,a.description,a.xp_reward,a.coin_reward
        from public.user_achievements ua
        join public.achievement_definitions a on a.id=ua.achievement_id
        where ua.user_id=auth.uid()
        order by ua.unlocked_at desc
      ) x
    ),'[]'::jsonb)
  );
$$;

grant execute on function public.get_progress_summary(date) to authenticated;
