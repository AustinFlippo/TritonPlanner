-- TritonPlanner Supabase setup
-- Applied to the "Triton Planner" project (aisoonveggmbqfufiisv) on 2026-08-09
-- as migration `create_planner_states`. Kept here as the reference schema —
-- re-run in the SQL Editor if setting up a fresh project.
--
-- One row per user holding their whole planner state as JSON.
-- Row-level security means users can only ever read/write their own row,
-- even though the client talks to the database directly with the anon key.

create table if not exists public.planner_states (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.planner_states enable row level security;

create policy "Users can read their own planner state"
  on public.planner_states for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own planner state"
  on public.planner_states for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own planner state"
  on public.planner_states for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Applied as migration `create_saved_plans` on 2026-08-09.
--
-- Named schedule snapshots the user saves from the Storage page. Many rows per
-- user, unlike planner_states, which holds the single live auto-saved plan.

create table if not exists public.saved_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  schedule jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Leading user_id also serves as the foreign-key index; updated_at desc
-- matches the newest-first list the Storage page renders.
create index if not exists saved_plans_user_id_updated_at_idx
  on public.saved_plans (user_id, updated_at desc);

alter table public.saved_plans enable row level security;

create policy "Users can read their own saved plans"
  on public.saved_plans for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own saved plans"
  on public.saved_plans for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own saved plans"
  on public.saved_plans for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own saved plans"
  on public.saved_plans for delete
  to authenticated
  using ((select auth.uid()) = user_id);
