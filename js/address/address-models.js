export const ADDRESS_LEVELS = ['region','province','city','barangay'];

export function emptyAddress(){
  return {
    regionCode:'',regionName:'',provinceCode:'',provinceName:'',cityCode:'',cityName:'',
    barangayCode:'',barangayName:'',addressLine:'',zipCode:'',formattedAddress:'',legacy:false,
  };
}

export function formatPhilippineAddress(value={}){
  if(typeof value==='string')return value.trim();
  const address=value&&typeof value==='object'?value:{};
  const parts=[address.addressLine||address.street||address.details,address.barangayName||address.barangay?.name,address.cityName||address.city?.name||address.municipalityName,address.provinceName||address.province?.name,address.regionName||address.region?.name].map(part=>String(part||'').trim()).filter(Boolean);
  const base=parts.join(', ');
  const zipCode=String(address.zipCode||address.zip||'').trim();
  return zipCode?`${base}${base?' ':''}${zipCode}`:base;
}

export function normalizeAddress(value,legacyFallback=''){
  if(typeof value==='string'){
    const text=value.trim();
    return {...emptyAddress(),addressLine:text,formattedAddress:text,legacy:!!text};
  }
  const source=value&&typeof value==='object'?value:{};
  const address={
    ...emptyAddress(),
    regionCode:String(source.regionCode||source.region?.code||''),
    regionName:String(source.regionName||source.region?.name||''),
    provinceCode:String(source.provinceCode||source.province?.code||''),
    provinceName:String(source.provinceName||source.province?.name||''),
    cityCode:String(source.cityCode||source.city?.code||source.municipalityCode||''),
    cityName:String(source.cityName||source.city?.name||source.municipalityName||''),
    barangayCode:String(source.barangayCode||source.barangay?.code||''),
    barangayName:String(source.barangayName||source.barangay?.name||''),
    addressLine:String(source.addressLine||source.street||source.details||''),
    zipCode:String(source.zipCode||source.zip||''),
    legacy:source.legacy===true,
  };
  if(!address.addressLine&&!address.regionName&&legacyFallback){
    address.addressLine=String(legacyFallback).trim();
    address.legacy=!!address.addressLine;
  }
  address.formattedAddress=String(source.formattedAddress||'').trim()||formatPhilippineAddress({...address,formattedAddress:''});
  return address;
}

export function addressHasValue(value){
  const address=normalizeAddress(value);
  return ['regionName','provinceName','cityName','barangayName','addressLine','zipCode'].some(key=>Boolean(address[key]));
}

export function cloneAddress(value){return normalizeAddress(JSON.parse(JSON.stringify(normalizeAddress(value))));}

export function clearAddressChildren(value,level){
  const address=normalizeAddress(value);
  const start=ADDRESS_LEVELS.indexOf(level)+1;
  if(start<=0)return address;
  ADDRESS_LEVELS.slice(start).forEach(child=>{
    address[`${child}Code`]='';
    address[`${child}Name`]='';
  });
  if(['region','province','city'].includes(level))address.zipCode='';
  address.formattedAddress=formatPhilippineAddress(address);
  return address;
}
