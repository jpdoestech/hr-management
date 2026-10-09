export const EMPLOYMENT_TYPES=['Regular / Permanent','Probationary','Project-Based','Seasonal','Fixed-Term / Contractual','Casual'];
export const EMPLOYMENT_STATUSES=['Active','Inactive','Separated'];
export const STATUS_REASONS={
  Active:['Active / Normal','Return to Agency','Reinstated','Rehired'],
  Inactive:['On Leave','Suspended','Floating Status','AWOL (Pending Review)','Returned to Agency'],
  Separated:['Resigned','Dismissed / Terminated','Contract / Project Completed','Retired','Deceased','Other / Review Required'],
};
export const REVIEW_TYPE='Unspecified / Review Required';
export function canonicalEmploymentType(value){
  const text=String(value||'').trim();
  const aliases={regular:'Regular / Permanent',permanent:'Regular / Permanent','fixed-term (contractual)':'Fixed-Term / Contractual','fixed-term':'Fixed-Term / Contractual',contractual:'Fixed-Term / Contractual'};
  return EMPLOYMENT_TYPES.find(type=>type.toLowerCase()===text.toLowerCase())||aliases[text.toLowerCase()]||'';
}
export function normalizeEmployment(record){
  const result={...record};
  const legacy=String(record.status||'Active');
  if(!EMPLOYMENT_STATUSES.includes(legacy)){
    result.legacyEmploymentStatus=record.legacyEmploymentStatus||legacy;
    const mappings={AWOL:['Inactive','AWOL (Pending Review)'],Resigned:['Separated','Resigned'],'Returned to Agency':['Inactive','Returned to Agency']};
    [result.status,result.statusReason]=mappings[legacy]||['Active','Active / Normal'];
  }else {result.status=legacy;result.statusReason=record.statusReason|| (legacy==='Active'?'Active / Normal':legacy==='Inactive'?'Floating Status':'Other / Review Required');}
  result.employmentType=record.employmentType===REVIEW_TYPE?REVIEW_TYPE:canonicalEmploymentType(record.employmentType)||canonicalEmploymentType(record.classOverride)||REVIEW_TYPE;
  result.employmentTypeNeedsReview=result.employmentType===REVIEW_TYPE;
  // Dates are independent: never infer a status event from the hiring date.
  result.statusDate=record.statusDate||'';
  return result;
}
export function isSeparated(record){return normalizeEmployment(record).status==='Separated';}
export function isEmployed(record){return normalizeEmployment(record).status!=='Separated';}
export function employmentValidation(record,{allowLegacy=false}={}){
  if(!EMPLOYMENT_TYPES.includes(record.employmentType)&&!(allowLegacy&&record.employmentType===REVIEW_TYPE))return 'Select an Employment Type based on the actual contract.';
  if(!EMPLOYMENT_STATUSES.includes(record.status))return 'Select Active, Inactive, or Separated for Employment Status.';
  if(!STATUS_REASONS[record.status].includes(record.statusReason))return 'Select a Status Reason valid for the selected Employment Status.';
  if(record.status!=='Active'&&!record.statusDate)return 'An inactive or separated employee requires a Status Effective Date.';
  if(record.statusDate&&record.dateHired&&record.statusDate<record.dateHired)return 'Status Effective Date cannot be before Date Hired.';
  return '';
}
