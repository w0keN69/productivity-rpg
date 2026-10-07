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

create policy "Users can update own player stats"
on public.player_stats for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Streaks
create policy "Users can view own streak"
on public.streaks for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can update own streak"
on public.streaks for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

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

create policy "Users can manage own task completions"
on public.task_completions for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can manage own daily progress"
on public.daily_progress for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can manage own quests"
on public.quests for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can manage own user achievements"
on public.user_achievements for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can manage own rewards"
on public.rewards for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can manage own reward redemptions"
on public.reward_redemptions for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can manage own focus presets"
on public.focus_presets for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can manage own focus sessions"
on public.focus_sessions for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

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

-- The new-user trigger is SECURITY DEFINER and is invoked by auth.users.
-- Do not grant direct execution of handle_new_user to normal clients.
