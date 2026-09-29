import { formatPhilippineAddress, normalizeAddress } from './address-models.js';
import { loadAddressIndex, loadBarangays, searchAddressRows } from './address-index.js';
import { addressValidationMessage, validatePhilippineAddress } from './address-validation.js';

const instances=new Map();
const levelOrder=['region','province','city','barangay'];
const labels={region:'Region',province:'Province',city:'City / Municipality',barangay:'Barangay'};
const escapeHTML=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const id=(prefix,suffix)=>`${prefix}_${suffix}`;

function field(prefix,level,value,required){
  return `<div class="field address-admin-field" data-address-level="${level}"><label for="${id(prefix,level)}">${labels[level]}${required?' *':''}</label><div class="address-combobox"><input id="${id(prefix,level)}" value="${escapeHTML(value[`${level}Name`]||'')}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id(prefix,`${level}_options`)}" placeholder="Type to search…" onfocus="addressAutocompleteFocus('${prefix}','${level}')" oninput="addressAutocompleteInput('${prefix}','${level}')" onkeydown="addressAutocompleteKeydown(event,'${prefix}','${level}')" onblur="addressAutocompleteBlur('${prefix}','${level}')"><input type="hidden" id="${id(prefix,`${level}_code`)}" value="${escapeHTML(value[`${level}Code`]||'')}"><div class="address-options" id="${id(prefix,`${level}_options`)}" role="listbox" hidden></div></div><div class="field-error" id="${id(prefix,`${level}_error`)}" aria-live="polite"></div></div>`;
}

export function addressComponentHTML({prefix,label='Address',value=null,required=false,showCopy=false,copyFromPrefix=''}={}){
  const address=normalizeAddress(value);
  instances.set(prefix,{required,options:[],highlight:-1,level:'',barangays:[]});
  return `<section class="address-component" data-address-component="${escapeHTML(prefix)}" data-address-required="${required?'true':'false'}"><div class="address-component-head"><div><h5>${escapeHTML(label)}${required?' *':''}</h5><p>Choose official PSGC locations; enter building and street details separately.</p></div>${showCopy?`<label class="address-copy"><input type="checkbox" onchange="addressCopyFrom('${copyFromPrefix}','${prefix}',this.checked)"><span>Same as home address</span></label>`:''}</div><div class="address-grid">${field(prefix,'region',address,required)}${field(prefix,'province',address,required)}${field(prefix,'city',address,required)}${field(prefix,'barangay',address,required)}<div class="field address-line-field"><label for="${id(prefix,'line')}">Street / House / Unit details</label><input id="${id(prefix,'line')}" value="${escapeHTML(address.addressLine)}" maxlength="180" placeholder="House no., street, subdivision, building, unit"><div class="field-error" id="${id(prefix,'line_error')}"></div></div><div class="field address-zip-field"><label for="${id(prefix,'zip')}">ZIP Code</label><input id="${id(prefix,'zip')}" value="${escapeHTML(address.zipCode)}" inputmode="numeric" maxlength="4" readonly placeholder="From selected locality"><div class="field-error" id="${id(prefix,'zip_error')}"></div></div></div>${address.legacy&&!address.regionCode?`<div class="address-legacy-note">Existing address loaded as street/details. Select its official locations before saving.</div>`:''}<div class="address-status" id="${id(prefix,'status')}" aria-live="polite"></div></section>`;
}

function element(prefix,suffix){return document.getElementById(id(prefix,suffix));}
function state(prefix){if(!instances.has(prefix))instances.set(prefix,{required:false,options:[],highlight:-1,level:'',barangays:[]});return instances.get(prefix);}
function setStatus(prefix,message='',kind=''){const target=element(prefix,'status');if(target){target.textContent=message;target.className=`address-status${kind?` ${kind}`:''}`;}}
function setError(prefix,level,message=''){const target=element(prefix,`${level}_error`);if(target)target.textContent=message;const input=element(prefix,level);if(input)input.setAttribute('aria-invalid',message?'true':'false');}
function closeOptions(prefix,level){const box=element(prefix,`${level}_options`);const input=element(prefix,level);if(box)box.hidden=true;if(input)input.setAttribute('aria-expanded','false');}
function clearLevel(prefix,level){const input=element(prefix,level),code=element(prefix,`${level}_code`);if(input){input.value='';input.disabled=false;input.placeholder='Type to search…';}if(code)code.value='';setError(prefix,level,'');closeOptions(prefix,level);}
function clearChildren(prefix,level){const start=levelOrder.indexOf(level)+1;levelOrder.slice(start).forEach(child=>clearLevel(prefix,child));if(['region','province','city'].includes(level)){const zip=element(prefix,'zip');if(zip)zip.value='';}state(prefix).barangays=[];}

