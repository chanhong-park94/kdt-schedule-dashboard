-- Supabase Dashboard -> SQL Editor -> New Query -> 실행

create extension if not exists pgcrypto;

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  course_id text unique not null,
  course_name text not null,
  created_at timestamptz default now()
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  course_id text not null,
  subject_code text not null,
  subject_name text,
  unique (course_id, subject_code)
);

create table if not exists public.instructors (
  id uuid primary key default gen_random_uuid(),
  instructor_code text unique not null,
  name text,
  created_at timestamptz default now()
);

create table if not exists public.course_subject_instructor_map (
  id uuid primary key default gen_random_uuid(),
  course_id text not null,
  subject_code text not null,
  instructor_code text not null,
  unique (course_id, subject_code)
);

create table if not exists public.course_templates (
  id uuid primary key default gen_random_uuid(),
  course_id text not null,
  template_name text not null,
  template_json jsonb not null,
  created_at timestamptz default now()
);

alter table public.courses enable row level security;
alter table public.subjects enable row level security;
alter table public.instructors enable row level security;
alter table public.course_subject_instructor_map enable row level security;
alter table public.course_templates enable row level security;

create policy courses_select_authenticated
on public.courses
for select
to authenticated
using (true);

create policy courses_insert_authenticated
on public.courses
for insert
to authenticated
with check (true);

create policy courses_update_authenticated
on public.courses
for update
to authenticated
using (true)
with check (true);

create policy subjects_select_authenticated
on public.subjects
for select
to authenticated
using (true);

create policy subjects_insert_authenticated
on public.subjects
for insert
to authenticated
with check (true);

create policy subjects_update_authenticated
on public.subjects
for update
to authenticated
using (true)
with check (true);

create policy instructors_select_authenticated
on public.instructors
for select
to authenticated
using (true);

create policy instructors_insert_authenticated
on public.instructors
for insert
to authenticated
with check (true);

create policy instructors_update_authenticated
on public.instructors
for update
to authenticated
using (true)
with check (true);

create policy course_subject_instructor_map_select_authenticated
on public.course_subject_instructor_map
for select
to authenticated
using (true);

create policy course_subject_instructor_map_insert_authenticated
on public.course_subject_instructor_map
for insert
to authenticated
with check (true);

create policy course_subject_instructor_map_update_authenticated
on public.course_subject_instructor_map
for update
to authenticated
using (true)
with check (true);

create policy course_templates_select_authenticated
on public.course_templates
for select
to authenticated
using (true);

create policy course_templates_insert_authenticated
on public.course_templates
for insert
to authenticated
with check (true);

create policy course_templates_update_authenticated
on public.course_templates
for update
to authenticated
using (true)
with check (true);
