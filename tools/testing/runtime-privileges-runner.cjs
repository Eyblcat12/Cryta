// Real LOGIN roles and compiled API in a newly allocated test database only.
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {spawn,spawnSync,execFileSync}=require('node:child_process');const net=require('node:net');
async function main(options){
 assert.match(options.project,/^crypta-t30-test-[a-f0-9]{12}$/);assert.match(options.database,/^crypta_runtime_test_[a-f0-9]{12}$/);
 assert.equal(process.env.CRYPTO_PROVIDER_MODE,'MOCK');assert.equal(process.env.SMTP_ENABLED,'false');
 const base=new URL(process.env.DATABASE_URL);assert.equal(base.hostname,'postgres');assert.equal(base.pathname,'/crypta_t30_test');base.pathname=`/${options.database}`;
 require('/app/node_modules/reflect-metadata');const {Pool}=require('/app/node_modules/pg');const {Logger}=require('/app/node_modules/@nestjs/common');Logger.overrideLogger([]);
 const {ExpiryScanService}=require('/app/dist/jobs/expiry-scan.service.js');const {NotificationsService}=require('/app/dist/notifications/notifications.service.js');const {EmailWorkerService}=require('/app/dist/notifications/email-worker.service.js');
 const suffix=options.database.slice(-12),roles={runtime:`crypta_runtime_role_${suffix}`,owner:`crypta_owner_role_${suffix}`,migrator:`crypta_migrator_role_${suffix}`};
 const passwords={runtime:crypto.randomBytes(32).toString('hex'),migrator:crypto.randomBytes(32).toString('hex'),rotated:crypto.randomBytes(32).toString('hex')};
 const urlFor=(role,password)=>{const u=new URL(base);u.username=role;u.password=password;return u.href;};
 const admin=new Pool({connectionString:base.href,max:3,statement_timeout:10000});let runtime,child,childExit,childLog='',roleCreated=[];
 const sql=(q,v)=>admin.query(q,v),results=[],sessions={};
 const report={database:options.database,fixtureOnly:false,provider:'MOCK',smtpEnabled:false,success:false,results,roles,compiledServiceHashes:Object.fromEntries(['main.js','audit/audit-context.js','audit/http-failure-audit.service.js','audit/audit.controller.js','common/api-exception.filter.js','common/request-context.middleware.js','database/migration.service.js','database/migrate.js','auth/auth.service.js','users/users.service.js','requests/requests.service.js','jobs/asset-processing.service.js','jobs/expiry-scan.service.js','jobs/expiry-warning-policy.js','policies/policies.controller.js','notifications/notifications.service.js','notifications/asset-alert-recipient.js','notifications/email-worker.service.js','notifications/email-test.service.js'].map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync('/app/dist/'+n)).digest('hex')])),roleSelection:'Real PostgreSQL LOGIN credentials over the postgres service network; child API uses only runtime URL and validate mode.'};
 async function executeFormatted(format,values){const q=(await sql('SELECT format($1::text,'+values.map((_,i)=>`$${i+2}::text`).join(',')+') AS q',[format,...values])).rows[0].q;await sql(q);}
 async function test(name,run){try{results.push({name,passed:true,evidence:await run()??null});}catch(e){results.push({name,passed:false,error:e instanceof assert.AssertionError?e.message:String(e.code||e.message).slice(0,220)});}}
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 async function api(method,endpoint,body,session,expected){
  assert(endpoint.startsWith('/'));const response=await fetch('http://127.0.0.1:3309/api/v1'+endpoint,{method,headers:{'Content-Type':'application/json',...(session?.token?{Authorization:'Bearer '+session.token}:{}),...(session?.cookie?{Cookie:session.cookie}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
  const payload=await response.json();if(expected!==undefined)assert.equal(response.status,expected,`${method} ${endpoint} HTTP status`);
  const cookie=response.headers.get('set-cookie')?.split(';')[0];return{status:response.status,data:payload.data??payload,cookie,correlationId:response.headers.get('x-request-id')};
 }
 async function login(email,password='Password@123'){const r=await api('POST','/auth/login',{email,password},null,200);assert(r.data.accessToken);return{token:r.data.accessToken,cookie:r.cookie,user:r.data.user};}
 async function stopApi(){if(!child)return;const owned=child;child=null;owned.kill('SIGTERM');await Promise.race([new Promise(r=>owned.once('close',r)),sleep(3000)]);if(owned.exitCode===null&&owned.signalCode===null){owned.kill('SIGKILL');await new Promise(r=>owned.once('close',r));}}
 async function startApi(password,overrides={}){
  await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen({host:'127.0.0.1',port:3309,exclusive:true},()=>probe.close(resolve));});
  childExit=undefined;child=spawn(process.execPath,['/app/dist/main.js'],{env:{...process.env,DATABASE_URL:urlFor(roles.runtime,password),DATABASE_MIGRATION_MODE:'validate',DATABASE_MIGRATION_OWNER_ROLE:'',PORT:'3309',SMTP_ENABLED:'false',CRYPTO_PROVIDER_MODE:'MOCK',...overrides},stdio:['ignore','pipe','pipe']});
  child.on('error',()=>{childExit='spawn-error';});child.on('exit',code=>{childExit=code;});
  const capture=b=>{childLog+=b.toString();if(childLog.length>1024*1024){child?.kill('SIGTERM');childExit='log-bound';}};child.stdout.on('data',capture);child.stderr.on('data',capture);
  const deadline=Date.now()+25000;while(Date.now()<deadline){if(childExit!==undefined)throw new Error('RESTRICTED_API_EXITED');try{const r=await api('GET','/health');if(r.status===200)return;}catch{}await sleep(200);}throw new Error('RESTRICTED_API_NOT_READY');
 }
 async function pollRequest(id){const until=Date.now()+16000;while(Date.now()<until){const r=(await api('GET','/requests/'+id,null,sessions.user,200)).data;if(r.status==='COMPLETED')return r;if(r.status==='RECONCILIATION_REQUIRED')throw new Error('WORKER_REQUIRES_RECONCILIATION');await sleep(250);}throw new Error('WORKER_COMPLETION_TIMEOUT');}
 let policy,createdAsset,renewedAsset,newUser;
 try{
  assert.equal((await sql('SELECT current_database() AS name')).rows[0].name,options.database);
  for(const [kind,role]of Object.entries(roles)){assert.equal((await sql('SELECT count(*)::int AS n FROM pg_roles WHERE rolname=$1',[role])).rows[0].n,0);await executeFormatted(kind==='owner'?'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS':'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD %L',kind==='owner'?[role]:[role,passwords[kind]]);roleCreated.push(role);}
  await executeFormatted('GRANT %I TO %I',[roles.owner,roles.migrator]);
  // Inventory and transfer only application objects in this newly allocated DB.
  const objects=(await sql("SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','S') ORDER BY CASE WHEN c.relkind='S' THEN 1 ELSE 0 END,c.relname")).rows;
  for(const o of objects)await executeFormatted(`ALTER ${o.relkind==='S'?'SEQUENCE':'TABLE'} public.%I OWNER TO %I`,[o.relname,roles.owner]);
  const functions=(await sql("SELECT p.oid::regprocedure::text AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')")).rows;
  for(const f of functions){assert(!/[;"\n]/.test(f.name));await sql(`ALTER FUNCTION ${f.name} OWNER TO "${roles.owner}"`);}
  await executeFormatted('ALTER SCHEMA public OWNER TO %I',[roles.owner]);
  await sql('CREATE SCHEMA crypta_extension_test; CREATE EXTENSION pg_trgm WITH SCHEMA crypta_extension_test;');
  await executeFormatted('GRANT USAGE ON SCHEMA crypta_extension_test TO %I',[roles.owner]);
  await test('Migrator LOGIN can SET ROLE to a NOLOGIN owner and apply all published migrations',async()=>{
   assert.equal((await sql("SELECT has_database_privilege($1,current_database(),'CREATE') AS allowed",[roles.owner])).rows[0].allowed,false);
   execFileSync(process.execPath,['/app/dist/database/migrate.js'],{env:{...process.env,DATABASE_URL:urlFor(roles.migrator,passwords.migrator),DATABASE_MIGRATION_OWNER_ROLE:roles.owner},stdio:['ignore','pipe','pipe'],timeout:45000});
   const ledger=(await sql('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows;assert.equal(ledger.length,25);
   assert.equal(ledger.at(-1)?.version,'025_expiry_scan_status');
   const index=(await sql("SELECT pg_get_indexdef('public.idx_audit_text_trgm'::regclass) AS definition")).rows[0].definition;
   assert.ok(index.includes('crypta_extension_test.gin_trgm_ops'));
   assert.equal((await sql("SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='schema_migrations'::regclass")).rows[0].owner,roles.owner);return{versions:ledger.map(r=>r.version),ledgerOwner:roles.owner,extensionSchema:'crypta_extension_test'};
  });
  assert.equal(results[0].passed,true,'Migration role setup must succeed before app tests.');
  assert.equal(typeof options.grantsSql,'string');
  const grantScript=(role,database)=>options.grantsSql.replaceAll(':"runtime_role"',`"${role}"`).replaceAll(':"database"',`"${database}"`).replaceAll(":'runtime_role'",`'${role}'`).replaceAll(":'database'",`'${database}'`);
  // A failed multi-statement script leaves its connection in a transaction;
  // pin the same client through rollback rather than relying on pool scheduling.
  async function applyGrants(script){const client=await admin.connect();try{await client.query(script);}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
  const aclSnapshot=async()=>JSON.stringify((await sql("SELECT 'relation' AS kind,c.relname AS name,c.relacl::text AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' UNION ALL SELECT 'column',c.relname||'.'||a.attname,a.attacl::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND a.attnum>0 UNION ALL SELECT 'database',datname,datacl::text FROM pg_database WHERE datname=current_database() UNION ALL SELECT 'schema',nspname,nspacl::text FROM pg_namespace WHERE nspname='public' ORDER BY kind,name")).rows);
  await test('Grant provisioning refuses wrong database, unsafe roles and PUBLIC grants without changing ACLs',async()=>{
   const codes=[];
   for(const [role,database]of [[roles.runtime,options.database+'_wrong'],[roles.owner,options.database],[roles.migrator,options.database]]){
    const before=await aclSnapshot();await assert.rejects(()=>applyGrants(grantScript(role,database)),e=>{codes.push(e.code);return e.code==='22023';});assert.equal(await aclSnapshot(),before);
   }
   for(const [grant,revoke]of [['GRANT UPDATE ON audit_logs TO PUBLIC','REVOKE UPDATE ON audit_logs FROM PUBLIC'],['GRANT UPDATE(algorithm) ON cryptographic_keys TO PUBLIC','REVOKE UPDATE(algorithm) ON cryptographic_keys FROM PUBLIC'],['GRANT USAGE ON SEQUENCE audit_logs_id_seq TO PUBLIC','REVOKE USAGE ON SEQUENCE audit_logs_id_seq FROM PUBLIC'],[`GRANT CREATE ON DATABASE "${options.database}" TO PUBLIC`,`REVOKE CREATE ON DATABASE "${options.database}" FROM PUBLIC`]]){
    await sql(grant);try{const before=await aclSnapshot();await assert.rejects(()=>applyGrants(grantScript(roles.runtime,options.database)),e=>{codes.push(e.code);return e.code==='22023'&&e.message==='UNSAFE_PUBLIC_GRANTS';});assert.equal(await aclSnapshot(),before);}finally{await sql(revoke);}
   }
   await sql("CREATE FUNCTION public.runtime_owned_function_fixture() RETURNS integer LANGUAGE sql AS 'SELECT 1'");
   try{
    await executeFormatted('GRANT CREATE ON SCHEMA public TO %I',[roles.runtime]);
    await executeFormatted('ALTER FUNCTION public.runtime_owned_function_fixture() OWNER TO %I',[roles.runtime]);
    await executeFormatted('REVOKE CREATE ON SCHEMA public FROM %I',[roles.runtime]);
    const before=await aclSnapshot();
    await assert.rejects(()=>applyGrants(grantScript(roles.runtime,options.database)),e=>{codes.push(e.code);return e.code==='22023'&&e.message==='UNSAFE_RUNTIME_ROLE';});
    assert.equal(await aclSnapshot(),before);
   }finally{
    await sql('DROP FUNCTION public.runtime_owned_function_fixture()');
   }
   const triggerSql=(await sql("SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid='cryptographic_keys'::regclass AND tgname='trg_key_asset_identity'")).rows[0].definition;
   for(const [remove,restore]of [
    ['ALTER TABLE cryptographic_keys DISABLE TRIGGER trg_key_asset_identity','ALTER TABLE cryptographic_keys ENABLE TRIGGER trg_key_asset_identity'],
    ['DROP TRIGGER trg_key_asset_identity ON cryptographic_keys',triggerSql],
   ]){
    await sql(remove);
    try{
     const before=await aclSnapshot();
     await assert.rejects(()=>applyGrants(grantScript(roles.runtime,options.database)),e=>{codes.push(e.code);return e.code==='22023'&&e.message==='KEY_IDENTITY_GUARD_REQUIRED';});
     assert.equal(await aclSnapshot(),before);
    }finally{await sql(restore);}
   }
   return{rejectedConfigurations:codes.length,sqlstates:codes,aclUnchangedForEveryRejection:true};
  });
  const grants=grantScript(roles.runtime,options.database);assert(!/:(?:"(?:runtime_role|database)"|'(?:runtime_role|database)')/.test(grants));await applyGrants(grants);
  runtime=new Pool({connectionString:urlFor(roles.runtime,passwords.runtime),max:4,statement_timeout:10000});
  await test('OIDC runtime reads operator links without changing them',async()=>{
   await runtime.query('SELECT issuer,subject FROM auth_oidc_links LIMIT 1');
   for(const statement of ['UPDATE auth_oidc_links SET revoked_at=NOW() WHERE FALSE','DELETE FROM auth_oidc_links WHERE FALSE',
     "INSERT INTO auth_oidc_links (user_id,issuer,subject) SELECT id,'https://identity.example.test/realms/crypta','fixture' FROM users WHERE FALSE"]){
    await assert.rejects(()=>runtime.query(statement),error=>error.code==='42501');
   }
   const client=await runtime.connect();
   try{
    await client.query('BEGIN');
    await client.query('SELECT ticket_hash FROM auth_oidc_flows LIMIT 1 FOR UPDATE SKIP LOCKED');
    await client.query('SELECT id FROM auth_oidc_sessions LIMIT 1 FOR UPDATE');
   }finally{await client.query('ROLLBACK');client.release();}
   return{linkWritesDenied:3,sessionAndFlowLocks:true};
  });
  await test('Runtime authenticates by password without membership or ownership escalation',async()=>{
   const identity=(await runtime.query('SELECT current_user,session_user,current_database()')).rows[0];assert.equal(identity.current_user,roles.runtime);assert.equal(identity.session_user,roles.runtime);
   const attributes=(await sql('SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname=$1',[roles.runtime])).rows[0];assert(attributes.rolcanlogin);assert(!attributes.rolsuper&&!attributes.rolcreatedb&&!attributes.rolcreaterole&&!attributes.rolbypassrls);
   const membership=(await runtime.query('SELECT pg_has_role(current_user,$1,\'MEMBER\') AS owner,pg_has_role(current_user,$2,\'MEMBER\') AS migrator',[roles.owner,roles.migrator])).rows[0];assert.deepEqual(membership,{owner:false,migrator:false});return{identity,attributes,membership};
  });
  await test('Reapplying runtime grants removes preexisting database, schema, table, column and sequence privileges',async()=>{
   await sql(`GRANT ALL ON DATABASE "${options.database}" TO "${roles.runtime}"; GRANT ALL ON SCHEMA public TO "${roles.runtime}"; GRANT ALL ON audit_logs TO "${roles.runtime}"; GRANT UPDATE(algorithm) ON cryptographic_keys TO "${roles.runtime}"; GRANT UPDATE(id) ON policy_versions TO "${roles.runtime}"; GRANT ALL ON SEQUENCE audit_logs_id_seq TO "${roles.runtime}"`);
   const privileges=async()=> (await runtime.query("SELECT has_database_privilege(current_user,current_database(),'CREATE') AS database_create,has_schema_privilege(current_user,'public','CREATE') AS schema_create,has_table_privilege(current_user,'audit_logs','TRUNCATE') AS audit_truncate,has_column_privilege(current_user,'cryptographic_keys','algorithm','UPDATE') AS key_algorithm_update,has_column_privilege(current_user,'policy_versions','id','UPDATE') AS policy_id_update,has_sequence_privilege(current_user,'audit_logs_id_seq','UPDATE') AS sequence_update")).rows[0];
   const before=await privileges();assert(Object.values(before).every(v=>v===true));
   await applyGrants(grants);const after=await privileges();assert(Object.values(after).every(v=>v===false));
   const statements=['UPDATE audit_logs SET metadata=metadata WHERE FALSE','TRUNCATE audit_logs','UPDATE cryptographic_keys SET algorithm=algorithm WHERE FALSE','CREATE TABLE public.runtime_regrant_forbidden(id int)','CREATE TEMP TABLE runtime_regrant_forbidden(id int)',"SELECT setval('audit_logs_id_seq',1,false)"];
   for(const statement of statements)await assert.rejects(()=>runtime.query(statement),e=>e.code==='42501');
   return{before,after,actualPrivilegeDenials:statements.length,sqlstate:'42501'};
  });
  await test('Owner-only DDL, immutable DML and ledger/sequence tampering are denied',async()=>{
   const statements=['CREATE TABLE public.runtime_forbidden(id int)','CREATE TEMP TABLE runtime_forbidden(id int)','ALTER TABLE audit_logs DISABLE TRIGGER USER','DROP TABLE audit_logs',
    'UPDATE audit_logs SET metadata=metadata WHERE FALSE','DELETE FROM audit_logs WHERE FALSE','TRUNCATE audit_logs','UPDATE request_decisions SET comment=comment WHERE FALSE','TRUNCATE request_decisions',
    'UPDATE policy_versions SET configuration=configuration WHERE FALSE','DELETE FROM policy_versions WHERE FALSE','TRUNCATE policy_versions','UPDATE cryptographic_keys SET algorithm=algorithm WHERE FALSE',
    'UPDATE policies SET name=name WHERE FALSE','DELETE FROM policies WHERE FALSE','UPDATE crypto_assets SET provider_scope=provider_scope WHERE FALSE',
    'UPDATE schema_migrations SET checksum=checksum','DELETE FROM schema_migrations',"INSERT INTO schema_migrations(version,checksum) VALUES('999_forbidden',repeat('a',64))",'TRUNCATE schema_migrations',"SELECT setval('audit_logs_id_seq',1,false)",`SET ROLE "${roles.owner}"`,`SET ROLE "${roles.migrator}"`,"SET session_replication_role='replica'"];
   const codes=[];for(const statement of statements)await assert.rejects(()=>runtime.query(statement),e=>{codes.push(e.code);return e.code==='42501';});
   await assert.rejects(()=>runtime.query('UPDATE policy_versions SET id=id'),e=>e.code==='42501');return{privilegeDenials:codes.length,sqlstates:codes,policyIdUpdateDenied:'42501'};
  });
  await test('Runtime can lock key metadata but cannot reassign its asset identity',async()=>{
   const original=(await sql('SELECT * FROM cryptographic_keys ORDER BY asset_id')).rows;
   const source=original[0];assert(source);
   const destination=(await sql("SELECT id FROM crypto_assets WHERE asset_type='CERTIFICATE' ORDER BY id LIMIT 1")).rows[0];assert(destination);
   await assert.rejects(()=>runtime.query('UPDATE cryptographic_keys SET asset_id=$2 WHERE asset_id=$1',[source.asset_id,destination.id]),
    e=>e.code==='23514'&&e.message==='KEY_ASSET_LINK_IMMUTABLE');
   assert.deepEqual((await sql('SELECT * FROM cryptographic_keys ORDER BY asset_id')).rows,original);
   const reader=await runtime.connect(),writer=await admin.connect();
   try{
    await reader.query('BEGIN');
    const locked=await reader.query('SELECT algorithm,key_size,usage FROM cryptographic_keys WHERE asset_id=$1 FOR SHARE',[source.asset_id]);
    assert.equal(locked.rowCount,1);
    await writer.query('BEGIN');await writer.query("SET LOCAL lock_timeout='100ms'");
    await assert.rejects(()=>writer.query('UPDATE cryptographic_keys SET key_size=key_size WHERE asset_id=$1',[source.asset_id]),e=>e.code==='55P03');
   }finally{
    await writer.query('ROLLBACK');writer.release();
    await reader.query('ROLLBACK');reader.release();
   }
   assert.deepEqual((await sql('SELECT * FROM cryptographic_keys ORDER BY asset_id')).rows,original);
   return{identityMutationDenied:'23514',concurrentMetadataWriteBlocked:'55P03',metadataPreserved:true};
  });
  await test('An occupied child API port is refused before spawning or sending credentials',async()=>{
   let connections=0;const occupied=net.createServer(socket=>{connections++;socket.destroy();});
   await new Promise((resolve,reject)=>{occupied.once('error',reject);occupied.listen(3309,'127.0.0.1',resolve);});
   try{await assert.rejects(()=>startApi(passwords.runtime),e=>e.code==='EADDRINUSE');assert.equal(child,undefined);assert.equal(connections,0);return{connections,childSpawned:false};}finally{await new Promise(resolve=>occupied.close(resolve));}
  });
  await test('Compiled API starts in validate mode using only the runtime LOGIN role',async()=>{await startApi(passwords.runtime);const active=(await sql("SELECT DISTINCT usename FROM pg_stat_activity WHERE datname=$1 AND application_name='crypta-api'",[options.database])).rows;assert.deepEqual(active,[{usename:roles.runtime}]);return{apiProcessId:child.pid,databaseUsers:active};});
  assert(child&&childExit===undefined,'Restricted API must be live for HTTP verification.');
  await test('Login, refresh rotation and logout work with the restricted role',async()=>{
   const s=await login('dev.nguyen@congty.com');const refresh=await api('POST','/auth/refresh',null,s,200);s.token=refresh.data.accessToken;s.cookie=refresh.cookie;await api('GET','/auth/me',null,s,200);await api('POST','/auth/logout',null,s,200);const denied=await api('POST','/auth/refresh',null,s);assert.equal(denied.status,401);
   sessions.user=await login('dev.nguyen@congty.com');sessions.admin=await login('admin@congty.com');sessions.approver=await login('it.manager@congty.com');return{refreshAfterLogout:denied.status};
  });
  await test('HTTP audit correlates successes and denials without retaining submitted secrets or guessing an actor',async()=>{
   const marker='private-audit-'+crypto.randomBytes(12).toString('hex');
   const denied=await api('POST','/auth/login',{email:'missing-'+suffix+'@example.test',password:marker},null,401);
   const forbidden=await api('GET','/audit-logs?search='+marker,null,sessions.user,403);
   const success=await api('POST','/auth/refresh',null,sessions.user,200);
   sessions.user.token=success.data.accessToken;sessions.user.cookie=success.cookie;
   for(const [response,action,actor]of [[denied,'HTTP_REQUEST_DENIED',null],[forbidden,'HTTP_REQUEST_DENIED',sessions.user.user.id],[success,'SESSION_REFRESHED',sessions.user.user.id]]){
    assert.match(response.correlationId,/^req_[0-9a-f-]{36}$/);
    const rows=(await sql("SELECT actor_id,actor_type,action,entity_id,metadata FROM audit_logs WHERE metadata->>'correlationId'=$1",[response.correlationId])).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].action,action);assert.equal(rows[0].actor_id,actor);assert.equal(rows[0].actor_type,actor?'USER':'SYSTEM');
    assert(!JSON.stringify(rows).includes(marker));
    const found=(await api('GET','/audit-logs?correlationId='+response.correlationId,null,sessions.admin,200)).data;
    assert.equal(found.total,1);assert.equal(found.items[0].correlationId,response.correlationId);
   }
   assert(!childLog.includes(marker));
   const connected=(await sql("SELECT DISTINCT usename FROM pg_stat_activity WHERE datname=$1 AND application_name='crypta-failure-audit'",[options.database])).rows;
   assert.deepEqual(connected,[{usename:roles.runtime}]);
   return{serverCorrelation:true,anonymousActorNotInferred:true,secretAbsent:true,independentPoolUsesRuntimeRole:true};
  });
  await test('Wrong refresh secrets preserve sessions and logout audit failure rolls revocation back',async()=>{
   let s=await login('dev.nguyen@congty.com');
   const [cookieName,cookieValue]=s.cookie.split('=');const raw=decodeURIComponent(cookieValue),sessionId=raw.split('.')[0];
   assert.match(sessionId,/^[0-9a-f-]{36}$/);
   const before=(await sql('SELECT id,revoked_at FROM auth_sessions WHERE user_id=$1 ORDER BY id',[s.user.id])).rows;
   await api('POST','/auth/refresh',null,{cookie:cookieName+'='+sessionId+'.wrong-fixture-secret'},401);
   assert.deepEqual((await sql('SELECT id,revoked_at FROM auth_sessions WHERE user_id=$1 ORDER BY id',[s.user.id])).rows,before);
   await sql("CREATE FUNCTION public.runtime_test_reject_logout() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='LOGOUT' THEN RAISE EXCEPTION 'RUNTIME_TEST_LOGOUT_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER runtime_test_logout_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION runtime_test_reject_logout()");
   let failed;
   try{
    failed=await api('POST','/auth/logout',null,s,500);
    assert.equal((await sql('SELECT revoked_at FROM auth_sessions WHERE id=$1',[sessionId])).rows[0].revoked_at,null);
    assert.equal((await sql("SELECT count(*)::int AS n FROM audit_logs WHERE action='HTTP_REQUEST_FAILED' AND metadata->>'correlationId'=$1",[failed.correlationId])).rows[0].n,1);
   }finally{await sql('DROP TRIGGER runtime_test_logout_failure ON audit_logs; DROP FUNCTION runtime_test_reject_logout()');}
   const rotated=await api('POST','/auth/refresh',null,s,200);s.token=rotated.data.accessToken;s.cookie=rotated.cookie;
   await api('POST','/auth/logout',null,s,200);
   return{wrongSecretPreservedSessions:true,logoutRollback:true,failureAuditSurvived:true};
  });
  await test('Users create, mandatory password change, status and access mutations use granted columns only',async()=>{
   const ref=(await api('GET','/users/reference-data',null,sessions.admin,200)).data;const department=ref.departments.find(d=>d.code==='IT');assert(department);
   newUser=(await api('POST','/users',{email:`runtime-${suffix}@example.test`,displayName:'Runtime privilege fixture',departmentId:department.id,temporaryPassword:'Temporary@12345',roles:['USER'],approverDepartmentIds:[]},sessions.admin,201)).data;
   let s=await login(newUser.email,'Temporary@12345');await api('POST','/auth/change-password',{currentPassword:'Temporary@12345',newPassword:'ChangedRuntime@12345'},s,200);await api('GET','/auth/me',null,s,401);s=await login(newUser.email,'ChangedRuntime@12345');
   await api('PUT',`/users/${newUser.id}/access`,{roles:['APPROVER'],approverDepartmentIds:[department.id]},sessions.admin,200);await api('GET','/auth/me',null,s,401);
   await api('PUT',`/users/${newUser.id}/access`,{roles:['USER'],approverDepartmentIds:[]},sessions.admin,200);await api('PATCH',`/users/${newUser.id}/status`,{status:'INACTIVE'},sessions.admin,200);await api('PATCH',`/users/${newUser.id}/status`,{status:'ACTIVE'},sessions.admin,200);
   return{createdUserId:newUser.id,passwordChangeRevokesOldToken:true,accessChangeRevokesOldToken:true};
  });
  await test('Department administration and user transfer use only the new column grants',async()=>{
   const id=crypto.randomUUID(),code='RUNTIME_'+suffix.toUpperCase();
   const created=(await api('PUT','/departments/'+id,{code,name:'Runtime department'},sessions.admin,200)).data;assert.equal(created.version,1);
   const edited=(await api('PUT','/departments/'+id,{code,name:'Runtime department edited',version:1},sessions.admin,200)).data;assert.equal(edited.version,2);
   await api('PATCH',`/departments/${id}/status`,{active:false,version:2},sessions.admin,200);
   const ref=(await api('GET','/users/reference-data',null,sessions.admin,200)).data;assert(!ref.departments.some(row=>row.id===id));
   await api('PATCH',`/departments/${id}/status`,{active:true,version:3},sessions.admin,200);
   const before=(await api('GET',`/users?userId=${newUser.id}&pageSize=1`,null,sessions.admin,200)).data.items[0],oldSession=await login(newUser.email,'ChangedRuntime@12345');
   const unchanged=(await api('PUT',`/users/${newUser.id}/department`,{departmentId:before.departmentId.toUpperCase(),version:before.version},sessions.admin,200)).data;
   assert.deepEqual(unchanged,{updated:false,departmentId:before.departmentId,version:before.version});
   await api('GET','/auth/me',null,oldSession,200);
   await api('PUT',`/users/${newUser.id}/department`,{departmentId:id,version:before.version},sessions.admin,200);await api('GET','/auth/me',null,oldSession,401);
   const moved=(await api('GET',`/users?userId=${newUser.id}&pageSize=1`,null,sessions.admin,200)).data.items[0];assert.equal(moved.departmentId,id);
   await api('PUT',`/users/${newUser.id}/department`,{departmentId:before.departmentId,version:moved.version},sessions.admin,200);
   await api('PATCH',`/departments/${id}/status`,{active:false,version:4},sessions.admin,200);
   return{departmentVersion:5,transfers:2,oldAccessDenied:true};
  });
  await test('CREATE approval and the real polling worker complete once under runtime grants',async()=>{
   const list=(await api('GET','/policies',null,sessions.user,200)).data;policy=list.find(p=>p.code==='RSA_STANDARD'&&p.version===Math.max(...list.filter(p=>p.code==='RSA_STANDARD').map(p=>p.version)));assert(policy);
   const r=(await api('POST','/requests',{type:'CREATE',policyVersionId:policy.id,reason:'Runtime grants create verification',parameters:{assetType:'KEY',validityDays:90}},sessions.user,201)).data;
   await api('POST',`/requests/${r.id}/decision`,{decision:'APPROVED',version:String(r.version)},sessions.approver,201);await pollRequest(r.id);
   createdAsset=(await sql('SELECT result_asset_id FROM requests WHERE id=$1',[r.id])).rows[0].result_asset_id;assert(createdAsset);const operation=(await sql('SELECT status,attempt_count FROM provider_operations WHERE request_id=$1',[r.id])).rows[0];assert.deepEqual(operation,{status:'COMPLETED',attempt_count:1});return{requestId:r.id,assetId:createdAsset,operation};
  });
  const draftPath = id => '/requests/drafts/' + id;
  const submitPath = id => '/requests/' + id + '/submit';
  const cancelPath = id => '/requests/' + id + '/cancel';
  const validDraft = () => ({
   type: 'CREATE', policyVersionId: policy.id, reason: 'Runtime draft verification', parameters: { assetType: 'KEY' },
  });
  const draftEffects = async id => (await sql(`SELECT
   (SELECT count(*)::int FROM audit_logs WHERE request_id=$1 AND action='REQUEST_SUBMITTED') AS audit,
   (SELECT count(*)::int FROM notifications WHERE request_id=$1 AND type='REQUEST_SUBMITTED') AS notifications,
   (SELECT count(*)::int FROM provider_operations WHERE request_id=$1) AS provider`, [id])).rows[0];
  await test('Drafts accept incomplete input, remain owner-only and never reach the real worker', async () => {
   const id = crypto.randomUUID();
   const blank = { type: 'RENEW' };
   const first = await Promise.all([
    api('PUT', draftPath(id), blank, sessions.user, 200),
    api('PUT', draftPath(id), blank, sessions.user, 200),
   ]);
   for (const result of first) {
    assert.equal(result.data.status, 'DRAFT');
    assert.equal(result.data.version, 1);
    assert.equal(result.data.submittedAt, null);
   }
   const other = await login(newUser.email, 'ChangedRuntime@12345');
   for (const session of [other, sessions.approver, sessions.admin]) {
    await api('GET', '/requests/' + id, null, session, 404);
    const result = await api('GET', '/requests?status=DRAFT&search=' + id, null, session, 200);
    assert.equal(result.data.total, 0);
   }
   await api('PUT', draftPath(id), { ...blank, version: 1 }, other, 404);
   await api('POST', submitPath(id), { version: 1 }, other, 404);
   await api('POST', cancelPath(id), { version: 1 }, other, 404);
   await api('POST', '/requests/' + id + '/decision', { decision: 'APPROVED' }, sessions.approver, 404);
   const owned = await api('GET', '/requests?createdByMe=true&status=DRAFT&search=' + id, null, sessions.user, 200);
   assert.equal(owned.data.total, 1);
   await api('POST', submitPath(id), { version: 1 }, sessions.user, 400);
   const getPoll = async () => (await api('GET', '/operations/metrics', null, sessions.admin, 200)).data.process.jobs.assetProcessing?.finishedAt;
   const beforePoll = await getPoll();
   const deadline = Date.now() + 8000;
   while (Date.now() < deadline && await getPoll() === beforePoll) await sleep(250);
   assert.notEqual(await getPoll(), beforePoll);
   assert.equal((await api('GET', '/requests/' + id, null, sessions.user, 200)).data.status, 'DRAFT');
   assert.deepEqual(await draftEffects(id), { audit: 0, notifications: 0, provider: 0 });
   return { ownerCount: 1, hiddenFromRoles: 3, workerPolled: true, firstPutVersions: first.map(r => r.data.version) };
  });
  await test('Draft edits reject stale versions and concurrent submit commits exactly one notification batch and audit', async () => {
   const id = crypto.randomUUID();
   await api('PUT', draftPath(id), { type: 'CREATE' }, sessions.user, 200);
   const alternatives = ['Draft edit attempt A', 'Draft edit attempt B'];
   const edits = await Promise.all(alternatives.map(reason => api('PUT', draftPath(id), {
    ...validDraft(), reason, version: 1,
   }, sessions.user)));
   assert.deepEqual(edits.map(r => r.status).sort(), [200, 409]);
   const winning = edits.find(r => r.status === 200).data;
   assert.equal(winning.version, 2);
   await api('POST', submitPath(id), { version: 1 }, sessions.user, 409);
   await sql(`CREATE FUNCTION public.runtime_test_draft_abort() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.request_id='${id}' THEN RAISE EXCEPTION 'RUNTIME_TEST_DRAFT_NOTIFICATION_FAILURE'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER runtime_test_draft_abort BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION runtime_test_draft_abort()`);
   try {
    await api('POST', submitPath(id), { version: 2 }, sessions.user, 500);
    const unchanged = (await api('GET', '/requests/' + id, null, sessions.user, 200)).data;
    assert.equal(unchanged.status, 'DRAFT');
    assert.equal(unchanged.version, 2);
    assert.deepEqual(await draftEffects(id), { audit: 0, notifications: 0, provider: 0 });
   } finally {
    await sql('DROP TRIGGER runtime_test_draft_abort ON notifications; DROP FUNCTION runtime_test_draft_abort()');
   }
   const sends = await Promise.all(Array.from({ length: 2 }, () => api('POST', submitPath(id), { version: 2 }, sessions.user, 201)));
   assert.ok(sends.every(r => r.data.status === 'PENDING' && r.data.version === 3 && r.data.submittedAt && r.data.reason === winning.reason));
   const effects = await draftEffects(id);
   const recipients = (await sql(`SELECT count(DISTINCT s.user_id)::int AS n FROM approver_scopes s
    JOIN users u ON u.id=s.user_id AND u.status='ACTIVE' WHERE s.department_id=$1`, [sessions.user.user.departmentId])).rows[0].n;
   assert.ok(recipients > 0);
   assert.deepEqual(effects, { audit: 1, notifications: recipients * 2, provider: 0 });
   const visible = await api('GET', '/requests?status=PENDING&search=' + id, null, sessions.approver, 200);
   assert.equal(visible.data.total, 1);
   return { editStatuses: edits.map(r => r.status), submitStatuses: sends.map(r => r.status), effects, rolledBackOnNotificationFailure: true };
  });
  await test('Two renew drafts can coexist but only one can submit for a target, and private cancellation stays hidden', async () => {
   const draft = { type: 'RENEW', targetAssetId: createdAsset, policyVersionId: policy.id, reason: 'Runtime renew draft target verification' };
   const ids = [crypto.randomUUID(), crypto.randomUUID()];
   for (const id of ids) await api('PUT', draftPath(id), draft, sessions.user, 200);
   const attempts = await Promise.all(ids.map(id => api('POST', submitPath(id), { version: 1 }, sessions.user)));
   assert.deepEqual(attempts.map(r => r.status).sort(), [201, 409]);
   const pending = attempts.findIndex(r => r.status === 201);
   const rejected = 1 - pending;
   assert.equal(attempts[rejected].data.error.code, 'DUPLICATE_OPEN_REQUEST');
   const cancelReason = 'No longer needed in this fixture';
   const cancelled = await api('POST', cancelPath(ids[rejected]), { version: 1, reason: cancelReason }, sessions.user, 201);
   assert.equal(cancelled.data.cancellationReason, cancelReason);
   assert.equal(cancelled.data.submittedAt, null);
   await api('GET', '/requests/' + ids[rejected], null, sessions.approver, 404);
   const history = (await api('GET', '/assets/' + createdAsset + '/history?page=1&pageSize=25', null, sessions.admin, 200)).data;
   assert.ok(!history.items.some(item => item.requestId === ids[rejected]));
   await api('POST', cancelPath(ids[pending]), { version: 2, reason: cancelReason }, sessions.user, 201);
   return { submitStatuses: attempts.map(r => r.status), privateCancellation: true };
  });
  await test('Duplicate cancel and cancel versus decision serialize without repeated audit or provider effects', async () => {
   const draft = validDraft();
   const id = crypto.randomUUID();
   await api('PUT', draftPath(id), draft, sessions.user, 200);
   const copies = await Promise.all(Array.from({ length: 2 }, () => api('POST', cancelPath(id), {
    version: 1, reason: 'Cancel duplicate test',
   }, sessions.user)));
   assert.deepEqual(copies.map(r => r.status).sort(), [201, 409]);
   const duplicateAudit = await sql("SELECT count(*)::int AS n FROM audit_logs WHERE request_id=$1 AND action='REQUEST_CANCELLED'", [id]);
   assert.equal(duplicateAudit.rows[0].n, 1);
   const raceId = crypto.randomUUID();
   await api('PUT', draftPath(raceId), draft, sessions.user, 200);
   await api('POST', submitPath(raceId), { version: 1 }, sessions.user, 201);
   const race = await Promise.all([
    api('POST', cancelPath(raceId), { version: 2, reason: 'Cancel against decision' }, sessions.user),
    api('POST', '/requests/' + raceId + '/decision', { version: '2', decision: 'REJECTED', comment: 'Rejection against cancellation' }, sessions.approver),
   ]);
   assert.deepEqual(race.map(r => r.status).sort(), [201, 409]);
   assert.equal((await sql("SELECT count(*)::int AS n FROM audit_logs WHERE request_id=$1 AND action IN ('REQUEST_CANCELLED','REQUEST_REJECTED')", [raceId])).rows[0].n, 1);
   assert.equal((await draftEffects(raceId)).provider, 0);
   return { duplicateCancelStatuses: copies.map(r => r.status), cancelVersusDecisionStatuses: race.map(r => r.status) };
  });
  await test('RENEW and REVOKE preserve lineage and complete with runtime row-lock privileges',async()=>{
   const r=(await api('POST','/requests',{type:'RENEW',targetAssetId:createdAsset,policyVersionId:policy.id,reason:'Runtime grants renew verification',parameters:{validityDays:90}},sessions.user,201)).data;
   await api('POST',`/requests/${r.id}/decision`,{decision:'APPROVED',version:String(r.version)},sessions.approver,201);await pollRequest(r.id);renewedAsset=(await sql('SELECT result_asset_id FROM requests WHERE id=$1',[r.id])).rows[0].result_asset_id;
   assert.equal((await sql('SELECT status FROM crypto_assets WHERE id=$1',[createdAsset])).rows[0].status,'SUPERSEDED');assert.equal((await sql('SELECT replaces_asset_id FROM crypto_assets WHERE id=$1',[renewedAsset])).rows[0].replaces_asset_id,createdAsset);
   const history=async id=>(await api('GET',`/assets/${id}/history?page=1&pageSize=50`,null,sessions.user,200)).data;
   const oldHistory=await history(createdAsset),newHistory=await history(renewedAsset);
   assert(oldHistory.lineage.assets.some(row=>row.id===renewedAsset&&row.relation==='successor'));
   assert(newHistory.lineage.assets.some(row=>row.id===createdAsset&&row.relation==='predecessor'));
   for(const result of [oldHistory,newHistory]){
    const actions=result.items.filter(event=>event.requestId===r.id).map(event=>event.action);
    for(const action of ['REQUEST_SUBMITTED','REQUEST_APPROVED','ASSET_RENEWED','PROVIDER_DISPATCH_STARTED','PROVIDER_RESULT_RECORDED'])assert(actions.includes(action));
    assert.equal(actions.filter(action=>action==='REQUEST_APPROVED').length,1);
    assert.equal(actions.filter(action=>action==='PROVIDER_DISPATCH_STARTED').length,1);
    assert.equal(actions.filter(action=>action==='PROVIDER_RESULT_RECORDED').length,1);
   }
   const revoke=(await api('POST','/requests',{type:'REVOKE',targetAssetId:renewedAsset,policyVersionId:policy.id,reason:'Runtime grants revoke verification',parameters:{}},sessions.user,201)).data;await api('POST',`/requests/${revoke.id}/decision`,{decision:'APPROVED',version:String(revoke.version)},sessions.approver,201);await pollRequest(revoke.id);
   assert.equal((await sql('SELECT status FROM crypto_assets WHERE id=$1',[renewedAsset])).rows[0].status,'REVOKED');
   const after=await history(renewedAsset);assert(after.items.some(event=>event.action==='ASSET_REVOKED'&&event.requestId===revoke.id));
   const paged=[];for(let page=1;paged.length<after.total;page++){
    const result=(await api('GET',`/assets/${renewedAsset}/history?page=${page}&pageSize=3`,null,sessions.user,200)).data;
    assert.equal(result.total,after.total);assert(result.items.length);paged.push(...result.items.map(event=>String(event.id)));
   }
   assert.equal(new Set(paged).size,after.total);assert.deepEqual(paged,after.items.map(event=>String(event.id)));
   return{renewRequest:r.id,revokeRequest:revoke.id,old:createdAsset,renewed:renewedAsset,historyEvents:after.total,providerMilestonesVisible:true};
  });
  await test('Reject and creator cancel paths remain transactional under runtime grants',async()=>{
   const ids=[];for(const action of ['reject','cancel']){const r=(await api('POST','/requests',{type:'CREATE',policyVersionId:policy.id,reason:'Runtime reject or cancel verification',parameters:{assetType:'KEY'}},sessions.user,201)).data;
    if(action==='reject')await api('POST',`/requests/${r.id}/decision`,{decision:'REJECTED',comment:'Rejected for runtime role verification',version:String(r.version)},sessions.approver,201);else await api('POST',`/requests/${r.id}/cancel`,null,sessions.user,201);
    assert.equal((await sql('SELECT status FROM requests WHERE id=$1',[r.id])).rows[0].status,action==='reject'?'REJECTED':'CANCELLED');ids.push(r.id);
   }return{requestIds:ids};
  });
  await test('Audit INSERT failure rolls back request and notification writes with the restricted API',async()=>{
   const counts=async()=> (await sql('SELECT (SELECT count(*) FROM requests)::int AS requests,(SELECT count(*) FROM notifications)::int AS notifications')).rows[0];const before=await counts();
   await sql("CREATE FUNCTION public.runtime_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='REQUEST_SUBMITTED' THEN RAISE EXCEPTION 'RUNTIME_TEST_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER runtime_test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION runtime_test_reject_audit()");
   let failure;
   try{
    failure=await api('POST','/requests',{type:'CREATE',policyVersionId:policy.id,reason:'Rollback runtime role verification',parameters:{assetType:'KEY'}},sessions.user,500);assert.deepEqual(await counts(),before);
    const durable=(await sql("SELECT actor_id,action,entity_id,metadata FROM audit_logs WHERE metadata->>'correlationId'=$1",[failure.correlationId])).rows;
    assert.equal(durable.length,1);assert.equal(durable[0].action,'HTTP_REQUEST_FAILED');assert.equal(durable[0].actor_id,sessions.user.user.id);assert.equal(durable[0].entity_id,'/api/v1/requests');assert.equal(durable[0].metadata.httpStatus,500);
   }finally{await sql('DROP TRIGGER runtime_test_audit_failure ON audit_logs; DROP FUNCTION runtime_test_reject_audit()');}return{rowsBefore:before,rowsAfter:await counts(),failureAuditSurvivedRollback:true};
  });
  await test('Policy append concurrency commits one version and keeps published rows immutable',async()=>{
   const body={expectedVersion:policy.version,algorithm:'RSA',minimumKeySize:2048,maximumValidityDays:90,warningDays:[30,7,1]};const pairs=await Promise.all([api('POST',`/policies/${policy.policyId}/versions`,body,sessions.admin),api('POST',`/policies/${policy.policyId}/versions`,body,sessions.admin)]);assert.deepEqual(pairs.map(r=>r.status).sort(),[201,409]);return{statuses:pairs.map(r=>r.status)};
  });
  await test('Policy lifecycle is Admin-only and commits an initial version, then rejects a stale deactivation',async()=>{
   const list=async()=> (await api('GET','/policies/admin',null,sessions.admin,200)).data;
   const body={code:` runtime_${suffix} `,name:'Runtime lifecycle',algorithm:'RSA',minimumKeySize:2048,maximumValidityDays:90,warningDays:[7,1]};
   const code=body.code.trim().toUpperCase(),initialCount=(await list()).length;
   await api('GET','/policies/admin',null,sessions.user,403);
   await api('POST','/policies',body,sessions.user,403);
   const copies=await Promise.all([api('POST','/policies',body,sessions.admin),api('POST','/policies',body,sessions.admin)]);
   assert.deepEqual(copies.map(item=>item.status).sort(),[201,409]);
   const root=copies.find(item=>item.status===201).data;
   assert.equal(root.code,code);assert.equal(root.latest.version,1);assert.equal(root.effectiveVersion,1);
   const history=`/policies/${root.id}/versions`,stop=`/policies/${root.id}/deactivate`;
   await api('GET',history,null,sessions.user,403);
   await api('PATCH',stop,{expectedVersion:1},sessions.user,403);
   const update={expectedVersion:1,algorithm:body.algorithm,minimumKeySize:3072,maximumValidityDays:60,warningDays:[14,1]};
   const second=(await api('POST',history,update,sessions.admin,201)).data;
   const current=await list();assert.equal(current.length,initialCount+1);
   const summary=current.find(item=>item.id===root.id);
   assert.equal(summary.effectiveVersion,2);assert.equal(Date.parse(summary.effectiveFrom),Date.parse(second.effectiveFrom));
   const stale=await api('PATCH',stop,{expectedVersion:1},sessions.admin,409);
   assert.equal(stale.data.error.code,'VERSION_CONFLICT');
   const versions=(await api('GET',history,null,sessions.admin,200)).data;
   assert.deepEqual(versions.map(item=>[item.version,item.configuration.minimum_key_size]),[[2,3072],[1,2048]]);
   const competing=await Promise.all([api('POST',history,{...update,expectedVersion:2},sessions.admin),api('PATCH',stop,{expectedVersion:2},sessions.admin)]);
   assert.equal(competing.filter(item=>item.status===409).length,1);
   const winner=(await list()).find(item=>item.id===root.id);
   if(winner.active){assert.equal(winner.latest.version,3);await api('PATCH',stop,{expectedVersion:3},sessions.admin,200);}
   else assert.equal(winner.latest.version,2);
   const stopped=(await list()).find(item=>item.id===root.id);
   assert.equal(stopped.active,false);assert.equal(stopped.effectiveVersion,null);assert.equal(stopped.effectiveFrom,null);
   const actions=(await sql('SELECT action FROM audit_logs WHERE entity_id=$1 ORDER BY id',[root.id])).rows.map(row=>row.action);
   assert.equal(actions[0],'POLICY_CREATED');assert.equal(actions.at(-1),'POLICY_DEACTIVATED');assert.equal(actions.length,stopped.latest.version+1);
   return { duplicateStatuses:copies.map(item=>item.status),raceStatuses:competing.map(item=>item.status),policyCount:current.length,versionCount:stopped.latest.version,actions };
  });
  await test('Policy deactivation hides the picker option, preserves submitted work and allows revocation',async()=>{
   const root=(await api('POST','/policies',{code:`INACTIVE_${suffix}`,name:'Deactivation verification',algorithm:'RSA',minimumKeySize:2048,maximumValidityDays:90,warningDays:[7]},sessions.admin,201)).data;
   const body={type:'CREATE',policyVersionId:root.latest.id,reason:'Submitted before policy deactivation',parameters:{assetType:'KEY'}};
   const pending=(await api('POST','/requests',body,sessions.user,201)).data;
   await api('PATCH',`/policies/${root.id}/deactivate`,{expectedVersion:1},sessions.admin,200);
   const available=(await api('GET','/policies',null,sessions.user,200)).data;
   assert(!available.some(item=>item.policyId===root.id));
   await api('POST','/requests',body,sessions.user,404);
   await api('POST',`/requests/${pending.id}/decision`,{decision:'APPROVED',version:String(pending.version)},sessions.approver,201);
   await pollRequest(pending.id);
   const asset=(await sql('SELECT a.id,a.status,a.policy_version_id FROM requests r JOIN crypto_assets a ON a.id=r.result_asset_id WHERE r.id=$1',[pending.id])).rows[0];
   assert.equal(asset.policy_version_id,root.latest.id);assert.equal(asset.status,'ACTIVE');
   const linked={targetAssetId:asset.id,policyVersionId:root.latest.id,reason:'Asset linked to a deactivated policy',parameters:{}};
   await api('POST','/requests',{...linked,type:'RENEW'},sessions.user,404);
   const revoke=(await api('POST','/requests',{...linked,type:'REVOKE'},sessions.user,201)).data;
   await api('POST',`/requests/${revoke.id}/decision`,{decision:'APPROVED',version:String(revoke.version)},sessions.approver,201);
   await pollRequest(revoke.id);
   assert.equal((await sql('SELECT status FROM crypto_assets WHERE id=$1',[asset.id])).rows[0].status,'REVOKED');
   const history=(await api('GET',`/policies/${root.id}/versions`,null,sessions.admin,200)).data;
   assert.deepEqual(history,[root.latest]);
   return { provisionedVersion:asset.policy_version_id,newCreateBlocked:true,newRenewBlocked:true,revocationCompleted:true,historyPreserved:true };
  });
  await test('A waiting CREATE validates against the version published while it was waiting for the policy lock',async()=>{
   const root=(await api('POST','/policies',{code:`POLICY_LOCK_${suffix}`,name:'Policy lock verification',algorithm:'RSA',minimumKeySize:2048,maximumValidityDays:90,warningDays:[]},sessions.admin,201)).data;
   const publisher=await admin.connect();
   let request;
   try{
    await publisher.query('BEGIN');
    await publisher.query('SELECT id FROM policies WHERE id=$1 FOR UPDATE',[root.id]);
    request=api('POST','/requests',{type:'CREATE',policyVersionId:root.latest.id,reason:'Wait for concurrent publication',parameters:{assetType:'KEY'}},sessions.user);
    const deadline=Date.now()+5000;
    let blocked=false;
    while(!blocked&&Date.now()<deadline){
     const waiting=await sql("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT p.id FROM policies p JOIN policy_versions%'");
     blocked=waiting.rowCount>0;
     if(!blocked)await sleep(40);
    }
    assert(blocked,'Expected the request to be blocked on the policy row');
    await publisher.query(`INSERT INTO policy_versions(policy_id,version,configuration,effective_from)
      VALUES($1,2,$2::jsonb,statement_timestamp())`,[root.id,JSON.stringify(root.latest.configuration)]);
    await publisher.query('COMMIT');
    const response=await request;
    assert.equal(response.status,404);assert.equal(response.data.error.code,'POLICY_NOT_FOUND');
    return { waitedForPublisher:true,staleVersionRejected:true };
   }finally{
    await publisher.query('ROLLBACK');publisher.release();
    await request?.catch(()=>{});
   }
  });
  await test('Policy creation and deactivation roll back if their audit insert fails',async()=>{
   const body={code:`ROLLBACK_${suffix.toUpperCase()}`,name:'Policy audit rollback',algorithm:'AES',minimumKeySize:256,maximumValidityDays:90,warningDays:[]};
   const root=(await api('POST','/policies',{...body,code:`STOP_ROLLBACK_${suffix}`},sessions.admin,201)).data;
   await sql("CREATE FUNCTION public.runtime_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('POLICY_CREATED','POLICY_DEACTIVATED') THEN RAISE EXCEPTION 'RUNTIME_TEST_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER runtime_test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION runtime_test_reject_audit()");
   try{
    await api('POST','/policies',body,sessions.admin,500);
    await api('PATCH',`/policies/${root.id}/deactivate`,{expectedVersion:1},sessions.admin,500);
    const found=(await sql('SELECT code,is_active FROM policies WHERE code=$1 OR id=$2',[body.code,root.id])).rows;
    assert.deepEqual(found,[{code:root.code,is_active:true}]);
   }finally{await sql('DROP TRIGGER runtime_test_audit_failure ON audit_logs; DROP FUNCTION runtime_test_reject_audit()');}
   return { creationRolledBack:true,deactivationRolledBack:true };
  });
  async function recoveryFixture(classification, legacy=false){
   const id=crypto.randomUUID();
   await sql(`INSERT INTO requests(id,request_type,creator_id,department_id,policy_version_id,status,reason)
     VALUES($1,'CREATE',$2,$3,$4,'RECONCILIATION_REQUIRED','Provider recovery verification')`,[id,sessions.user.user.id,sessions.user.user.departmentId,policy.id]);
   await sql(`INSERT INTO provider_operations(request_id,operation_type,status,claim_version,failure_class,last_error_code,provider_reference)
     VALUES($1,'CREATE','RECONCILIATION_REQUIRED',$2,$3,$4,$5)`,[id,legacy?null:1,classification,legacy?'sensitive-detail-fixture':'STALE_PROCESSING',legacy?'private-reference-fixture':null]);
   return `/operations/provider-issues/${id}`;
  }
  await test('Provider recovery is Admin-only and legacy uncertainty cannot retry, confirm or close',async()=>{
   const route=await recoveryFixture(null,true);
   await api('GET','/operations/provider-issues',null,sessions.user,403);
   await api('GET',route,null,sessions.user,403);
   const detail=(await api('GET',route,null,sessions.admin,200)).data;
   assert.equal(detail.failureClass,'OUTCOME_UNKNOWN');assert.equal(detail.errorCode,'PROCESSING_ERROR');
   assert.deepEqual(detail.availableActions,[]);assert.equal(detail.hasReceipt,false);
   assert(!JSON.stringify(detail).includes('private-reference-fixture'));assert(!JSON.stringify(detail).includes('sensitive-detail-fixture'));
   const reason='Review fixture outcome without verified evidence';
   await api('POST',route+'/actions',{version:detail.version,action:'RETRY',reason},sessions.user,403);
   for(const action of ['RETRY','CONFIRM','ABANDON']){
    const denied=await api('POST',route+'/actions',{version:detail.version,action,reason},sessions.admin,409);
    assert.equal(denied.data.error.code,'RECOVERY_UNVERIFIED');
   }
   const list=(await api('GET','/operations/provider-issues?status=RECONCILIATION_REQUIRED&page=1&pageSize=1',null,sessions.admin,200)).data;
   assert.equal(list.items.length,1);assert.equal(list.items[0].id,detail.id);assert.deepEqual((await api('GET',route,null,sessions.admin,200)).data,detail);
   return { legacyBlocked:true,protectedFieldsOmitted:true,adminOnly:true };
  });
  await test('Known-unsent operations can retry or close with an optimistic version and an audited reason',async()=>{
   const reason='Database lock was cleared and delivery was not attempted';
   const retryRoute=await recoveryFixture('UNSENT_TRANSIENT');
   const before=(await api('GET',retryRoute,null,sessions.admin,200)).data;
   assert.deepEqual(before.availableActions,['RETRY','ABANDON']);
   await api('POST',retryRoute+'/actions',{version:before.version,action:'RETRY',reason:'   '},sessions.admin,400);
   const body={version:before.version,action:'RETRY',reason};
   const competing=await Promise.all([api('POST',retryRoute+'/actions',body,sessions.admin),api('POST',retryRoute+'/actions',body,sessions.admin)]);
   assert.deepEqual(competing.map(item=>item.status).sort(),[201,409]);
   const scheduled=(await api('GET',retryRoute,null,sessions.admin,200)).data;
   assert.equal(scheduled.status,'RETRY_SCHEDULED');assert.equal(scheduled.attemptCount,0);assert.equal(scheduled.retryCount,1);
   assert.equal(scheduled.history[0].reason,reason);assert.equal(scheduled.history[0].delaySeconds,60);
   await sql("UPDATE provider_operations SET retry_after=NOW()-INTERVAL '1 second' WHERE request_id=$1",[before.id]);
   await pollRequest(before.id);
   assert.equal((await api('GET',retryRoute,null,sessions.admin,200)).data.attemptCount,1);
   const closeRoute=await recoveryFixture('UNSENT_PERMANENT');
   const close=(await api('GET',closeRoute,null,sessions.admin,200)).data;
   assert.deepEqual(close.availableActions,['ABANDON']);
   await api('POST',closeRoute+'/actions',{version:close.version,action:'RETRY',reason},sessions.admin,409);
   const done=(await api('POST',closeRoute+'/actions',{version:close.version,action:'ABANDON',reason},sessions.admin,201)).data;
   assert.equal(done.status,'FAILED');
   const notices=(await sql("SELECT channel FROM notifications WHERE request_id=$1 AND type='REQUEST_FAILED' ORDER BY channel",[close.id])).rows;
   assert.deepEqual(notices.map(row=>row.channel),['EMAIL','IN_APP']);
   return { retryRaceStatuses:competing.map(item=>item.status),sentAfterScheduledRetry:1,closedWithNotifications:true };
  });
  await test('Recorded provider success can be applied once and an audit fault rolls back the recovery',async()=>{
   const current=(await api('GET','/policies',null,sessions.user,200)).data.find(item=>item.policyId===policy.policyId);
   const req=(await api('POST','/requests',{type:'CREATE',policyVersionId:current.id,reason:'Confirm actual provider receipt',parameters:{assetType:'KEY'}},sessions.user,201)).data;
   assert.match(req.id,/^[a-f0-9-]{36}$/);
   const route=`/operations/provider-issues/${req.id}`;
   await sql(`CREATE FUNCTION public.runtime_test_reject_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN IF NEW.request_id='${req.id}' AND NEW.action IN ('ASSET_CREATED','PROVIDER_RESULT_CONFIRMED')
       THEN RAISE EXCEPTION 'RUNTIME_TEST_CONFIRMATION_FAILURE'; END IF; RETURN NEW; END $$;
     CREATE TRIGGER runtime_test_confirmation_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION runtime_test_reject_confirmation()`);
   let detail;
   try {
    await api('POST',`/requests/${req.id}/decision`,{decision:'APPROVED',version:String(req.version)},sessions.approver,201);
    const until=Date.now()+16000;
    while(Date.now()<until){const response=await api('GET',route,null,sessions.admin);if(response.data.status==='RECONCILIATION_REQUIRED'){detail=response.data;break}await sleep(200)}
    assert(detail);assert.equal(detail.failureClass,'RESULT_RECORDED');assert.equal(detail.attemptCount,1);
    assert.deepEqual(detail.availableActions,['CONFIRM']);assert.equal(detail.hasReceipt,true);
    await sql('UPDATE requests SET reason=$2 WHERE id=$1',[req.id,'Approved input drift fixture']);
    const drift=await api('POST',route+'/actions',{version:detail.version,action:'CONFIRM',reason:'Inspect changes after provider dispatch'},sessions.admin,409);
    assert.equal(drift.data.error.code,'RECOVERY_UNVERIFIED');
    await sql('UPDATE requests SET reason=$2 WHERE id=$1',[req.id,'Confirm actual provider receipt']);
    await api('POST',route+'/actions',{version:detail.version,action:'CONFIRM',reason:'Apply the receipt after auditing the transaction failure'},sessions.admin,500);
    const after=(await api('GET',route,null,sessions.admin,200)).data;
    assert.deepEqual(after,detail);
    assert.equal((await sql('SELECT result_asset_id FROM requests WHERE id=$1',[req.id])).rows[0].result_asset_id,null);
   }finally{await sql('DROP TRIGGER runtime_test_confirmation_failure ON audit_logs; DROP FUNCTION public.runtime_test_reject_confirmation()');}
   const body={version:detail.version,action:'CONFIRM',reason:'Verified receipt with unchanged approved inputs'};
   const confirmed=await Promise.all([api('POST',route+'/actions',body,sessions.admin),api('POST',route+'/actions',body,sessions.admin)]);
   assert.deepEqual(confirmed.map(item=>item.status).sort(),[201,409]);
   const done=(await api('GET',route,null,sessions.admin,200)).data;
   assert.equal(done.status,'COMPLETED');assert.equal(done.attemptCount,1);assert.equal(done.history[0].reason,body.reason);
   const saved=(await sql(`SELECT a.provider_reference,a.valid_from,op.provider_reference AS receipt_ref,op.sent_at
     FROM requests r JOIN crypto_assets a ON a.id=r.result_asset_id JOIN provider_operations op ON op.request_id=r.id WHERE r.id=$1`,[req.id])).rows[0];
   assert.equal(saved.provider_reference,saved.receipt_ref);assert.equal(+saved.valid_from,+saved.sent_at);
   return { confirmationRaceStatuses:confirmed.map(item=>item.status),inputDriftRejected:true,auditRollback:true,noProviderReplay:true };
  });
  await test('Asset scope migration identifies demo assets and rejects an unbound reference at submission and selection',async()=>{
   const id=crypto.randomUUID(),seed='a1111111-1111-1111-1111-111111111111';
   assert.equal((await sql('SELECT provider_scope FROM crypto_assets WHERE id=$1',[seed])).rows[0].provider_scope,'MOCK');
   const demoKeys=(await sql("SELECT asset_code,provider_scope FROM crypto_assets WHERE asset_code IN ('KEY-DEV-OLD','KEY-DEV-NEW','KEY-DEV-REVOKED') ORDER BY asset_code")).rows;
   assert.equal(demoKeys.length,3);assert(demoKeys.every(row=>row.provider_scope==='MOCK'));
   const demoCert=(await sql("SELECT asset_code,provider_scope FROM crypto_assets WHERE id='a2222223-2222-2222-2222-222222222223'")).rows[0];
   assert.deepEqual(demoCert,{asset_code:'CRT-FIN-ACTIVE',provider_scope:'MOCK'});
   await sql(`INSERT INTO crypto_assets(id,asset_code,asset_type,owner_id,department_id,policy_version_id,purpose,status,valid_from,expires_at,provider_reference)
     VALUES($1,$2,'KEY',$3,$4,$5,'Unbound legacy fixture','ACTIVE',NOW(),NOW()+INTERVAL '10 days',$6)`,
   [id,'UNBOUND-'+suffix,sessions.user.user.id,sessions.user.user.departmentId,policy.id,'unknown-provider-'+suffix]);
   const asset=(await api('GET','/assets/'+id,null,sessions.user,200)).data;
   assert.equal(asset.providerMode,null);assert.equal(Object.hasOwn(asset,'providerScope'),false);
   const picker=(await api('GET','/assets?eligible=true&ownedOnly=true&page=1&pageSize=100',null,sessions.user,200)).data;
   assert(!picker.items.some(item=>item.id===id));
   const known=(await api('GET','/assets/'+seed,null,sessions.user,200)).data;
   assert.equal(known.providerMode,'MOCK');
   const body={type:'REVOKE',targetAssetId:id,policyVersionId:policy.id,reason:'Test unverified provider target',parameters:{}};
   const blocked=await api('POST','/requests',body,sessions.user,409);
   assert.equal(blocked.data.error.code,'CRYPTO_PROVIDER_SCOPE_MISMATCH');
   return { demoScopeBackfilled:true,unboundAssetOmittedFromPicker:true,unboundMutationBlocked:true };
  });
  await test('Compiled API rejects bad provider configuration before boot without printing credentials',async()=>{
   const marker='must-not-be-logged-fixture';
   for(const [overrides,code] of [
    [{CRYPTO_PROVIDER_MODE:'typo'},'CRYPTO_PROVIDER_MODE_INVALID'],
    [{CRYPTO_PROVIDER_MODE:'HTTP',CRYPTO_PROVIDER_URL:`https://fixture:${marker}@provider.example.invalid`,CRYPTO_PROVIDER_TOKEN:marker},'CRYPTO_PROVIDER_URL_INVALID'],
   ]){
    const child=spawnSync(process.execPath,['/app/dist/main.js'],{env:{...process.env,...overrides},encoding:'utf8',timeout:5000,maxBuffer:128*1024});
    assert.equal(child.status,1);assert(child.stderr.includes(code));
    assert(!(child.stdout+child.stderr).includes(marker));
   }
   return { invalidModeRejected:true,unsafeUrlRejected:true,credentialAbsentFromOutput:true };
  });
  await test('Expiry and notification read paths work under the real runtime connection',async()=>{
   const asset=crypto.randomUUID();await sql("INSERT INTO crypto_assets(id,asset_code,asset_type,owner_id,department_id,policy_version_id,purpose,status,valid_from,expires_at,provider_reference) VALUES($1,$2,'KEY',$3,$4,$5,'Runtime expiry fixture','ACTIVE',NOW()-INTERVAL '2 days',NOW()-INTERVAL '1 day',$2)",[asset,'runtime-expiry-'+suffix,sessions.user.user.id,sessions.user.user.departmentId,policy.id]);
   await new ExpiryScanService(runtime,new NotificationsService(runtime)).run();assert.equal((await sql('SELECT status FROM crypto_assets WHERE id=$1',[asset])).rows[0].status,'EXPIRED');
   const history=(await api('GET',`/assets/${asset}/history?page=1&pageSize=10`,null,sessions.user,200)).data;
   assert.equal(history.items.filter(event=>event.action==='ASSET_MARKED_EXPIRED').length,1);
   const notification=(await sql("SELECT id FROM notifications WHERE asset_id=$1 AND recipient_id=$2 AND channel='IN_APP'",[asset,sessions.user.user.id])).rows[0];assert(notification);await api('PATCH',`/notifications/${notification.id}/read`,null,sessions.user,200);assert((await sql('SELECT read_at FROM notifications WHERE id=$1',[notification.id])).rows[0].read_at);return{assetId:asset,notificationId:notification.id};
  });
  await test('Email queue claim and SENT bookkeeping use runtime grants with a fake transport only',async()=>{
   const email=new EmailWorkerService(runtime);let sent=0;const old=process.env.SMTP_FROM;process.env.SMTP_FROM='Crypta <no-reply@example.test>';email.transporter={sendMail:async()=>{sent++;}};
   try{const job=await email.claim();assert(job);await email.deliver(job);assert.equal(sent,1);assert.equal((await sql('SELECT delivery_status FROM notifications WHERE id=$1',[job.id])).rows[0].delivery_status,'SENT');return{queueId:job.id,fakeTransportCalls:sent,smtpNetworkCalls:0};}finally{if(old===undefined)delete process.env.SMTP_FROM;else process.env.SMTP_FROM=old;}
  });
  await test('Dashboard, asset/history, audit, notification and operations metrics reads are available under runtime',async()=>{
   for(const endpoint of ['/dashboard?role=ADMIN','/users?page=1&pageSize=25','/audit-logs?page=1&pageSize=25','/notifications/status','/notifications/delivery-issues?page=1&pageSize=25'])await api('GET',endpoint,null,sessions.admin,200);
   const metrics=(await api('GET','/operations/metrics',null,sessions.admin,200)).data;
   assert.equal(metrics.database.status,'connected');assert.equal(metrics.provider.mode,'MOCK');
   await api('GET',`/assets/${createdAsset}/history`,null,sessions.user,200);await api('GET','/notifications?page=1&pageSize=25',null,sessions.user,200);return{readEndpoints:8};
  });
  await test('Large list fixtures keep every sorted page scoped and preserve totals beyond legacy limits',async()=>{
   const marker='T17-'+suffix,foreign=crypto.randomUUID();
   const otherDepartment=(await sql('SELECT id FROM departments WHERE id<>$1 ORDER BY id LIMIT 1',[sessions.user.user.departmentId])).rows[0].id;
   await sql(`INSERT INTO users(id,department_id,email,password_hash,display_name)
     VALUES($1,$2,$3,'not-a-login-credential','Foreign list fixture')`,[foreign,otherDepartment,`foreign-${suffix}@example.test`]);
   await sql(`INSERT INTO users(department_id,email,password_hash,display_name)
     SELECT $1,$2||'-'||n||'@example.test','not-a-login-credential',$2||' user' FROM generate_series(1,600) n`,
   [sessions.user.user.departmentId,marker]);
   await sql(`INSERT INTO crypto_assets(asset_code,asset_type,owner_id,department_id,policy_version_id,purpose,status,valid_from,expires_at)
     SELECT $1||'-asset-'||lpad(n::text,4,'0'),'KEY',CASE WHEN n<=600 THEN $2::uuid ELSE $3::uuid END,
       CASE WHEN n<=600 THEN $4::uuid ELSE $5::uuid END,$6,$1||' asset','ACTIVE',NOW(),NOW()+INTERVAL '90 days'
     FROM generate_series(1,720) n`,[marker,sessions.user.user.id,foreign,sessions.user.user.departmentId,otherDepartment,policy.id]);
   await sql(`INSERT INTO requests(request_type,creator_id,department_id,policy_version_id,status,reason,submitted_at)
     SELECT 'CREATE',CASE WHEN n<=600 THEN $2::uuid ELSE $3::uuid END,
       CASE WHEN n<=600 THEN $4::uuid ELSE $5::uuid END,$6,'PENDING',$1||' request',NOW()
     FROM generate_series(1,720) n`,[marker,sessions.user.user.id,foreign,sessions.user.user.departmentId,otherDepartment,policy.id]);
   await sql(`INSERT INTO notifications(recipient_id,asset_id,type,channel,deduplication_key,delivery_status,sent_at)
     SELECT owner_id,id,'ASSET_EXPIRING','IN_APP',$1||':'||id,'SENT',NOW()
     FROM crypto_assets WHERE purpose=$1||' asset'`,[marker]);
   await sql(`INSERT INTO audit_logs(actor_type,action,entity_type,entity_id,outcome)
     SELECT 'SYSTEM',$1,'REQUEST',gen_random_uuid()::text,'SUCCESS' FROM generate_series(1,600) n`,[marker]);
   const cases=[
    {endpoint:'/assets',params:{search:marker,sortBy:'expiresAt'},session:sessions.user,
     select:'SELECT id FROM crypto_assets WHERE purpose=$1 AND owner_id=$2',values:[marker+' asset',sessions.user.user.id]},
    {endpoint:'/requests',params:{search:marker,sortBy:'submittedAt'},session:sessions.user,
     select:'SELECT id FROM requests WHERE reason=$1 AND creator_id=$2',values:[marker+' request',sessions.user.user.id]},
    {endpoint:'/requests',params:{search:marker,sortBy:'submittedAt'},session:sessions.approver,
     select:'SELECT id FROM requests WHERE reason=$1 AND department_id=ANY($2::uuid[])',values:[marker+' request',sessions.approver.user.approverDepartmentIds]},
    {endpoint:'/users',params:{search:marker,sortBy:'displayName'},session:sessions.admin,
     select:'SELECT id FROM users WHERE display_name=$1',values:[marker+' user']},
    {endpoint:'/audit-logs',params:{action:marker,sortBy:'occurredAt'},session:sessions.admin,
     select:'SELECT id FROM audit_logs WHERE action=$1',values:[marker]},
    {endpoint:'/notifications',params:{search:marker,type:'ASSET_EXPIRING',sortBy:'createdAt'},session:sessions.user,
     select:'SELECT id FROM notifications WHERE deduplication_key LIKE $1 AND recipient_id=$2',values:[marker+':%',sessions.user.user.id]},
   ];
   const evidence=[];
   for(const fixture of cases)for(const direction of ['asc','desc']){
    const expected=(await sql(fixture.select+' ORDER BY id '+direction,fixture.values)).rows.map(row=>String(row.id));
    assert.equal(expected.length,600);
    const collected=[],started=performance.now();
    for(let page=1;page<=7;page++){
     const params=new URLSearchParams({...fixture.params,sortOrder:direction,page:String(page),pageSize:'100'});
     const result=(await api('GET',fixture.endpoint+'?'+params,null,fixture.session,200)).data;
     assert.equal(result.total,600);assert.equal(result.page,page);assert.equal(result.pageSize,100);
     assert.equal(result.items.length,page===7?0:100);collected.push(...result.items.map(row=>String(row.id)));
    }
    assert.deepEqual(collected,expected);assert.equal(new Set(collected).size,600);
    evidence.push({endpoint:fixture.endpoint,role:fixture.session.user.roles.join(','),direction,total:600,pages:7,elapsedMs:Math.round(performance.now()-started)});
   }
   for(const [endpoint,session]of [['/assets',sessions.user],['/requests',sessions.user],['/users',sessions.admin],['/audit-logs',sessions.admin],['/notifications',sessions.user]]){
    const invalid=await api('GET',endpoint+'?sortBy=id%3BDROP&page=1',null,session,400);
    assert.equal(invalid.data.error.code,'INVALID_SORT');
   }
   const filteredAudit=(await api('GET','/audit-logs?action='+marker,null,sessions.admin,200)).data;
   assert.equal(filteredAudit.total,600);assert.equal(filteredAudit.items.length,25);
   await sql('ANALYZE crypto_assets; ANALYZE requests; ANALYZE users; ANALYZE audit_logs; ANALYZE notifications');
   const statements=[],measuredPool={query:async(text,values)=>{statements.push({text,values});return runtime.query(text,values)}};
   const {AssetsService}=require('/app/dist/assets/assets.service.js');
   const {RequestsService}=require('/app/dist/requests/requests.service.js');
   const {UsersService}=require('/app/dist/users/users.service.js');
   const {AuditController}=require('/app/dist/audit/audit.controller.js');
   const sample={search:marker,page:'3',pageSize:'100'};
   await new AssetsService(measuredPool).list(sessions.user.user,{...sample,sortBy:'expiresAt',sortOrder:'desc'});
   await new RequestsService(measuredPool,null).list(sessions.approver.user,{...sample,sortBy:'submittedAt',sortOrder:'asc'});
   await new UsersService(measuredPool,null).listPage(sessions.admin.user,{...sample,sortBy:'displayName'});
   await new AuditController(measuredPool).list(sessions.admin.user,{page:'3',pageSize:'100',action:marker,sortBy:'occurredAt'});
   await new NotificationsService(measuredPool).list(sessions.user.user.id,{...sample,sortBy:'createdAt'});
   const plans=[];
   for(const statement of statements){
    const result=(await runtime.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+statement.text,statement.values)).rows[0]['QUERY PLAN'][0];
    plans.push({sql:statement.text,plan:result});
   }
   assert.equal(plans.length,10);
   return {fixturesPerList:600,foreignRowsPerScopedList:120,orderedPages:evidence,filterWithoutPageWorks:true,queryPlans:plans};
  });
  await test('Two Admin actors concurrently disabling each other preserve one active Admin under restricted grants',async()=>{
   const other=await login('ciso@congty.com');const count=async()=>Number((await sql("SELECT count(*)::int AS n FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.code='ADMIN' AND u.status='ACTIVE'")).rows[0].n);
   assert.equal(await count(),2);
   const responses=await Promise.all([api('PATCH',`/users/${other.user.id}/status`,{status:'INACTIVE'},sessions.admin),api('PATCH',`/users/${sessions.admin.user.id}/status`,{status:'INACTIVE'},other)]);
   const statuses=responses.map(r=>r.status).sort();assert.equal(statuses[0],200);assert([401,409].includes(statuses[1]));assert.equal(await count(),1);return{statuses,activeAdmins:await count()};
  });
  await test('Runtime database password rotation rejects old new-connections and permits a restarted API with the new secret',async()=>{
   await executeFormatted('ALTER ROLE %I PASSWORD %L',[roles.runtime,passwords.rotated]);
   const stale=new Pool({connectionString:urlFor(roles.runtime,passwords.runtime),max:1,connectionTimeoutMillis:3000});try{await assert.rejects(()=>stale.query('SELECT 1'),e=>e.code==='28P01');}finally{await stale.end();}
   assert.equal((await runtime.query('SELECT current_user AS name')).rows[0].name,roles.runtime);const oldPid=child.pid;await stopApi();await startApi(passwords.rotated);await api('GET','/auth/me',null,sessions.user,200);return{oldCredentialNewConnectionDenied:'28P01',existingConnectionRemainsValid:true,oldApiPid:oldPid,newApiPid:child.pid};
  });
  await verifyAccountActions({ api, login, sql, test, sleep, startApi:overrides=>startApi(passwords.rotated,overrides), stopApi, readLog:()=>childLog });
  report.accountActionsSmtpLoopback=true;
 }catch(error){report.setupError=error instanceof assert.AssertionError?error.message:String(error.code||error.message).slice(0,200);}
 finally{
  await stopApi();if(runtime)await runtime.end();
  report.permissionDenialsInApiLog=[...new Set([...childLog.matchAll(/permission denied for (?:table|sequence|schema) ([a-z_]+)/g)].map(m=>m[1]))];
  const secrets=[...Object.values(passwords),base.password,'Password@123','Temporary@12345','ChangedRuntime@12345',...Object.values(sessions).flatMap(s=>[s.token,s.cookie]).filter(Boolean)];
  report.credentialsAbsentFromApiLog=secrets.every(p=>!childLog.includes(p));report.apiLogBytes=Buffer.byteLength(childLog);report.apiLogSha256=crypto.createHash('sha256').update(childLog).digest('hex');
  report.rolesRetainedBeforeHostCleanup=roleCreated.length;report.roleCleanupDeferredToHost=true;
  report.roleRemaining=(await sql('SELECT count(*)::int AS n FROM pg_roles WHERE rolname=ANY($1::text[])',[Object.values(roles)])).rows[0].n;
  await admin.end();
 }
 report.success=results.length===50&&results.every(r=>r.passed)&&report.roleRemaining===3&&report.credentialsAbsentFromApiLog&&report.permissionDenialsInApiLog.length===0;return report;
}
