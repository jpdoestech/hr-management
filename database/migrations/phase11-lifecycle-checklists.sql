-- SLSC HR Management - Lifecycle checklist access and manager task updates
-- Run after phase10-self-service.sql in the Supabase SQL Editor.

begin;

-- Employees can read their own lifecycle journeys. Managers can read journeys
-- for direct reports, while existing HR and Viewer access remains unchanged.
drop policy if exists hr_records_select on public.hr_records;
create policy hr_records_select on public.hr_records for select to authenticated using (
  public.current_profile_role() in ('Administrator','HR Staff','Viewer')
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

create or replace function public.update_lifecycle_checklist_item(
  p_checklist_id text,
  p_item_id text,
  p_completed boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record public.hr_records%rowtype;
  v_role text := public.current_profile_role();
  v_items jsonb;
  v_item jsonb;
  v_all_complete boolean;
  v_overdue boolean;
  v_status text;
  v_actor_name text;
  v_result jsonb;
begin
  select * into v_record
  from public.hr_records
  where module='lifecycleChecklists' and record_id=p_checklist_id
  for update;

  if v_record.record_id is null then
    raise exception 'Lifecycle checklist not found';
  end if;

  select value into v_item
  from jsonb_array_elements(coalesce(v_record.data->'items','[]'::jsonb))
  where value->>'id'=p_item_id
  limit 1;

  if v_item is null then
    raise exception 'Lifecycle checklist task not found';
  end if;

  if v_role not in ('Administrator','HR Staff')
    and not (
      v_role='Manager'
      and public.is_managed_employee_record(v_record.data->>'employeeId')
      and (
        v_record.data->>'managerProfileId'=auth.uid()::text
        or v_item->>'assigneeProfileId'=auth.uid()::text
      )
    ) then
    raise exception 'You are not authorized to update this lifecycle task';
  end if;

  select coalesce(jsonb_agg(
    case when item->>'id'=p_item_id then
      item || jsonb_build_object(
        'completed',p_completed,
        'note',coalesce(trim(p_note),''),
        'completedAt',case when p_completed then now()::text else '' end,
        'completedBy',case when p_completed then auth.uid()::text else '' end
      )
    else item end
    order by ord
  ),'[]'::jsonb)
  into v_items
  from jsonb_array_elements(coalesce(v_record.data->'items','[]'::jsonb)) with ordinality as rows(item,ord);

  select coalesce(bool_and(coalesce((item->>'completed')::boolean,false)),false),
         coalesce(bool_or(not coalesce((item->>'completed')::boolean,false) and nullif(item->>'dueDate','')::date < current_date),false)
  into v_all_complete,v_overdue
  from jsonb_array_elements(v_items) as rows(item);

  v_status := case
    when v_record.data->>'status'='Cancelled' then 'Cancelled'
    when v_all_complete then 'Completed'
    when v_overdue then 'Overdue'
    else 'Active'
  end;

  select full_name into v_actor_name from public.profiles where id=auth.uid();

  v_result := v_record.data || jsonb_build_object(
    'items',v_items,
    'status',v_status,
    'updatedAt',now()::text,
    'updatedBy',auth.uid()::text,
    'history',jsonb_build_array(jsonb_build_object(
      'id','db-' || gen_random_uuid()::text,
      'action',case when p_completed then 'Task completed' else 'Task updated' end,
      'detail',coalesce(v_item->>'title','Lifecycle task') ||
        case when nullif(trim(coalesce(p_note,'')),'') is not null then ' · ' || trim(p_note) else '' end,
      'at',now()::text,
      'by',coalesce(v_actor_name,'Manager'),
      'byId',auth.uid()::text
    )) || coalesce(v_record.data->'history','[]'::jsonb)
  );

  update public.hr_records
  set data=v_result,updated_at=now(),updated_by=auth.uid()
  where module='lifecycleChecklists' and record_id=p_checklist_id;

  insert into public.hr_audit_logs(user_id,user_name,action)
  values(auth.uid(),v_actor_name,(case when p_completed then 'Completed' else 'Updated' end) || ' lifecycle task: ' || coalesce(v_item->>'title','Task'));

  return v_result;
end;
$$;

revoke all on function public.update_lifecycle_checklist_item(text,text,boolean,text) from public;
grant execute on function public.update_lifecycle_checklist_item(text,text,boolean,text) to authenticated;

commit;

