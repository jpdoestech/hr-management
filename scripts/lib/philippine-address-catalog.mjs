import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root=new URL('../../assets/data/philippine-address/',import.meta.url);

export function readPhilippineAddressCatalog(){
  const read=file=>{
    const bytes=readFileSync(new URL(file,root));
    const data=JSON.parse(bytes);if(!Array.isArray(data))throw new Error('Address reference must be an array: '+file);
    return data;
  };
  const rows=[],byCode=new Map();
  function append(row){
    if(typeof row.code!=='string'||!/^[0-9]{10}$/.test(row.code)||typeof row.name!=='string'||!row.name.trim()||byCode.has(row.code))throw new Error('Invalid or duplicate address code: '+row.code);
    byCode.set(row.code,row);rows.push(row);
  }
  for(const row of read('regions.json'))append({code:row.code,kind:'region',parent_code:null,name:row.name,zip:''});
  for(const row of read('provinces.json')){
    if(byCode.get(row.regionCode)?.kind!=='region')throw new Error('Unknown province region: '+row.code);
    append({code:row.code,kind:'province',parent_code:row.regionCode,name:row.name,zip:''});
  }
  const cities=read('cities.json');
  for(const row of cities){
    const parent=byCode.get(row.provinceCode||row.regionCode);
    if(!parent||!['province','region'].includes(parent.kind)
      ||(parent.kind==='province'&&parent.parent_code!==row.regionCode))throw new Error('Incompatible city parent: '+row.code);
    append({code:row.code,kind:'city',parent_code:parent.code,name:row.name,zip:String(row.zip||'')});
  }
  for(const city of [...cities].sort((a,b)=>a.code.localeCompare(b.code)))for(const row of read('barangays/'+city.code+'.json')){
    if(row.cityCode&&row.cityCode!==city.code)throw new Error('Incompatible barangay parent: '+row.code);
    append({code:row.code,kind:'barangay',parent_code:city.code,name:row.name,zip:''});
  }
  rows.sort((a,b)=>a.code.localeCompare(b.code));
  return {rows,sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),counts:Object.fromEntries(['region','province','city','barangay'].map(kind=>[kind,rows.filter(row=>row.kind===kind).length]))};
}

function literal(value){return "'"+String(value).replaceAll("'","''")+"'";}
export function addressCatalogSeedSQL(catalog=readPhilippineAddressCatalog()){
  const statements=['-- Generated from the authoritative reference. Gated operator seed; never auto-deployed.','begin;',"set local statement_timeout='2min';","set local standard_conforming_strings=on;"];
  for(let offset=0;offset<catalog.rows.length;offset+=1000){
    statements.push(`insert into manpower_private.address_locations(code,kind,parent_code,name,zip)
select code,kind,parent_code,name,zip from jsonb_to_recordset(${literal(JSON.stringify(catalog.rows.slice(offset,offset+1000)))}::jsonb)
as location(code text,kind text,parent_code text,name text,zip text);`);
  }
  statements.push(`insert into manpower_private.address_catalog_manifest(singleton,sha256,counts)
values(true,${literal(catalog.sha256)},${literal(JSON.stringify(catalog.counts))}::jsonb);`,'commit;');
  return statements.join('\n');
}
