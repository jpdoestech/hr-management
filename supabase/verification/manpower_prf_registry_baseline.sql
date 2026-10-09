-- Read-only operator baseline. Requires existing migrations through 0034.
-- Run before promoting proposal 0035. This does not repair or merge records.
begin transaction isolation level repeatable read read only;

select current_database() database_name,
  to_regclass('public.hr_manpower_clients') client_catalog,
  to_regclass('public.hr_manpower_requests') quantity_requests,
  to_regclass('public.hr_manpower_lines') quantity_lines,
  to_regclass('public.hr_manpower_prf_registry') number_registry;

with sources as (
  select tenant_id,'legacy' model,record_id id,public.normalize_manpower_prf(data->>'prfNumber') normalized_prf
  from public.hr_records where module='manpowerRequests'
  union all
  select tenant_id,'quantity',id,normalized_prf from public.hr_manpower_requests
)
select tenant_id,normalized_prf,count(*) owner_count,
  jsonb_agg(jsonb_build_object('model',model,'id',id) order by model,id) owners
from sources where normalized_prf<>''
group by tenant_id,normalized_prf having count(*)>1
order by tenant_id,normalized_prf;

select tenant_id,'legacy' model,count(*) request_count,
  count(*) filter(where public.normalize_manpower_prf(data->>'prfNumber')='') unnumbered_count
from public.hr_records where module='manpowerRequests' group by tenant_id
union all
select tenant_id,'quantity',count(*),count(*) filter(where normalized_prf='')
from public.hr_manpower_requests group by tenant_id;

-- Record this fingerprint before and after registry installation.
select tenant_id,md5(string_agg(record_id||':'||data::text,E'\n' order by record_id)) legacy_source_fingerprint
from public.hr_records where module='manpowerRequests' group by tenant_id;
select tenant_id,md5(string_agg(to_jsonb(request)::text,E'\n' order by id)) quantity_source_fingerprint
from public.hr_manpower_requests request group by tenant_id;

rollback;
