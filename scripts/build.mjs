import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root=process.cwd();
const output=join(root,'dist');
if(existsSync(output))rmSync(output,{recursive:true,force:true});
mkdirSync(output,{recursive:true});
for(const entry of ['index.html','.nojekyll','vercel.json','supabase-config.js','css','js','assets']){
  const source=join(root,entry);
  if(existsSync(source))cpSync(source,join(output,entry),{recursive:true});
}
console.log('Production files created in dist/.');
