// Synthetic navigation harness: real sidebar renderer/styles, no authentication or employee records.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url)),source=readFileSync(resolve(root,'js/app.js'),'utf8');
const navigation=source.slice(source.indexOf('const NAV = ['),source.indexOf('const VIEW_RECORD_MODULES='));
const icons=[...source.matchAll(/^function i\w+\(s\)\{.*$/gm)].map(match=>match[0]).join('\n');
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic sidebar review</title><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/professional.css"></head><body><div id="app" class="sidebar-open" style="display:grid"><aside id="sidebar"><div class="brand">Navigation review</div><nav id="nav" aria-label="Main navigation"></nav></aside><main id="main"><div id="topbar"><button class="mobile-menu" aria-label="Open navigation" onclick="toggleSidebar()">Menu</button><h1 id="destination">Employees</h1></div></main></div><script>
${icons}
const SESSION={role:'Administrator'},STATE={view:'employees'},esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;'),viewPermission=view=>view,hasPermission=()=>true;
const pendingServiceRequestCount=()=>0,lifecycleChecklistPendingCount=()=>0,workflowPendingCount=()=>0,automationPendingCount=()=>0,onboardingOpenCount=()=>0;
function go(view){STATE.view=view;renderNav();closeSidebar();document.getElementById('destination').textContent=navLabelForView(view);}
${navigation}
renderNav();
</script></body></html>`;
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/shutdown'){res.end('Stopped');server.close();server.closeAllConnections();return;}
  if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const file=resolve(root,'.'+decodeURIComponent(path));if(!file.startsWith(resolve(root,'css')+sep)){res.writeHead(403);res.end();return;}
  try{res.setHeader('Content-Type',extname(file)==='.css'?'text/css':'text/javascript');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});
server.listen(4186,'127.0.0.1',()=>console.log('Synthetic sidebar: http://127.0.0.1:4186/'));
