begin;

-- Phase 28: Employee Relations chronology and finalization guardrails.
-- Existing rows are preserved. The triggers validate future inserts and updates
-- while Data Quality & Governance flags legacy exceptions for review.

create or replace function public.validate_case_decision_notice_timeline()
returns trigger language plpgsql security definer set search_path=public,auth as $$
begin
  if new.nod_status in ('Finalized','Issued','Served') and new.decision_status not in ('Approved','Superseded','Reversed') then
    raise exception 'A Notice of Decision cannot be finalized before the decision is approved.' using errcode='23514';
  end if;
  if new.nod_status in ('Finalized','Issued','Served') and nullif(trim(coalesce(new.nod_record_id,'')),'') is null then
    raise exception 'A finalized Notice of Decision requires a linked NOD record.' using errcode='23514';
  end if;
  if new.nod_status in ('Issued','Served') and new.nod_issued_at is null then
    raise exception 'An issued Notice of Decision requires an issue date.' using errcode='23514';
  end if;
  if new.nod_status='Served' and new.nod_served_at is null then
    raise exception 'A served Notice of Decision requires a service date.' using errcode='23514';
  end if;
  if new.nod_issued_at is not null and new.decision_date is not null and new.nod_issued_at < new.decision_date then
    raise exception 'The Notice of Decision issue date cannot precede the decision date.' using errcode='23514';
  end if;
  if new.nod_served_at is not null and new.nod_issued_at is not null and new.nod_served_at < new.nod_issued_at then
    raise exception 'The Notice of Decision service date cannot precede its issue date.' using errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_case_decision_notice_timeline on public.hr_case_decisions;
create trigger validate_case_decision_notice_timeline
before insert or update of decision_status,nod_status,nod_record_id,nod_issued_at,nod_served_at,decision_date on public.hr_case_decisions
for each row execute function public.validate_case_decision_notice_timeline();

create or replace function public.validate_case_response_timeline()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare earliest_nte_issue date;
begin
  if new.received_at is null then return new; end if;
  select min((record.data->>'dateIssued')::date) into earliest_nte_issue
  from public.hr_case_links link
  join public.hr_records record
    on record.tenant_id=new.tenant_id and record.module='nte' and record.record_id=link.record_id
  where link.tenant_id=new.tenant_id and link.case_id=new.case_id and link.module='nte'
    and coalesce(record.data->>'dateIssued','') ~ '^\d{4}-\d{2}-\d{2}$';
  if earliest_nte_issue is not null and new.received_at::date < earliest_nte_issue then
    raise exception 'Employee response cannot be received before the linked NTE issue date.' using errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_case_response_timeline on public.hr_case_responses;
create trigger validate_case_response_timeline
before insert or update of case_id,received_at on public.hr_case_responses
for each row execute function public.validate_case_response_timeline();

create or replace function public.validate_case_implementation_timeline()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare baseline_date date;
begin
  if new.decision_id is not null then
    select decision_date into baseline_date from public.hr_case_decisions
    where id=new.decision_id and tenant_id=new.tenant_id and case_id=new.case_id;
  elsif new.history_id is not null then
    select finalization_date into baseline_date from public.hr_disciplinary_history
    where id=new.history_id and tenant_id=new.tenant_id and case_id=new.case_id;
  end if;
  if baseline_date is not null and (
    (new.issued_date is not null and new.issued_date < baseline_date)
    or (new.effective_date is not null and new.effective_date < baseline_date)
    or (new.suspension_start is not null and new.suspension_start < baseline_date)
    or (new.completion_date is not null and new.completion_date < baseline_date)
  ) then
    raise exception 'Implementation dates cannot precede the approved decision or finalized history date.' using errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_case_implementation_timeline on public.hr_case_implementations;
create trigger validate_case_implementation_timeline
before insert or update of decision_id,history_id,issued_date,effective_date,suspension_start,completion_date on public.hr_case_implementations
for each row execute function public.validate_case_implementation_timeline();

comment on function public.validate_case_decision_notice_timeline() is 'Prevents NOD finalization and service chronology from preceding the approved Employee Relations decision.';
comment on function public.validate_case_response_timeline() is 'Prevents normalized employee responses from predating a linked NTE issue date while preserving legacy rows.';
comment on function public.validate_case_implementation_timeline() is 'Prevents final-action implementation dates from predating their approved decision or finalized history source.';

commit;
