-- Reviewed release only. Read-only API; existing reservation/source RLS remains authoritative.
begin;
create function public.manpower_line_workers(p_request text,p_line text,p_page integer default 1,
  p_size integer default 10,p_search text default '',p_state text default '') returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare result jsonb;
begin
  if auth.uid() is null or public.current_tenant_id() is null
    or not coalesce(public.current_user_has_permission('manpower.view'),false)
    or not coalesce(public.current_user_has_permission('onboarding.view'),false) then
    raise exception 'Worker monitoring access denied' using errcode='42501';end if;
  if p_page is null or p_page<1 or p_size is null or p_size not in (10,25,50)
    or p_search is null or length(p_search)>120 or p_state is null
    or p_state not in ('','Reserved','Scheduled','Deployed','Ended','Released','Reversed') then
    raise exception 'Use a valid page, bounded search and assignment state' using errcode='23514';end if;
  if not exists(select 1 from public.hr_manpower_lines line
    join public.hr_manpower_requests request on request.tenant_id=line.tenant_id and request.id=line.request_id
    where line.tenant_id=public.current_tenant_id() and line.id=p_line and line.request_id=p_request
      and request.state in ('Open','Closed','Cancelled') and public.can_read_manpower_draft(p_request)) then
    raise exception 'Submitted line unavailable or outside your scope' using errcode='42501';end if;
  with permitted as (
    select reservation.id,reservation.candidate_id,reservation.employee_id,reservation.hiring_category,
      reservation.state,reservation.created_at,reservation.scheduled_date,reservation.actual_date,reservation.ended_date,
      coalesce(nullif(concat_ws(', ',nullif(btrim(candidate.data->>'lastName'),''),
        nullif(btrim(concat_ws(' ',candidate.data->>'firstName',candidate.data->>'middleName')),'')),''),
        nullif(candidate.data->>'name',''),'Name unavailable') as name
    from public.hr_manpower_reservations reservation
    join public.hr_records candidate on candidate.tenant_id=reservation.tenant_id
      and candidate.module='onboardingCandidates' and candidate.record_id=reservation.candidate_id
    where reservation.tenant_id=public.current_tenant_id() and reservation.line_id=p_line
      and (p_state='' or reservation.state=p_state)
  ), filtered as (
    select * from permitted where p_search='' or
      strpos(lower(name),lower(btrim(p_search)))>0 or strpos(lower(candidate_id),lower(btrim(p_search)))>0
      or strpos(lower(coalesce(employee_id,'')),lower(btrim(p_search)))>0
  ), paged as (
    select * from filtered order by created_at desc,id
      limit p_size offset ((p_page::bigint-1)*p_size)
  ) select jsonb_build_object('count',(select count(*) from filtered),
    'data',coalesce((select jsonb_agg(to_jsonb(paged) order by created_at desc,id) from paged),'[]'::jsonb)) into result;
  return result;
end $$;
revoke all on function public.manpower_line_workers(text,text,integer,integer,text,text) from public,anon;
grant execute on function public.manpower_line_workers(text,text,integer,integer,text,text) to authenticated;
commit;
