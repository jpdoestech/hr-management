-- Stage A only. Read-only baseline; no migration or remediation is performed.
-- Run with an authorized database administrator in the intended project.
-- Authenticated/RLS-restricted execution may return only a partial baseline.
begin transaction isolation level repeatable read read only;

select current_database() as database_name,current_user as database_role,
       current_setting('server_version') as postgres_version,
       current_setting('transaction_read_only') as read_only;

-- Report migration history only if visible; never repair or infer applied versions.
do $$
declare versions jsonb;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise notice 'Migration history is unavailable; deployed versions are NOT verified.';
  elsif has_table_privilege(current_user,'supabase_migrations.schema_migrations','SELECT') then
    execute 'select jsonb_agg(version order by version) from supabase_migrations.schema_migrations' into versions;
    raise notice 'Applied migration versions: %',versions;
  else
    raise notice 'Migration history is not accessible to this role.';
  end if;
end;$$;

select table_name,column_name,data_type from information_schema.columns
where table_schema='public' and table_name in ('hr_records','hr_settings','hr_audit_logs','access_user_scopes','access_resource_assignments')
order by table_name,ordinal_position;

select c.relname as table_name,c.relrowsecurity as rls_enabled,c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('hr_records','hr_settings','hr_audit_logs');
select tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('hr_records','hr_settings','hr_audit_logs') order by tablename,policyname;
select c.relname as table_name,t.tgname as trigger_name,pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal and c.relname in ('hr_records','hr_settings','hr_audit_logs') order by c.relname,t.tgname;
select conname,pg_get_constraintdef(oid) as definition from pg_constraint
where conrelid='public.hr_records'::regclass order by conname;

select tenant_id,module,count(*) as records from public.hr_records
where module in ('manpowerRequests','manpowerRequirements','manpowerSlots','prf','onboardingCandidates','employees','oncall','transfers','attendance','atd')
group by tenant_id,module order by tenant_id,module;

-- Check identity fields before relying on JSON ids as relationships.
select tenant_id,module,record_id,data->>'id' as json_id from public.hr_records
where module in ('manpowerRequests','manpowerRequirements','manpowerSlots','onboardingCandidates','employees','oncall')
and (coalesce(data->>'id','')='' or data->>'id'<>record_id);

-- Blank headers and normalized duplicates require review before uniqueness.
select tenant_id,record_id,data->>'status' as status from public.hr_records
where module='manpowerRequests' and btrim(coalesce(data->>'prfNumber',''))='';
select tenant_id,lower(regexp_replace(btrim(data->>'prfNumber'),'[[:space:]]+',' ','g')) as normalized_prf,
       count(*) as duplicate_count,array_agg(record_id order by record_id) as request_ids
from public.hr_records where module='manpowerRequests' and btrim(coalesce(data->>'prfNumber',''))<>''
group by tenant_id,lower(regexp_replace(btrim(data->>'prfNumber'),'[[:space:]]+',' ','g')) having count(*)>1;

-- Legacy PRF/applicant text references: zero/multiple header matches are exceptions.
select source.tenant_id,source.module,source.record_id,count(header.record_id) as matching_headers
from public.hr_records source left join public.hr_records header
on header.tenant_id=source.tenant_id and header.module='manpowerRequests'
and lower(regexp_replace(btrim(header.data->>'prfNumber'),'[[:space:]]+',' ','g'))=lower(regexp_replace(btrim(source.data->>'prfNumber'),'[[:space:]]+',' ','g'))
where source.module in ('prf','onboardingCandidates') and btrim(coalesce(source.data->>'prfNumber',''))<>''
group by source.tenant_id,source.module,source.record_id having count(header.record_id)<>1;

