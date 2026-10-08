-- SCPA HR Management — Phase 9: HR Case Intelligence
-- Additive migration for case priority, deadlines, and append-only case activity.
-- Run after Phase 3B / Phase 3A.

begin;

alter table public.hr_cases
  add column if not exists priority text not null default 'Normal';

alter table public.hr_cases
  add column if not exists due_date date;

alter table public.hr_cases
  drop constraint if exists hr_cases_priority_check;

alter table public.hr_cases
  add constraint hr_cases_priority_check
  check (priority in ('Low','Normal','High','Urgent'));

create index if not exists hr_cases_due_date_idx
  on public.hr_cases(due_date);

create index if not exists hr_cases_priority_idx
  on public.hr_cases(priority);

create table if not exists public.hr_case_activity (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.hr_cases(id) on delete cascade,
  activity_type text not null,
  note text,
  status_from text,
  status_to text,
  due_date date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists hr_case_activity_case_idx
  on public.hr_case_activity(case_id, created_at desc);

alter table public.hr_case_activity enable row level security;

drop policy if exists hr_case_activity_select on public.hr_case_activity;
create policy hr_case_activity_select
on public.hr_case_activity
for select
 to authenticated
using (true);

drop policy if exists hr_case_activity_insert on public.hr_case_activity;
create policy hr_case_activity_insert
on public.hr_case_activity
for insert
 to authenticated
with check (
  public.current_profile_role() in ('Administrator','HR Staff')
  and created_by = auth.uid()
);

-- Keep activities append-only from the client. No UPDATE/DELETE policy is created.
-- Existing role/security policies on hr_cases remain in force.

update public.hr_cases
set priority = coalesce(nullif(priority,''),'Normal')
where priority is null or priority = '';

commit;

-- Verification:
-- select id, case_number, priority, due_date, status from public.hr_cases order by updated_at desc;
-- select case_id, activity_type, note, status_from, status_to, created_at from public.hr_case_activity order by created_at desc;
