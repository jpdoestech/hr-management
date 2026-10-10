-- Catalog checks only, not evidence of independent-session concurrency acceptance.
select 'private schema exposed' as issue where has_schema_privilege('authenticated','manpower_private','USAGE')
  or has_schema_privilege('anon','manpower_private','USAGE');

select p.oid::regprocedure as unsafe_private_function from pg_proc p
join pg_namespace n on n.oid=p.pronamespace where n.nspname='manpower_private'
  and (has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE'));

select 'source trigger missing/disabled' as issue where not exists(select 1 from pg_trigger
  where tgrelid='public.hr_records'::regclass and tgname='manpower_00_source_snapshot_guard' and tgenabled='O');

select expected.signature as missing_guarded_entry from (values
  ('public.reserve_manpower_applicants(text,jsonb)'),('public.release_manpower_reservation(uuid,text)'),
  ('public.schedule_manpower_reservation(uuid,bigint,date,text)'),('public.confirm_manpower_deployments(text,jsonb)'),
  ('public.record_manpower_identity_review(text,text,text,text,text,text,bigint)'),
  ('public.record_manpower_identity_review(text,text,text,text,text,text)')) expected(signature)
left join pg_proc p on p.oid=to_regprocedure(expected.signature)
where p.oid is null or not p.prosecdef or p.prosrc not like '%manpower_private.lock_source_snapshot%';
