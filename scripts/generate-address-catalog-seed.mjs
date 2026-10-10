import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {readPhilippineAddressCatalog,addressCatalogSeedSQL} from './lib/philippine-address-catalog.mjs';

const position=process.argv.indexOf('--output'),output=process.argv[position+1];
if(position<0||!output||output.startsWith('--'))throw new Error('Use --output with an explicit generated SQL path outside migrations.');
const path=resolve(output);
if(path.toLowerCase().includes('supabase\\migrations\\')||path.toLowerCase().includes('supabase/migrations/'))throw new Error('Address seed is deployment gated; do not generate it into migrations.');
const catalog=readPhilippineAddressCatalog();
writeFileSync(path,addressCatalogSeedSQL(catalog),{encoding:'utf8',flag:'wx'});
console.log(JSON.stringify({output:path,counts:catalog.counts,sha256:catalog.sha256}));
