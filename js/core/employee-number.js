export const EMPLOYEE_NUMBER_DIGITS=6;
export const EMPLOYEE_NUMBER_MAX=999999;

export function employeeNumberSequence(value){
  const text=String(value??'').trim();
  const match=text.match(/^(?:EMP[\s_-]?)?(\d{1,6})$/i);
  if(!match) return null;
  const sequence=Number(match[1]);
  return Number.isInteger(sequence)&&sequence>=1&&sequence<=EMPLOYEE_NUMBER_MAX?sequence:null;
}

export function normalizeEmployeeNumber(value){
  const sequence=employeeNumberSequence(value);
  return sequence===null?String(value??'').trim().toUpperCase():`EMP-${String(sequence).padStart(EMPLOYEE_NUMBER_DIGITS,'0')}`;
}

export function isValidEmployeeNumber(value){
  return /^EMP-\d{6}$/.test(String(value??'').trim())&&employeeNumberSequence(value)!==null;
}

export function nextEmployeeNumber(records=[]){
  const highest=(records||[]).reduce((max,record)=>Math.max(max,employeeNumberSequence(record?.employeeNo)??0),0);
  const next=highest+1;
  if(next>EMPLOYEE_NUMBER_MAX) throw new RangeError('The six-digit employee number sequence is exhausted.');
  return `EMP-${String(next).padStart(EMPLOYEE_NUMBER_DIGITS,'0')}`;
}
