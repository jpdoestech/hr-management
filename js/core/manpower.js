function isoDate(value){
  const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(!match)return null;
  const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));
  return Number.isNaN(date.getTime())?null:date;
}

export function calendarDaysBetween(start,end){
  const from=isoDate(start),to=isoDate(end);
  if(!from||!to)return null;
  return Math.round((to-from)/86400000);
}

export function manpowerTargetDate(request,requirements=[]){
  const dates=requirements.map(row=>row.targetDeploymentDateOverride).filter(Boolean).sort();
  return dates[0]||request?.targetDeploymentDate||'';
}

export function requirementSlotCounts(requirement,slots=[]){
  const rows=slots.filter(slot=>String(slot.requirementId)===String(requirement?.id));
  const requested=Math.max(0,Number(requirement?.requestedHeadcount)||0);
  const cancelled=rows.filter(slot=>slot.status==='Cancelled').length;
  const deployed=rows.filter(slot=>Boolean(slot.dateDeployed)||slot.status==='Deployed').length;
  const onboarded=rows.filter(slot=>Boolean(slot.dateOnboarded)||['Onboarded / Ready for Deployment','Deployed'].includes(slot.status)).length;
  const selected=rows.filter(slot=>Boolean(slot.employeeId||slot.candidateId||slot.dateSelected)||['Candidate Identified','For Onboarding','Onboarded / Ready for Deployment','Deployed'].includes(slot.status)).length;
  return {requested,selected,onboarded,deployed,cancelled,remaining:Math.max(0,requested-deployed-cancelled),slots:rows};
}

function average(values){
  const valid=values.filter(value=>Number.isFinite(value));
  return valid.length?Math.round((valid.reduce((sum,value)=>sum+value,0)/valid.length)*10)/10:null;
}

export function slotMetrics(slot,request,requirement={}){
  const requestDate=request?.dateRequested||'';
  const target=requirement?.targetDeploymentDateOverride||request?.targetDeploymentDate||'';
  return {
    timeToOnboard:calendarDaysBetween(requestDate,slot?.dateOnboarded),
    deploymentLeadTime:calendarDaysBetween(slot?.dateOnboarded,slot?.dateDeployed),
    totalFulfillmentTime:calendarDaysBetween(requestDate,slot?.dateDeployed),
    deploymentVariance:calendarDaysBetween(target,slot?.dateDeployed),
    replacementLeadTime:calendarDaysBetween(slot?.replacementExitDate,slot?.dateDeployed),
  };
}

export function slotChronologyIssues(slot,request,requirement={}){
  const issues=[];
  const target=requirement?.targetDeploymentDateOverride||request?.targetDeploymentDate||'';
  if(slot?.dateSelected&&calendarDaysBetween(request?.dateRequested,slot.dateSelected)<0)issues.push('Selected date is before the request date.');
  if(slot?.dateOnboarded&&calendarDaysBetween(request?.dateRequested,slot.dateOnboarded)<0)issues.push('Onboarded date is before the request date.');
  if(slot?.dateDeployed&&calendarDaysBetween(request?.dateRequested,slot.dateDeployed)<0)issues.push('Deployed date is before the request date.');
  if(slot?.dateOnboarded&&slot?.dateDeployed&&calendarDaysBetween(slot.dateOnboarded,slot.dateDeployed)<0)issues.push('Deployed date is before the onboarded date.');
  if(slot?.dateDeployed&&!slot?.employeeId)issues.push('A deployed slot must be linked to an employee.');
  if(requirement?.requestType==='Expansion'&&slot?.replacementEmployeeId)issues.push('An expansion slot cannot have a replacement employee.');
  if(requirement?.requestType==='Replacement'&&!slot?.replacementEmployeeId&&!slot?.legacyReplacementName)issues.push('A replacement slot requires the employee being replaced or a historical exception.');
  if(target&&request?.dateRequested&&calendarDaysBetween(request.dateRequested,target)<0)issues.push('Target deployment date is before the request date.');
  return issues;
}

export function manpowerRequestSummary(request,requirements=[],slots=[],today=new Date().toISOString().slice(0,10)){
  const requestRequirements=requirements.filter(row=>String(row.requestId)===String(request?.id));
  const requirementIds=new Set(requestRequirements.map(row=>String(row.id)));
  const requestSlots=slots.filter(row=>String(row.requestId)===String(request?.id)||requirementIds.has(String(row.requirementId)));
  const counts=requestRequirements.reduce((total,requirement)=>{
    const current=requirementSlotCounts(requirement,requestSlots);
    Object.keys(total).forEach(key=>total[key]+=current[key]||0);
    return total;
  },{requested:0,selected:0,onboarded:0,deployed:0,cancelled:0,remaining:0});
  const target=manpowerTargetDate(request,requestRequirements);
  const daysToTarget=target?calendarDaysBetween(today,target):null;
  const fulfilled=counts.requested>0&&counts.deployed>=counts.requested;
  const closedByCancellation=counts.requested>0&&counts.cancelled>0&&counts.remaining===0&&!fulfilled;
  const deployedDates=requestSlots.filter(slot=>slot.dateDeployed).map(slot=>slot.dateDeployed).sort();
  const lastDeployment=deployedDates.at(-1)||'';
  let risk='No Target';
  if(closedByCancellation)risk='Closed';
  else if(target){
    if(fulfilled)risk=calendarDaysBetween(target,lastDeployment)<=0?'Deployed On Time':'Deployed Late';
    else if(daysToTarget<0)risk='Overdue';
    else if(daysToTarget===0)risk='Due Today';
    else if(daysToTarget<=3)risk='At Risk';
    else if(daysToTarget<=7)risk='Monitor';
    else risk='On Track';
  }
  let status=request?.status||'Draft';
  if(['Cancelled','Closed'].includes(status))status=request.status;
  else if(!counts.requested)status='Draft';
  else if(fulfilled)status='Fulfilled';
  else if(closedByCancellation)status='Closed';
  else if(risk==='Overdue')status='Overdue';
  else if(risk==='At Risk'||risk==='Due Today')status='At Risk';
  else if(counts.deployed)status='Partially Fulfilled';
  else if(counts.selected||counts.onboarded)status='In Progress';
  else status='Open';
  const metrics=requestSlots.map(slot=>slotMetrics(slot,request,requestRequirements.find(row=>String(row.id)===String(slot.requirementId))));
  return {
    ...counts,
    target,
    daysToTarget,
    fulfillmentRate:counts.requested?Math.round((counts.deployed/counts.requested)*1000)/10:0,
    status,
    risk,
    averageTimeToOnboard:average(metrics.map(row=>row.timeToOnboard)),
    averageTimeToDeploy:average(metrics.map(row=>row.totalFulfillmentTime)),
    averageReplacementLeadTime:average(metrics.map(row=>row.replacementLeadTime)),
  };
}

export function manpowerRequestTotals(requests=[],requirements=[],slots=[],today){
  return requests.reduce((total,request)=>{
    const summary=manpowerRequestSummary(request,requirements,slots,today);
    total.active+=['Open','In Progress','Partially Fulfilled','At Risk','Overdue'].includes(summary.status)?1:0;
    total.requested+=summary.requested;
    total.onboarded+=summary.onboarded;
    total.deployed+=summary.deployed;
    total.remaining+=summary.remaining;
    total.atRisk+=['At Risk','Due Today'].includes(summary.risk)?1:0;
    total.overdue+=summary.risk==='Overdue'?1:0;
    return total;
  },{active:0,requested:0,onboarded:0,deployed:0,remaining:0,atRisk:0,overdue:0});
}
