import { formatPhilippineAddress, normalizeAddress } from './address-models.js';
import { loadAddressIndex, loadBarangays, loadBarangaySearchIndex, normalizeAddressSearch, searchAddressRows } from './address-index.js';
import { addressValidationMessage, validatePhilippineAddress } from './address-validation.js';

const instances=new Map();
const levelOrder=['region','province','city','barangay'];
const labels={region:'Region',province:'Province',city:'City / Municipality',barangay:'Barangay'};
const escapeHTML=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const id=(prefix,suffix)=>`${prefix}_${suffix}`;

function field(prefix,level,value,required){
  return `<div class="field address-admin-field" data-address-level="${level}"><label for="${id(prefix,level)}">${labels[level]}${required?' *':''}</label><div class="address-combobox"><input id="${id(prefix,level)}" value="${escapeHTML(value[`${level}Name`]||'')}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id(prefix,`${level}_options`)}" placeholder="Search ${labels[level].toLowerCase()}…" onfocus="addressAutocompleteFocus('${prefix}','${level}')" oninput="addressAutocompleteInput('${prefix}','${level}')" onkeydown="addressAutocompleteKeydown(event,'${prefix}','${level}')" onblur="addressAutocompleteBlur('${prefix}','${level}')"><input type="hidden" id="${id(prefix,`${level}_code`)}" value="${escapeHTML(value[`${level}Code`]||'')}"><div class="address-options" id="${id(prefix,`${level}_options`)}" role="listbox" hidden></div></div><div class="field-error" id="${id(prefix,`${level}_error`)}" aria-live="polite"></div></div>`;
}

export function addressComponentHTML({prefix,label='Address',value=null,required=false,showCopy=false,copyFromPrefix=''}={}){
  const address=normalizeAddress(value);
  instances.set(prefix,{required,options:[],highlight:-1,level:'',barangays:[],copyFrom:'',requestId:0});
  return `<section class="address-component" data-address-component="${escapeHTML(prefix)}" data-address-required="${required?'true':'false'}"><div class="address-component-head"><div><h5>${escapeHTML(label)}${required?' *':''}</h5><p>Start with any location field. Selecting a result fills its parent locations automatically.</p></div>${showCopy?`<label class="address-copy"><input type="checkbox" onchange="addressCopyFrom('${copyFromPrefix}','${prefix}',this.checked)"><span>Same as home address</span></label>`:''}</div><div class="address-grid">${field(prefix,'region',address,required)}${field(prefix,'province',address,required)}${field(prefix,'city',address,required)}${field(prefix,'barangay',address,required)}<div class="field address-line-field"><label for="${id(prefix,'line')}">Street / House / Unit details</label><input id="${id(prefix,'line')}" value="${escapeHTML(address.addressLine)}" maxlength="180" placeholder="House no., street, subdivision, building, unit" oninput="addressDetailInput('${prefix}')"><div class="field-error" id="${id(prefix,'line_error')}"></div></div><div class="field address-zip-field"><label for="${id(prefix,'zip')}">ZIP Code</label><input id="${id(prefix,'zip')}" value="${escapeHTML(address.zipCode)}" inputmode="numeric" maxlength="4" readonly placeholder="From selected locality"><div class="field-error" id="${id(prefix,'zip_error')}"></div></div></div>${address.legacy&&!address.regionCode?`<div class="address-legacy-note">Existing address loaded as street/details. Add official locations when they are available.</div>`:''}<div class="address-status" id="${id(prefix,'status')}" aria-live="polite"></div></section>`;
}

