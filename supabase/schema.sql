-- SCPA HR Management — Supabase Phase 2 schema
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  username text not null unique,
  email text not null unique,
  role text not null default 'HR Staff' check (role in ('Administrator','HR Staff','Viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.current_profile_role()
returns text
language sql
security definer
set search_path = public
stable
as $$ select role from public.profiles where id = auth.uid(); $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id,full_name,username,email,role)
  values(
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1))),
    lower(new.email),
    'HR Staff'
  )
  on conflict (id) do update set
    full_name=excluded.full_name,
    username=excluded.username,
    email=excluded.email,
    updated_at=now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.hr_records (
  module text not null,
  record_id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (module, record_id)
);

create index if not exists hr_records_module_idx on public.hr_records(module);
create index if not exists hr_records_updated_idx on public.hr_records(updated_at desc);

create table if not exists public.hr_settings (
  id text primary key check (id = 'singleton'),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.hr_audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  user_name text,
  action text not null,
  created_at timestamptz not null default now()
);
create index if not exists hr_audit_created_idx on public.hr_audit_logs(created_at desc);

-- Keep legacy table available for one-time Phase 1 migration, if it exists.
create table if not exists public.hr_app_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.hr_records enable row level security;
alter table public.hr_settings enable row level security;
alter table public.hr_audit_logs enable row level security;
alter table public.hr_app_state enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid() and role = 'HR Staff');
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid() or public.current_profile_role() = 'Administrator') with check ((id = auth.uid() and role = (select p.role from public.profiles p where p.id=auth.uid())) or public.current_profile_role() = 'Administrator');

drop policy if exists hr_records_select on public.hr_records;
create policy hr_records_select on public.hr_records for select to authenticated using (true);
drop policy if exists hr_records_insert on public.hr_records;
create policy hr_records_insert on public.hr_records for insert to authenticated with check (public.current_profile_role() in ('Administrator','HR Staff'));
drop policy if exists hr_records_update on public.hr_records;
create policy hr_records_update on public.hr_records for update to authenticated using (public.current_profile_role() in ('Administrator','HR Staff')) with check (public.current_profile_role() in ('Administrator','HR Staff'));
drop policy if exists hr_records_delete on public.hr_records;
create policy hr_records_delete on public.hr_records for delete to authenticated using (public.current_profile_role() in ('Administrator','HR Staff'));

drop policy if exists hr_settings_select on public.hr_settings;
create policy hr_settings_select on public.hr_settings for select to authenticated using (true);
drop policy if exists hr_settings_write on public.hr_settings;
create policy hr_settings_write on public.hr_settings for all to authenticated using (public.current_profile_role() in ('Administrator','HR Staff')) with check (public.current_profile_role() in ('Administrator','HR Staff'));

drop policy if exists hr_audit_select on public.hr_audit_logs;
create policy hr_audit_select on public.hr_audit_logs for select to authenticated using (true);
drop policy if exists hr_audit_insert on public.hr_audit_logs;
create policy hr_audit_insert on public.hr_audit_logs for insert to authenticated with check (public.current_profile_role() in ('Administrator','HR Staff'));

drop policy if exists legacy_state_select on public.hr_app_state;
create policy legacy_state_select on public.hr_app_state for select to authenticated using (true);
drop policy if exists legacy_state_write on public.hr_app_state;
create policy legacy_state_write on public.hr_app_state for all to authenticated using (public.current_profile_role() in ('Administrator','HR Staff')) with check (public.current_profile_role() in ('Administrator','HR Staff'));

-- Storage
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('hr-documents','hr-documents',false,10485760,array[
  'application/pdf','image/png','image/jpeg','image/webp','image/gif',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
])
on conflict (id) do update set file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists hr_documents_select on storage.objects;
create policy hr_documents_select on storage.objects for select to authenticated using (bucket_id='hr-documents');
drop policy if exists hr_documents_insert on storage.objects;
create policy hr_documents_insert on storage.objects for insert to authenticated with check (bucket_id='hr-documents' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists hr_documents_delete on storage.objects;
create policy hr_documents_delete on storage.objects for delete to authenticated using (bucket_id='hr-documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.current_profile_role()='Administrator'));

-- updated_at helper
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
drop trigger if exists hr_records_updated_at on public.hr_records;
create trigger hr_records_updated_at before update on public.hr_records for each row execute procedure public.set_updated_at();
drop trigger if exists hr_settings_updated_at on public.hr_settings;
create trigger hr_settings_updated_at before update on public.hr_settings for each row execute procedure public.set_updated_at();