async function rowsFor(prefix,level){
  const index=await loadAddressIndex();
  const regionCode=element(prefix,'region_code')?.value||'';
  const provinceCode=element(prefix,'province_code')?.value||'';
  const cityCode=element(prefix,'city_code')?.value||'';
  if(level==='region')return index.regions;
  if(level==='province')return regionCode?index.provincesForRegion(regionCode):[];
  if(level==='city')return regionCode?index.citiesForProvince(provinceCode,regionCode):[];
  if(level==='barangay'&&cityCode){const rows=await loadBarangays(cityCode);state(prefix).barangays=rows;return rows;}
  return [];
}

function renderOptions(prefix,level,rows,message=''){
  const box=element(prefix,`${level}_options`),input=element(prefix,level),current=state(prefix);if(!box||!input)return;
  current.level=level;current.options=rows;current.highlight=rows.length?0:-1;
  box.innerHTML=rows.length?rows.map((row,index)=>`<button type="button" role="option" data-index="${index}" aria-selected="${index===0?'true':'false'}" onmousedown="event.preventDefault()" onclick="addressSelectOption('${prefix}','${level}','${escapeHTML(row.code)}')"><b>${escapeHTML(row.name)}</b>${row.zip?`<small>ZIP ${escapeHTML(row.zip)}</small>`:''}</button>`).join(''):`<div class="address-option-state">${escapeHTML(message||'No matching locations')}</div>`;
  box.hidden=false;input.setAttribute('aria-expanded','true');
}

async function refreshOptions(prefix,level){
  const input=element(prefix,level);if(!input||input.disabled)return;
  renderOptions(prefix,level,[],'Loading locations…');
  try{
    const rows=await rowsFor(prefix,level);
    if(level==='province'&&element(prefix,'region_code')?.value&&rows.length===0){
      input.value='Not applicable';input.disabled=true;element(prefix,'province_code').value='';closeOptions(prefix,level);setError(prefix,level,'');return;
    }
    const query=input.value==='Not applicable'?'':input.value;
    renderOptions(prefix,level,searchAddressRows(rows,query,50),rows.length?'No matching locations':'Select the parent location first');
  }catch(error){renderOptions(prefix,level,[],error.message||'Address data could not be loaded');setStatus(prefix,error.message||'Address data could not be loaded','error');}
}

export function addressAutocompleteFocus(prefix,level){refreshOptions(prefix,level);}
export function addressAutocompleteInput(prefix,level){
  const code=element(prefix,`${level}_code`);if(code)code.value='';clearChildren(prefix,level);setError(prefix,level,'');refreshOptions(prefix,level);
}
export function addressAutocompleteBlur(prefix,level){setTimeout(()=>{const input=element(prefix,level);if(!input||input.disabled)return;if(element(prefix,`${level}_code`)?.value){closeOptions(prefix,level);return;}const current=state(prefix);const exact=current.options.find(row=>row.name.toLowerCase()===input.value.trim().toLowerCase());if(exact)addressSelectOption(prefix,level,exact.code);else if(input.value.trim()){setError(prefix,level,`Select a valid ${labels[level].toLowerCase()} from the suggestions.`);closeOptions(prefix,level);}else closeOptions(prefix,level);},120);}
export function addressAutocompleteKeydown(event,prefix,level){
  const current=state(prefix);if(event.key==='Escape'){closeOptions(prefix,level);return;}if(!['ArrowDown','ArrowUp','Enter'].includes(event.key))return;
  event.preventDefault();if(!current.options.length)return;
  if(event.key==='ArrowDown')current.highlight=Math.min(current.options.length-1,current.highlight+1);if(event.key==='ArrowUp')current.highlight=Math.max(0,current.highlight-1);
  if(event.key==='Enter'){const row=current.options[Math.max(0,current.highlight)];if(row)addressSelectOption(prefix,level,row.code);return;}
  const box=element(prefix,`${level}_options`);box?.querySelectorAll('[role="option"]').forEach((option,index)=>option.setAttribute('aria-selected',String(index===current.highlight)));box?.querySelector(`[data-index="${current.highlight}"]`)?.scrollIntoView({block:'nearest'});
}
export async function addressSelectOption(prefix,level,code){
  const rows=await rowsFor(prefix,level);const row=rows.find(item=>String(item.code)===String(code));if(!row)return;
  const input=element(prefix,level),codeInput=element(prefix,`${level}_code`);input.value=row.name;codeInput.value=String(row.code);setError(prefix,level,'');closeOptions(prefix,level);clearChildren(prefix,level);
  if(level==='region'){
    const provinces=(await loadAddressIndex()).provincesForRegion(row.code);if(!provinces.length){const province=element(prefix,'province');province.value='Not applicable';province.disabled=true;}
  }
  if(level==='city'){const zip=element(prefix,'zip');if(zip)zip.value=String(row.zip||'');}
  const next=levelOrder[levelOrder.indexOf(level)+1];if(next){const nextInput=element(prefix,next);if(nextInput&&!nextInput.disabled)nextInput.focus();}
}

