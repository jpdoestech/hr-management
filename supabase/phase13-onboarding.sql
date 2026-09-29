-- Phase 13: protect applicant/onboarding records from non-HR roles.
-- Run after phase12-user-preferences.sql in the Supabase SQL Editor.
begin;

drop policy if exists hr_records_select on public.hr_records;
create policy hr_records_select on public.hr_records for select to authenticated using (
  public.current_profile_role() in ('Administrator','HR Staff')
  or (public.current_profile_role()='Viewer' and module <> 'onboardingCandidates')
  or (
    module in ('employees','leaves','evaluations','documents','lifecycleChecklists')
    and (
      record_id=public.current_employee_record_id()
      or data->>'employeeId'=public.current_employee_record_id()
      or public.is_managed_employee_record(record_id)
      or public.is_managed_employee_record(data->>'employeeId')
    )
  )
);

commit;
