import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {paginationMeta,paginationHTML} from '../../js/core/pagination.js';

const source=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
const migration=readFileSync(new URL('../../supabase/migrations/0033_manpower_client_catalog.sql',import.meta.url),'utf8');
export function clientCatalogPreview({role='Administrator',fail=false}={}){
  const host={innerHTML:'',isConnected:true},calls=[],messages=[];
  const context={SESSION:{id:'admin',role},STATE:{tablePages:{},clientSearch:''},paginationMeta,paginationHTML,crypto:{randomUUID:()=> '00000000-0000-0000-0000-000000000001'},
    document:{getElementById:id=>id==='client-catalog-results'?host:null},hasPermission:()=>true,
    esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    settingsCatalogStatus:active=>active?'Active':'Inactive',iSearch:()=>'',iPlus:()=>'',iEdit:()=>'',openModal:html=>{context.modal=html;},toast:(...args)=>messages.push(args),closeModal:async()=>{},
    supabase:{from:table=>{
      calls.push({table});const query={select:(...args)=>{calls.push({select:args});return query;},order:()=>query,range:(start,end)=>{calls.push({range:[start,end]});return query;},ilike:(key,value)=>{calls.push({search:value});return query;},
        then:resolve=>Promise.resolve(resolve(fail?{error:{code:'PGRST205',message:'Missing table'}}:{data:[{id:'00000000-0000-0000-0000-000000000001',name:'Example Client',active:true,revision:1}],count:26}))};return query;
    },rpc:async(name,args)=>{calls.push({rpc:name,args});return {};}}
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('const CLIENT_CATALOG='),source.indexOf('function settingsOrganizationHTML(')),context);
  return {context,host,calls,messages,run:code=>vm.runInContext(code,context)};
}
test('client catalog searches and paginates on the database without replacing search input',async()=>{
  const fixture=clientCatalogPreview();fixture.context.STATE.clientSearch='A_100%';
  await fixture.run('renderClientCatalog()');
  assert.deepEqual(fixture.calls.find(call=>call.range).range,[0,9]);
  assert.equal(fixture.calls.find(call=>call.search).search,'%A\\_100\\%%');
  assert.match(fixture.host.innerHTML,/1-10 of 26/);assert.match(fixture.host.innerHTML,/Example Client/);
  assert.doesNotMatch(fixture.host.innerHTML,/value="100000"/);
  fixture.run("clientCatalogPageSize('settings:clients',25)");
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(fixture.calls.filter(call=>call.range).at(-1).range,[0,24]);
});
test('non-administrator cannot load or open client mutations even with permission override',async()=>{
  const fixture=clientCatalogPreview({role:'HR Staff'});
  await fixture.run('renderClientCatalog();openClientAccountForm()');
  assert.equal(fixture.calls.length,0);assert.equal(fixture.context.modal,undefined);
});
test('missing client migration shows setup guidance and retry, not fabricated records',async()=>{
  const fixture=clientCatalogPreview({fail:true});await fixture.run('renderClientCatalog()');
  assert.match(fixture.host.innerHTML,/Deploy migration 0033/);assert.match(fixture.host.innerHTML,/Retry/);
  assert.doesNotMatch(fixture.host.innerHTML,/Example Client/);
});
test('an older client search response cannot overwrite newer results',async()=>{
  const fixture=clientCatalogPreview();const pending=[];
  fixture.context.supabase.from=()=>{
    const query={select:()=>query,order:()=>query,range:()=>query,then:resolve=>new Promise(done=>pending.push(value=>done(resolve(value))))};return query;
  };
  const first=fixture.run('renderClientCatalog()');await new Promise(resolve=>setImmediate(resolve));
  const second=fixture.run('renderClientCatalog()');await new Promise(resolve=>setImmediate(resolve));
  pending[1]({data:[{id:'new',name:'Newest result',active:true}],count:1});await second;
  pending[0]({data:[{id:'old',name:'Outdated result',active:true}],count:1});await first;
  assert.match(fixture.host.innerHTML,/Newest result/);assert.doesNotMatch(fixture.host.innerHTML,/Outdated result/);
});
test('client save uses one revision-checked RPC and database-generated audit',async()=>{
  const fixture=clientCatalogPreview();
  fixture.context.document.getElementById=id=>id==='client_name'?{value:'  Example   Client  '}:id==='client_active'?{checked:true}:null;
  await fixture.run('saveClientAccount()');
  const call=fixture.calls.find(item=>item.rpc);
  assert.equal(call.rpc,'save_manpower_client');assert.equal(call.args.p_name,'Example Client');
  assert.equal(call.args.p_expected_revision,0);assert.equal(call.args.p_active,true);
  assert.match(call.args.p_id,/^[0-9a-f-]{36}$/);
});
test('client migration enforces tenant reads, administrator writes, uniqueness and audit atomically',()=>{
  assert.match(migration,/enable row level security/);assert.match(migration,/tenant_id=public.current_tenant_id\(\)/);
  assert.match(migration,/create unique index/);assert.match(migration,/actor.role='Administrator'/);
  assert.match(migration,/current_user_has_permission\('settings.manage'\)/);
  assert.match(migration,/for update/);assert.match(migration,/account.revision<>p_expected_revision/);
  assert.match(migration,/insert into public.hr_audit_logs/);assert.match(migration,/revoke all on public.hr_manpower_clients from anon,authenticated/);
  assert.doesNotMatch(migration,/delete from|update public.hr_records|insert into public.hr_records/i);
});
