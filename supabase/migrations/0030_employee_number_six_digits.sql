-- Canonical employee numbers: EMP- followed by a six-digit sequence.
-- Existing valid legacy numbers are padded. Missing, malformed, or colliding
-- values receive the next available sequence without deleting employee data.

begin;

do $$
declare
  employee_row record;
  parsed_number integer;
  assigned_number integer;
  next_number integer;
  used_numbers integer[] := array[]::integer[];
begin
  select coalesce(max((substring(data->>'employeeNo' from '([0-9]+)$'))::integer),0)
    into next_number
  from public.hr_records
  where module='employees'
    and coalesce(data->>'employeeNo','') ~* '^EMP-[0-9]{1,6}$'
    and (substring(data->>'employeeNo' from '([0-9]+)$'))::integer between 1 and 999999;

  for employee_row in
    select record_id,data
    from public.hr_records
    where module='employees'
    order by record_id
  loop
    parsed_number := null;
    if coalesce(employee_row.data->>'employeeNo','') ~* '^EMP-[0-9]{1,6}$' then
      parsed_number := (substring(employee_row.data->>'employeeNo' from '([0-9]+)$'))::integer;
      if parsed_number < 1 or parsed_number > 999999 then
        parsed_number := null;
      end if;
    end if;

    if parsed_number is not null and not (parsed_number = any(used_numbers)) then
      assigned_number := parsed_number;
    else
      loop
        next_number := next_number+1;
        if next_number > 999999 then
          raise exception 'Cannot assign employee number: six-digit sequence is exhausted';
        end if;
        exit when not (next_number = any(used_numbers));
      end loop;
      assigned_number := next_number;
    end if;

    used_numbers := array_append(used_numbers,assigned_number);
    update public.hr_records
       set data=jsonb_set(data,'{employeeNo}',to_jsonb('EMP-'||lpad(assigned_number::text,6,'0')),true)
     where module='employees' and record_id=employee_row.record_id;
  end loop;
end;
$$;

create unique index if not exists hr_records_employee_number_unique_idx
  on public.hr_records (upper(data->>'employeeNo'))
  where module='employees';

create or replace function public.enforce_employee_number_format()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.module='employees'
     and coalesce(new.data->>'employeeNo','') !~ '^EMP-[0-9]{6}$' then
    raise exception 'Employee number must use EMP- followed by exactly six digits (for example EMP-000001)'
      using errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists hr_records_employee_number_format on public.hr_records;
create trigger hr_records_employee_number_format
before insert or update of data,module on public.hr_records
for each row execute function public.enforce_employee_number_format();

commit;