function element(prefix,suffix){return document.getElementById(id(prefix,suffix));}
function state(prefix){if(!instances.has(prefix))instances.set(prefix,{required:false,options:[],highlight:-1,level:'',barangays:[],copyFrom:'',requestId:0});return instances.get(prefix);}
function setStatus(prefix,message='',kind=''){const target=element(prefix,'status');if(target){target.textContent=message;target.className=`address-status${kind?` ${kind}`:''}`;}}
function setError(prefix,level,message=''){const target=element(prefix,`${level}_error`);if(target)target.textContent=message;const input=element(prefix,level);if(input)input.setAttribute('aria-invalid',message?'true':'false');}
function closeOptions(prefix,level){const box=element(prefix,`${level}_options`);const input=element(prefix,level);if(box)box.hidden=true;if(input)input.setAttribute('aria-expanded','false');}
function clearLevel(prefix,level){const input=element(prefix,level),code=element(prefix,`${level}_code`);if(input){input.value='';input.disabled=false;input.placeholder=`Search ${labels[level].toLowerCase()}…`;}if(code)code.value='';setError(prefix,level,'');closeOptions(prefix,level);}
function clearChildren(prefix,level){const start=levelOrder.indexOf(level)+1;levelOrder.slice(start).forEach(child=>clearLevel(prefix,child));if(['region','province','city'].includes(level)){const zip=element(prefix,'zip');if(zip)zip.value='';}state(prefix).barangays=[];}
function incompleteParent(prefix,level){return levelOrder.slice(0,levelOrder.indexOf(level)).find(parent=>{const input=element(prefix,parent);return input&&!input.disabled&&input.value.trim()&&!element(prefix,`${parent}_code`)?.value;})||'';}

async function rowsFor(prefix,level){
  const index=await loadAddressIndex();
  const regionCode=element(prefix,'region_code')?.value||'';
  const provinceCode=element(prefix,'province_code')?.value||'';
  const cityCode=element(prefix,'city_code')?.value||'';
  if(level==='region')return index.regions;
  if(level==='province')return regionCode?index.provincesForRegion(regionCode):index.provinces;
  if(level==='city')return provinceCode?index.citiesForProvince(provinceCode):regionCode?index.citiesForRegion(regionCode):index.cities;
  if(level==='barangay'&&cityCode){const rows=await loadBarangays(cityCode);state(prefix).barangays=rows;return rows;}
  if(level==='barangay')return loadBarangaySearchIndex();
  return [];
}

function optionContext(level,row,index){
  if(level==='province')return index.regionByCode.get(String(row.regionCode||''))?.name||'';
  if(level==='city')return [index.provinceByCode.get(String(row.provinceCode||''))?.name,index.regionByCode.get(String(row.regionCode||''))?.name].filter(Boolean).join(' · ');
  if(level==='barangay')return [row.cityName||index.cityByCode.get(String(row.cityCode||''))?.name,row.provinceName||index.provinceByCode.get(String(row.provinceCode||''))?.name].filter(Boolean).join(' · ');
  return '';
}

function renderOptions(prefix,level,rows,message='',index=null){
  const box=element(prefix,`${level}_options`),input=element(prefix,level),current=state(prefix);if(!box||!input)return;
  current.level=level;current.options=rows;current.highlight=rows.length?0:-1;
  box.innerHTML=rows.length?rows.map((row,optionIndex)=>{const context=index?optionContext(level,row,index):'';return `<button type="button" role="option" data-index="${optionIndex}" aria-selected="${optionIndex===0?'true':'false'}" onmousedown="event.preventDefault()" onclick="addressSelectOption('${prefix}','${level}','${escapeHTML(row.code)}')"><b>${escapeHTML(row.name)}</b>${context||row.zip?`<small>${escapeHTML(context)}${context&&row.zip?' · ':''}${row.zip?`ZIP ${escapeHTML(row.zip)}`:''}</small>`:''}</button>`;}).join(''):`<div class="address-option-state">${escapeHTML(message||'No matching locations')}</div>`;
  box.hidden=false;input.setAttribute('aria-expanded','true');
}

async function refreshOptions(prefix,level){
  const input=element(prefix,level);if(!input||input.disabled)return;
  const blockedBy=incompleteParent(prefix,level);if(blockedBy){renderOptions(prefix,level,[],`Select or clear ${labels[blockedBy].toLowerCase()} first.`);return;}
  const query=input.value==='Not applicable'?'':input.value;
  if(level==='barangay'&&!element(prefix,'city_code')?.value&&normalizeAddressSearch(query).length<2){renderOptions(prefix,level,[],'Type at least 2 characters to search all barangays.');return;}
  const requestId=++state(prefix).requestId;
  renderOptions(prefix,level,[],'Loading locations…');
  try{
    const index=await loadAddressIndex();
    const rows=await rowsFor(prefix,level);
    if(requestId!==state(prefix).requestId)return;
    if(level==='province'&&element(prefix,'region_code')?.value&&rows.length===0){input.value='Not applicable';input.disabled=true;element(prefix,'province_code').value='';closeOptions(prefix,level);setError(prefix,level,'');return;}
    renderOptions(prefix,level,searchAddressRows(rows,query,50),rows.length?'No matching locations':'No locations available',index);
  }catch(error){renderOptions(prefix,level,[],error.message||'Address data could not be loaded');setStatus(prefix,error.message||'Address data could not be loaded','error');}
}

