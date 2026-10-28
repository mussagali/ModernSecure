import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { pushMessage, classifyPushResponse } from '../lib/push.ts';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const uid = n => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function as(n, sql, params = [], aal = 'aal2') {
  const user = uid(n);
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)", [user, JSON.stringify({ sub:user, role:'authenticated', aal, session_id: uid(n+100) })]);
  await db.exec('set role authenticated');
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
try {
  await db.exec(`create role anon; create role authenticated; create role service_role; create role authenticator;
    create schema auth; create schema storage; create schema extensions;
    create function extensions.digest(text,text) returns bytea language sql as $$ select pg_catalog.sha256(convert_to($1, 'UTF8')) $$;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create table auth.mfa_factors(id uuid primary key, user_id uuid, status text);
    create table auth.sessions(id uuid, user_id uuid, aal text, not_after timestamptz);
    create table auth.audit_log_entries(id uuid, created_at timestamptz, payload jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
    grant usage on schema auth,public to authenticated;
    grant execute on function auth.uid(),auth.jwt() to authenticated;
    create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,metadata jsonb,user_metadata jsonb,primary key(bucket_id,name));
    create publication supabase_realtime;
  `);

  for (const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) {
    if(file.includes('0008')) {
      await db.query('insert into auth.users values($1,$2,now())',[uid(1),'ayanz2008@gmail.com']);
      await db.query("insert into public.staff_members(user_id,display_name,role) values($1,'Owner','admin')",[uid(1)]);
    }
    try { await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8')); }
    catch(e) { throw new Error(`${file}: ${e.message}`); }
  }

  for(let n=2;n<=5;n++) await db.query('insert into auth.users values($1,$2,now())',[uid(n),`user${n}@example.test`]);
  for(let n=1;n<=5;n++) await db.query("insert into auth.sessions values($1,$2,'aal2',null)",[uid(n+100),uid(n)]);
  await db.query("insert into public.staff_members(user_id,display_name,role) values($1,'Lawyer','lawyer'),($2,'Manager','manager')",[uid(2),uid(3)]);
  const register = (n,device,secret,token) => as(n,"select public.register_push_device($1,$2,$3,'android')",[uid(device),uid(secret),token]);
  const token='token-placeholder-at-least-20-characters';
  await assert.rejects(register(4,200,300,token),/Not authorized/);
  await register(2,200,300,token);
  await assert.rejects(register(3,200,301,token),/Invalid installation secret/);
  const notice = async(n) => (await db.query("insert into public.notifications(recipient_user_id,kind,title,body) values($1,'message','Private case','Sensitive details') returning id",[uid(n)])).rows[0].id;
  const first=await notice(2);
  let batch=await db.query('select * from public.claim_push_batch()');
  assert.equal(batch.rows.length,1);
  assert.equal(batch.rows[0].notification_id,first);
  assert.equal((await db.query('select * from public.claim_push_batch()')).rows.length,0,'Leased work cannot be claimed twice');
  await db.query("select public.finish_push_delivery($1,$2,'sent')",[batch.rows[0].id,uid(999)]);
  assert.equal((await db.query('select completed_at from public.push_outbox where id=$1',[batch.rows[0].id])).rows[0].completed_at,null,'Stale lease cannot acknowledge');
  await db.query("select public.finish_push_delivery($1,$2,'retry')",[batch.rows[0].id,batch.rows[0].lease_id]);
  await db.exec("update public.push_outbox set next_attempt_at=now()-interval '1 second'");
  batch=await db.query('select * from public.claim_push_batch()');
  assert.equal(batch.rows.length,1);
  await db.query("select public.finish_push_delivery($1,$2,'sent')",[batch.rows[0].id,batch.rows[0].lease_id]);
  await notice(2);
  await as(2,'select public.unregister_push_session()');
  assert.equal((await db.query('select * from public.claim_push_batch()')).rows.length,0,'Logout cancels delivery');
  await register(2,200,300,token); await notice(2);
  await register(3,200,300,token);
  assert.equal((await db.query('select * from public.claim_push_batch()')).rows.length,0,'Account switching cannot deliver previous user notifications');
  await notice(3);
  await db.query('delete from auth.sessions where user_id=$1',[uid(3)]);
  assert.equal((await db.query('select * from public.claim_push_batch()')).rows.length,0,'Revoked session cancels delivery');
  await register(2,200,300,token); await notice(2);
  await db.query('update public.staff_members set active=false where user_id=$1',[uid(2)]);
  assert.equal((await db.query('select * from public.claim_push_batch()')).rows.length,0,'Blocked staff cannot receive pushes');
  await assert.rejects(as(2,'select * from public.push_devices'),/permission denied/);
  await assert.rejects(as(2,'select * from public.claim_push_batch()'),/permission denied/);
  const payload=pushMessage({token,notification_id:first,platform:'ios'});
  assert.deepEqual(payload.message.data,{notificationId:first});
  assert.equal(JSON.stringify(payload).includes('Sensitive'),false);
  assert.equal(classifyPushResponse(200),'sent');assert.equal(classifyPushResponse(404,'UNREGISTERED'),'invalid_token');
  for(const code of [401,403,429,500,503]) assert.equal(classifyPushResponse(code),'retry');
  assert.equal(classifyPushResponse(400,'INVALID_ARGUMENT'),'failed');
  console.log('OK push isolation, session revocation, account switching, leases/retry, private payloads and provider errors');
} finally { await db.close(); }
