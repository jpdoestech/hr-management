-- Read-only checks after verified 0044 deployment; every result must be empty.
-- Revision-zero pre-existing planning dates require separate baseline reconciliation.
select * from public.hr_manpower_reservation_intents;

select history.tenant_id,history.reservation_id,history.schedule_revision
from public.hr_manpower_schedule_history history
join public.hr_manpower_reservations reservation on reservation.tenant_id=history.tenant_id and reservation.id=history.reservation_id
left join public.hr_audit_logs audit on audit.id=history.audit_id
where audit.id is null or audit.tenant_id is distinct from history.tenant_id or audit.user_id is null
  or history.schedule_revision>reservation.schedule_revision;

with sequence as (
  select history.*,lag(scheduled_date) over(partition by tenant_id,reservation_id order by schedule_revision) prior_date,
    lag(current_state) over(partition by tenant_id,reservation_id order by schedule_revision) prior_state,
    row_number() over(partition by tenant_id,reservation_id order by schedule_revision) sequence_number,
    row_number() over(partition by tenant_id,reservation_id order by schedule_revision desc) latest
  from public.hr_manpower_schedule_history history
)
select sequence.tenant_id,sequence.reservation_id,sequence.schedule_revision
from sequence join public.hr_manpower_reservations reservation
  on reservation.tenant_id=sequence.tenant_id and reservation.id=sequence.reservation_id
where sequence.schedule_revision<>sequence.sequence_number
  or (sequence.sequence_number>1 and (sequence.previous_date is distinct from sequence.prior_date
    or sequence.previous_state is distinct from sequence.prior_state))
  or (sequence.latest=1 and (sequence.schedule_revision<>reservation.schedule_revision
    or sequence.scheduled_date is distinct from reservation.scheduled_date
    or (reservation.state in ('Reserved','Scheduled') and sequence.current_state<>reservation.state)));

select reservation.tenant_id,reservation.id,reservation.schedule_revision
from public.hr_manpower_reservations reservation
where reservation.schedule_revision>0 and not exists(select 1 from public.hr_manpower_schedule_history history
  where history.tenant_id=reservation.tenant_id and history.reservation_id=reservation.id
    and history.schedule_revision=reservation.schedule_revision);
