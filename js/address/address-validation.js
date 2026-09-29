import { addressHasValue, normalizeAddress } from './address-models.js';
import { normalizeAddressSearch } from './address-index.js';

function sameName(left,right){return normalizeAddressSearch(left)===normalizeAddressSearch(right);}

export function validatePhilippineAddress(value,{index,barangays=[],required=false}={}){
  const address=normalizeAddress(value);
  const errors={};
  if(!addressHasValue(address)){
    if(required)errors.region='Address is required.';
    return {valid:!required,address,errors};
  }
  const region=index?.regionByCode?.get(address.regionCode);
  if(!region||!sameName(region.name,address.regionName))errors.region='Select a valid region from the suggestions.';
  const availableProvinces=region?index.provincesForRegion(region.code):[];
  let province=null;
  if(availableProvinces.length){
    province=index?.provinceByCode?.get(address.provinceCode);
    if(!province||province.regionCode!==region?.code||!sameName(province.name,address.provinceName))errors.province='Select a valid province from the suggestions.';
  }else if(address.provinceCode||address.provinceName){
    errors.province='Province is not applicable to the selected region.';
  }
  const city=index?.cityByCode?.get(address.cityCode);
  if(!city||city.regionCode!==region?.code||(availableProvinces.length&&city.provinceCode!==province?.code)||!sameName(city.name,address.cityName))errors.city='Select a valid city or municipality from the suggestions.';
  const barangay=barangays.find(row=>String(row.code)===address.barangayCode&&sameName(row.name,address.barangayName));
  if(!barangay||String(barangay.cityCode||address.cityCode)!==address.cityCode)errors.barangay='Select a valid barangay from the suggestions.';
  if(city&&String(city.zip||'')&&address.zipCode!==String(city.zip))errors.zipCode='ZIP code must match the selected city or municipality.';
  return {valid:Object.keys(errors).length===0,address,errors};
}

export function addressValidationMessage(errors={}){
  return ['region','province','city','barangay','zipCode'].map(key=>errors[key]).find(Boolean)||'';
}
