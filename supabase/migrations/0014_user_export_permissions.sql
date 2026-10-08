-- Phase 17: per-user export permission.
-- Administrator and HR Staff export by role; other roles require this explicit flag.

alter table public.profiles
  add column if not exists can_export boolean not null default false;

comment on column public.profiles.can_export is
  'Administrator-granted permission for non-HR roles to use application export actions.';
