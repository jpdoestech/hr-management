-- Gated reference validation prerequisite for atomic employee creation.
begin;
set local lock_timeout='5s';
create table manpower_private.address_locations (
  code text primary key check(code ~ '^[0-9]{10}$'),
  kind text not null check(kind in ('region','province','city','barangay')),
  parent_code text references manpower_private.address_locations(code) deferrable initially deferred,
  name text not null check(length(name)>0),zip text not null default '',
  check((kind='region' and parent_code is null) or (kind<>'region' and parent_code is not null))
);
create index manpower_address_parent on manpower_private.address_locations(parent_code,kind);
create table manpower_private.address_catalog_manifest (
  singleton boolean primary key default true check(singleton),sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  counts jsonb not null
);
alter table manpower_private.address_locations enable row level security;
alter table manpower_private.address_catalog_manifest enable row level security;
revoke all on manpower_private.address_locations,manpower_private.address_catalog_manifest from public,anon,authenticated;
create trigger manpower_address_reference_guard before update or delete on manpower_private.address_locations
  for each row execute function public.guard_manpower_reservation_batch();
create trigger manpower_address_manifest_guard before update or delete on manpower_private.address_catalog_manifest
  for each row execute function public.guard_manpower_reservation_batch();

create function manpower_private.address_name_key(p_name text) returns text
language sql immutable set search_path=public as $$
  select btrim(regexp_replace(lower(regexp_replace(normalize(coalesce(p_name,''),NFKD),U&'[\0300-\036f]','','g')),'[^a-z0-9]+',' ','g'));
$$;
create function manpower_private.validate_employee_address(p_address jsonb) returns jsonb
language plpgsql stable set search_path=public as $$
declare
  address jsonb;key text;level_kind text;location manpower_private.address_locations;
  region manpower_private.address_locations;province manpower_private.address_locations;city manpower_private.address_locations;
  administrative boolean:=false;parts text[]:=array[]::text[];formatted text;zip text;
begin
  if p_address is null or p_address='null'::jsonb then p_address:='{}';end if;
  if jsonb_typeof(p_address)='string' then p_address:=jsonb_build_object('addressLine',p_address#>>'{}','legacy',true);end if;
  if jsonb_typeof(p_address)<>'object' or p_address-array['regionCode','regionName','provinceCode','provinceName','cityCode','cityName',
    'barangayCode','barangayName','addressLine','zipCode','formattedAddress','legacy']<>'{}'::jsonb then
    raise exception 'Use the shared address fields or free-text street address' using errcode='23514';end if;
  if p_address?'legacy' and jsonb_typeof(p_address->'legacy') not in ('boolean','null') then
    raise exception 'Legacy address flag must be boolean' using errcode='23514';end if;
  address:=jsonb_build_object('regionCode','','regionName','','provinceCode','','provinceName','','cityCode','','cityName','',
    'barangayCode','','barangayName','','addressLine','','zipCode','','formattedAddress','','legacy',false);
  for key in select value from jsonb_object_keys(address) value where value<>'legacy' loop
    if p_address?key and jsonb_typeof(p_address->key) not in ('string','null') then
      raise exception 'Address values must be text' using errcode='23514';end if;
    address:=jsonb_set(address,array[key],to_jsonb(btrim(coalesce(p_address->>key,''))));
  end loop;
  if length(address->>'addressLine')>2000 or length(address->>'zipCode')>20 then
    raise exception 'Street address or ZIP is too long' using errcode='23514';end if;
  foreach level_kind in array array['region','province','city','barangay'] loop
    administrative:=administrative or address->>(level_kind||'Code')<>'' or address->>(level_kind||'Name')<>'';
  end loop;
  if administrative then
    if not exists(select 1 from manpower_private.address_catalog_manifest where singleton) then
      raise exception 'Authoritative address reference is not installed; reload after setup' using errcode='23514';end if;
    foreach level_kind in array array['region','province','city','barangay'] loop
      if level_kind='province' and not exists(select 1 from manpower_private.address_locations where parent_code=region.code and address_locations.kind='province') then
        if address->>'provinceCode'<>'' or address->>'provinceName'<>'' then
          raise exception 'Province is not applicable to this region' using errcode='23514';end if;
        continue;
      end if;
      select * into location from manpower_private.address_locations where code=address->>(level_kind||'Code') and address_locations.kind=level_kind;
      if not found or manpower_private.address_name_key(location.name)<>manpower_private.address_name_key(address->>(level_kind||'Name')) then
        raise exception 'Select a valid % from the address suggestions',level_kind using errcode='23514';end if;
      if level_kind='region' then region:=location;
      elsif level_kind='province' then
        if location.parent_code<>region.code then raise exception 'Province does not belong to region' using errcode='23514';end if;province:=location;
      elsif level_kind='city' then
        if location.parent_code<>coalesce(province.code,region.code) then raise exception 'City does not belong to selected parent' using errcode='23514';end if;city:=location;
      elsif location.parent_code<>city.code then raise exception 'Barangay does not belong to city' using errcode='23514';end if;
      address:=jsonb_set(address,array[level_kind||'Name'],to_jsonb(location.name));
    end loop;
    if city.zip<>'' and address->>'zipCode'<>city.zip then raise exception 'ZIP must match the selected city' using errcode='23514';end if;
  end if;
  foreach key in array array['addressLine','barangayName','cityName','provinceName','regionName'] loop
    if address->>key<>'' then parts:=array_append(parts,address->>key);end if;
  end loop;
  formatted:=array_to_string(parts,', ');zip:=address->>'zipCode';
  if zip<>'' then formatted:=formatted||case when formatted='' then '' else ' ' end||zip;end if;
  address:=jsonb_set(address,'{formattedAddress}',to_jsonb(formatted));
  return jsonb_set(address,'{legacy}',to_jsonb(not administrative and address->>'addressLine'<>'' and coalesce(p_address->'legacy'='true'::jsonb,false)));
end $$;
revoke all on function manpower_private.address_name_key(text),manpower_private.validate_employee_address(jsonb) from public,anon,authenticated;
commit;
