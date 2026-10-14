import {dayClassification,validDate} from './attendance-matrix.js';
export const WAGE_DAY_TYPES=['ordinary','rest_day','special_non_working','special_non_working_rest_day','regular_holiday','regular_holiday_rest_day','double_regular_holiday','double_regular_holiday_rest_day'];
export function centsTimesBasisPoints(cents,basisPoints){
  if(!Number.isSafeInteger(cents)||cents<0||!Number.isSafeInteger(basisPoints)||basisPoints<0)throw Error('Use nonnegative integer centavos and basis points.');
  const value=Number((BigInt(cents)*BigInt(basisPoints)+5000n)/10000n);
  if(!Number.isSafeInteger(value))throw Error('Amount exceeds supported precision.');return value;
}
export function resolveDatedVersion(versions,date){
  if(!validDate(date))throw Error('Invalid work date.');
  const matches=versions.filter(v=>v.effectiveFrom<=date&&(!v.effectiveTo||date<v.effectiveTo)).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom));
  if(matches.length>1&&matches[0].effectiveFrom===matches[1].effectiveFrom)throw Error('Ambiguous rule versions need review.');return matches[0]||null;
}
export function holidayEligibility(day,history){
  const evidence=new Map();
  for(const row of history){if(row.employeeId!==day.employeeId||row.clientId!==day.clientId||row.date>=day.date||evidence.has(row.date))throw Error('Evidence must contain unique earlier dates for the same employee/client.');evidence.set(row.date,row);}
  let date=new Date(Date.parse(day.date)-86400000).toISOString().slice(0,10);
  for(let i=0;i<=evidence.size;i++){
    const prior=evidence.get(date);
    if(!prior?.calendarReviewed||!prior.scheduleReviewed||prior.attendance&&prior.attendance.reviewState!=='Approved')return {status:'Needs Review',date};
    if(prior.attendance?.status==='Approved Leave'&&!['Paid','Unpaid'].includes(prior.attendance.leaveTreatment)||prior.attendance?.status==='Present'&&!Number.isFinite(prior.attendance.workedMinutes))return {status:'Needs Review',date};
    if(prior.attendance?.status==='Present'&&prior.attendance.workedMinutes>0||prior.attendance?.status==='Approved Leave'&&prior.attendance.leaveTreatment==='Paid')return {status:'Eligible',date};
    const regular=['regular_holiday','double_regular_holiday'].includes(prior.holiday);
    if(regular&&!prior.attendance)return {status:'Needs Review',date};
    if(regular||prior.restDay||prior.holiday==='special_non_working'){date=new Date(Date.parse(date)-86400000).toISOString().slice(0,10);continue;}
    return {status:prior.attendance?'Ineligible':'Needs Review',date};
  }
  return {status:'Needs Review',date};
}
export function dailyWagePreview({day,history=[],policy,statutory,basicDailyCentavos,coverageConfirmed=false,payBasis='daily'}){
  const blocked=reason=>({status:'Needs Review',centavos:null,reason});
  if(!policy||!statutory||!coverageConfirmed||payBasis!=='daily'||!validDate(day?.date))return blocked('Reviewed client policy, statutory coverage and daily pay basis are required.');
  if(!Number.isSafeInteger(basicDailyCentavos)||basicDailyCentavos<=0)return blocked('A reviewed daily rate in integer centavos is required.');
  if(!policy.id||!statutory.id||!day.calendarVersion||!day.scheduleVersion||!day.attendance?.version)return blocked('Source version evidence is required.');
  for(const v of [policy,statutory])if(!v.reviewed||!v.reference||!validDate(v.effectiveFrom)||v.effectiveFrom>day.date||v.effectiveTo&&day.date>=v.effectiveTo)return blocked('Policy/rule not reviewed or effective on the work date.');
  if(policy.clientId!==day.clientId||policy.statutoryId!==statutory.id)return blocked('Policy/rule identity mismatch.');
  for(const type of WAGE_DAY_TYPES)for(const key of ['worked','unworked']){
    const rate=policy[key]?.[type],minimum=statutory[key]?.[type];
    if(!Number.isSafeInteger(rate)||!Number.isSafeInteger(minimum)||rate<minimum||minimum<0)return blocked('Missing or below-minimum configured rate.');
  }
  if(!day.calendarReviewed||!day.scheduleReviewed||day.attendance?.reviewState!=='Approved')return blocked('Calendar, schedule and attendance evidence need review.');
  const type=dayClassification(day.holiday,day.restDay),worked=day.attendance.status==='Present';
  if(worked&&day.attendance.workedMinutes!==480)return blocked('Partial days, overtime and other duty lengths require separate allocation.');
  if(!worked&&day.attendance.status==='Approved Leave')return blocked('Paid-leave entitlement is a separate calculation.');
  let eligible=null;
  if(!worked&&['regular_holiday','double_regular_holiday'].includes(day.holiday)){
    eligible=policy.waivePrecedingCondition===true?{status:'Eligible'}:holidayEligibility(day,history);
    if(eligible.status==='Needs Review')return blocked('Preceding qualifying evidence is missing or unreviewed.');
  }
  const basisPoints=eligible?.status==='Ineligible'?0:policy[worked?'worked':'unworked'][type];
  return {status:'Estimated',centavos:centsTimesBasisPoints(basicDailyCentavos,basisPoints),basisPoints,classification:type,eligibility:eligible,
    versions:{policy:policy.id,statutory:statutory.id,calendar:day.calendarVersion,schedule:day.scheduleVersion,attendance:day.attendance.version},reason:'Basic first-eight-hour estimate only; not certified payroll.'};
}
