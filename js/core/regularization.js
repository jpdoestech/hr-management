export function regularizationToday(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  return ['year','month','day'].map(key=>parts.find(part=>part.type===key).value).join('-');
}
export function regularizationDate(dateHired){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(dateHired||'')))return '';
  const date=new Date(`${dateHired}T00:00:00Z`);
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==dateHired)return '';
  const day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+6);
  const end=new Date(date);end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);
  date.setUTCDate(Math.min(day,end.getUTCDate()));return date.toISOString().slice(0,10);
}
export function regularizationWorkItems(employees,today){
  const horizon=new Date(`${today}T00:00:00Z`);horizon.setUTCDate(horizon.getUTCDate()+14);
  const since=new Date(`${today}T00:00:00Z`);since.setUTCDate(since.getUTCDate()-14);
  const items=[];
  for(const employee of employees){
    const due=regularizationDate(employee.dateHired),marker=employee.automaticRegularization;
    const processedOn=marker?.processedOn||marker?.processedAt?.slice(0,10)||'';
    if(employee.employmentType==='Probationary'&&['Active','Inactive'].includes(employee.status)&&due&&due<=horizon.toISOString().slice(0,10)){
      items.push({id:`regularization-due-${employee.id}-${due}`,employeeId:employee.id,level:due<=today?'danger':'warning',title:due<=today?'Regularization due':'Regularization approaching',date:due,completed:false});
    }else if(marker?.policy==='six-calendar-months-v1'&&processedOn>=since.toISOString().slice(0,10)&&processedOn<=today){
      items.push({id:`regularization-completed-${employee.id}-${marker.effectiveDate}`,employeeId:employee.id,level:'info',title:'Automatically regularized',date:marker.effectiveDate,completed:true});
    }
  }
  return items;
}
