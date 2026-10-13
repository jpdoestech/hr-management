-- Approved rule: still-employed Probationary workers, six calendar months after hiring.
-- No backfill runs during deployment. Existing rows are processed by the scoped RPC/job.
begin;
create or replace function public.employee_regularization_due(p_data jsonb)
returns date language plpgsql immutable set search_path=public as $$
declare hired date;begin
  if coalesce(p_data->>'dateHired','') !~ '^\d{4}-\d{2}-\d{2}$' then return null;end if;
  begin hired:=(p_data->>'dateHired')::date;exception when others then return null;end;
  if to_char(hired,'YYYY-MM-DD')<>p_data->>'dateHired' then return null;end if;
  return (hired+interval '6 months')::date;
end;$$;

create or replace function public.apply_employee_regularization()
returns trigger language plpgsql security definer set search_path=public as $$
declare due date;today date:=(now() at time zone 'Asia/Manila')::date;
  event_key text;marker jsonb;prior jsonb;event jsonb;history jsonb;history_key text;
begin
  if new.module<>'employees' then return new;end if;
  -- Generated audit metadata cannot be invented or accidentally erased by a stale form.
  if tg_op='UPDATE' and old.data->>'dateHired'=new.data->>'dateHired' then prior:=old.data->'automaticRegularization';end if;
  new.data:=new.data-'automaticRegularization';
  if prior is not null then
    new.data:=new.data||jsonb_build_object('automaticRegularization',prior,'regularizationDate',old.data->'regularizationDate');
    foreach history_key in array array['employmentHistory','recordHistory'] loop
      history:=case when jsonb_typeof(new.data->history_key)='array' then new.data->history_key else '[]'::jsonb end;
      for event in select value from jsonb_array_elements(case when jsonb_typeof(old.data->history_key)='array' then old.data->history_key else '[]'::jsonb end)
        where value->>'key'=prior->>'key' loop
        if not exists(select 1 from jsonb_array_elements(history) entry where entry->>'key'=prior->>'key') then history:=history||jsonb_build_array(event);end if;
      end loop;
      new.data:=jsonb_set(new.data,array[history_key],history);
    end loop;
  end if;
  if new.module<>'employees' or coalesce(new.data->>'employmentType','')<>'Probationary'
    or coalesce(new.data->>'status','') not in ('Active','Inactive') then return new;end if;
  due:=public.employee_regularization_due(new.data);
  if due is null or due>today then return new;end if;
  event_key:='automatic-regularization:'||(new.data->>'dateHired');
  marker:=case when prior->>'key'=event_key then prior else jsonb_build_object(
    'key',event_key,'policy','six-calendar-months-v1','effectiveDate',due,'processedAt',now(),'processedOn',today) end;
  new.data:=new.data||jsonb_build_object('employmentType','Regular / Permanent','employmentTypeNeedsReview',false,
    'regularizationDate',due,'automaticRegularization',marker,'updatedAt',now(),'updatedBy',auth.uid(),'updatedByName','Automatic regularization');
  event:=jsonb_build_object('key',event_key,'type','Regularization','employmentType','Regular / Permanent',
    'from',new.data->>'status','to',new.data->>'status','statusReason',new.data->>'statusReason',
    'effectiveDate',due,'changedAt',marker->>'processedAt','changedBy','Automatic regularization',
    'remarks','Automatic regularization after six calendar months; operational status unchanged');
  history:=case when jsonb_typeof(new.data->'employmentHistory')='array' then new.data->'employmentHistory' else '[]'::jsonb end;
  if not exists(select 1 from jsonb_array_elements(history) entry where entry->>'key'=event_key) then history:=history||jsonb_build_array(event);end if;
  new.data:=jsonb_set(new.data,'{employmentHistory}',history);
  history:=case when jsonb_typeof(new.data->'recordHistory')='array' then new.data->'recordHistory' else '[]'::jsonb end;
  if not exists(select 1 from jsonb_array_elements(history) entry where entry->>'key'=event_key) then
    history:=history||jsonb_build_array(jsonb_build_object('key',event_key,'action','Regularized','at',marker->>'processedAt',
      'by','Automatic regularization','detail','Probationary to Regular / Permanent, effective '||due::text));end if;
  new.data:=jsonb_set(new.data,'{recordHistory}',history);
  if prior->>'key' is distinct from event_key then
    insert into public.hr_audit_logs(tenant_id,user_id,user_name,action)
    values(new.tenant_id,auth.uid(),'Automatic regularization','Regularized employee record '||new.record_id||', effective '||due::text);
  end if;
  return new;
end;$$;
revoke all on function public.apply_employee_regularization() from public,anon,authenticated;
create trigger hr_records_employee_regularization before insert or update on public.hr_records
for each row execute function public.apply_employee_regularization();
create index hr_records_regularization_due_idx on public.hr_records(public.employee_regularization_due(data),tenant_id)
where module='employees' and data->>'employmentType'='Probationary' and data->>'status' in ('Active','Inactive');

create or replace function public.regularize_probationary_employees()
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb;begin
  if auth.uid() is null or public.current_tenant_id() is null
    or not coalesce(public.current_user_has_permission('employees.update'),false)
    or not coalesce(public.current_user_has_permission('employees.view'),false) then raise exception 'Access denied' using errcode='42501';end if;
  with changed as (
    update public.hr_records set data=data,updated_by=auth.uid()
    where tenant_id=public.current_tenant_id() and module='employees' and data->>'employmentType'='Probationary'
      and data->>'status' in ('Active','Inactive') and public.employee_regularization_due(data)<=(now() at time zone 'Asia/Manila')::date
      and public.current_user_scope_allows(record_id,data)
    returning record_id,data
  ) select coalesce(jsonb_agg(jsonb_build_object('record_id',record_id,'data',data)),'[]'::jsonb) into result from changed;
  return result;
end;$$;
revoke all on function public.regularize_probationary_employees() from public,anon;
grant execute on function public.regularize_probationary_employees() to authenticated;

-- Owner-only background entry point; not executable through authenticated browser clients.
create or replace function public.run_scheduled_employee_regularization()
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is not null then raise exception 'Scheduler only' using errcode='42501';end if;
  update public.hr_records set data=data,updated_by=null
  where module='employees' and data->>'employmentType'='Probationary' and data->>'status' in ('Active','Inactive')
    and public.employee_regularization_due(data)<=(now() at time zone 'Asia/Manila')::date;
end;$$;
revoke all on function public.run_scheduled_employee_regularization() from public,anon,authenticated;
do $$begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    execute $job$select cron.schedule('hris-automatic-regularization','5 16 * * *','select public.run_scheduled_employee_regularization();')$job$;
  end if;
end;$$;
commit;
