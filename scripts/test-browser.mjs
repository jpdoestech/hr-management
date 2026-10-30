import {createServer} from 'node:http';
import {createServer as createSocket} from 'node:net';
import {spawn} from 'node:child_process';
import {readFile,mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,sep,extname,basename,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {expectedIds} from '../tests/browser/regression-suite.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export function validateBrowserReport(report,runId){
  if(report?.runId!==runId||report.fontMode!=='offline-fallback'||!Array.isArray(report.results))throw Error('Invalid browser report');
  const ids=new Set(expectedIds());
  if(report.results.length!==ids.size)throw Error('Incomplete browser report');
  for(const result of report.results){
    if(!ids.delete(result.id)||typeof result.pass!=='boolean'||!Number.isFinite(result.durationMs)||result.durationMs<0)throw Error('Invalid or duplicate browser result');
    if(result.error!==undefined&&(typeof result.error!=='string'||result.error.length>600))throw Error('Invalid browser error');
    for(const [key,value] of Object.entries(result.metrics||{}))if(!['rows','renderMedianMs','renderMaxMs','searchMs','profileMedianMs','profileMaxMs'].includes(key)||!Number.isFinite(value)||value<0)throw Error('Invalid performance metrics');
  }
  return report.results;
}
export function isolatedProfile(path){return dirname(resolve(path))===resolve(tmpdir())&&basename(path).startsWith('hr-browser-');}
const fixtures=[['modal',4187,'modal-typography'],['ui',4194,'ui-consistency'],['workspace',4191,'workspace-redesign'],['attendance',4189,'attendance-preparation']];
const csp="default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'";
export function offlineFixture(html){
  const prelude='<script>window.__fixtureErrors=[];addEventListener("error",event=>{if(event.message)window.__fixtureErrors.push(event.message)});addEventListener("unhandledrejection",event=>window.__fixtureErrors.push(String(event.reason?.message||event.reason)));</script>';
  return html.replace(/(href|src)="(css|assets)\//g,'$1="/$2/').replace(/<link\b[^>]*href="https:\/\/fonts\.[^>]*>/g,'').replace(/<head[^>]*>/i,match=>match+'<meta http-equiv="Content-Security-Policy" content="'+csp+'">'+prelude);
}
async function available(port){
  await new Promise((resolveReady,reject)=>{const probe=createSocket();probe.once('error',()=>reject(Error('Fixture port '+port+' is already in use; stop that fixture first.')));probe.listen(port,'127.0.0.1',()=>probe.close(resolveReady));});
}
async function main(){
  const children=[],runId=randomBytes(16).toString('hex');let browser,profile,server,deadline,stopping=false;
  async function stop(code){
    if(stopping)return;stopping=true;clearTimeout(deadline);process.exitCode=code;
    for(const child of children)child.kill();
    if(browser){browser.kill();await new Promise(resolveDone=>{if(browser.exitCode!==null)return resolveDone();browser.once('close',resolveDone);setTimeout(resolveDone,1500);});}
    if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}
    if(profile&&isolatedProfile(profile)){
      // shortcut: a browser still holding files can leave its disposable profile; never delete a user's profile.
      await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(()=>console.warn('Disposable browser profile remains at '+profile));
    }
  }
  const fail=error=>{console.error(error.message);return stop(1);};
  process.once('SIGINT',()=>stop(130));process.once('SIGTERM',()=>stop(143));
  try{
    for(const [,port] of fixtures)await available(port);
    for(const [,port,name] of fixtures){
      const child=spawn(process.execPath,[resolve(root,'tests/browser/'+name+'-fixture.mjs')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(child);
      await new Promise((ready,reject)=>{
        const timer=setTimeout(()=>reject(Error('Fixture startup timed out: '+name)),5000);
        child.stdout.on('data',data=>{if(data.toString().includes('127.0.0.1:'+port)){clearTimeout(timer);ready();}});
        child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);if(!stopping)reject(Error('Fixture failed to start: '+name+' ('+code+')'));});
      });
    }
    server=createServer(async(req,res)=>{
      try{
        const url=new URL(req.url,'http://127.0.0.1');
        if(req.method==='POST'&&url.pathname==='/results'){
          let body='';for await(const chunk of req){body+=chunk;if(body.length>150000)throw Error('Report too large');}
          const report=JSON.parse(body),results=validateBrowserReport(report,runId),failed=results.filter(row=>!row.pass);
          await mkdir(resolve(root,'artifacts'),{recursive:true});
          await writeFile(resolve(root,'artifacts/browser-regression.json'),JSON.stringify({at:new Date().toISOString(),fontMode:report.fontMode,results},null,2));
          console.log(`${results.length-failed.length}/${results.length} browser checks passed`);
          for(const result of failed)console.error(result.id+': '+result.error);
          for(const result of results.filter(row=>row.metrics?.renderMedianMs!==undefined||row.metrics?.profileMedianMs!==undefined))console.log(result.id+' '+JSON.stringify(result.metrics));
          res.setHeader('Content-Type','application/json');res.end('{"received":true}');
          setTimeout(()=>stop(failed.length?1:0),100);return;
        }
        if(req.method!=='GET'){res.writeHead(405);res.end();return;}
        if(url.pathname==='/'){
          res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HR browser regressions</title><style>body{font:14px system-ui;margin:24px;background:#f7f7fa;color:#28252f}h1{font-size:24px}.pass{color:#15583f}.fail{color:#991b1b}.preview{max-width:100%;height:400px;overflow:auto;border:1px solid #bbb}iframe{border:0;background:white}li{margin:4px 0}#results{columns:2;column-width:320px}</style><h1>STRELLAS HR browser regression checks</h1><p>Synthetic records only · offline fallback fonts · seven document widths</p><p id="summary" role="status">Starting…</p><div class="preview"><iframe id="preview" title="Synthetic application under test"></iframe></div><ol id="results"></ol><script type="module" src="/tests/browser/regression-suite.mjs"></script></html>`);return;
        }
        const fixture=fixtures.find(([name])=>url.pathname==='/fixtures/'+name);
        if(fixture){const response=await fetch('http://127.0.0.1:'+fixture[1]+'/'+url.search,{signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Fixture response '+response.status);res.setHeader('Content-Type','text/html');res.end(offlineFixture(await response.text()));return;}
        const file=resolve(root,'.'+decodeURIComponent(url.pathname));
        const allowed=['css','assets','js/core','js/manpower'].some(dir=>file.startsWith(resolve(root,dir)+sep))||file===resolve(root,'tests/browser/regression-suite.mjs');
        if(!allowed){res.writeHead(404);res.end();return;}
        res.setHeader('Content-Type',({'.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));
      }catch(error){res.writeHead(400,{'Content-Type':'text/plain'});res.end('Browser fixture request failed: '+error.message);}
    });
    await new Promise((ready,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',ready);});
    const url='http://127.0.0.1:'+server.address().port+'/?run='+runId;
    console.log('Open this local URL to run the suite: '+url);
    deadline=setTimeout(()=>fail(Error('Browser suite timed out without a complete result')),180000);
    if(process.argv.includes('--headless')){
      const candidates=process.platform==='win32'?[join(process.env.PROGRAMFILES||'C:/Program Files','Google/Chrome/Application/chrome.exe'),join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe')]:process.platform==='darwin'?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']:['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'];
      const executable=process.env.BROWSER_BIN||candidates.find(existsSync);if(!executable)throw Error('Chrome/Edge not found. Set BROWSER_BIN or run without --headless and open the printed URL.');
      profile=await mkdtemp(join(tmpdir(),'hr-browser-'));
      browser=spawn(executable,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--user-data-dir='+profile,url],{windowsHide:true,stdio:'ignore'});
      browser.once('error',fail);browser.once('exit',code=>{if(!stopping)fail(Error('Headless browser exited before reporting ('+code+')'));});
    }
  }catch(error){await fail(error);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
