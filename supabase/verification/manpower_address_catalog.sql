-- Read-only owner checks; compare manifest SHA with the generator for this checkout.
select 'reference manifest missing' as issue where not exists(select 1 from manpower_private.address_catalog_manifest);

select m.sha256,kind.key from manpower_private.address_catalog_manifest m cross join jsonb_each_text(m.counts) kind
where kind.value::bigint<>(select count(*) from manpower_private.address_locations where address_locations.kind=kind.key);

select child.code from manpower_private.address_locations child left join manpower_private.address_locations parent on parent.code=child.parent_code
where (child.kind='province' and parent.kind is distinct from 'region')
  or (child.kind='city' and coalesce(parent.kind,'') not in ('region','province'))
  or (child.kind='barangay' and parent.kind is distinct from 'city');

select 'reference exposed' as issue where has_table_privilege('authenticated','manpower_private.address_locations','SELECT')
  or has_function_privilege('authenticated','manpower_private.validate_employee_address(jsonb)','EXECUTE');
