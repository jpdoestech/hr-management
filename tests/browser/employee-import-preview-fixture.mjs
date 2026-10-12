// Synthetic layout/controller harness. Authorization, address initialization and validation are stubbed.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url)),source=readFileSync(resolve(root,'js/app.js'),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic employee import</title><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/professional.css"></head><body><div class="overlay on" id="overlay"><div class="modal employee-workspace-modal" id="modal"></div></div><script type="module">
import {revalidateEmployeeImport,employeeImportCorrection,employeeImportPreviewHTML} from '/js/core/employee-import-preview.js';
import {normalizeAddress} from '/js/address/address-models.js';
import {EMPLOYMENT_TYPES,STATUS_REASONS,REVIEW_TYPE} from '/js/core/employment.js';
const EMP_STATUS=['Active','Inactive','Separated'],EXIT_CLASSIFICATIONS=['Voluntary'],WORKFORCE_FACTORS=['Personal'];
const SESSION={id:'actor'},DB={employees:[]},requireEmployeeImportAdmin=()=>true,isHRRole=()=>false;
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const employeeDepartmentNames=current=>['Production',...(current&&current!=='Production'?[current]:[])],employeePositionNames=()=>['Operator'],employeeBranchLocations=()=>['Main'],uniqueSettingNames=values=>[...new Set(values.filter(Boolean))];
const canonicalEmploymentType=value=>value,formatGovernmentId=(key,value)=>value,employeeAllowanceFieldsHTML=()=>'',readEmployeeAllowances=()=>({}),nextEmployeeNumber=()=> 'EMP-000001';
const addressComponentHTML=({label})=>'<section><h4>'+label+'</h4><input aria-label="'+label+' street" value="Synthetic street"></section>',readAddressComponent=async()=>({valid:true,address:{street:'Synthetic street'}}),formatPhilippineAddress=address=>address.street;
const toast=console.log,openEmployeeWorkspaceModal=html=>document.getElementById('modal').innerHTML=html,transitionModal=async fn=>fn(),closeModal=()=>{},openEmployeeImport=()=>{},commitEmployeeImport=()=>{};
const requestCloseModal=async()=>returnEmployeeImportPreview();
${section('const EMP_FIELDS = [','const EMPLOYEE_IMPORT_COLUMNS = [')}
${section('const EMP_FORM_SECTIONS = [','function syncPositionSelect(')}
${section('function fieldHTML(','function readFields(')}
${section('function readFields(','function fileNameFromData(').split('\nfunction ')[0]}
let EMPLOYEE_IMPORT_EDIT=null;
const values={lastName:'SYNTHETIC',firstName:'Applicant',name:'SYNTHETIC, Applicant',department:'Production',position:'Operator',branchReporting:'Main',employeeNo:'EMP-000001',gender:'Male',employmentType:'Probationary',status:'Active',statusReason:'Active / Normal',dateHired:'2026-10-01'};
let EMPLOYEE_IMPORT_PREVIEW={fileName:'synthetic.xlsx',fileErrors:[],rows:[{rowNumber:2,values:{...values},sourceValues:{...values},errors:[],warnings:[]},{rowNumber:3,values:{...values,gender:'Unknown'},sourceValues:{...values,gender:'Unknown'},errors:['Invalid gender'],warnings:[]},{rowNumber:4,values:{...values},sourceValues:{...values},errors:[],warnings:['Possible duplicate']}]};
const employeeImportSummary=preview=>({errors:preview.rows.reduce((n,row)=>n+row.errors.length,0),warnings:preview.rows.reduce((n,row)=>n+row.warnings.length,0),valid:preview.rows.filter(row=>!row.errors.length).length,total:preview.rows.length});
const validateEmployeeImportRow=(values,rowNumber)=>({rowNumber,values,errors:values.gender==='Unknown'?['Invalid gender']:[],warnings:rowNumber===4?['Possible duplicate']:[]});
${section('function renderEmployeeImportPreview(','async function commitEmployeeImport(')}
Object.assign(window,{filterEmployeeImport,openEmployeeImportRow,saveEmployeeImportRow,requestCloseModal,closeModal,commitEmployeeImport,openEmployeeImport});renderEmployeeImportPreview();
</script></body></html>`;
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/shutdown'){res.end('Stopped');server.close();server.closeAllConnections();return;}
  if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const file=resolve(root,'.'+decodeURIComponent(path));if(!['js','css'].some(folder=>file.startsWith(resolve(root,folder)+sep))){res.writeHead(403);res.end();return;}
  try{res.setHeader('Content-Type',extname(file)==='.css'?'text/css':'text/javascript');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});
server.listen(4185,'127.0.0.1',()=>console.log('Synthetic import preview: http://127.0.0.1:4185/'));
