const DATA_ROOT=new URL('../../assets/data/philippine-address/',import.meta.url);
let catalogPromise=null;
let barangaySearchPromise=null;
const barangayCache=new Map();

export function normalizeAddressSearch(value){
  return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

function sortByName(rows){return [...rows].sort((a,b)=>a.name.localeCompare(b.name));}
function rankedSearch(rows,query,limit=50){
  const needle=normalizeAddressSearch(query);
  if(!needle)return rows.slice(0,limit);
  return rows.map(row=>{const name=normalizeAddressSearch(row.name);return {row,rank:name===needle?0:name.startsWith(needle)?1:name.includes(needle)?2:99};}).filter(match=>match.rank<99).sort((a,b)=>a.rank-b.rank||a.row.name.localeCompare(b.row.name)).slice(0,limit).map(match=>match.row);
}

export function createAddressIndex({regions=[],provinces=[],cities=[]}={}){
  const regionRows=sortByName(regions);
  const provinceRows=sortByName(provinces);
  const cityRows=sortByName(cities);
  const regionByCode=new Map(regionRows.map(row=>[String(row.code),row]));
  const provinceByCode=new Map(provinceRows.map(row=>[String(row.code),row]));
  const cityByCode=new Map(cityRows.map(row=>[String(row.code),row]));
  const provincesByRegion=new Map();
  const citiesByProvince=new Map();
  const citiesByRegion=new Map();
  provinceRows.forEach(row=>{const key=String(row.regionCode||'');if(!provincesByRegion.has(key))provincesByRegion.set(key,[]);provincesByRegion.get(key).push(row);});
  cityRows.forEach(row=>{const provinceKey=String(row.provinceCode||'');const regionKey=String(row.regionCode||'');if(!citiesByProvince.has(provinceKey))citiesByProvince.set(provinceKey,[]);citiesByProvince.get(provinceKey).push(row);if(!citiesByRegion.has(regionKey))citiesByRegion.set(regionKey,[]);citiesByRegion.get(regionKey).push(row);});
  const api={
    regions:regionRows,provinces:provinceRows,cities:cityRows,regionByCode,provinceByCode,cityByCode,
    provincesForRegion:code=>provincesByRegion.get(String(code||''))||[],
    citiesForRegion:code=>citiesByRegion.get(String(code||''))||[],
    citiesForProvince:(provinceCode,regionCode='')=>provinceCode?(citiesByProvince.get(String(provinceCode))||[]):(citiesByRegion.get(String(regionCode||''))||[]).filter(city=>!city.provinceCode),
    searchRegions:(query,limit)=>rankedSearch(regionRows,query,limit),
    searchProvinces:(regionCode,query,limit)=>rankedSearch(regionCode?api.provincesForRegion(regionCode):provinceRows,query,limit),
    searchCities:(provinceCode,regionCode,query,limit)=>rankedSearch(provinceCode?api.citiesForProvince(provinceCode):regionCode?api.citiesForRegion(regionCode):cityRows,query,limit),
    exact:(rows,name)=>rows.find(row=>normalizeAddressSearch(row.name)===normalizeAddressSearch(name))||null,
  };
  return api;
}

async function fetchJson(url,message){
  const response=await fetch(url);
  if(!response.ok)throw new Error(message);
  return response.json();
}

export async function loadAddressIndex(){
  if(!catalogPromise)catalogPromise=Promise.all([
    fetchJson(new URL('regions.json',DATA_ROOT),'Unable to load Philippine regions.'),
    fetchJson(new URL('provinces.json',DATA_ROOT),'Unable to load Philippine provinces.'),
    fetchJson(new URL('cities.json',DATA_ROOT),'Unable to load Philippine cities and municipalities.'),
  ]).then(([regions,provinces,cities])=>createAddressIndex({regions,provinces,cities})).catch(error=>{catalogPromise=null;throw error;});
  return catalogPromise;
}

export async function loadBarangays(cityCode){
  const code=String(cityCode||'');
  if(!code)return [];
  if(!barangayCache.has(code))barangayCache.set(code,fetchJson(new URL(`barangays/${encodeURIComponent(code)}.json`,DATA_ROOT),'Unable to load barangays for the selected city or municipality.').then(rows=>sortByName(rows.map(row=>({...row,cityCode:code})))).catch(error=>{barangayCache.delete(code);throw error;}));
  return barangayCache.get(code);
}

export async function loadBarangaySearchIndex(){
  if(!barangaySearchPromise)barangaySearchPromise=fetchJson(new URL('barangay-search-index.json',DATA_ROOT),'Unable to load the nationwide barangay search index.').then(rows=>sortByName(rows)).catch(error=>{barangaySearchPromise=null;throw error;});
  return barangaySearchPromise;
}

export function searchAddressRows(rows,query,limit=50){return rankedSearch(rows,query,limit);}
export function clearAddressDataCache(){catalogPromise=null;barangaySearchPromise=null;barangayCache.clear();}