export function addressValueFromDOM(prefix){
  const value={};levelOrder.forEach(level=>{value[`${level}Name`]=element(prefix,level)?.disabled?'':element(prefix,level)?.value.trim()||'';value[`${level}Code`]=element(prefix,`${level}_code`)?.value||'';});
  value.addressLine=element(prefix,'line')?.value.trim()||'';value.zipCode=element(prefix,'zip')?.value.trim()||'';value.formattedAddress=formatPhilippineAddress(value);value.legacy=false;return value;
}
export async function readAddressComponent(prefix,{required=null}={}){
  const component=document.querySelector(`[data-address-component="${CSS.escape(prefix)}"]`);const mustFill=required??component?.dataset.addressRequired==='true';const value=addressValueFromDOM(prefix);let index;
  try{index=await loadAddressIndex();}catch(error){setStatus(prefix,error.message,'error');return {valid:false,address:value,errors:{region:error.message},message:error.message};}
  let barangays=[];if(value.cityCode){try{barangays=await loadBarangays(value.cityCode);}catch(error){setStatus(prefix,error.message,'error');return {valid:false,address:value,errors:{barangay:error.message},message:error.message};}}
  const result=validatePhilippineAddress(value,{index,barangays,required:mustFill});
  levelOrder.forEach(level=>setError(prefix,level,result.errors[level]||''));setError(prefix,'zip',result.errors.zipCode||'');
  const message=addressValidationMessage(result.errors);setStatus(prefix,message,result.valid?'success':'error');
  return {...result,message};
}
export function addressCopyFrom(sourcePrefix,targetPrefix,checked){
  if(!checked)return;
  const source=addressValueFromDOM(sourcePrefix);levelOrder.forEach(level=>{const targetInput=element(targetPrefix,level);const targetCode=element(targetPrefix,`${level}_code`);if(targetInput){targetInput.disabled=false;targetInput.value=source[`${level}Name`]||'';}if(targetCode)targetCode.value=source[`${level}Code`]||'';});
  const province=element(targetPrefix,'province');if(!source.provinceCode&&source.regionCode&&province){province.value='Not applicable';province.disabled=true;}
  if(element(targetPrefix,'line'))element(targetPrefix,'line').value=source.addressLine;if(element(targetPrefix,'zip'))element(targetPrefix,'zip').value=source.zipCode;setStatus(targetPrefix,'Copied from home address.','success');
}

export async function initializeAddressComponents(root=document){
  const components=[...root.querySelectorAll('[data-address-component]')];
  if(!components.length)return;
  try{
    const index=await loadAddressIndex();
    await Promise.all(components.map(async component=>{
      const prefix=component.dataset.addressComponent;
      const regionCode=element(prefix,'region_code')?.value||'';
      const province=element(prefix,'province');
      if(regionCode&&province&&!index.provincesForRegion(regionCode).length){province.value='Not applicable';province.disabled=true;}
      const cityCode=element(prefix,'city_code')?.value||'';
      if(cityCode)state(prefix).barangays=await loadBarangays(cityCode);
    }));
  }catch(error){components.forEach(component=>setStatus(component.dataset.addressComponent,error.message||'Address data could not be loaded','error'));}
}
