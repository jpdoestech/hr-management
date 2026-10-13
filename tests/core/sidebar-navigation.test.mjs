import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
const navigation=source.slice(source.indexOf('const NAV = ['),source.indexOf('function toggleSidebar('));
function fixture(role='Administrator',permissions=['dashboard','employees','users','settings']){
  const element=()=>({children:[],attributes:{},innerHTML:'',appendChild(child){this.children.push(child);},setAttribute(key,value){this.attributes[key]=value;}});
  const nav=element(),destinations=[];
  const sandbox={SESSION:{role},STATE:{view:'employees'},esc:String,viewPermission:view=>view,hasPermission:key=>permissions.includes(key),
    document:{getElementById:id=>id==='nav'?nav:null,querySelectorAll:()=>[],createElement:element},go:view=>destinations.push(view)};
  for(const icon of navigation.matchAll(/\b(?:icon:|':)(i\w+)/g))sandbox[icon[1]]=()=>'';
  sandbox.iGrid=sandbox.iArrowLeft=()=>'';
  vm.createContext(sandbox);vm.runInContext(navigation+'\nthis.groups=NAV;',sandbox);
  return {sandbox,nav,destinations};
}

test('Dashboard and Employees are unique direct links outside grouped workspaces',()=>{
  const {sandbox}=fixture();
  assert.deepEqual(Array.from(sandbox.groups[0].items,item=>item.v),['dashboard','employees']);
  assert.equal(sandbox.groups[0].direct,true);
  for(const view of ['dashboard','employees'])assert.equal(sandbox.groups.flatMap(group=>group.items).filter(item=>item.v===view).length,1);
  assert.equal(sandbox.navLabelForView('employees'),'Employees');assert.equal(sandbox.navSectionForView('employees'),'');
  const admin=sandbox.groups.find(group=>group.sec==='Administration');
  assert.deepEqual(Array.from(admin.items,item=>item.v),['users','settings']);
  assert.equal(sandbox.navSectionForView('users'),'Administration');
  assert.equal(sandbox.groups.find(group=>group.sec==='Documents & Governance').items.some(item=>['users','settings'].includes(item.v)),false);
});

test('direct links navigate in one click with current-page semantics and no submenu',()=>{
  const {sandbox,nav,destinations}=fixture();sandbox.renderNav();
  const [dashboard,employees]=nav.children.map(group=>group.children[0]);
  assert.equal(dashboard.className,'navgroup-head nav-direct');assert.equal(employees.attributes['aria-current'],'page');
  assert.equal(employees.attributes['aria-haspopup'],undefined);assert.equal(employees.type,'button');
  employees.onclick();dashboard.onclick();assert.deepEqual(destinations,['employees','dashboard']);
});

test('Administration preserves existing permissions and HR organization access',()=>{
  const viewer=fixture('Viewer',['dashboard','employees']);viewer.sandbox.renderNav();
  assert.equal(viewer.nav.children.some(group=>group.children[0].innerHTML.includes('Administration')),false);
  const hr=fixture('HR Staff',['dashboard','employees']);hr.sandbox.renderNav();
  const admin=hr.sandbox.groups.find(group=>group.sec==='Administration');
  assert.deepEqual(Array.from(admin.items.filter(hr.sandbox.navItemVisible),item=>item.v),['settings']);
  const employee=fixture('Employee',[]);employee.sandbox.renderNav();
  assert.equal(employee.nav.children.some(group=>group.children[0].className==='navgroup-head nav-direct'),false);
});
