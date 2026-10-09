import {MANPOWER_PASTE_FIELDS} from '../core/manpower-paste.js';
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function manpowerPastePanelHTML(){
  return `<details class="manpower-paste-panel"><summary>Paste Requisition Lines</summary><div class="manpower-paste-body">
    <div class="field"><label for="md_paste_text">Spreadsheet Rows</label><textarea id="md_paste_text" rows="5" maxlength="2000000" spellcheck="false" oninput="manpowerDraftPasteChanged()" aria-describedby="md_paste_status"></textarea></div>
    <div class="manpower-paste-tools"><label for="md_paste_header"><input id="md_paste_header" type="checkbox" checked onchange="manpowerDraftPasteChanged()"> First row contains headers</label><button type="button" class="btn btn-ghost btn-sm" onclick="manpowerDraftPreviewPaste()">Preview Rows</button><button type="button" class="btn btn-ghost btn-sm" onclick="manpowerDraftClearPaste()">Clear Paste</button></div>
    <div id="md_paste_mapping" class="manpower-paste-mapping"></div><div id="md_paste_status" role="status" aria-live="polite" aria-atomic="true"></div>
    <div id="md_paste_preview"></div><button id="md_paste_apply" type="button" class="btn btn-primary btn-sm" onclick="manpowerDraftApplyPaste()" disabled>Add Rows to Draft</button>
  </div></details>`;
}
export function manpowerPasteMappingHTML(matrix,mapping,hasHeader){
  return mapping.map((key,index)=>`<div class="field"><label for="md_paste_map_${index}">${escape(hasHeader?matrix[0]?.[index]||`Column ${index+1}`:`Column ${index+1}`)}</label><select id="md_paste_map_${index}" data-paste-mapping onchange="manpowerDraftPreviewPaste()"><option value="">Ignore column</option>${MANPOWER_PASTE_FIELDS.map(field=>`<option value="${field.key}" ${key===field.key?'selected':''}>${field.label}</option>`).join('')}</select></div>`).join('');
}
export function manpowerPastePreviewHTML(preview,page=1){
  const size=25;const pages=Math.max(1,Math.ceil(preview.rows.length/size));const current=Math.max(1,Math.min(page,pages));
  const rows=preview.rows.slice((current-1)*size,current*size);
  return `${preview.errors.length?`<div class="notice" role="alert">${preview.errors.map(error=>`<div>${escape(error)}</div>`).join('')}</div>`:''}
    <div class="tablewrap manpower-paste-table"><table class="data-table" data-server-paginated="true" aria-label="Pasted requisition preview"><thead><tr><th scope="col" data-table-column-locked="true">Source Row</th>${MANPOWER_PASTE_FIELDS.map(field=>`<th scope="col" data-table-column-locked="true">${field.label}</th>`).join('')}<th scope="col" data-table-column-locked="true">Validation</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${row.sourceRow}</td>${MANPOWER_PASTE_FIELDS.map(field=>`<td>${escape(row.line[field.key]||'\u2014')}</td>`).join('')}<td>${row.errors.length?`<ul class="manpower-paste-errors">${row.errors.map(error=>`<li>${escape(error)}</li>`).join('')}</ul>`:'Ready'}</td></tr>`).join('')||'<tr><td colspan="9">No rows to preview.</td></tr>'}</tbody></table></div>
    <div class="table-pagination-wrap"><span>Page ${current} of ${pages} \u00b7 ${preview.rows.length} rows</span><div class="page-buttons"><button type="button" class="page-btn" aria-label="Previous preview page" onclick="manpowerDraftPastePage(${current-1})" ${current<=1?'disabled':''}>\u2039</button><button type="button" class="page-btn" aria-label="Next preview page" onclick="manpowerDraftPastePage(${current+1})" ${current>=pages?'disabled':''}>\u203a</button></div></div>`;
}
