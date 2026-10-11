-- Additive catalog import; existing organization permissions and settings are preserved.
begin;
create or replace function public.organization_import_clients()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if auth.uid() is null or public.current_tenant_id() is null or not coalesce(public.current_user_has_permission('organization.manage'),false) then
    raise exception 'Access denied' using errcode='42501';end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id)
    from public.hr_manpower_clients where tenant_id=public.current_tenant_id() and active),'[]');
end;$$;
revoke all on function public.organization_import_clients() from public,anon;
grant execute on function public.organization_import_clients() to authenticated;
create or replace function public.import_organization_structure(p_rows jsonb,p_client_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  tenant uuid:=public.current_tenant_id(); actor uuid:=auth.uid(); settings jsonb;
  departments jsonb; positions jsonb; item jsonb; existing jsonb; name text; title text;
  di integer; pi integer; added_departments integer:=0; added_positions integer:=0;
  skipped_departments integer:=0; skipped_positions integer:=0; assignments integer:=0;
begin
  if actor is null or tenant is null or not coalesce(public.current_user_has_permission('organization.manage'),false) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 2000 then
    raise exception 'Import between 1 and 2000 rows' using errcode='23514';
  end if;
  -- Serialize imports with ordinary catalog saves on the same settings row.
  insert into public.hr_settings(tenant_id,id,data,updated_at,updated_by)
  values(tenant,'singleton','{}',now(),actor) on conflict(tenant_id,id) do nothing;
  select data into settings from public.hr_settings where tenant_id=tenant and id='singleton' for update;
  if p_client_id is not null then
    if not exists(select 1 from public.hr_manpower_clients where tenant_id=tenant and id=p_client_id and active) then
      raise exception 'Select an active client in this organization' using errcode='23514';
    end if;
  end if;
  departments:=coalesce(settings->'departments','[]'); positions:=coalesce(settings->'positions','[]');
  for item in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'department') is distinct from 'string'
      or (item ? 'position' and jsonb_typeof(item->'position') is distinct from 'string') then
      raise exception 'Invalid catalog row' using errcode='23514';
    end if;
    name:=btrim(regexp_replace(item->>'department','[[:space:]]+',' ','g'));
    title:=btrim(regexp_replace(coalesce(item->>'position',''),'[[:space:]]+',' ','g'));
    if length(name) not between 1 and 60 or length(title)>80 then raise exception 'Invalid department or position length' using errcode='23514';end if;
    select (ordinality-1)::integer,value into di,existing from jsonb_array_elements(departments) with ordinality
      where lower(btrim(regexp_replace(value->>'name','[[:space:]]+',' ','g')))=lower(name);
    if di is null then
      existing:=jsonb_build_object('name',name,'active',true);
      if p_client_id is not null then existing:=existing||jsonb_build_object('clientIds',jsonb_build_array(p_client_id));assignments:=assignments+1;end if;
      departments:=departments||jsonb_build_array(existing);added_departments:=added_departments+1;
    else
      name:=existing->>'name';skipped_departments:=skipped_departments+1;
      -- Globally available legacy entries remain global; never silently narrow them.
      if p_client_id is not null and jsonb_array_length(coalesce(existing->'clientIds','[]'))>0
        and not (existing->'clientIds' @> jsonb_build_array(p_client_id)) then
        departments:=jsonb_set(departments,array[di::text,'clientIds'],(existing->'clientIds')||jsonb_build_array(p_client_id));assignments:=assignments+1;
      end if;
    end if;
    if title='' then continue;end if;
    select (ordinality-1)::integer,value into pi,existing from jsonb_array_elements(positions) with ordinality
      where lower(btrim(regexp_replace(value->>'name','[[:space:]]+',' ','g')))=lower(title) and lower(value->>'department')=lower(name);
    if pi is null then
      existing:=jsonb_build_object('name',title,'department',name,'active',true);
      if p_client_id is not null then existing:=existing||jsonb_build_object('clientIds',jsonb_build_array(p_client_id));assignments:=assignments+1;end if;
      positions:=positions||jsonb_build_array(existing);added_positions:=added_positions+1;
    else
      skipped_positions:=skipped_positions+1;
      if p_client_id is not null and jsonb_array_length(coalesce(existing->'clientIds','[]'))>0
        and not (existing->'clientIds' @> jsonb_build_array(p_client_id)) then
        positions:=jsonb_set(positions,array[pi::text,'clientIds'],(existing->'clientIds')||jsonb_build_array(p_client_id));assignments:=assignments+1;
      end if;
    end if;
  end loop;
  settings:=public.save_organization_structure(departments,positions);
  insert into public.hr_audit_logs(tenant_id,user_id,user_name,action)
    select tenant,actor,coalesce(full_name,'Organization manager'),format('Organization import: %s departments, %s positions added; %s department and %s position duplicates skipped; %s client assignments added',added_departments,added_positions,skipped_departments,skipped_positions,assignments)
    from public.profiles where id=actor;
  return jsonb_build_object('settings',settings,'departmentsAdded',added_departments,'positionsAdded',added_positions,
    'departmentsSkipped',skipped_departments,'positionsSkipped',skipped_positions,'assignmentsAdded',assignments);
end;$$;
revoke all on function public.import_organization_structure(jsonb,uuid) from public,anon;
grant execute on function public.import_organization_structure(jsonb,uuid) to authenticated;
commit;
