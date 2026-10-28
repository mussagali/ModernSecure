import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const sql = name => readFileSync(new URL(`../supabase-upload/${name}`, import.meta.url), 'utf8');
const db = new PGlite();
const operator = '10000000-0000-4000-8000-000000000001';
const client = '10000000-0000-4000-8000-000000000002';
const other = '10000000-0000-4000-8000-000000000003';
async function as(user, query, params = []) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [user,JSON.stringify({ sub:user,role:'authenticated',aal:'aal1' })]);
  await db.exec('set role authenticated');
  try { return await db.query(query,params); } finally { await db.exec('reset role'); }
}
try {
  // Supabase-managed schemas simulated locally; pg_cron and Storage HTTP are not emulated.
  await db.exec(`create role anon; create role authenticated; create role service_role; create role authenticator;
    create schema auth; create schema storage; create schema extensions;
    create function extensions.digest(text,text) returns bytea language sql as $$ select pg_catalog.sha256(convert_to($1,'UTF8')) $$;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table auth.mfa_factors(id uuid primary key,user_id uuid,status text);
    create table auth.sessions(id uuid,user_id uuid,aal text,not_after timestamptz);
    create table auth.audit_log_entries(id uuid,created_at timestamptz,payload jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
    grant usage on schema auth,public to authenticated;
    grant execute on function auth.uid(),auth.jwt() to authenticated;
    create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,metadata jsonb,user_metadata jsonb,primary key(bucket_id,name));
    create publication supabase_realtime;
  `);
  await db.query("insert into auth.users values($1,'operator@example.test',now())",[operator]);
  await db.exec(sql('00_INSPECT.sql'));
  await db.exec(sql('01_INSTALL_SCHEMA.sql'));
  const rpcNames = new Set();
  for (const directory of ['app','lib']) {
    const sourceRoot = fileURLToPath(new URL(`../${directory}/`,import.meta.url));
    for (const file of readdirSync(sourceRoot,{ recursive:true }).filter(name => /\.tsx?$/.test(name))) {
      const source = readFileSync(path.join(sourceRoot,file),'utf8');
      for (const match of source.matchAll(/\.rpc\(\s*["']([a-z_]+)["']/g)) rpcNames.add(match[1]);
    }
  }
  const functions = new Set((await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")).rows.map(row=>row.proname));
  for (const rpc of rpcNames) assert.ok(functions.has(rpc),`Missing application RPC: ${rpc}`);
  console.log(`PASS: all ${rpcNames.size} literal application RPC names exist`);
  assert.equal((await db.query('select count(*)::int n from public.staff_members')).rows[0].n,0,'No hard-coded owner');
  assert.equal((await db.query('select count(*)::int n from public.profiles')).rows[0].n,1,'Existing Auth user backfilled');
  await db.exec(sql('02_CREATE_OPERATOR.sql').replaceAll('REPLACE_OPERATOR_UUID',operator));
  await db.exec(sql('02_CREATE_OPERATOR.sql').replaceAll('REPLACE_OPERATOR_UUID',operator));
  await db.query("insert into auth.users values($1,'client@example.test',now()),($2,'other@example.test',now())",[client,other]);
  const link = sql('03_LINK_CLIENT.sql').replaceAll('REPLACE_OPERATOR_UUID',operator)
    .replaceAll("'REPLACE_CLIENT_EMAIL'","'client@example.test'")
    .replaceAll("'REPLACE_CLIENT_FULL_NAME'","'Test Client'");
  await db.exec(link);
  await db.exec(link);
  assert.equal((await db.query('select count(*)::int n from public.clients')).rows[0].n,1,'Linking is repeat-safe');
  const card = (await db.query('select id from public.clients')).rows[0].id;
  const createCase = sql('04_CREATE_CASE.sql').replaceAll('REPLACE_OPERATOR_UUID',operator)
    .replaceAll('REPLACE_CLIENT_CARD_UUID',card).replaceAll("'REPLACE_CASE_TITLE'","'Test Case'")
    .replaceAll("'REPLACE_SERVICE_NAME'","'Test Service'");
  await db.exec(createCase);
  const caseId = (await db.query('select id from public.cases')).rows[0].id;
  assert.equal((await as(client,'select id from public.cases')).rows.length,1);
  assert.equal((await as(other,'select id from public.cases')).rows.length,0);
  assert.equal((await as(other,'select id from public.cases where id=$1',[caseId])).rows.length,0);
  assert.equal((await as(client,'select public.staff_mfa_status() s')).rows[0].s,null);
  await assert.rejects(as(client,"select public.staff_create_case($1,(select service_version_id from public.cases limit 1),'Illegal')",[card]),/Not authorized|permission denied/);
  const task = (await as(operator,"select public.staff_create_task($1,'answer','Test question','Reply',null) id",[caseId])).rows[0].id;
  await assert.rejects(as(other,"select public.client_respond_task($1,'Other reply')",[task]),/Not authorized/);
  await as(client,"select public.client_respond_task($1,'Client reply')",[task]);
  assert.equal((await as(client,'select status from public.tasks where id=$1',[task])).rows[0].status,'response_sent');
  assert.equal((await as(other,'select id from public.tasks')).rows.length,0);
  const message = (await as(client,"select public.post_case_message($1,'Test message','test-upload-package-1') id",[caseId])).rows[0].id;
  const replay = (await as(client,"select public.post_case_message($1,'Test message','test-upload-package-1') id",[caseId])).rows[0].id;
  assert.equal(message,replay,'Message retries are idempotent');
  assert.equal((await as(other,'select id from public.messages where id=$1',[message])).rows.length,0);
  await assert.rejects(as(other,"select public.post_case_message($1,'Not my case','test-upload-package-2')",[caseId]),/Not authorized/);
  await assert.rejects(as(client,"update public.cases set title='Illegal' where id=$1 returning id",[caseId]),/permission denied/);
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from public.clients'),/permission denied/);
  await db.exec('reset role');
  await db.exec(sql('05_VERIFY.sql'));
  await assert.rejects(db.exec(sql('01_INSTALL_SCHEMA.sql')),/STOP: public\/private already contains/);
  await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int n from public.cases')).rows[0].n,1,'Repeat install preserves existing cases');
  await assert.rejects(db.exec(createCase),/already exists/);
  await db.exec('rollback');
  const counts = (await db.query("select (select count(*)::int from pg_tables where schemaname='public') tables,(select count(*)::int from pg_policies where schemaname='public') policies")).rows[0];
  console.log('PASS: full install, operator, linked client, case, RLS isolation, task response, anonymous denial, repeat protection',counts);
} catch(error) {
  console.error(error.message);
  process.exitCode=1;
} finally { await db.close(); }
