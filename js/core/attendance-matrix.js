export const MATRIX_TRANSACTIONS=[
  ['Present','P'],['Absent','A'],['Paid Leave','PL'],['Unpaid Leave','UL'],['Day-off','DO'],['Holiday (Unworked)','HU'],['AWOL/AWOP','AW'],['Late/Undertime','L/U'],
  ['Rest-day Duty','RD'],['Special Non-working Holiday Duty','SH'],['Regular Holiday Duty','RH'],['Double Regular Holiday Duty','DH'],
  ['Special Non-working Holiday + Rest-day Duty','SHR'],['Regular Holiday + Rest-day Duty','RHR'],['Double Regular Holiday + Rest-day Duty','DHR'],
];
export function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
export function cutoffDates(start,end){
  if(!validDate(start)||!validDate(end)||end<start)throw Error('Enter a valid cutoff date range.');
  const count=(Date.parse(end)-Date.parse(start))/86400000+1;
  if(count>31)throw Error('A cutoff can contain at most 31 calendar days.');
  return Array.from({length:count},(_,i)=>new Date(Date.parse(start)+i*86400000).toISOString().slice(0,10));
}
export const attendanceKey=(employeeId,date)=>`${employeeId}:${date}`;
export function matrixPeriod(month,period){
  if(!/^\d{4}-\d{2}$/.test(month)||!validDate(`${month}-01`))throw Error('Select a valid attendance month.');
  const [year,number]=month.split('-').map(Number),last=new Date(Date.UTC(year,number,0)).getUTCDate();
  if(!['first','second','month'].includes(period))throw Error('Select a valid cutoff.');
  return {start:`${month}-${period==='second'?'16':'01'}`,end:`${month}-${String(period==='first'?15:last).padStart(2,'0')}`};
}
export function matrixSummary(row,edits={}){
  const summary={absent:0,dayOff:0,leave:0,awol:0,lost:0,present:0};
  for(const cell of Object.values(row.days)){
    const record=edits[attendanceKey(row.id,cell.date)]||cell.record;if(!record)continue;
    if(record.transaction==='AWOL/AWOP')summary.awol++;
    else if(record.status==='Absent')summary.absent++;
    if(record.status==='Approved Leave')summary.leave++;
    if(record.transaction==='Day-off'||record.status==='Rest Day / Holiday'&&cell.context?.restDay)summary.dayOff++;
    if(record.status==='Present')summary.present++;
    summary.lost+=(Number(record.lateMinutes)||0)+(Number(record.undertimeMinutes)||0);
  }
  return summary;
}
export function validateSegments(segments){
  if(!Array.isArray(segments)||!segments.length||segments.length>12)throw Error('Enter 1 to 12 duty segments.');
  const sorted=segments.map(s=>({...s})).sort((a,b)=>a.start-b.start);
  for(let i=0;i<sorted.length;i++){
    const s=sorted[i];
    if(![s.start,s.end,s.breakMinutes].every(Number.isInteger)||s.start<0||s.start>=2880||s.end>s.start+1440||s.end>2880||s.end<=s.start||s.breakMinutes<0||s.breakMinutes>=s.end-s.start||i&&s.start<sorted[i-1].end)throw Error('Duty times or breaks are invalid or overlap.');
  }
  if(sorted.reduce((total,s)=>total+s.end-s.start-s.breakMinutes,0)>1440)throw Error('Total duty minutes cannot exceed 24 hours per attendance date.');
  return sorted;
}
export function dutyMetrics(schedule,actual){
  const duties=validateSegments(schedule),punches=validateSegments(actual);
  const total=rows=>rows.reduce((sum,s)=>sum+s.end-s.start-s.breakMinutes,0);
  let late=0,undertime=0;
  for(const duty of duties){
    const overlaps=punches.filter(s=>s.start<duty.end&&s.end>duty.start);
    if(!overlaps.length){undertime+=duty.end-duty.start-duty.breakMinutes;continue;}
    const first=Math.max(duty.start,overlaps[0].start),last=Math.min(duty.end,overlaps.at(-1).end);
    late+=first-duty.start;undertime+=duty.end-last;
    let cursor=first;
    for(const s of overlaps){if(s.start>cursor)undertime+=s.start-cursor;cursor=Math.max(cursor,s.end);}
    const actualBreak=overlaps.reduce((n,s)=>n+s.breakMinutes,0);
    undertime+=Math.max(0,actualBreak-duty.breakMinutes);
  }
  const scheduled=total(duties);late=Math.min(late,scheduled);undertime=Math.min(undertime,scheduled-late);
  return {scheduledMinutes:scheduled,workedMinutes:total(punches),lateMinutes:late,undertimeMinutes:undertime};
}
export function dayClassification(holiday,restDay){
  if(!['ordinary','special_working','special_non_working','regular_holiday','double_regular_holiday'].includes(holiday))throw Error('Calendar classification needs review.');
  const base=['ordinary','special_working'].includes(holiday)?'ordinary':holiday;
  return restDay?(base==='ordinary'?'rest_day':`${base}_rest_day`):base;
}
export function matrixInput(cell,transaction,segments){
  if(!cell?.context?.ready||cell.posted)throw Error(cell?.posted?'Posted attendance requires a controlled adjustment.':'Review the dated schedule and calendar first.');
  if(!MATRIX_TRANSACTIONS.some(([name])=>name===transaction))throw Error('Select a transaction.');
  const context=cell.context,classification=dayClassification(context.holiday,context.restDay);
  const expected={'Rest-day Duty':'rest_day','Special Non-working Holiday Duty':'special_non_working','Regular Holiday Duty':'regular_holiday','Double Regular Holiday Duty':'double_regular_holiday','Special Non-working Holiday + Rest-day Duty':'special_non_working_rest_day','Regular Holiday + Rest-day Duty':'regular_holiday_rest_day','Double Regular Holiday + Rest-day Duty':'double_regular_holiday_rest_day'};
  if(expected[transaction]&&expected[transaction]!==classification)throw Error('Duty selection conflicts with the reviewed calendar or rest day.');
  if(transaction==='Day-off'&&!context.restDay)throw Error('Record a reviewed rest-day override first.');
  if(transaction==='Holiday (Unworked)'&&['ordinary','special_working'].includes(context.holiday))throw Error('Select a reviewed non-working holiday.');
  const working=transaction==='Present'||transaction==='Late/Undertime'||Boolean(expected[transaction]);
  if(transaction==='Present'&&classification!=='ordinary')throw Error('Select the matching holiday or rest-day duty transaction.');
  const duties=validateSegments(context.segments),actual=working?validateSegments(segments||duties):[];
  const metrics=working?dutyMetrics(duties,actual):{scheduledMinutes:duties.reduce((n,s)=>n+s.end-s.start-s.breakMinutes,0),lateMinutes:0,undertimeMinutes:0,workedMinutes:0};
  return {employeeId:cell.employeeId,workDate:cell.date,expectedHash:cell.hash||'',sourceHash:context.hash,transaction,
    status:working?'Present':['Paid Leave','Unpaid Leave'].includes(transaction)?'Approved Leave':['Day-off','Holiday (Unworked)'].includes(transaction)?'Rest Day / Holiday':'Absent',
    leaveTreatment:transaction==='Paid Leave'?'Paid':transaction==='Unpaid Leave'?'Unpaid':'',segments:actual,...metrics};
}
export function compatibleTimeInputs(cells,segments){
  if(!cells.length)throw Error('Select attendance days first.');
  const signature=JSON.stringify(cells[0].context?.segments);
  if(cells.some(c=>JSON.stringify(c.context?.segments)!==signature))throw Error('Bulk time adjustments require identical duty schedules.');
  return cells.map(cell=>matrixInput(cell,'Late/Undertime',segments));
}
export function assumedTransaction(cell,mode){
  if(!['present','absent'].includes(mode))throw Error('Select a valid encoding preference.');
  if(cell.record||cell.posted||!cell.context?.ready)return null;
  if(cell.context.restDay)return 'Day-off';
  if(!['ordinary','special_working'].includes(cell.context.holiday))return null;
  return mode==='present'?'Present':'Absent';
}
export function rectangleCells(rows,dates,from,to){
  const cells=[];
  for(let r=Math.min(from.row,to.row);r<=Math.max(from.row,to.row);r++)for(let c=Math.min(from.col,to.col);c<=Math.max(from.col,to.col);c++){
    const cell=rows[r]?.days?.[dates[c]];if(cell)cells.push(cell);
  }
  return cells;
}
export function createMatrixDraft(){
  let edits={},undo=[],redo=[];
  const commit=next=>{if(JSON.stringify(next)===JSON.stringify(edits))return;undo.push(structuredClone(edits));undo=undo.slice(-30);redo=[];edits=next;};
  return {
    get edits(){return structuredClone(edits);},get count(){return Object.keys(edits).length;},get canUndo(){return !!undo.length;},get canRedo(){return !!redo.length;},
    apply(inputs){const next={...edits};for(const input of inputs)next[attendanceKey(input.employeeId,input.workDate)]=structuredClone(input);commit(next);},
    clear(){commit({});},reset(){edits={};undo=[];redo=[];},
    undo(){if(!undo.length)return;redo.push(edits);edits=undo.pop();},redo(){if(!redo.length)return;undo.push(edits);edits=redo.pop();},
  };
}
