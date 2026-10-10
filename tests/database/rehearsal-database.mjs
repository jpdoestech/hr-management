// Test-only adapter. Never connect this harness to an existing/live database.
export async function openRehearsalDatabase(){
  if(!process.env.HRIS_REHEARSAL_DATABASE_URL){
    const path=process.env.HRIS_PGLITE_MODULE||'@electric-sql/pglite';
    const {PGlite}=await import(path);
    const {fuzzystrmatch}=await import(process.env.HRIS_PGLITE_MODULE?new URL('./contrib/fuzzystrmatch.js',path).href:'@electric-sql/pglite/contrib/fuzzystrmatch');
    const {btree_gist}=await import(process.env.HRIS_PGLITE_MODULE?new URL('./contrib/btree_gist.js',path).href:'@electric-sql/pglite/contrib/btree_gist');
    return new PGlite({extensions:{fuzzystrmatch,btree_gist}});
  }
  const url=new URL(process.env.HRIS_REHEARSAL_DATABASE_URL);
  if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||!url.port||url.port==='5432'
    ||!/^\/hris_rehearsal_[a-z0-9_]+$/.test(url.pathname)||url.username!=='hris_rehearsal'||url.password||url.search
    ||process.env.HRIS_NATIVE_REHEARSAL_ALLOWED!=='synthetic-only')throw new Error('Native rehearsal requires an explicitly permitted, isolated loopback test cluster');
  const pg=(await import(process.env.HRIS_PG_MODULE||'pg')).default;
  pg.types.setTypeParser(20,value=>{
    const number=Number(value);if(!Number.isSafeInteger(number))throw new Error('Unsafe integer in synthetic rehearsal');return number;
  });
  pg.types.setTypeParser(1082,value=>new Date(value+'T00:00:00Z'));
  const connect=async()=>{
    const client=new pg.Client({connectionString:url.href,application_name:'hris-synthetic-rehearsal'});await client.connect();
    await client.query("set statement_timeout='30s';set lock_timeout='5s';set timezone='UTC'");
    return client;
  };
  const client=await connect();
  const existing=await client.query(`select (
    (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' or (n.nspname not like 'pg_%' and n.nspname<>'information_schema'))+
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' or (n.nspname not like 'pg_%' and n.nspname<>'information_schema'))+
    (select count(*) from pg_namespace where nspname not in ('public','information_schema') and nspname not like 'pg_%')
  )::int count`);
  if(existing.rows[0].count){await client.end();throw new Error('Refusing to initialize a nonempty database');}
  const wrap=connection=>({
    query(sql,parameters=[]){
      // Fixture arrays are JSON unless the SQL explicitly requests a PostgreSQL array.
      const values=parameters.map((value,index)=>Array.isArray(value)&&!new RegExp('\\$'+(index+1)+'\\s*::\\s*(?:uuid|text)\\[\\]','i').test(sql)?JSON.stringify(value):value);
      return connection.query(sql,values);
    },
    async exec(sql){const results=await connection.query(sql);return Array.isArray(results)?results:[results];},
    close:()=>connection.end(),
    native:true
  });
  return {...wrap(client),async connection(){return wrap(await connect());}};
}
