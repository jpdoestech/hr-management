-- Phase 14: System-wide upload storage can only be configured by Administrators.

drop policy if exists hr_settings_write on public.hr_settings;
create policy hr_settings_write
on public.hr_settings
for all
to authenticated
using (public.current_profile_role() = 'Administrator')
with check (public.current_profile_role() = 'Administrator');
