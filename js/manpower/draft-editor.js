import {manpowerPastePanelHTML} from './paste-preview.js';
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function options(values,current){const retained=current&&!values.includes(current)?[current,...values]:values;return '<option value="">Not selected</option>'+retained.map(value=>`<option value="${escape(value)}" ${value===current?'selected':''}>${escape(value)}</option>`).join('');}
function field(key,label,value,type='text'){return `<div class="field"><label for="md_${key}">${label}</label><input id="md_${key}" type="${type}" value="${escape(value)}"${type==='text'?' maxlength="120"':''}></div>`;}
export function manpowerDraftEditorHTML(draft,catalogs,icons={}){
  const request=draft.request;
  const client=catalogs.clients.find(row=>row.id===request.client_id);
  return `<div class="manpower-draft-editor"><div class="page-header-actions"><button class="btn btn-ghost btn-sm" onclick="go('manpowerDrafts')">Back to Drafts</button></div>
    <section class="manpower-draft-header"><h3>PRF Header</h3><div class="settings-form-grid">
      ${field('prf_number','PRF Number',request.prf_number)}
      <div class="field"><label for="md_client">Client Account</label><input id="md_client" list="md_clients" value="${escape(client?.name||'')}" autocomplete="off"><datalist id="md_clients">${catalogs.clients.filter(row=>row.active||row.id===request.client_id).map(row=>`<option value="${escape(row.name)}"></option>`).join('')}</datalist></div>
      <div class="field"><label for="md_branch_reporting">Reporting Branch</label><select id="md_branch_reporting">${options(catalogs.branches,request.branch_reporting)}</select></div>
      ${field('requested_by','Requested By',request.requested_by)}${field('date_requested','Date Requested',request.date_requested,'date')}${field('target_date','Target Deployment Date',request.target_date,'date')}
      <div class="field"><label for="md_priority">Priority</label><select id="md_priority">${options(['Low','Normal','High','Urgent'],request.priority)}</select></div>
      <div class="field"><label for="md_remarks">General Remarks</label><textarea id="md_remarks" rows="2" maxlength="10000">${escape(request.remarks)}</textarea></div>
    </div></section>
    <section class="manpower-draft-requisitions"><div class="settings-section-head"><h3>Requisition Lines</h3><button class="btn btn-ghost btn-sm" onclick="manpowerDraftAddLine()">${icons.plus||'+'} Add Line</button></div>
    ${manpowerPastePanelHTML()}<div id="md_lines">${manpowerDraftLinesHTML(draft.lines,catalogs)}</div></section>
    <div id="md_errors" class="notice" role="alert" hidden></div>
    <div class="manpower-draft-footer"><button class="btn btn-ghost" onclick="go('manpowerDrafts')">Cancel</button><button id="md_save" class="btn btn-primary" onclick="saveManpowerDraft()">Save Draft</button></div></div>`;
}
export function manpowerDraftLinesHTML(lines,catalogs){
  return lines.map((row,index)=>`<fieldset class="manpower-draft-line" data-line-id="${escape(row.id)}"><legend>Line ${index+1}</legend><div class="manpower-draft-line-fields">
    <div class="field"><label for="md_${index}_department">Department</label><select id="md_${index}_department" data-draft-field="department" onchange="manpowerDraftDepartmentChanged(${index})">${options(catalogs.departments.filter(item=>item.active).map(item=>item.name),row.department)}</select></div>
    <div class="field"><label for="md_${index}_position">Position</label><select id="md_${index}_position" data-draft-field="position">${options(catalogs.positions.filter(item=>item.active&&item.department===row.department).map(item=>item.name),row.position)}</select></div>
    <div class="field"><label for="md_${index}_quantity">Headcount</label><input id="md_${index}_quantity" data-draft-field="current_authorized" type="number" min="1" max="2147483647" step="1" value="${escape(row.current_authorized)}"></div>
    <div class="field"><label for="md_${index}_type">Demand Type</label><select id="md_${index}_type" data-draft-field="demand_type">${options(['Expansion','Replacement'],row.demand_type)}</select></div>
    <div class="field"><label for="md_${index}_date">Target Date</label><input id="md_${index}_date" data-draft-field="target_date" type="date" value="${escape(row.target_date)}"></div>
    <div class="field"><label for="md_${index}_site">Site</label><select id="md_${index}_site" data-draft-field="site">${options(catalogs.branches,row.site)}</select></div>
    <div class="field"><label for="md_${index}_purpose">Purpose / Remarks</label><textarea id="md_${index}_purpose" data-draft-field="purpose" rows="2" maxlength="10000">${escape(row.purpose)}</textarea></div>
    <div class="rowactions"><button class="btn btn-ghost btn-sm" onclick="manpowerDraftAddLine(${index})">Duplicate</button><button class="btn btn-ghost btn-sm" onclick="manpowerDraftRemoveLine(${index})">Remove</button></div>
    </div></fieldset>`).join('')||'<div class="empty">No requisition lines.</div>';
}
export function readManpowerDraft(root,draft,catalogs){
  const request={...draft.request};
  for(const key of ['prf_number','branch_reporting','requested_by','date_requested','target_date','priority','remarks'])request[key]=root.querySelector(`#md_${key}`)?.value||'';
  const name=(root.querySelector('#md_client')?.value||'').trim().replace(/\s+/g,' ').toLowerCase();
  const match=catalogs.clients.find(row=>row.name.toLowerCase()===name);
  request.client_id=match?.id||'';
  const lines=[...root.querySelectorAll('[data-line-id]')].map(fieldset=>{
    const line={id:fieldset.dataset.lineId};fieldset.querySelectorAll('[data-draft-field]').forEach(input=>line[input.dataset.draftField]=input.value);return line;
  });
  return {request,lines,originalClientId:draft.originalClientId,unknownClient:!!name&&!match};
}
