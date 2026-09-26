export function paginationMeta(state,key,total,defaultSize=10){
  state.tablePages ||= {};
  const allowed=[10,25,50,100];
  const current=state.tablePages[key]||{page:1,size:defaultSize,signature:''};
  const size=allowed.includes(Number(current.size))?Number(current.size):defaultSize;
  const pages=Math.max(1,Math.ceil(total/size));
  const page=Math.min(Math.max(1,Number(current.page)||1),pages);
  state.tablePages[key]={...current,page,size};
  return {key,total,size,pages,page,start:total?((page-1)*size+1):0,end:Math.min(total,page*size)};
}
export function paginateRows(rows,state,key,defaultSize=10){
  const meta=paginationMeta(state,key,rows.length,defaultSize);
  return {rows:rows.slice(meta.start?meta.start-1:0,meta.end),meta};
}
export function paginationReset(state,key){
  state.tablePages ||= {};
  if(key) delete state.tablePages[key]; else state.tablePages={};
}
function pageList(meta){
  const pages=[];
  if(meta.pages<=7){ for(let p=1;p<=meta.pages;p++) pages.push(p); return pages; }
  pages.push(1);
  if(meta.page>4) pages.push('…');
  const start=Math.max(2,meta.page-1), end=Math.min(meta.pages-1,meta.page+1);
  for(let p=start;p<=end;p++) pages.push(p);
  if(meta.page<meta.pages-3) pages.push('…');
  pages.push(meta.pages);
  return pages;
}
export function paginationHTML(meta,scope,handlers={}){
  const key=String(scope).replace(/'/g,"\\'");
  const goFn=handlers.go||'tablePageGo';
  const sizeFn=handlers.size||'tablePageSize';
  return `<div class="table-pagination"><label class="page-size">Rows <select onchange="${sizeFn}('${key}',this.value)">${[10,25,50,100].map(n=>`<option value="${n}" ${meta.size===n?'selected':''}>${n}</option>`).join('')}</select></label><div class="page-buttons"><button class="page-btn" ${meta.page<=1?'disabled':''} onclick="${goFn}('${key}',${meta.page-1})" aria-label="Previous page">‹</button>${pageList(meta).map(p=>p==='…'?`<span class="page-ellipsis">…</span>`:`<button class="page-btn ${p===meta.page?'active':''}" onclick="${goFn}('${key}',${p})">${p}</button>`).join('')}<button class="page-btn" ${meta.page>=meta.pages?'disabled':''} onclick="${goFn}('${key}',${meta.page+1})" aria-label="Next page">›</button></div></div>`;
}
