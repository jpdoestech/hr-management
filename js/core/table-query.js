function numericValue(value){
  const compact=String(value||'').replace(/[,₱$%\s]/g,'');
  return compact!==''&&/^-?\d+(\.\d+)?$/.test(compact)?Number(compact):null;
}

function dateValue(value){
  const text=String(value||'').trim();
  if(!text||!(/[A-Za-z]{3,}/.test(text)||/^\d{4}-\d{2}-\d{2}$/.test(text)))return null;
  const parsed=Date.parse(text);
  return Number.isNaN(parsed)?null:parsed;
}

export function normalizeTableValue(value){
  return String(value??'').replace(/\s+/g,' ').trim();
}

export function compareTableValues(a,b,direction='asc'){
  const left=normalizeTableValue(a),right=normalizeTableValue(b);
  const leftNumber=numericValue(left),rightNumber=numericValue(right);
  const leftDate=dateValue(left),rightDate=dateValue(right);
  let result;
  if(leftNumber!==null&&rightNumber!==null)result=leftNumber-rightNumber;
  else if(leftDate!==null&&rightDate!==null)result=leftDate-rightDate;
  else result=left.localeCompare(right,undefined,{numeric:true,sensitivity:'base'});
  return direction==='desc'?-result:result;
}

export function valueMatchesFilter(value,filter){
  const query=normalizeTableValue(filter).toLocaleLowerCase();
  return !query||normalizeTableValue(value).toLocaleLowerCase().includes(query);
}
