begin;

alter table public.hr_cases
  add column if not exists attachment_name text,
  add column if not exists attachment_ref text;

comment on column public.hr_cases.attachment_name is
  'Original display name of the primary HR case supporting file.';

comment on column public.hr_cases.attachment_ref is
  'Managed storage reference for the primary HR case file. Supports Supabase paths and gdrive: file IDs.';

commit;
