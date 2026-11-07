// Compiled validator under an actual restricted PostgreSQL role, allocated DB only.
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
async function main(options){
 assert.match(options.project,/^crypta-t30-test-[a-f0-9]{12}$/);assert.match(options.database,/^crypta_ledger_test_[a-f0-9]{12}$/);
 assert.equal(process.env.CRYPTO_PROVIDER_MODE,'MOCK');assert.equal(process.env.SMTP_ENABLED,'false');
 const url=new URL(process.env.DATABASE_URL);assert.equal(url.hostname,'postgres');assert.equal(url.pathname,'/crypta_t30_test');url.pathname=`/${options.database}`;
 require('/app/node_modules/reflect-metadata');const {Pool}=require('/app/node_modules/pg');const {MigrationService}=require('/app/dist/database/migration.service.js');
 const admin=new Pool({connectionString:url.href,max:2,statement_timeout:10000});const runtime=new Pool({connectionString:url.href,max:2,statement_timeout:10000});
 const role=`crypta_ledger_role_${options.database.slice(-12)}`;assert.match(role,/^crypta_ledger_role_[a-f0-9]{12}$/);
 const results=[];const report={database:options.database,fixtureOnly:false,success:false,role,results,compiledServiceHashes:Object.fromEntries(['database/migration.service.js','database/migrate.js'].map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync('/app/dist/'+n)).digest('hex')])),roleSelection:'SET ROLE using dedicated test connections, not LOGIN credential authentication'};
 const sql=(q,v)=>admin.query(q,v);const ledger=async()=> (await sql('SELECT version,checksum FROM public.schema_migrations ORDER BY version')).rows;
 const runtimePool={async connect(){const c=await runtime.connect();try{await c.query(`SET ROLE "${role}"`);return c;}catch(e){c.release();throw e;}}};
 const service=new MigrationService(runtimePool);let created=false;
 async function test(name,run){try{results.push({name,passed:true,evidence:await run()??null});}catch(e){results.push({name,passed:false,error:e instanceof assert.AssertionError?e.message:String(e.message).slice(0,250)});}}
 async function rejectValidation(message){const before=await ledger();await assert.rejects(()=>service.validateApplied(),new RegExp(message));assert.deepEqual(await ledger(),before);}
 try{
  assert.equal((await sql('SELECT current_database() AS name')).rows[0].name,options.database);
  const expectedMigrationCount = 24;
  await test('Standalone migration process applies all expected migrations in the allocated DB',async()=>{
   execFileSync(process.execPath,['/app/dist/database/migrate.js'],{env:{...process.env,DATABASE_URL:url.href},stdio:['ignore','pipe','pipe'],timeout:45000});
   const entries=await ledger();assert.equal(entries.length,expectedMigrationCount);assert.equal(entries.at(-1)?.version,'024_asset_expiry_page_index');assert(entries.every(e=>/^[a-f0-9]{64}$/.test(e.checksum)));return entries;
  });
  const original=await ledger();assert.equal(original.length,expectedMigrationCount);
  assert.equal((await sql('SELECT count(*)::int AS count FROM pg_roles WHERE rolname=$1',[role])).rows[0].count,0);
  await sql(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);created=true;
  await sql('REVOKE CREATE ON SCHEMA public FROM PUBLIC');await sql(`GRANT USAGE ON SCHEMA public TO "${role}"`);await sql(`GRANT SELECT ON public.schema_migrations TO "${role}"`);
  await test('Actual limited role has no elevated attributes or object ownership',async()=>{
   const c=await runtimePool.connect();try{const identity=(await c.query('SELECT current_user,session_user')).rows[0];assert.equal(identity.current_user,role);
    const attributes=(await sql('SELECT rolsuper,rolcreatedb,rolcreaterole,rolcanlogin,rolbypassrls FROM pg_roles WHERE rolname=$1',[role])).rows[0];assert(Object.values(attributes).every(v=>v===false));
    assert.equal((await sql('SELECT count(*)::int AS count FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=$1)',[role])).rows[0].count,0);return{identity,attributes};
   }finally{c.release();}
  });
  await test('Read-only startup validates with SELECT-only ledger grant and changes no rows',async()=>{
   const before=await ledger();const prior=process.env.DATABASE_MIGRATION_MODE;delete process.env.DATABASE_MIGRATION_MODE;
   try{await service.onModuleInit();}finally{if(prior===undefined)delete process.env.DATABASE_MIGRATION_MODE;else process.env.DATABASE_MIGRATION_MODE=prior;}
   assert.deepEqual(await ledger(),before);return{migrationCount:before.length};
  });
  await test('Actual DDL and ledger INSERT UPDATE DELETE TRUNCATE attempts are denied',async()=>{
   const before=await ledger(),codes=[];
   for(const statement of ['CREATE TABLE public.ledger_forbidden(id int)','ALTER TABLE public.schema_migrations ADD COLUMN forbidden int',
    'UPDATE public.schema_migrations SET checksum=checksum','DELETE FROM public.schema_migrations',
    "INSERT INTO public.schema_migrations(version,checksum) VALUES('999_forbidden',repeat('a',64))",'TRUNCATE public.schema_migrations']){
    const c=await runtimePool.connect();try{await assert.rejects(()=>c.query(statement),e=>{codes.push(e.code);return e.code==='42501';});}finally{c.release();}
   }assert.deepEqual(await ledger(),before);return{statements:6,sqlstates:codes};
  });
  await test('Pending migration is rejected without applying schema',async()=>{
   await sql('DELETE FROM schema_migrations WHERE version=$1',[original[8].version]);await rejectValidation('DATABASE_MIGRATION_PENDING');
   await sql('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[original[8].version,original[8].checksum]);
  });
  await test('Null legacy checksum is rejected without checksum backfill',async()=>{
   await sql('UPDATE schema_migrations SET checksum=NULL WHERE version=$1',[original[0].version]);await rejectValidation('DATABASE_MIGRATION_CHECKSUM_REQUIRED');
   await sql('UPDATE schema_migrations SET checksum=$2 WHERE version=$1',[original[0].version,original[0].checksum]);
  });
  await test('Modified checksum is rejected without repairing the ledger',async()=>{
   await sql("UPDATE schema_migrations SET checksum=repeat('a',64) WHERE version=$1",[original[0].version]);await rejectValidation('DATABASE_MIGRATION_CHANGED');
   await sql('UPDATE schema_migrations SET checksum=$2 WHERE version=$1',[original[0].version,original[0].checksum]);
  });
  await test('Unknown future migration is rejected and retained for investigation',async()=>{
   await sql("INSERT INTO schema_migrations(version,checksum) VALUES('999_future',repeat('a',64))");await rejectValidation('UNKNOWN_DATABASE_MIGRATION');await sql("DELETE FROM schema_migrations WHERE version='999_future'");
  });
  await test('Missing ledger is rejected without creating a table',async()=>{
   await sql('ALTER TABLE schema_migrations RENAME TO ledger_saved');try{await assert.rejects(()=>service.validateApplied(),/DATABASE_MIGRATIONS_REQUIRED/);
    assert.equal((await sql("SELECT to_regclass('public.schema_migrations') AS name")).rows[0].name,null);
   }finally{await sql('ALTER TABLE ledger_saved RENAME TO schema_migrations');}
  });
  await test('A later valid startup recovers after all failed validation cases',async()=>{await service.validateApplied();assert.deepEqual(await ledger(),original);});
 }finally{await runtime.end();if(created){await sql(`DROP OWNED BY "${role}"`);await sql(`DROP ROLE "${role}"`);}report.roleRemaining=(await sql('SELECT count(*)::int AS count FROM pg_roles WHERE rolname=$1',[role])).rows[0].count;await admin.end();}
 report.success=results.length===10&&results.every(r=>r.passed)&&report.roleRemaining===0;return report;
}
