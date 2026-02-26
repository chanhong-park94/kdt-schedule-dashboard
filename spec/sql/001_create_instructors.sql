-- Supabase table for instructor cloud sync
create table if not exists public.instructors (
  instructor_code text primary key,
  name text,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_instructors_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_instructors_updated_at on public.instructors;
create trigger trg_instructors_updated_at
before update on public.instructors
for each row
execute function public.set_instructors_updated_at();

alter table public.instructors enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.instructors to anon, authenticated;

drop policy if exists instructors_select_all on public.instructors;
create policy instructors_select_all
on public.instructors
for select
to anon, authenticated
using (true);

drop policy if exists instructors_insert_all on public.instructors;
create policy instructors_insert_all
on public.instructors
for insert
to anon, authenticated
with check (true);

drop policy if exists instructors_update_all on public.instructors;
create policy instructors_update_all
on public.instructors
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists instructors_delete_all on public.instructors;
create policy instructors_delete_all
on public.instructors
for delete
to anon, authenticated
using (true);
