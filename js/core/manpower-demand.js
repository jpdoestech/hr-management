export const MAX_MANPOWER_QUANTITY=2147483647;
export function normalizePrfNumber(value){return String(value??'').trim().replace(/\s+/g,' ').toLowerCase();}
export function manpowerQuantity(value,{allowZero=false}={}){
  const text=String(value??'').trim();
  if(!/^\d+$/.test(text))throw new Error('Headcount must be a whole number.');
  const quantity=Number(text);
  if(!Number.isSafeInteger(quantity)||quantity<(allowZero?0:1)||quantity>MAX_MANPOWER_QUANTITY)throw new Error(`Headcount must be between ${allowZero?0:1} and ${MAX_MANPOWER_QUANTITY}.`);
  return quantity;
}
// This is a preview calculation. The future transaction RPC must enforce it under locks.
export function manpowerDemandBalance(line,assignments=[]){
  const authorized=manpowerQuantity(line.currentAuthorized);
  const cancelled=manpowerQuantity(line.cancelledUnfilled??0,{allowZero:true});
  const rows=assignments.filter(row=>row.lineId===line.id);
  const reserved=rows.filter(row=>['Reserved','Scheduled'].includes(row.state)).length;
  const scheduled=rows.filter(row=>row.state==='Scheduled').length;
  const fulfilled=rows.filter(row=>['Confirmed','Ended'].includes(row.state)&&row.creditVoided!==true).length;
  const activeDeployed=rows.filter(row=>row.state==='Confirmed'&&row.creditVoided!==true).length;
  const effectiveCapacity=authorized-cancelled;
  const available=effectiveCapacity-reserved-fulfilled;
  if(effectiveCapacity<0||available<0)throw new Error('Authorization cannot be reduced below reserved and valid fulfilled commitments.');
  return {originalRequested:line.originalRequested==null?null:manpowerQuantity(line.originalRequested),currentAuthorized:authorized,cancelledUnfilled:cancelled,effectiveCapacity,reserved,scheduled,fulfilled,activeDeployed,available};
}