export function addressAutocompleteFocus(prefix,level){refreshOptions(prefix,level);}
export function addressAutocompleteInput(prefix,level){const code=element(prefix,`${level}_code`);if(code)code.value='';clearChildren(prefix,level);setError(prefix,level,'');syncAddressCopies(prefix);refreshOptions(prefix,level);}
export function addressAutocompleteBlur(prefix,level){setTimeout(()=>{const input=element(prefix,level);if(!input||input.disabled)return;if(element(prefix,`${level}_code`)?.value){closeOptions(prefix,level);return;}const current=state(prefix);const exact=current.options.find(row=>row.name.toLowerCase()===input.value.trim().toLowerCase());if(exact)addressSelectOption(prefix,level,exact.code);else if(input.value.trim()){setError(prefix,level,`Select a valid ${labels[level].toLowerCase()} from the suggestions.`);closeOptions(prefix,level);}else closeOptions(prefix,level);},120);}
export function addressAutocompleteKeydown(event,prefix,level){
  const current=state(prefix);if(event.key==='Escape'){closeOptions(prefix,level);return;}if(!['ArrowDown','ArrowUp','Enter'].includes(event.key))return;
  event.preventDefault();if(!current.options.length)return;
  if(event.key==='ArrowDown')current.highlight=Math.min(current.options.length-1,current.highlight+1);if(event.key==='ArrowUp')current.highlight=Math.max(0,current.highlight-1);
  if(event.key==='Enter'){const row=current.options[Math.max(0,current.highlight)];if(row)addressSelectOption(prefix,level,row.code);return;}
  const box=element(prefix,`${level}_options`);box?.querySelectorAll('[role="option"]').forEach((option,index)=>option.setAttribute('aria-selected',String(index===current.highlight)));box?.querySelector(`[data-index="${current.highlight}"]`)?.scrollIntoView({block:'nearest'});
}

export async function addressSelectOption(prefix,level,code){
  const row=state(prefix).options.find(item=>String(item.code)===String(code));if(!row)return;
  const index=await loadAddressIndex();
  const city=level==='barangay'?index.cityByCode.get(String(row.cityCode||'')):level==='city'?row:null;
  const province=level==='province'?row:index.provinceByCode.get(String(city?.provinceCode||row.provinceCode||''));
  const region=level==='region'?row:index.regionByCode.get(String(city?.regionCode||province?.regionCode||row.regionCode||''));
  const setValue=(targetLevel,targetRow)=>{const input=element(prefix,targetLevel),codeInput=element(prefix,`${targetLevel}_code`);if(!input||!codeInput||!targetRow)return;input.disabled=false;input.value=targetRow.name;codeInput.value=String(targetRow.code);setError(prefix,targetLevel,'');};
  if(region)setValue('region',region);
  if(province)setValue('province',province);
  else if(city&&region){const provinceInput=element(prefix,'province');if(provinceInput){provinceInput.value='Not applicable';provinceInput.disabled=true;element(prefix,'province_code').value='';}}
  if(city)setValue('city',city);
  setValue(level,row);
  closeOptions(prefix,level);clearChildren(prefix,level);
  if(level==='region'&&!index.provincesForRegion(row.code).length){const provinceInput=element(prefix,'province');provinceInput.value='Not applicable';provinceInput.disabled=true;}
  const selectedCity=level==='city'?row:level==='barangay'?city:null;if(selectedCity){const zip=element(prefix,'zip');if(zip)zip.value=String(selectedCity.zip||'');}
  syncAddressCopies(prefix);
  const next=levelOrder[levelOrder.indexOf(level)+1];if(next){const nextInput=element(prefix,next);if(nextInput&&!nextInput.disabled)nextInput.focus();}
}

