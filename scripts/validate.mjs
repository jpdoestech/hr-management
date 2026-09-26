import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const required=[
  'index.html','css/app.css','css/professional.css','js/app.js',
  'js/core/pagination.js','js/core/table-enhancer.js','supabase-config.js'
];
const missing=required.filter(f=>!fs.existsSync(path.join(root,f)));
if(missing.length){
  console.error('Missing required files:', missing.join(', '));
  process.exit(1);
}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const attr of ['href','src']){
  const re=new RegExp(`${attr}="([^"]+)"`,'g');
  let m;
  while((m=re.exec(html))){
    const ref=m[1];
    if(/^(https?:|#|data:)/.test(ref)) continue;
    if(!fs.existsSync(path.join(root,ref))){
      console.error(`Broken ${attr} reference: ${ref}`);
      process.exit(1);
    }
  }
}
const app=fs.readFileSync(path.join(root,'js/app.js'),'utf8');
if(!app.includes('SUPABASE_PUBLISHABLE_KEY')){
  console.error('Publishable Supabase key reference is missing.');
  process.exit(1);
}
if(app.includes('SUPABASE_ANON_KEY')){
  console.error('Legacy SUPABASE_ANON_KEY reference found.');
  process.exit(1);
}
console.log('SCPA HR Platform structural validation passed.');
