import { ALL_ROWS_SIZE, paginationHTML, paginationMeta } from './pagination.js?v=20261008-6';
import { columnKey, moveColumn, normalizeFrozenColumns, reconcileColumnOrder } from './table-layout.js?v=20260930-1';
import { compareTableValues, normalizeTableValue, valueMatchesFilter } from './table-query.js?v=20261001-1';

export function installTableEnhancer({getState, getContent, getAdditionalRoots=()=>[], getLayouts=()=>({}), onLayoutChange=()=>{}, openSettings=()=>{}, onViewAll=()=>{}}) {
  const registry=new Map();
  const tableQueries=new Map();
  let draggedColumn=null;
  let resizeFrame=0;
  let columnMenu=null;

  function tableSignature(table){
    return Array.from(table.querySelectorAll('tbody tr')).map(row=>Array.from(row.cells).map(cell=>cell.textContent.trim()).sort().join(' ')).join('¦').slice(0,20000);
  }
  function getTablePageKey(table,index){
    const state=getState();
    return `${state.view||'view'}:${table.id||table.dataset.tableKey||'table'}:${index}`;
  }
  function isActionHeader(header){ return header.classList.contains('actions-head')||/^actions?$/i.test(header.textContent.trim()); }
  function hasExternalColumnFilter(table,key,label){
    const root=table.closest('#content')||getContent();
    const controls=Array.from(root?.querySelectorAll('select[aria-label*="filter" i]')||[]).map(control=>control.getAttribute('aria-label')?.toLowerCase()||'').join(' ');
    const columnText=`${key} ${label}`.toLowerCase();
    return ['department','branch','status','classification'].some(category=>controls.includes(category)&&columnText.includes(category));
  }
  function identifyColumns(table){
    const headers=Array.from(table.tHead?.rows?.[0]?.cells||[]);
    const managed=new Set(String(table.dataset.managedColumns||'').split(',').map(key=>key.trim()).filter(Boolean));
    const used=new Set();
    headers.forEach((header,index)=>{
      let key=header.dataset.columnKey||header.dataset.tableColumn||columnKey(header.textContent,index);
      while(used.has(key)) key=`${key}-${index}`;
      used.add(key);
      header.dataset.tableColumn=key;
      if(isActionHeader(header)) header.dataset.tableColumnLocked='true';
    });
    const headerKeys=headers.map(header=>header.dataset.tableColumn);
    Array.from(table.tBodies||[]).forEach(body=>Array.from(body.rows).forEach((row,rowIndex)=>{
      if(!row.dataset.tableOriginalIndex)row.dataset.tableOriginalIndex=String(rowIndex);
      if(row.cells.length!==headers.length) return;
      Array.from(row.cells).forEach((cell,index)=>{ cell.dataset.tableColumn=cell.dataset.column||headerKeys[index]; });
    }));
    Array.from(table.querySelectorAll(':scope > colgroup > col')).forEach((col,index)=>{ if(headerKeys[index]) col.dataset.tableColumn=headerKeys[index]; });
    return headers.map(header=>{
      const label=header.dataset.columnLabel||header.textContent.trim()||'Column';
      return {key:header.dataset.tableColumn,label,locked:header.dataset.tableColumnLocked==='true',managed:header.dataset.columnManaged==='true'||managed.has(header.dataset.tableColumn)||hasExternalColumnFilter(table,header.dataset.tableColumn,label)};
    });
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
  function rowCellValue(row,key){
    const cell=Array.from(row.cells).find(item=>item.dataset.tableColumn===key);
    return normalizeTableValue(cell?.dataset.filterValue??cell?.textContent??'');
  }
  function tableQuery(key){
    if(!tableQueries.has(key))tableQueries.set(key,{sortKey:'',direction:'asc',filters:{}});
    return tableQueries.get(key);
  }
  function validDataRows(entry){
    return Array.from(entry.table.tBodies||[]).flatMap(body=>Array.from(body.rows)).filter(row=>row.cells.length===entry.columns.length&&!row.querySelector('.empty'));
  }
  function updateQueryIndicators(entry){
    const query=tableQuery(entry.key);
    entry.columns.forEach(column=>{
      const header=entry.table.querySelector(`thead [data-table-column="${CSS.escape(column.key)}"]`);
      const button=header?.querySelector(':scope > .table-column-menu-button');
      if(!header||!button)return;
      const sorted=query.sortKey===column.key;
      const filtered=Boolean(query.filters[column.key]);
      header.classList.toggle('table-column-sorted',sorted);
      header.classList.toggle('table-column-filtered',filtered);
      button.classList.toggle('active',sorted||filtered);
      button.setAttribute('aria-label',`${column.label}${sorted?`, sorted ${query.direction==='asc'?'A to Z':'Z to A'}`:''}${filtered?', filtered':''}. Open column menu`);
    });
  }
  function updateServerTableSummary(entry,matching,total){
    if(entry.table.dataset.serverPaginated!=='true'||entry.requiresCompleteSet&&!entry.viewAll)return;
    const footer=entry.table.closest('.tablewrap')?.nextElementSibling;
    const meta=footer?.querySelector('.table-pagination-meta');
    if(meta)meta.innerHTML=`${matching} <span>of ${total} matching records</span>`;
  }
  function applyTableQuery(entry){
    const query=tableQuery(entry.key);
    const rows=validDataRows(entry);
    rows.forEach(row=>{
      const matches=Object.entries(query.filters).every(([key,filter])=>valueMatchesFilter(rowCellValue(row,key),filter));
      row.classList.toggle('table-column-filtered-out',!matches);
    });
    const sorted=rows.slice().sort((left,right)=>{
      if(query.sortKey){
        const result=compareTableValues(rowCellValue(left,query.sortKey),rowCellValue(right,query.sortKey),query.direction);
        if(result)return result;
      }
      return Number(left.dataset.tableOriginalIndex||0)-Number(right.dataset.tableOriginalIndex||0);
    });
    Array.from(entry.table.tBodies||[]).forEach(body=>{
      const bodyRows=sorted.filter(row=>row.parentElement===body);
      bodyRows.forEach((row,index)=>{if(body.rows[index]!==row)body.appendChild(row);});
    });
    updateQueryIndicators(entry);
    updateServerTableSummary(entry,rows.filter(row=>!row.classList.contains('table-column-filtered-out')).length,rows.length);
  }
  function paginationContext(table,index){
    const footer=table.closest('.tablewrap')?.nextElementSibling;
    const select=footer?.querySelector('.page-size select');
    const handlerText=select?.getAttribute('onchange')||'';
    const scopeMatch=handlerText.match(/\('([^']+)'/);
    const totalMatch=footer?.querySelector('.table-pagination-meta')?.textContent.match(/of\s+(\d+)/i);
    const rowCount=Array.from(table.tBodies||[]).flatMap(body=>Array.from(body.rows)).filter(row=>!row.querySelector('.empty')).length;
    return {scope:table.dataset.pageScope||scopeMatch?.[1]||getTablePageKey(table,index),total:Number(totalMatch?.[1]||rowCount),rowCount};
  }
  function isTableViewAll(table,index){
    const state=getState();
    const scope=paginationContext(table,index).scope;
    return Number(state.tablePages?.[scope]?.size||state.tablePageSizes?.[scope])===ALL_ROWS_SIZE;
  }
  function closeColumnMenu(){
    if(columnMenu){columnMenu.remove();columnMenu=null;}
    document.querySelectorAll('.table-column-menu-button[aria-expanded="true"]').forEach(button=>button.setAttribute('aria-expanded','false'));
  }
  function positionColumnMenu(menu,button){
    const rect=button.getBoundingClientRect();
    const width=Math.min(286,window.innerWidth-20);
    menu.style.width=`${width}px`;
    menu.style.left=`${Math.max(10,Math.min(window.innerWidth-width-10,rect.right-width))}px`;
    menu.style.top=`${Math.min(window.innerHeight-menu.offsetHeight-10,rect.bottom+6)}px`;
  }
  function viewAllRows(entry){
    closeColumnMenu();
    if(!entry.allowViewAll)return;
    const scope=entry.pageScope;
    const handler=entry.table.dataset.pageHandler||'';
    if(entry.requiresCompleteSet)onViewAll(scope,handler,ALL_ROWS_SIZE);
    else tablePageSize(scope,ALL_ROWS_SIZE);
  }
  function updateTableQuery(entry,column,changes){
    const current=tableQuery(entry.key);
    const next={...current,filters:{...current.filters},...changes};
    if(Object.prototype.hasOwnProperty.call(changes,'filter')){
      const value=String(changes.filter||'').trim();
      if(value)next.filters[column.key]=value;else delete next.filters[column.key];
      delete next.filter;
    }
    tableQueries.set(entry.key,next);
    applyTableQuery(entry);
    if(entry.table.dataset.serverPaginated!=='true')applyTablePagination(entry.table,entry.index);
  }
  function openColumnMenu(entry,column,button){
    closeColumnMenu();button.setAttribute('aria-expanded','true');
    const menu=document.createElement('div');menu.className='table-column-menu';menu.setAttribute('role','dialog');menu.setAttribute('aria-label',`${column.label} column options`);
    const query=tableQuery(entry.key);
    if(column.managed){
      menu.innerHTML=`<div class="table-column-menu-head"><b>${column.label}</b><button type="button" aria-label="Close">×</button></div><div class="table-column-menu-info"><span aria-hidden="true">i</span><p><b>Managed by the filters above</b>This column already has a dedicated page filter, so duplicate sorting, filtering, and View all controls are unavailable here.</p></div>`;
    }else if(entry.requiresCompleteSet&&!entry.viewAll){
      menu.innerHTML=entry.allowViewAll?`<div class="table-column-menu-head"><b>${column.label}</b><button type="button" aria-label="Close">×</button></div><div class="table-column-menu-info"><span aria-hidden="true">i</span><p><b>Load the complete result first</b>Sorting or filtering one database page could hide valid records. Use View all to work with the complete filtered result.</p></div><button type="button" class="table-column-view-all">View all rows</button>`:`<div class="table-column-menu-head"><b>${column.label}</b><button type="button" aria-label="Close">×</button></div><div class="table-column-menu-info"><span aria-hidden="true">i</span><p><b>Use the directory controls</b>Search and filters run against the complete database while this table stays on a fast, bounded page.</p></div>`;
      menu.querySelector('.table-column-view-all')?.addEventListener('click',()=>viewAllRows(entry));
    }else{
      const values=[...new Set(validDataRows(entry).map(row=>rowCellValue(row,column.key)).filter(Boolean))].sort((a,b)=>compareTableValues(a,b,'asc')).slice(0,8);
      menu.innerHTML=`<div class="table-column-menu-head"><b>${column.label}</b><button type="button" aria-label="Close">×</button></div><div class="table-column-sort"><button type="button" data-sort="asc" class="${query.sortKey===column.key&&query.direction==='asc'?'active':''}"><b>A → Z</b><span>Sort ascending</span></button><button type="button" data-sort="desc" class="${query.sortKey===column.key&&query.direction==='desc'?'active':''}"><b>Z → A</b><span>Sort descending</span></button></div><label class="table-column-filter-label">Filter this column<input type="search" value="${String(query.filters[column.key]||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')}" placeholder="Contains text…"></label>${values.length?`<div class="table-column-values"><span>Quick values</span>${values.map(value=>`<button type="button" data-value="${value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')}">${value.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</button>`).join('')}</div>`:''}<div class="table-column-menu-actions"><button type="button" class="table-column-clear">Clear</button><button type="button" class="table-column-apply">Apply filter</button></div>${entry.allowViewAll&&!entry.viewAll?'<button type="button" class="table-column-view-all">View all rows</button>':''}`;
      menu.querySelectorAll('[data-sort]').forEach(control=>control.addEventListener('click',()=>{updateTableQuery(entry,column,{sortKey:column.key,direction:control.dataset.sort});closeColumnMenu();}));
      const input=menu.querySelector('input');
      menu.querySelectorAll('[data-value]').forEach(control=>control.addEventListener('click',()=>{input.value=control.dataset.value;input.focus();}));
      menu.querySelector('.table-column-apply').addEventListener('click',()=>{updateTableQuery(entry,column,{filter:input.value});closeColumnMenu();});
      input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();updateTableQuery(entry,column,{filter:input.value});closeColumnMenu();}});
      menu.querySelector('.table-column-clear').addEventListener('click',()=>{updateTableQuery(entry,column,{filter:'',sortKey:query.sortKey===column.key?'':query.sortKey});closeColumnMenu();});
      menu.querySelector('.table-column-view-all')?.addEventListener('click',()=>viewAllRows(entry));
    }
    menu.querySelector('.table-column-menu-head button').addEventListener('click',closeColumnMenu);
    document.body.appendChild(menu);columnMenu=menu;positionColumnMenu(menu,button);
    menu.querySelector('input')?.focus();
  }
  function installHeaderMenus(entry){
    entry.columns.forEach(column=>{
      if(column.locked)return;
      const header=entry.table.querySelector(`thead [data-table-column="${CSS.escape(column.key)}"]`);
      if(!header||header.querySelector(':scope > .table-column-menu-button'))return;
      header.dataset.columnLabel=column.label;
      const button=document.createElement('button');button.type='button';button.className='table-column-menu-button';button.draggable=false;button.title=`Sort or filter ${column.label}`;button.setAttribute('aria-expanded','false');button.setAttribute('aria-label',`${column.label}. Open column menu`);button.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
      button.addEventListener('dragstart',event=>event.stopPropagation());
      button.addEventListener('click',event=>{event.stopPropagation();openColumnMenu(entry,column,button);});
      header.appendChild(button);
    });
    updateQueryIndicators(entry);
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
    const pageContext=paginationContext(table,index);
    const entry={key,table,columns,layout,index,pageKey:getTablePageKey(table,index),pageScope:pageContext.scope,viewAll:isTableViewAll(table,index),allowViewAll:table.dataset.viewAllDisabled!=='true',requiresCompleteSet:pageContext.total>pageContext.rowCount};
    registry.set(key,entry);
    applyColumnOrder(table,columns,layout);
    if(entry.requiresCompleteSet&&!entry.viewAll)tableQueries.delete(key);
    applyTableQuery(entry);
    installHeaderDragging(table,key,columns);
    installHeaderMenus(entry);
    installToolsTrigger(table,key);
    requestAnimationFrame(()=>applyFrozenColumns(table,layout));
  }
  function applyTablePagination(table,index){
    if(!table||!table.tBodies?.[0]||table.dataset.serverPaginated==='true') return;
    if(table.closest('.notification-popover')||table.classList.contains('dashboard-mini-table')) return;
    const rows=Array.from(table.tBodies[0].rows);
    const visibleRows=rows.filter(row=>row.querySelector('.empty')===null&&!row.classList.contains('table-column-filtered-out'));
    rows.filter(row=>row.classList.contains('table-column-filtered-out')).forEach(row=>{row.style.display='none';});
    const host=table.closest('.tablewrap')||table.parentNode;
    const pageContext=paginationContext(table,index);
    if(pageContext.total>pageContext.rowCount&&!isTableViewAll(table,index))return;
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
  document.addEventListener('click',event=>{if(columnMenu&&!columnMenu.contains(event.target)&&!event.target.closest('.table-column-menu-button'))closeColumnMenu();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeColumnMenu();});
  window.addEventListener('resize',()=>{refreshFrozenColumns();closeColumnMenu();});start();
  return {enhanceDataTables,tablePageGo,tablePageSize,resetAllTablePages,getTableInfo,setTableLayout,resetTableLayout,refreshFrozenColumns};
}
