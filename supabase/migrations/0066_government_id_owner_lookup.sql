-- Return only permitted owner display fields, never stored government IDs.
begin;
create or replace function public.employee_government_id_owners(p_field text,p_entries jsonb)
returns table("clientName" text,department text,"position" text,name text)
language plpgsql stable security invoker
set search_path=public,pg_temp
as $$
begin
  if auth.uid() is null or not coalesce(public.current_user_has_permission('employees.view'),false)
     or not (coalesce(public.current_user_has_permission('employees.create'),false) or coalesce(public.current_user_has_permission('employees.update'),false)) then
    raise exception 'Employee editing and viewing access required' using errcode='42501';
  end if;
  if p_field is null or p_field not in ('sssNumber','philHealthNumber','pagIbigNumber','tin')
     or p_entries is null or jsonb_typeof(p_entries)<>'array' then
    raise exception 'Invalid government ID lookup' using errcode='22023';
  end if;
  if jsonb_array_length(p_entries)>250 then
    raise exception 'Government ID lookup is limited to one save batch' using errcode='22023';
  end if;
  return query
    select distinct coalesce(r.data->>'clientName',''),coalesce(r.data->>'department',''),coalesce(r.data->>'position',''),
      case when coalesce(r.data->>'lastName','')<>'' and coalesce(r.data->>'firstName','')<>''
        then (r.data->>'lastName')||', '||concat_ws(' ',nullif(r.data->>'firstName',''),nullif(r.data->>'middleName',''))
        else coalesce(r.data->>'name','') end
    from public.hr_records r
    join jsonb_array_elements(p_entries) e on r.record_id<>coalesce(e.value->>'record_id','')
      and public.employee_government_id_key(p_field,r.data->>p_field)=public.employee_government_id_key(p_field,e.value->>'value')
    where r.tenant_id=public.current_tenant_id() and r.module='employees'
      and public.current_user_scope_allows(r.record_id,r.data)
      and public.employee_government_id_key(p_field,e.value->>'value')<>'';
end;
$$;
revoke all on function public.employee_government_id_owners(text,jsonb) from public;
grant execute on function public.employee_government_id_owners(text,jsonb) to authenticated;
commit;
