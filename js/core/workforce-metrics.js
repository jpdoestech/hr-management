export const AGE_BANDS=[
  {label:'Early Career / Gen Z',low:18,high:26},
  {label:'Young Professionals',low:26,high:31},
  {label:'Mid-Career',low:31,high:41},
  {label:'Experienced',low:41,high:51},
  {label:'Senior Workforce',low:51,high:61},
  {label:'Retirement Eligible',low:61,high:Infinity},
];
export const EXIT_STATUSES=['Separated'];
export const EXIT_CLASSIFICATIONS=['Voluntary','Involuntary','Unconfirmed / Under Review','End of Assignment'];
export const WORKFORCE_FACTORS=['Compensation / Benefits','Career Development','Workload / Schedule','Management / Workplace','Health / Medical','Family / Personal','Transport / Location','Attendance / Conduct','Contract / Assignment End','Retirement','Other','Unknown / Not Disclosed'];
export const ATTENDANCE_STATUSES=['Present','Absent','Approved Leave','Rest Day / Holiday'];
export const ABSENCE_CLASSIFICATIONS=['Authorized','Unauthorized','Pending Validation'];

export function ageOn(birthDate,asOf){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate||'')))return null;
  const birth=new Date(`${birthDate}T00:00:00Z`),date=new Date(`${asOf}T00:00:00Z`);
  if(!Number.isFinite(birth.getTime())||!Number.isFinite(date.getTime())||birth.toISOString().slice(0,10)!==birthDate||birth>date)return null;
  return date.getUTCFullYear()-birth.getUTCFullYear()-(date.getUTCMonth()<birth.getUTCMonth()||(date.getUTCMonth()===birth.getUTCMonth()&&date.getUTCDate()<birth.getUTCDate())?1:0);
}
export function workforceAgeMix(employees,asOf){
  const rows=[...AGE_BANDS,{label:'Under 18',low:0,high:18},{label:'Unknown birth date',low:null,high:null}].map(band=>({...band,male:0,female:0,other:0,total:0}));
  for(const employee of employees){
    const age=ageOn(employee.birthDate,asOf);
    const row=rows.find(band=>age===null?band.low===null:band.low!==null&&age>=band.low&&age<band.high);
    if(!row)continue;
    const gender=String(employee.gender||'').toLowerCase();
    row[gender==='male'?'male':gender==='female'?'female':'other']++;row.total++;
  }
  return rows;
}
const rate=(value,total)=>total?Math.round(value/total*1000)/10:null;
export function attendanceMetrics(records){
  const scheduled=records.filter(row=>row.status!=='Rest Day / Holiday');
  const present=scheduled.filter(row=>row.status==='Present');
  const absent=scheduled.filter(row=>row.status==='Absent');
  const late=present.filter(row=>Number(row.lateMinutes)>0);
  const undertime=present.filter(row=>Number(row.undertimeMinutes)>0);
  const scheduledMinutes=scheduled.reduce((sum,row)=>sum+Number(row.scheduledMinutes||0),0);
  const lostMinutes=scheduled.reduce((sum,row)=>sum+(row.status==='Absent'?Number(row.scheduledMinutes||0):row.status==='Present'?Number(row.lateMinutes||0)+Number(row.undertimeMinutes||0):0),0);
  return {scheduled:scheduled.length,present:present.length,absent:absent.length,leave:scheduled.filter(row=>row.status==='Approved Leave').length,late:late.length,undertime:undertime.length,attendanceRate:rate(present.length,scheduled.length),absenceRate:rate(absent.length,scheduled.length),lateRate:rate(late.length,present.length),undertimeRate:rate(undertime.length,present.length),lostMinutes,scheduledMinutes,lostTimeRate:rate(lostMinutes,scheduledMinutes),unauthorized:absent.filter(row=>row.absenceClassification==='Unauthorized').length};
}
export function validateAttendance(row,records=[],id=''){
  if(!row.employeeId)return 'Select an employee from the search results.';
  const date=new Date(`${row.workDate}T00:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(row.workDate||'')||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==row.workDate)return 'Enter a valid work date.';
  if(!ATTENDANCE_STATUSES.includes(row.status))return 'Select a valid attendance status.';
  if(records.some(item=>item.id!==id&&item.employeeId===row.employeeId&&item.workDate===row.workDate))return 'Attendance already exists for this employee and date.';
  for(const key of ['scheduledMinutes','lateMinutes','undertimeMinutes'])if(!Number.isInteger(Number(row[key]))||Number(row[key])<0)return 'Minutes must be whole, non-negative numbers.';
  if(Number(row.scheduledMinutes)>1440)return 'Scheduled minutes cannot exceed one day (1,440 minutes).';
  if(row.status!=='Rest Day / Holiday'&&Number(row.scheduledMinutes)<=0)return 'Scheduled minutes must be greater than zero.';
  if(row.status!=='Present'&&(Number(row.lateMinutes)||Number(row.undertimeMinutes)))return 'Late and undertime minutes apply only to Present records.';
  if(Number(row.lateMinutes)+Number(row.undertimeMinutes)>Number(row.scheduledMinutes))return 'Late and undertime minutes cannot exceed scheduled minutes.';
  if(row.status==='Absent'&&!ABSENCE_CLASSIFICATIONS.includes(row.absenceClassification))return 'Classify the absence.';
  if(!WORKFORCE_FACTORS.includes(row.factor))return 'Select a contributing factor.';
  return '';
}
export function fillRateSummary(requirements,slots){
  const ids=new Set(requirements.map(row=>String(row.id)));
  const demand=requirements.reduce((sum,row)=>sum+Math.max(0,Number(row.requestedHeadcount)||0),0);
  const relevant=slots.filter(row=>ids.has(String(row.requirementId)));
  const cancelled=relevant.filter(row=>row.status==='Cancelled').length;
  const deployed=relevant.filter(row=>row.status!=='Cancelled'&&(row.status==='Deployed'||row.dateDeployed)).length;
  const required=Math.max(0,demand-cancelled);
  return {demand,cancelled,required,deployed,unfilled:Math.max(0,required-deployed),rate:rate(deployed,required)};
}