-- Broken/cross-tenant links and mismatched line/header relationships.
select child.tenant_id,child.module,child.record_id,'request missing' as issue
from public.hr_records child where child.module in ('manpowerRequirements','manpowerSlots')
and not exists(select 1 from public.hr_records parent where parent.tenant_id=child.tenant_id and parent.module='manpowerRequests' and parent.record_id=child.data->>'requestId')
union all
select child.tenant_id,child.module,child.record_id,'line missing or wrong request'
from public.hr_records child where child.module='manpowerSlots'
and not exists(select 1 from public.hr_records parent where parent.tenant_id=child.tenant_id and parent.module='manpowerRequirements' and parent.record_id=child.data->>'requirementId' and parent.data->>'requestId'=child.data->>'requestId');

select slot.tenant_id,slot.record_id,link.key as missing_reference_type,link.value as missing_reference
from public.hr_records slot cross join lateral jsonb_each_text(slot.data) link
where slot.module='manpowerSlots' and link.key in ('employeeId','candidateId','replacementEmployeeId') and coalesce(link.value,'')<>''
and not exists(select 1 from public.hr_records person where person.tenant_id=slot.tenant_id
and person.module=case when link.key='candidateId' then 'onboardingCandidates' else 'employees' end and person.record_id=link.value);

-- Quantities and placeholder sizes, without casting malformed legacy quantities.
select line.tenant_id,line.record_id,line.data->>'requestedHeadcount' as requested,
       count(slot.record_id) as legacy_slots,
       count(slot.record_id) filter(where coalesce(slot.data->>'employeeId','')='' and coalesce(slot.data->>'candidateId','')='' and coalesce(slot.data->>'dateSelected','')='' and coalesce(slot.data->>'dateOnboarded','')='' and coalesce(slot.data->>'dateDeployed','')='') as empty_slots
from public.hr_records line left join public.hr_records slot on slot.tenant_id=line.tenant_id and slot.module='manpowerSlots' and slot.data->>'requirementId'=line.record_id
where line.module='manpowerRequirements' group by line.tenant_id,line.record_id,line.data;

select tenant_id,record_id,data->>'status' as status,data->>'dateDeployed' as deployed_date,
       case when data->>'status'='Deployed' and coalesce(data->>'dateDeployed','')='' then 'deployed without date'
         when coalesce(data->>'dateDeployed','')<>'' and coalesce(data->>'employeeId','')='' then 'date without employee'
         when coalesce(data->>'dateDeployed','')<>'' and data->>'status' in ('Cancelled','Closed / Not Filled') then 'date conflicts with closed state'
         when data->>'dateDeployed'>to_char(current_date,'YYYY-MM-DD') then 'future date previously counted as fulfillment' end as issue
from public.hr_records where module='manpowerSlots' and (
 (data->>'status'='Deployed' and coalesce(data->>'dateDeployed','')='')
 or (coalesce(data->>'dateDeployed','')<>'' and coalesce(data->>'employeeId','')='')
 or (coalesce(data->>'dateDeployed','')<>'' and data->>'status' in ('Cancelled','Closed / Not Filled'))
 or data->>'dateDeployed'>to_char(current_date,'YYYY-MM-DD'));

select tenant_id,data->>'employeeId' as employee_id,count(*) as possible_duplicate_deployments,array_agg(record_id) as slot_ids
from public.hr_records where module='manpowerSlots' and coalesce(data->>'employeeId','')<>'' and (coalesce(data->>'dateDeployed','')<>'' or data->>'status'='Deployed')
group by tenant_id,data->>'employeeId' having count(*)>1;

-- These are review candidates, NOT confirmed overlaps: old slots lack end dates.
select tenant_id,record_id,coalesce(data->>'employeeId','')='' as unlinked_worker,
       coalesce(data->>'employeeReplacedId','')='' as unlinked_replaced_employee
from public.hr_records where module='oncall' and (coalesce(data->>'employeeId','')='' or (coalesce(data->>'employeeReplaced','')<>'' and coalesce(data->>'employeeReplacedId','')=''));

-- Master catalogs: report presence/count only, not private settings or credentials.
select tenant_id,key,jsonb_typeof(value) as value_type,
       case when jsonb_typeof(value)='array' then jsonb_array_length(value) end as entries
from public.hr_settings cross join lateral jsonb_each(data)
where key in ('departments','positions','branchLocations','clients','clientAccounts','sites');

commit;
