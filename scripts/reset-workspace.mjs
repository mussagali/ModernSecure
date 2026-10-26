// Explicit operator-only reset. Never imported by the app or run by migrations.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
const project = 'bdkrihsiprkmukyjyspv';
const credentialPath = '.workspace-accounts.local.json';
const tables = ['audit_events','case_assignments','case_internal_notes','case_stage_events','case_suspensions','cases','clients','consent_records','contact_settings','contracts','document_files','document_internal_notes','document_requests','document_templates','faq_entries','legal_documents','message_attachments','message_reads','messages','notifications','payment_receipts','payment_schedule','payments','profiles','service_template_versions','service_templates','staff_invites','staff_members','staff_message_attachments','staff_message_case_refs','staff_messages','staff_thread_reads','staff_threads','stage_templates','task_events','tasks','upload_sessions'];
const definitions = [
  ['owner','Главный администратор','admin'], ['admin','Администратор','admin'],
  ['lawyer','Юрист','lawyer'], ['manager','Менеджер','manager'], ['client','Клиент',null],
];
function env(file,name) {
  assert.equal(statSync(file).mode & 0o077, 0, `${file} requires mode 600`);
  return readFileSync(file,'utf8').split(/\r?\n/).find(x=>x.startsWith(name+'='))?.slice(name.length+1).trim().replace(/^['"]|['"]$/g,'');
}
const baseUrl=env('.env.local','NEXT_PUBLIC_SUPABASE_URL');
assert.equal(baseUrl,`https://${project}.supabase.co`);
const url=new URL(env('.env.db.local','DATABASE_URL'));
assert.ok((url.hostname===`db.${project}.supabase.co` && url.username==='postgres') || (url.hostname==='aws-0-ap-northeast-2.pooler.supabase.com' && url.username===`postgres.${project}`));
assert.equal(url.protocol,'postgresql:'); assert.equal(url.port,'5432'); assert.equal(url.pathname,'/postgres'); url.search='';
const db=new pg.Client({connectionString:url.toString(),ssl:{ca:readFileSync('supabase/certs/prod-ca-2021.crt','utf8'),rejectUnauthorized:true},connectionTimeoutMillis:12000});
const admin=createClient(baseUrl,env('.env.local','SUPABASE_SECRET_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
const identifier=s=>'"'+s.replaceAll('"','""')+'"';
const save=data=>writeFileSync(credentialPath,JSON.stringify(data,null,2)+'\n',{mode:0o600});
let transaction=false;
try {
  await db.connect();
  assert.ok(db.connection.stream.authorized);
  const actual=(await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(x=>x.tablename);
  assert.deepEqual(actual,[...tables].sort(),'Unknown tables: inspect the reset scope first');
  const oldUsers=(await db.query('select id from auth.users order by id')).rows.map(x=>x.id);
  const objects=(await db.query('select * from storage.objects order by bucket_id,name')).rows;
  assert.ok(objects.every(x=>['modernsecure-files','modernsecure-previews'].includes(x.bucket_id)),'Unknown storage bucket');
  if(process.argv[2]==='--plan') {
    console.log(JSON.stringify({project,publicTables:tables.length,oldUsers:oldUsers.length,files:objects.length,newAccounts:definitions.map(([key,name])=>({email:`${key}@modernsecure.test`,name}))},null,2));
  } else {
    assert.equal(process.argv[2],'--apply');assert.equal(process.argv[3],project,'Pass the exact project ID to authorize the reset');
    assert.ok(!existsSync(credentialPath),'Reset already started. Inspect the saved status before retrying.');
    const backup=path.join(homedir(),'.codex','backups','ModernSecure',new Date().toISOString().replaceAll(':','-'));
    mkdirSync(backup,{recursive:true,mode:0o700});
    const snapshot={project,createdAt:new Date().toISOString(),tables:{},storageObjects:objects};
    const allTables=(await db.query("select schemaname,tablename from pg_tables where schemaname in ('public','private','auth') order by 1,2")).rows;
    await db.query('begin isolation level repeatable read read only'); transaction=true;
    for(const t of allTables) snapshot.tables[`${t.schemaname}.${t.tablename}`]=(await db.query(`select * from ${identifier(t.schemaname)}.${identifier(t.tablename)}`)).rows;
    await db.query('commit');transaction=false;
    writeFileSync(path.join(backup,'data.json'),JSON.stringify(snapshot,null,2),{mode:0o600});
    if(existsSync('.test-accounts.local.json')) writeFileSync(path.join(backup,'previous-test-accounts.json'),readFileSync('.test-accounts.local.json'),{mode:0o600});
    const manifest=[];
    for(const obj of objects) {
      const {data,error}=await admin.storage.from(obj.bucket_id).download(obj.name);assert.ifError(error);
      const content=Buffer.from(await data.arrayBuffer());
      const file=`${obj.id}.bin`;writeFileSync(path.join(backup,file),content,{mode:0o600});
      manifest.push({bucket:obj.bucket_id,name:obj.name,file,bytes:content.length,sha256:createHash('sha256').update(content).digest('hex')});
    }
    writeFileSync(path.join(backup,'files.json'),JSON.stringify(manifest,null,2),{mode:0o600});
    const saved={project,status:'backed_up',backup,createdAt:new Date().toISOString(),oldUserIds:oldUsers,accounts:Object.fromEntries(definitions.map(([key,name,role])=>[key,{name,role,is_primary_admin:key==='owner',email:`${key}@modernsecure.test`,password:randomBytes(24).toString('base64url'),id:null}]))};
    save(saved);console.log(`Backup complete: ${oldUsers.length} users, ${objects.length} files; ${backup}`);
    // The hierarchy migration is a separately tested, transactional schema change.
    const migration='20261017008400';
    if(!(await db.query('select 1 from supabase_migrations.schema_migrations where version=$1',[migration])).rowCount) {
      const sql=readFileSync(`supabase/migrations/${migration}_primary_administrator.sql`,'utf8');
      await db.query('begin');transaction=true;await db.query(sql);
      await db.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)',[migration,'primary_administrator',[sql]]);
      await db.query('commit');transaction=false;
    }
    saved.status='creating_accounts';save(saved);
    for(const account of Object.values(saved.accounts)) {
      const {data,error}=await admin.auth.admin.createUser({email:account.email,password:account.password,email_confirm:true,user_metadata:{display_name:account.name}});
      assert.ifError(error);assert.ok(data.user?.id);account.id=data.user.id;save(saved);
    }
    await db.query('begin');transaction=true;
    await db.query("set local lock_timeout='15s'");
    await db.query(`truncate table ${tables.map(t=>'public.'+identifier(t)).join(',')}, private.staff_work_settings restart identity`);
    for(const account of Object.values(saved.accounts)) await db.query('insert into public.profiles(user_id,email,display_name) values($1,$2,$3)',[account.id,account.email,account.name]);
    for(const account of Object.values(saved.accounts).filter(x=>x.role)) await db.query('insert into public.staff_members(user_id,display_name,role,is_primary_admin,can_confirm_payments) values($1,$2,$3,$4,$5)',[account.id,account.name,account.role,account.is_primary_admin,account.role==='admin']);
    const client=saved.accounts.client;
    saved.client_card_id=(await db.query('insert into public.clients(user_id,full_name,email,linked_by,linked_at) values($1,$2,$3,$4,now()) returning id',[client.id,client.name,client.email,saved.accounts.owner.id])).rows[0].id;
    await db.query('insert into private.staff_work_settings(id) values(true)');
    await db.query('commit');transaction=false;
    saved.status='data_cleared';save(saved);
    for(const bucket of ['modernsecure-files','modernsecure-previews']) {
      const paths=objects.filter(x=>x.bucket_id===bucket).map(x=>x.name);
      for(let i=0;i<paths.length;i+=100) {const {error}=await admin.storage.from(bucket).remove(paths.slice(i,i+100));assert.ifError(error);}
    }
    saved.status='files_cleared';save(saved);
    for(const id of oldUsers) {const {error}=await admin.auth.admin.deleteUser(id);assert.ifError(error);}
    await db.query('delete from auth.audit_log_entries');
    assert.equal(Number((await db.query('select count(*) from auth.users')).rows[0].count),5);
    assert.equal(Number((await db.query('select count(*) from storage.objects')).rows[0].count),0);
    for(const table of tables.filter(t=>!['profiles','staff_members','clients'].includes(t))) assert.equal(Number((await db.query(`select count(*) from public.${identifier(table)}`)).rows[0].count),0,`${table} is not empty`);
    saved.status='ready';delete saved.oldUserIds;save(saved);
    if(existsSync('.test-accounts.local.json'))unlinkSync('.test-accounts.local.json');
    console.log('Reset verified: 5 accounts, 4 staff members, 1 client card, 0 cases/messages/files; credentials saved privately.');
  }
} finally {if(transaction)await db.query('rollback').catch(()=>{});await db.end();}
