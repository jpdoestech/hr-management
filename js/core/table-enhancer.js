import { paginationHTML, paginationMeta } from './pagination.js';

export function installTableEnhancer({getState, getContent}) {
  function tableSignature(table){
    return Array.from(table.querySelectorAll('tbody tr')).map(r=>Array.from(r.cells).map(c=>c.textContent.trim()).join(' ')).join('¦').slice(0,20000);
  }
  function getTablePageKey(table,index){
    const state=getState();
    const base=state.view||'view';
    return `${base}:${table.id||'table'}:${index}`;
  }
  function applyTablePagination(table,index){
    if(!table||!table.tBodies?.[0]) return;
    if(table.closest('.notification-popover') || table.classList.contains('dashboard-mini-table')) return;
    const rows=Array.from(table.tBodies[0].rows);
    const visibleRows=rows.filter(r=>r.querySelector('.empty')===null);
    const host=table.closest('.tablewrap')||table.parentNode;
    let footer=host.nextElementSibling;
    if(!visibleRows.length){
      if(footer?.classList?.contains('table-pagination-wrap')) footer.remove();
      return;
    }
    const key=getTablePageKey(table,index);
    const state=getState();
    state.tablePages ||= {};
    const sig=tableSignature(table);
    const stored=state.tablePages[key];
    if(!stored || stored.signature!==sig){ state.tablePages[key]={page:1,size:10,signature:sig}; }
    const meta=paginationMeta(state,key,visibleRows.length,10);
    visibleRows.forEach((row,idx)=>{ row.style.display=(idx>=meta.start-1&&idx<meta.end)?'':'none'; });
    const newFooter=`<div class="table-pagination-meta">${meta.total?`${meta.start}–${meta.end} of ${meta.total}`:'0'} <span>records</span></div>${paginationHTML(meta,key)}`;
    if(!footer||!footer.classList.contains('table-pagination-wrap')){
      footer=document.createElement('div');
      footer.className='table-pagination-wrap';
      host.parentNode.insertBefore(footer,host.nextSibling);
      footer.innerHTML=newFooter;
    } else if(footer.innerHTML!==newFooter){
      footer.innerHTML=newFooter;
    }
  }
  function enhanceDataTables(){
    const content=getContent();
    if(!content) return;
    const tables=Array.from(content.querySelectorAll('.tablewrap table, table.data-table')).filter(t=>!t.classList.contains('dashboard-mini-table')&&!t.closest('.notification-popover'));
    tables.forEach((t,i)=>applyTablePagination(t,i));
  }
  function tablePageGo(key,page){
    const state=getState();
    state.tablePages ||= {};
    const current=state.tablePages[key]||{page:1,size:10,signature:''};
    state.tablePages[key]={...current,page:Math.max(1,Number(page)||1)};
    enhanceDataTables();
  }
  function tablePageSize(key,size){
    const state=getState();
    state.tablePages ||= {};
    const current=state.tablePages[key]||{page:1,size:10,signature:''};
    state.tablePages[key]={...current,page:1,size:Number(size)||10};
    enhanceDataTables();
  }
  function resetAllTablePages(){ getState().tablePages={}; enhanceDataTables(); }

  const observer=new MutationObserver(()=>requestAnimationFrame(enhanceDataTables));
  function start(){
    const content=getContent();
    if(content && !content.__tableObserverStarted){
      observer.observe(content,{childList:true,subtree:true});
      content.__tableObserverStarted=true;
    }
  }
  start();
  return {enhanceDataTables,tablePageGo,tablePageSize,resetAllTablePages};
}