export function addressValueFromDOM(prefix){
  const value={},mirrored=Boolean(state(prefix).copyFrom);levelOrder.forEach(level=>{const input=element(prefix,level);value[`${level}Name`]=input?.disabled&&!mirrored?'':input?.value.trim()||'';value[`${level}Code`]=element(prefix,`${level}_code`)?.value||'';});
  value.addressLine=element(prefix,'line')?.value.trim()||'';value.zipCode=element(prefix,'zip')?.value.trim()||'';value.formattedAddress=formatPhilippineAddress(value);value.legacy=false;return value;
}

export async function readAddressComponent(prefix,{required=null}={}){
  const component=document.querySelector(`[data-address-component="${CSS.escape(prefix)}"]`);const mustFill=required??component?.dataset.addressRequired==='true';const value=addressValueFromDOM(prefix);let index;
  try{index=await loadAddressIndex();}catch(error){setStatus(prefix,error.message,'error');return {valid:false,address:value,errors:{region:error.message},message:error.message};}
  let barangays=[];if(value.cityCode){try{barangays=await loadBarangays(value.cityCode);}catch(error){setStatus(prefix,error.message,'error');return {valid:false,address:value,errors:{barangay:error.message},message:error.message};}}
  const result=validatePhilippineAddress(value,{index,barangays,required:mustFill});
  levelOrder.forEach(level=>setError(prefix,level,result.errors[level]||''));setError(prefix,'zip',result.errors.zipCode||'');
  const message=addressValidationMessage(result.errors);setStatus(prefix,message,result.valid&&value.formattedAddress?'success':'');
  return {...result,message};
}

function setMirrored(prefix,mirrored){
  const component=document.querySelector(`[data-address-component="${CSS.escape(prefix)}"]`);component?.classList.toggle('is-mirrored',mirrored);
  component?.querySelectorAll('.address-grid input:not([type="hidden"])').forEach(input=>{input.disabled=mirrored;});
  if(!mirrored){const province=element(prefix,'province');if(province&&!element(prefix,'province_code')?.value&&element(prefix,'region_code')?.value&&province.value==='Not applicable')province.disabled=true;}
}
function copyAddressValue(sourcePrefix,targetPrefix){
  const source=addressValueFromDOM(sourcePrefix);levelOrder.forEach(level=>{const targetInput=element(targetPrefix,level),targetCode=element(targetPrefix,`${level}_code`);if(targetInput)targetInput.value=source[`${level}Name`]||'';if(targetCode)targetCode.value=source[`${level}Code`]||'';});
  const province=element(targetPrefix,'province');if(!source.provinceCode&&source.regionCode&&province)province.value='Not applicable';
  if(element(targetPrefix,'line'))element(targetPrefix,'line').value=source.addressLine;if(element(targetPrefix,'zip'))element(targetPrefix,'zip').value=source.zipCode;setStatus(targetPrefix,'Mirroring home address.','success');
}
function syncAddressCopies(sourcePrefix){instances.forEach((current,targetPrefix)=>{if(current.copyFrom===sourcePrefix)copyAddressValue(sourcePrefix,targetPrefix);});}
export function addressDetailInput(prefix){setStatus(prefix,'');syncAddressCopies(prefix);}
export function addressCopyFrom(sourcePrefix,targetPrefix,checked){state(targetPrefix).copyFrom=checked?sourcePrefix:'';if(checked)copyAddressValue(sourcePrefix,targetPrefix);setMirrored(targetPrefix,checked);if(!checked)setStatus(targetPrefix,'');}

export async function initializeAddressComponents(root=document){
  const components=[...root.querySelectorAll('[data-address-component]')];if(!components.length)return;
  try{const index=await loadAddressIndex();await Promise.all(components.map(async component=>{const prefix=component.dataset.addressComponent;const regionCode=element(prefix,'region_code')?.value||'';const province=element(prefix,'province');if(regionCode&&province&&!index.provincesForRegion(regionCode).length){province.value='Not applicable';province.disabled=true;}const cityCode=element(prefix,'city_code')?.value||'';if(cityCode)state(prefix).barangays=await loadBarangays(cityCode);}));}
  catch(error){components.forEach(component=>setStatus(component.dataset.addressComponent,error.message||'Address data could not be loaded','error'));}
}
