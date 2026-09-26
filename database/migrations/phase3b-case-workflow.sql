-- SCPA HR Management — Phase 3B
-- Central HR case tracking + links between case records.
-- Safe additive migration: does not alter existing hr_records data.
-- Run in Supabase SQL Editor after Phase 3A.

begin;

create table if not exists public.hr_cases (
  id uuid primary key default gen_random_uuid(),
  case_number text not null unique,
  employee_record_id text,
  employee_name text not null,
  department text,
  subject text,
  status text not null default 'Open'
    check (status in ('Open','NTE Issued','Memo Issued','For Decision','Resolved','Closed','Cancelled')),
  opened_at date not null default current_date,
  closed_at date,
  assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_cases_employee_idx
  on public.hr_cases(employee_name);
create index if not exists hr_cases_status_idx
  on public.hr_cases(status);
create index if not exists hr_cases_updated_idx
  on public.hr_cases(updated_at desc);

create table if not exists public.hr_case_links (
  case_id uuid not null references public.hr_cases(id) on delete cascade,
  module text not null check (
    module in (
      'employees','leaves','disciplinary','nte','memos','nod','oncall',
      'transfers','offenseCatalog','cvr','incidents','prf','evaluations','atd'
    )
  ),
  record_id text not null,
  label text,
  linked_by uuid references auth.users(id) on delete set null,
  linked_at timestamptz not null default now(),
  primary key (case_id, module, record_id)
);

create index if not exists hr_case_links_record_idx
  on public.hr_case_links(module, record_id);
create index if not exists hr_case_links_case_idx
  on public.hr_case_links(case_id);

-- Keep updated_at reliable for case edits.
drop trigger if exists hr_cases_updated_at on public.hr_cases;
create trigger hr_cases_updated_at
before update on public.hr_cases
for each row execute procedure public.set_updated_at();

alter table public.hr_cases enable row level security;
alter table public.hr_case_links enable row level security;

-- Cases: everyone signed in can read; Administrator/HR Staff can write.
drop policy if exists hr_cases_select on public.hr_cases;
create policy hr_cases_select
on public.hr_cases
for select
to authenticated
using (true);

drop policy if exists hr_cases_insert on public.hr_cases;
create policy hr_cases_insert
on public.hr_cases
for insert
to authenticated
with check (
  public.current_profile_role() in ('Administrator','HR Staff')
  and created_by = auth.uid()
);

drop policy if exists hr_cases_update on public.hr_cases;
create policy hr_cases_update
on public.hr_cases
for update
to authenticated
using (
  public.current_profile_role() in ('Administrator','HR Staff')
)
with check (
  public.current_profile_role() in ('Administrator','HR Staff')
);

drop policy if exists hr_cases_delete on public.hr_cases;
create policy hr_cases_delete
on public.hr_cases
for delete
to authenticated
using (
  public.current_profile_role() in ('Administrator','HR Staff')
);

-- Case links follow the same read/write role model.
drop policy if exists hr_case_links_select on public.hr_case_links;
create policy hr_case_links_select
on public.hr_case_links
for select
to authenticated
using (true);

drop policy if exists hr_case_links_insert on public.hr_case_links;
create policy hr_case_links_insert
on public.hr_case_links
for insert
to authenticated
with check (
  public.current_profile_role() in ('Administrator','HR Staff')
  and linked_by = auth.uid()
);

drop policy if exists hr_case_links_update on public.hr_case_links;
create policy hr_case_links_update
on public.hr_case_links
for update
to authenticated
using (
  public.current_profile_role() in ('Administrator','HR Staff')
)
with check (
  public.current_profile_role() in ('Administrator','HR Staff')
);

drop policy if exists hr_case_links_delete on public.hr_case_links;
create policy hr_case_links_delete
on public.hr_case_links
for delete
to authenticated
using (
  public.current_profile_role() in ('Administrator','HR Staff')
);

-- The tables are intentionally not wired into the current UI yet.
-- Phase 3B UI work will:
--   1. Create/reuse a case from Incident / CVR / Disciplinary records.
--   2. Link NTE, Memo, NOD and ATD records to the same case.
--   3. Show a unified case timeline and current case status.
-- This keeps the current working app unchanged while the backend foundation is added safely.

commit;

-- Verification queries:
-- select id, case_number, employee_name, status, opened_at, closed_at from public.hr_cases order by created_at desc;
-- select case_id, module, record_id, label from public.hr_case_links order by linked_at desc;
