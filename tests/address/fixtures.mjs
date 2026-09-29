import { createAddressIndex } from '../../js/address/address-index.js';

export const regions=[
  {code:'1100000000',name:'Region XI (Davao Region)'},
  {code:'1300000000',name:'National Capital Region (NCR)'},
];
export const provinces=[{code:'1102400000',name:'Davao del Sur',regionCode:'1100000000'}];
export const cities=[
  {code:'1102401000',name:'Davao City',regionCode:'1100000000',provinceCode:'1102400000',zip:'8000'},
  {code:'1380600000',name:'City of Makati',regionCode:'1300000000',provinceCode:null,zip:'1200'},
];
export const barangays=[{code:'1102401001',name:'Barangay 1-A',cityCode:'1102401000'}];
export const index=createAddressIndex({regions,provinces,cities});
export const validAddress={regionCode:'1100000000',regionName:'Region XI (Davao Region)',provinceCode:'1102400000',provinceName:'Davao del Sur',cityCode:'1102401000',cityName:'Davao City',barangayCode:'1102401001',barangayName:'Barangay 1-A',addressLine:'Unit 2, Sample Building',zipCode:'8000'};
