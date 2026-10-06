export const ACCESS_ACTIONS=['view','create','update','delete','export','approve','manage'];

export const ACCESS_MODULES=[
  {key:'dashboard',label:'Dashboard',actions:['view']},
  {key:'employees',label:'Employee Information',actions:['view','create','update','delete','export','manage']},
  {key:'onboarding',label:'Onboarding & Applicants',actions:['view','create','update','delete','approve','export']},
  {key:'lifecycle',label:'Employment Lifecycle',actions:['view','create','update','approve','manage']},
  {key:'leave',label:'Leave Management',actions:['view','create','update','delete','export','approve']},
  {key:'manpower',label:'Manpower Fulfillment',actions:['view','create','update','delete','export','approve']},
  {key:'employee_relations',label:'Employee Relations',actions:['view','create','update','delete','export','approve','manage']},
  {key:'documents',label:'Documents',actions:['view','create','update','delete','export','manage']},
  {key:'workflow',label:'Workflow & Approvals',actions:['view','create','update','approve','manage']},
  {key:'analytics',label:'Analytics & Reports',actions:['view','export']},
  {key:'automation',label:'Automation Center',actions:['view','manage']},
  {key:'organization',label:'Organization Structure',actions:['view','create','update','manage']},
  {key:'settings',label:'System Settings',actions:['view','manage']},
  {key:'access_control',label:'Access Control',actions:['view','manage']},
  {key:'self_service',label:'Employee Self-Service',actions:['view','update']},
];

export const ACCESS_PERMISSION_KEYS=ACCESS_MODULES.flatMap(module=>module.actions.map(action=>`${module.key}.${action}`));

export function permissionLabel(key){
  const [moduleKey,action='']=String(key||'').split('.');
  const module=ACCESS_MODULES.find(item=>item.key===moduleKey);
  return `${module?.label||moduleKey} · ${action.charAt(0).toUpperCase()+action.slice(1)}`;
}

export function evaluateEffectiveAccess({superAdmin=false,rolePermissions=[],directGrants=[],directDenies=[]}={}){
  const roleSet=new Set(rolePermissions);
  const grantSet=new Set(directGrants);
  const denySet=new Set(directDenies);
  const final={};
  ACCESS_PERMISSION_KEYS.forEach(key=>{
    if(superAdmin) final[key]={allowed:true,source:'superadmin'};
    else if(denySet.has(key)) final[key]={allowed:false,source:'direct-deny'};
    else if(grantSet.has(key)) final[key]={allowed:true,source:'direct-grant'};
    else if(roleSet.has(key)) final[key]={allowed:true,source:'role'};
    else final[key]={allowed:false,source:'not-granted'};
  });
  return final;
}

export function legacyPermissions(role,canExport=false){
  const all=ACCESS_PERMISSION_KEYS;
  if(role==='Administrator') return [...all];
  if(role==='HR Staff') return all.filter(key=>!['settings.manage','access_control.manage'].includes(key));
  if(role==='Viewer') return all.filter(key=>(key.endsWith('.view')&&!['access_control.view','settings.view','organization.view'].includes(key))||key==='analytics.export'||(canExport&&key.endsWith('.export')));
  if(role==='Manager') return ['dashboard.view','employees.view','leave.view','leave.approve','workflow.view','workflow.approve','analytics.view','self_service.view','self_service.update'];
  return ['self_service.view','self_service.update'];
}

export function hasEffectivePermission(effective,key){
  const value=effective?.[key];
  return typeof value==='object'?value.allowed===true:value===true;
}
