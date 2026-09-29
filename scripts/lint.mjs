import { readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root=process.cwd();
const ignored=new Set(['.git','.ver','.vercel','dist','node_modules','vendor']);
function javascriptFiles(directory){
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    if(ignored.has(entry.name))return [];
    const absolute=join(directory,entry.name);
    if(entry.isDirectory())return javascriptFiles(absolute);
    return ['.js','.mjs'].includes(extname(entry.name))?[absolute]:[];
  });
}

for(const file of javascriptFiles(root)){
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status!==0){
    process.stderr.write(`Syntax check failed: ${relative(root,file)}\n${result.stderr}`);
    process.exit(result.status||1);
  }
}

const validation=spawnSync(process.execPath,['scripts/validate.mjs'],{cwd:root,stdio:'inherit'});
if(validation.status!==0)process.exit(validation.status||1);
console.log('Lint and repository validation passed.');
