import { paginationHTML, paginationMeta } from './pagination.js?v=20260928-4';
import { columnKey, moveColumn, normalizeFrozenColumns, reconcileColumnOrder } from './table-layout.js?v=20260930-1';

export function installTableEnhancer({getState, getContent, getAdditionalRoots=()=>[], getLayouts=()=>({}), onLayoutChange=()=>{}, openSettings=()=>{}}) {
  const registry=new Map();
  let draggedColumn=null;
  let resizeFrame=0;

  function tableSignature(table){
    return Array.from(table.querySelectorAll('tbody tr')).map(row=>Array.from(row.cells).map(cell=>cell.textContent.trim()).sort().join(' ')).join('¦').slice(0,20000);
  }
  function getTablePageKey(table,index){
    const state=getState();
    return `${state.view||'view'}:${table.id||table.dataset.tableKey||'table'}:${index}`;
  }
  function isActionHeader(header){ return header.classList.contains('actions-head')||/^actions?$/i.test(header.textContent.trim()); }
  function identifyColumns(table){
    const headers=Array.from(table.tHead?.rows?.[0]?.cells||[]);
    const used=new Set();
    headers.forEach((header,index)=>{
      let key=header.dataset.columnKey||header.dataset.tableColumn||columnKey(header.textContent,index);
      while(used.has(key)) key=`${key}-${index}`;
      used.add(key);
      header.dataset.tableColumn=key;
      if(isActionHeader(header)) header.dataset.tableColumnLocked='true';
    });
    const headerKeys=headers.map(header=>header.dataset.tableColumn);
    Array.from(table.tBodies||[]).forEach(body=>Array.from(body.rows).forEach(row=>{
      if(row.cells.length!==headers.length) return;
      Array.from(row.cells).forEach((cell,index)=>{ cell.dataset.tableColumn=cell.dataset.column||headerKeys[index]; });
    }));
    Array.from(table.querySelectorAll(':scope > colgroup > col')).forEach((col,index)=>{ if(headerKeys[index]) col.dataset.tableColumn=headerKeys[index]; });
    return headers.map(header=>({key:header.dataset.tableColumn,label:header.textContent.trim()||'Column',locked:header.dataset.tableColumnLocked==='true'}));
  }
  function stableTableKey(table,columns,index){
    if(table.dataset.enhancerKey) return table.dataset.enhancerKey;
    const explicit=table.dataset.tableKey||table.id;
    const signature=columns.map(column=>column.key).sort().join('-').slice(0,120);
    table.dataset.enhancerKey=explicit||`${getState().view||'view'}:${signature||'table'}:${index}`;
    return table.dataset.enhancerKey;
  }
  function layoutFor(key,columns){
    const saved=getLayouts()?.[key]||{};
    const movable=columns.filter(column=>!column.locked).map(column=>column.key);
    return {order:reconcileColumnOrder(movable,saved.order),frozen:normalizeFrozenColumns(movable,saved.frozen)};
  }
  function reorderRow(row,order){
    if(!row||row.cells.length!==order.length) return;
    order.forEach((key,index)=>{
      const cell=Array.from(row.cells).find(item=>item.dataset.tableColumn===key);
      if(cell&&row.cells[index]!==cell) row.appendChild(cell);
    });
  }
  function applyColumnOrder(table,columns,layout){
    const locked=columns.filter(column=>column.locked).map(column=>column.key);
    const order=[...layout.order,...locked];
    reorderRow(table.tHead?.rows?.[0],order);
    Array.from(table.tBodies||[]).forEach(body=>Array.from(body.rows).forEach(row=>reorderRow(row,order)));
    const colgroup=table.querySelector(':scope > colgroup');
    if(colgroup){
      order.forEach(key=>{
        const col=Array.from(colgroup.children).find(item=>item.dataset.tableColumn===key);
        if(col) colgroup.appendChild(col);
      });
    }
  }
  function clearFrozen(table){
    table.querySelectorAll('.table-column-frozen,.table-column-frozen-edge').forEach(cell=>{
      cell.classList.remove('table-column-frozen','table-column-frozen-edge');
      cell.style.removeProperty('--table-freeze-left');
    });
    table.classList.remove('has-frozen-columns');
  }
  function applyFrozenColumns(table,layout){
    clearFrozen(table);
    if(!window.matchMedia('(min-width: 721px)').matches) return;
    let left=0;
    const active=layout.order.filter(key=>layout.frozen.includes(key));
    active.forEach((key,index)=>{
      const header=table.querySelector(`thead [data-table-column="${CSS.escape(key)}"]`);
      if(!header) return;
      table.querySelectorAll(`[data-table-column="${CSS.escape(key)}"]`).forEach(cell=>{
        cell.classList.add('table-column-frozen');
        cell.style.setProperty('--table-freeze-left',`${left}px`);
        cell.classList.toggle('table-column-frozen-edge',index===active.length-1);
      });
      left+=header.getBoundingClientRect().width;
    });
    table.classList.toggle('has-frozen-columns',active.length>0);
  }
  function saveLayout(key,layout){
    const next={order:[...layout.order],frozen:[...layout.frozen]};
    onLayoutChange(key,next);
    const entry=registry.get(key);
    if(entry){entry.layout=next;applyColumnOrder(entry.table,entry.columns,next);requestAnimationFrame(()=>applyFrozenColumns(entry.table,next));}
  }
  function installHeaderDragging(table,key,columns){
    columns.forEach(column=>{
      if(column.locked) return;
      const header=table.querySelector(`thead [data-table-column="${CSS.escape(column.key)}"]`);
      if(!header||header.dataset.tableDragReady==='true') return;
      header.dataset.tableDragReady='true';
      header.draggable=true;
      header.title=header.title||'Drag to reorder column';
      header.addEventListener('dragstart',event=>{
        if(!window.matchMedia('(min-width: 721px)').matches){event.preventDefault();return;}
        draggedColumn={tableKey:key,columnKey:column.key};
        header.classList.add('table-column-dragging');
        event.dataTransfer.effectAllowed='move';
        event.dataTransfer.setData('text/plain',column.key);
      });
      header.addEventListener('dragover',event=>{
        if(draggedColumn?.tableKey!==key||draggedColumn.columnKey===column.key) return;
        event.preventDefault();header.classList.add('table-column-drop-target');
      });
      header.addEventListener('dragleave',()=>header.classList.remove('table-column-drop-target'));
      header.addEventListener('drop',event=>{
        event.preventDefault();header.classList.remove('table-column-drop-target');
        if(draggedColumn?.tableKey!==key) return;
        const entry=registry.get(key);
        saveLayout(key,{...entry.layout,order:moveColumn(entry.layout.order,draggedColumn.columnKey,column.key)});
      });
      header.addEventListener('dragend',()=>{
        draggedColumn=null;
        table.querySelectorAll('.table-column-dragging,.table-column-drop-target').forEach(cell=>cell.classList.remove('table-column-dragging','table-column-drop-target'));
      });
    });
  }
  function installToolsTrigger(table,key){
    if(table.dataset.tableTools==='external') return;
    const host=table.closest('.tablewrap');
    if(!host||host.querySelector(':scope > .table-view-trigger')) return;
    host.classList.add('has-table-view-trigger');
    const button=document.createElement('button');
    button.type='button';button.className='table-view-trigger';button.title='Table view: reorder and freeze columns';button.setAttribute('aria-label','Customize table columns');
    button.innerHTML='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/><path d="M6 8h0M12 8h0M18 8h0" stroke-linecap="round" stroke-width="3"/></svg>';
    button.addEventListener('click',event=>{event.stopPropagation();openSettings(key);});
    host.appendChild(button);
  }
  function enhanceTableLayout(table,index){
    if(!table.tHead?.rows?.[0]||table.closest('.notification-popover')||table.classList.contains('dashboard-mini-table')) return;
    const columns=identifyColumns(table);
    if(columns.filter(column=>!column.locked).length<2) return;
    const key=stableTableKey(table,columns,index);
    const layout=layoutFor(key,columns);
    registry.set(key,{table,columns,layout});
    applyColumnOrder(table,columns,layout);
    installHeaderDragging(table,key,columns);
    installToolsTrigger(table,key);
    requestAnimationFrame(()=>applyFrozenColumns(table,layout));
  }
  function applyTablePagination(table,index){
    if(!table||!table.tBodies?.[0]||table.dataset.serverPaginated==='true') return;
    if(table.closest('.notification-popover')||table.classList.contains('dashboard-mini-table')) return;
    const rows=Array.from(table.tBodies[0].rows);
    const visibleRows=rows.filter(row=>row.querySelector('.empty')===null);
    const host=table.closest('.tablewrap')||table.parentNode;
    let footer=host.nextElementSibling;
    if(!visibleRows.length){if(footer?.classList?.contains('table-pagination-wrap')) footer.remove();return;}
    const key=getTablePageKey(table,index);const state=getState();state.tablePages ||= {};
    const sig=tableSignature(table);const stored=state.tablePages[key];
    if(!stored||stored.signature!==sig){const preferredSize=stored?.size||state.tablePageSizes?.[key]||10;state.tablePages[key]={page:1,size:preferredSize,signature:sig};}
    const meta=paginationMeta(state,key,visibleRows.length,10);
    visibleRows.forEach((row,idx)=>{row.style.display=(idx>=meta.start-1&&idx<meta.end)?'':'none';});
    const newFooter=`<div class="table-pagination-meta">${meta.total?`${meta.start}–${meta.end} of ${meta.total}`:'0'} <span>records</span></div>${paginationHTML(meta,key)}`;
    const footerState=[meta.key,meta.total,meta.size,meta.pages,meta.page,meta.start,meta.end].join('|');
    if(!footer||!footer.classList.contains('table-pagination-wrap')){footer=document.createElement('div');footer.className='table-pagination-wrap';host.parentNode.insertBefore(footer,host.nextSibling);footer.innerHTML=newFooter;footer.dataset.paginationState=footerState;}
    else if(footer.dataset.paginationState!==footerState){footer.innerHTML=newFooter;footer.dataset.paginationState=footerState;}
  }
  function enhanceDataTables(){
    const content=getContent();if(!content) return;
    const contentTables=Array.from(content.querySelectorAll('.tablewrap table, table.data-table')).filter(table=>!table.classList.contains('dashboard-mini-table')&&!table.closest('.notification-popover'));
    const roots=[content,...getAdditionalRoots()].filter(Boolean);
    const layoutTables=[...new Set(roots.flatMap(root=>Array.from(root.querySelectorAll('.tablewrap table, table.data-table'))))].filter(table=>!table.classList.contains('dashboard-mini-table')&&!table.closest('.notification-popover'));
    layoutTables.forEach((table,index)=>enhanceTableLayout(table,index));
    contentTables.forEach((table,index)=>applyTablePagination(table,index));
  }
  function tablePageGo(key,page){const state=getState();state.tablePages ||= {};const current=state.tablePages[key]||{page:1,size:10,signature:''};state.tablePages[key]={...current,page:Math.max(1,Number(page)||1)};enhanceDataTables();}
  function tablePageSize(key,size){const state=getState();state.tablePages ||= {};state.tablePageSizes ||= {};const current=state.tablePages[key]||{page:1,size:10,signature:''};const nextSize=Number(size)||10;state.tablePageSizes[key]=nextSize;state.tablePages[key]={...current,page:1,size:nextSize};enhanceDataTables();}
  function resetAllTablePages(){getState().tablePages={};enhanceDataTables();}
  function getTableInfo(key){
    enhanceDataTables();const entry=registry.get(key);
    return entry?{key,columns:entry.columns.map(column=>({...column})),layout:{order:[...entry.layout.order],frozen:[...entry.layout.frozen]}}:null;
  }
  function setTableLayout(key,layout){
    const entry=registry.get(key);if(!entry) return false;
    const movable=entry.columns.filter(column=>!column.locked).map(column=>column.key);
    saveLayout(key,{order:reconcileColumnOrder(movable,layout.order),frozen:normalizeFrozenColumns(movable,layout.frozen)});return true;
  }
  function resetTableLayout(key){
    const entry=registry.get(key);onLayoutChange(key,null);
    if(entry){entry.layout={order:entry.columns.filter(column=>!column.locked).map(column=>column.key),frozen:[]};applyColumnOrder(entry.table,entry.columns,entry.layout);requestAnimationFrame(()=>applyFrozenColumns(entry.table,entry.layout));}
  }
  function refreshFrozenColumns(){cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>registry.forEach(entry=>applyFrozenColumns(entry.table,entry.layout)));}

  const observer=new MutationObserver(()=>requestAnimationFrame(enhanceDataTables));
  function start(){[getContent(),...getAdditionalRoots()].filter(Boolean).forEach(root=>{if(!root.__tableObserverStarted){observer.observe(root,{childList:true,subtree:true});root.__tableObserverStarted=true;}});}
  window.addEventListener('resize',refreshFrozenColumns);start();
  return {enhanceDataTables,tablePageGo,tablePageSize,resetAllTablePages,getTableInfo,setTableLayout,resetTableLayout,refreshFrozenColumns};
}
