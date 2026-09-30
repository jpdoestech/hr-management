export function columnKey(label, index = 0) {
  const normalized=String(label||'column').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  return `${normalized||'column'}-${index}`;
}

export function reconcileColumnOrder(columns, savedOrder = []) {
  const available=[...new Set((columns||[]).filter(Boolean))];
  const known=new Set(available);
  const result=[];
  (savedOrder||[]).forEach(key=>{
    if(known.has(key)&&!result.includes(key)) result.push(key);
  });
  available.forEach(key=>{ if(!result.includes(key)) result.push(key); });
  return result;
}

export function moveColumn(order, sourceKey, targetKey) {
  const result=[...(order||[])];
  const sourceIndex=result.indexOf(sourceKey);
  const targetIndex=result.indexOf(targetKey);
  if(sourceIndex<0||targetIndex<0||sourceIndex===targetIndex) return result;
  result.splice(sourceIndex,1);
  result.splice(result.indexOf(targetKey),0,sourceKey);
  return result;
}

export function normalizeFrozenColumns(columns, frozen = []) {
  const available=new Set(columns||[]);
  return [...new Set((frozen||[]).filter(key=>available.has(key)))];
}
