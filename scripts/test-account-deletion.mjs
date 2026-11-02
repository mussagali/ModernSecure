import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const uid = n => `92000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function as(n, sql, params = [], aal = 'aal2') {
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [n ? uid(n) : '', JSON.stringify({sub: n ? uid(n) : '', role:'authenticated', aal, session_id:uid(n+100)})]);
  await db.exec('set role authenticated');
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
try {
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
    create publication supabase_realtime;`);
  for (const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) {
    if (file.includes('0008')) {
      await db.query('insert into auth.users values($1,$2,now())',[uid(1),'ayanz2008@gmail.com']);
      await db.query("insert into public.staff_members(user_id,display_name,role) values($1,'Owner','admin')",[uid(1)]);
    }
    try { await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8')); }
    catch(error) { throw new Error(`${file}: ${error.message}`); }
  }
  for (let n=2;n<=4;n++) await db.query('insert into auth.users values($1,$2,now())',[uid(n),`privacy${n}@example.test`]);
  await db.query("insert into public.staff_members(user_id,display_name,role,active) values($1,'Disabled staff','lawyer',false),($2,'Ordinary admin','admin',true)",[uid(3),uid(4)]);
  for (let n=1;n<=4;n++) await db.query("insert into auth.sessions values($1,$2,'aal2',null)",[uid(n+100),uid(n)]);
  const request = (await as(2,'select public.request_own_account_deletion() as id',[],'aal1')).rows[0].id;
  assert.equal((await as(2,'select public.request_own_account_deletion() as id')).rows[0].id,request,'Repeat click must be idempotent');
  assert.equal((await as(2,'select public.own_account_deletion_request() as r')).rows[0].r.id,request);
  assert.equal((await as(3,'select public.own_account_deletion_request() as r')).rows[0].r,null,'Another user must not see the request');
  await as(3,'select public.request_own_account_deletion()',[],'aal1');
  await assert.rejects(as(0,'select public.request_own_account_deletion()'),/Not authorized/);
  await assert.rejects(as(2,'select * from public.account_deletion_requests'),/permission denied/);
  await assert.rejects(as(2,"insert into public.account_deletion_requests(user_id,requester_email) values($1,'forged@example.test')",[uid(3)]),/permission denied/);
  for (const n of [2,3,4]) await assert.rejects(as(n,'select * from public.admin_account_deletion_requests()'),/Not authorized/);
  const rows=(await as(1,'select * from public.admin_account_deletion_requests()')).rows;
  assert.equal(rows.length,2);
  assert.equal(rows.find(r=>r.id===request).requester_email,'privacy2@example.test');
  assert.equal((await db.query("select count(*)::int as n from public.notifications where kind='account_deletion_request'")).rows[0].n,2,'One notice per distinct request');
  await assert.rejects(as(1,"select public.admin_update_account_deletion($1,'completed','Done',true)",[request]),/Invalid/);
  await assert.rejects(as(1,"select public.admin_update_account_deletion($1,'completed','Detailed operator response for the user',false)",[request]),/Invalid/);
  await as(1,"select public.admin_update_account_deletion($1,'in_progress','Processing the request',false)",[request]);
  assert.equal((await as(2,'select public.own_account_deletion_request() as r')).rows[0].r.status,'in_progress');
  const response='Operator records actual manual processing and confirmation sent to the user';
  await as(1,"select public.admin_update_account_deletion($1,'completed',$2,true)",[request,response]);
  const completed=(await as(2,'select public.own_account_deletion_request() as r')).rows[0].r;
  assert.equal(completed.status,'completed');
  assert.ok(completed.completed_at);
  assert.equal(completed.response,response);
  await assert.rejects(as(1,"select public.admin_update_account_deletion($1,'in_progress','Attempt to rewrite a completed request',false)",[request]),/Request unavailable/);
  await db.query("insert into auth.mfa_factors values($1,$2,'verified')",[uid(500),uid(1)]);
  await assert.rejects(as(1,'select * from public.admin_account_deletion_requests()',[],'aal1'),/Not authorized/);
  for (const n of [1,2,3]) {
    for (const path of ['rpc/request_own_account_deletion','rpc/own_account_deletion_request']) {
      await as(n,"select set_config('request.path',$1,false)",[path],'aal1');
      await as(n,'select public.enforce_staff_mfa_request()',[],'aal1');
    }
  }
  await as(2,"select set_config('request.path','cases',false)");
  await assert.rejects(as(2,'select public.enforce_staff_mfa_request()'),/Account approval is required/);
  console.log('PASS: own-only idempotent privacy requests, admin/MFA guards, notifications, manual completion checks and safe login return');
} finally { await db.close(); }
