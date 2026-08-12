-- Shared course schedule, refreshed by an admin and read by everyone.
--
-- The point of this table: no student should have to install an extension or
-- sign into TSS to see when a course meets. One admin refreshes it when the
-- schedule publishes; every planner reads from here.
--
-- What lives here is impersonal and effectively public — meeting times,
-- instructors, rooms — the same fields UCSD served openly at act.ucsd.edu
-- before TSS. Nothing student-identifying is stored.
--
-- Seat counts are deliberately NOT authoritative here. They change by the
-- minute during enrollment, so a cached count is misleading; each student's own
-- session refreshes those live. Whatever count was captured at refresh time is
-- kept only so the admin page can show what it saw, and `refreshed_at` is the
-- honest age of it.

create table if not exists public.term_sections (
  -- "2026-fall". One row per term, replaced wholesale on refresh.
  id text primary key,
  year text not null,
  term text not null,
  -- { "DSC 106": [ { sectionId, component, days, start, end, instructor, ... } ] }
  courses jsonb not null,
  course_count integer not null default 0,
  section_count integer not null default 0,
  -- True when the fetch hit a page cap, so readers can say "incomplete"
  -- rather than presenting a partial term as the whole thing.
  truncated boolean not null default false,
  refreshed_at timestamptz not null default now(),
  refreshed_by uuid references auth.users (id) on delete set null
);

alter table public.term_sections enable row level security;

-- Readable by everyone, including signed-out visitors: a student with no
-- account should still get a working calendar. This is the whole reason the
-- table exists.
create policy "Anyone can read the shared schedule"
  on public.term_sections for select
  to anon, authenticated
  using (true);

-- Writes are admin-only. Without this any signed-in user could overwrite the
-- schedule for everyone.
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text
);

alter table public.app_admins enable row level security;

-- Deliberately "your own row", not "any row if you are an admin". The latter
-- makes the policy on app_admins query app_admins, which Postgres rejects as
-- infinite recursion — and the failure is silent from the client's side: the
-- admin check just errors and reports "not an admin".
create policy "Users can see their own admin row"
  on public.app_admins for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Admins can publish the shared schedule"
  on public.term_sections for insert
  to authenticated
  with check (exists (select 1 from public.app_admins a where a.user_id = (select auth.uid())));

create policy "Admins can replace the shared schedule"
  on public.term_sections for update
  to authenticated
  using (exists (select 1 from public.app_admins a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.app_admins a where a.user_id = (select auth.uid())));

-- Make yourself an admin. Find the id with:
--   select id, email from auth.users;
-- insert into public.app_admins (user_id, note) values ('<your-uuid>', 'Saaz');
