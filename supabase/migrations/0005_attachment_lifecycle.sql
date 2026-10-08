-- SCPA HR Management — Phase 4
-- Attachment lifecycle / cleanup policy.
-- Run after the existing Phase 3A/3B SQL.
-- This keeps the private hr-documents bucket private while allowing
-- HR Staff/Admins to remove files belonging to HR records they can delete.

begin;

drop policy if exists hr_documents_delete on storage.objects;
create policy hr_documents_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'hr-documents'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.current_profile_role() in ('Administrator','HR Staff')
  )
);

commit;

-- Verification:
-- select policyname, cmd, roles, qual
-- from pg_policies
-- where schemaname='storage' and tablename='objects'
--   and policyname='hr_documents_delete';
