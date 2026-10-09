-- Stage A2: isolated quantity-based drafts. No legacy conversion or submission.
begin;
alter table public.hr_manpower_clients add constraint hr_manpower_clients_tenant_identity unique(tenant_id,id);
create function public.normalize_manpower_prf(p_value text) returns text
language sql immutable set search_path=public as $$
  select lower(btrim(regexp_replace(coalesce(p_value,''),'[[:space:]]+',' ','g')));
$$;
create table public.hr_manpower_requests (
  tenant_id uuid not null default public.current_tenant_id() references public.hr_tenants(id),
  id text not null check(length(id) between 1 and 100 and id~'^[A-Za-z0-9_-]+$'),
  prf_number text not null default '' check(length(prf_number)<=120),
  normalized_prf text generated always as (public.normalize_manpower_prf(prf_number)) stored,
  client_id uuid,
  branch_reporting text not null default '' check(length(branch_reporting)<=60),
  requested_by text not null default '' check(length(requested_by)<=120),
  date_requested date,
  target_date date,
  priority text not null default 'Normal' check(priority in ('Low','Normal','High','Urgent')),
  remarks text not null default '' check(length(remarks)<=10000),
  state text not null default 'Draft' check(state='Draft'),
  revision bigint not null default 1 check(revision>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  primary key(tenant_id,id),
  foreign key(tenant_id,client_id) references public.hr_manpower_clients(tenant_id,id),
  check(date_requested is null or target_date is null or target_date>=date_requested)
);
create unique index hr_manpower_requests_draft_number_unique
  on public.hr_manpower_requests(tenant_id,normalized_prf) where normalized_prf<>'';
create index hr_manpower_requests_updated on public.hr_manpower_requests(tenant_id,updated_at desc,id);
create table public.hr_manpower_lines (
  tenant_id uuid not null,
  id text not null check(length(id) between 1 and 100 and id~'^[A-Za-z0-9_-]+$'),
  request_id text not null,
  ordinal integer not null check(ordinal>=0),
  department text not null default '' check(length(department)<=60),
  position text not null default '' check(length(position)<=80),
  current_authorized integer check(current_authorized>0),
  original_requested integer check(original_requested>0),
  cancelled_unfilled integer not null default 0 check(cancelled_unfilled=0),
  demand_type text not null default 'Expansion' check(demand_type in ('Expansion','Replacement')),
  target_date date,
  site text not null default '' check(length(site)<=60),
  purpose text not null default '' check(length(purpose)<=10000),
  primary key(tenant_id,id),
  foreign key(tenant_id,request_id) references public.hr_manpower_requests(tenant_id,id),
  unique(tenant_id,request_id,ordinal),
  -- An original submitted quantity does not exist until the submission gate opens.
  check(original_requested is null)
);
create function public.can_read_manpower_draft(p_id text) returns boolean
language sql stable security definer set search_path=public as $$
  select coalesce(public.current_user_has_permission('manpower.view'),false) and exists(
    select 1 from public.hr_manpower_requests request
    where request.tenant_id=public.current_tenant_id() and request.id=p_id and (
      public.current_user_scope_allows(request.id,jsonb_build_object('branchReporting',request.branch_reporting))
      or (exists(select 1 from public.hr_manpower_lines line where line.tenant_id=request.tenant_id and line.request_id=request.id)
        and not exists(select 1 from public.hr_manpower_lines line where line.tenant_id=request.tenant_id and line.request_id=request.id
          and not coalesce(public.current_user_scope_allows(line.id,jsonb_build_object('department',line.department,'branchReporting',request.branch_reporting)),false)))
    )
  );
$$;
alter table public.hr_manpower_requests enable row level security;
alter table public.hr_manpower_lines enable row level security;
create policy hr_manpower_requests_read on public.hr_manpower_requests for select to authenticated
  using(tenant_id=public.current_tenant_id() and public.can_read_manpower_draft(id));
create policy hr_manpower_lines_read on public.hr_manpower_lines for select to authenticated
  using(tenant_id=public.current_tenant_id() and public.can_read_manpower_draft(request_id));
revoke all on public.hr_manpower_requests,public.hr_manpower_lines from anon,authenticated;
grant select on public.hr_manpower_requests,public.hr_manpower_lines to authenticated;

create function public.save_manpower_draft(p_id text,p_expected_revision bigint,p_header jsonb,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  active_tenant uuid:=public.current_tenant_id();
  actor public.profiles;
  previous public.hr_manpower_requests;
  saved public.hr_manpower_requests;
  item jsonb;
  catalogs jsonb;
  client uuid;
  branch text:=btrim(coalesce(p_header->>'branch_reporting',''));
  number text:=btrim(regexp_replace(coalesce(p_header->>'prf_number',''),'[[:space:]]+',' ','g'));
  department_name text;
  position_name text;
  quantity integer;
  idx integer:=0;
  header_scope boolean;
begin
  select * into actor from public.profiles where id=auth.uid();
  if auth.uid() is null or active_tenant is null or actor.tenant_id is distinct from active_tenant then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if p_id is null or length(p_id) not between 1 and 100 or p_id!~'^[A-Za-z0-9_-]+$' or p_expected_revision is null or p_expected_revision<0
    or jsonb_typeof(p_header) is distinct from 'object' or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'A draft id, revision, header and line array are required' using errcode='23514';
  end if;
  -- Serialize new saves too: absent rows cannot be locked with SELECT FOR UPDATE.
  perform pg_advisory_xact_lock(hashtextextended(active_tenant::text||':draft:'||p_id,0));
  select * into previous from public.hr_manpower_requests where tenant_id=active_tenant and id=p_id for update;
  if not coalesce(public.current_user_has_permission(case when found then 'manpower.update' else 'manpower.create' end),false) then
    raise exception 'Manpower draft access denied' using errcode='42501';
  end if;
  if previous.id is null and p_expected_revision<>0 or previous.id is not null and previous.revision<>p_expected_revision then
    raise exception 'Draft changed. Reload before saving.' using errcode='40001';
  end if;
  if previous.id is not null and not public.can_read_manpower_draft(p_id) then
    raise exception 'Draft is outside your scope' using errcode='42501';
  end if;
  if p_header ?| array['state','revision','original_requested','cancelled_unfilled']
    or exists(select 1 from jsonb_array_elements(p_lines) value where jsonb_typeof(value) is distinct from 'object'
      or value ?| array['original_requested','cancelled_unfilled','state','employee_id','candidate_id']) then
    raise exception 'Drafts cannot submit, cancel, reserve or deploy workers' using errcode='23514';
  end if;
  if exists(select 1 from jsonb_array_elements(p_lines) value where length(coalesce(value->>'id','')) not between 1 and 100 or (value->>'id')!~'^[A-Za-z0-9_-]+$')
    or (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_lines) value) then
    raise exception 'Each line needs a distinct stable id' using errcode='23514';
  end if;
  if exists(select 1 from public.hr_manpower_lines line join jsonb_array_elements(p_lines) value on line.id=value->>'id'
    where line.tenant_id=active_tenant and line.request_id<>p_id) then
    raise exception 'Line belongs to another draft' using errcode='23514';
  end if;
  select data into catalogs from public.hr_settings where tenant_id=active_tenant and id='singleton' for share;
  if branch<>'' and not exists(select 1 from jsonb_array_elements_text(coalesce(catalogs->'branchLocations','[]')) value where value=branch) then
    raise exception 'Select a configured reporting branch' using errcode='23514';
  end if;
  client:=nullif(p_header->>'client_id','')::uuid;
  if client is not null then
    perform 1 from public.hr_manpower_clients account where account.id=client
      and account.tenant_id=active_tenant and (account.active or previous.client_id=client) for share;
    if not found then raise exception 'Select an active Client Account in your organization' using errcode='23514';end if;
  end if;
  -- A draft number is provisional. Submission needs a cross-model legacy-write guard.
  if number<>'' and exists(select 1 from public.hr_records record where record.tenant_id=active_tenant and record.module='manpowerRequests'
    and public.normalize_manpower_prf(record.data->>'prfNumber')=public.normalize_manpower_prf(number)) then
    raise exception 'PRF number already exists in legacy manpower requests' using errcode='23505';
  end if;
  header_scope:=coalesce(public.current_user_scope_allows(p_id,jsonb_build_object('branchReporting',branch)),false);
  if not header_scope and jsonb_array_length(p_lines)=0 then raise exception 'Draft is outside your scope' using errcode='42501';end if;
  for item in select value from jsonb_array_elements(p_lines) loop
    department_name:=btrim(coalesce(item->>'department',''));position_name:=btrim(coalesce(item->>'position',''));
    if not header_scope and not coalesce(public.current_user_scope_allows(item->>'id',jsonb_build_object('department',department_name,'branchReporting',branch)),false) then
      raise exception 'Requisition line is outside your scope' using errcode='42501';
    end if;
    if department_name<>'' and not exists(select 1 from jsonb_array_elements(coalesce(catalogs->'departments','[]')) value where value->>'name'=department_name and value->>'active'='true') then
      raise exception 'Select an active catalog department' using errcode='23514';
    end if;
    if position_name<>'' and not exists(select 1 from jsonb_array_elements(coalesce(catalogs->'positions','[]')) value where value->>'name'=position_name and value->>'department'=department_name and value->>'active'='true') then
      raise exception 'Position must belong to the selected department' using errcode='23514';
    end if;
    if coalesce(item->>'site','')<>'' and not exists(select 1 from jsonb_array_elements_text(coalesce(catalogs->'branchLocations','[]')) value where value=item->>'site') then
      raise exception 'Select a configured line site' using errcode='23514';
    end if;
    if nullif(item->>'current_authorized','') is not null and (item->>'current_authorized')!~'^[0-9]+$' then
      raise exception 'Headcount must be a positive whole number' using errcode='23514';
    end if;
    quantity:=nullif(item->>'current_authorized','')::integer;
    if quantity<=0 then raise exception 'Headcount must be positive' using errcode='23514';end if;
    if nullif(item->>'target_date','') is not null and nullif(p_header->>'date_requested','') is not null
      and (item->>'target_date')::date<(p_header->>'date_requested')::date then
      raise exception 'Line target cannot precede the request date' using errcode='23514';
    end if;
  end loop;
  insert into public.hr_manpower_requests(tenant_id,id,prf_number,client_id,branch_reporting,requested_by,date_requested,target_date,priority,remarks,created_by,updated_by)
  values(active_tenant,p_id,number,client,branch,btrim(coalesce(p_header->>'requested_by','')),nullif(p_header->>'date_requested','')::date,
    nullif(p_header->>'target_date','')::date,coalesce(p_header->>'priority','Normal'),coalesce(p_header->>'remarks',''),auth.uid(),auth.uid())
  on conflict(tenant_id,id) do update set prf_number=excluded.prf_number,client_id=excluded.client_id,branch_reporting=excluded.branch_reporting,
    requested_by=excluded.requested_by,date_requested=excluded.date_requested,target_date=excluded.target_date,priority=excluded.priority,remarks=excluded.remarks,
    revision=hr_manpower_requests.revision+1,updated_at=now(),updated_by=auth.uid() returning * into saved;
  -- Only drafts exist in this release: replacing their uncommitted rows is atomic.
  delete from public.hr_manpower_lines where tenant_id=active_tenant and request_id=p_id;
  for item in select value from jsonb_array_elements(p_lines) loop
    insert into public.hr_manpower_lines(tenant_id,id,request_id,ordinal,department,position,current_authorized,demand_type,target_date,site,purpose)
    values(active_tenant,item->>'id',p_id,idx,btrim(coalesce(item->>'department','')),btrim(coalesce(item->>'position','')),
      nullif(item->>'current_authorized','')::integer,coalesce(item->>'demand_type','Expansion'),nullif(item->>'target_date','')::date,
      coalesce(item->>'site',''),coalesce(item->>'purpose',''));
    idx:=idx+1;
  end loop;
  insert into public.hr_audit_logs(tenant_id,user_id,user_name,action)
  values(active_tenant,auth.uid(),coalesce(actor.full_name,'HR user'),format('Manpower draft saved [%s], revision %s, %s requisition lines',p_id,saved.revision,idx));
  return jsonb_build_object('request',to_jsonb(saved),'lines',coalesce((select jsonb_agg(to_jsonb(line) order by ordinal)
    from public.hr_manpower_lines line where line.tenant_id=active_tenant and line.request_id=p_id),'[]'::jsonb));
end;
$$;
revoke all on function public.normalize_manpower_prf(text),public.can_read_manpower_draft(text),public.save_manpower_draft(text,bigint,jsonb,jsonb) from public,anon;
grant execute on function public.normalize_manpower_prf(text),public.can_read_manpower_draft(text),public.save_manpower_draft(text,bigint,jsonb,jsonb) to authenticated;
comment on table public.hr_manpower_requests is 'Staged quantity model: draft only. Submission/reservations disabled pending legacy and capacity guards.';
commit;
