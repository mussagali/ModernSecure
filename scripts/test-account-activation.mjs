import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const uid = n => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function as(n, sql, params = [], aal = 'aal2') {
  const user = uid(n);
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)", [user, JSON.stringify({ sub:user, role:'authenticated', aal })]);
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
  for (let n=2;n<=10;n++) await db.query('insert into auth.users values($1,$2,$3)', [uid(n), `user${n}@example.test`, n===7 ? null : new Date()]);
  await db.query("insert into public.staff_members(user_id,display_name,role,is_primary_admin) values($1,'Admin','admin',false),($2,'Manager','manager',false)",[uid(2),uid(3)]);
  for (const n of [2,3,4]) {
    await assert.rejects(as(n,'select public.admin_pending_accounts()'), /Not authorized/);
    await assert.rejects(as(n,"select public.admin_approve_account($1,'admin','Escalation')",[uid(4)]), /Not authorized/);
    await assert.rejects(as(n,"select public.admin_add_staff('user4@example.test','Escalation','lawyer')"), /Not authorized/);
    await assert.rejects(as(n,"select public.admin_invite_staff('user4@example.test','Escalation','lawyer')"), /Not authorized/);
    await assert.rejects(as(n,"select public.admin_set_staff_access($1,'lawyer',true,'Escalation')",[uid(3)]), /Not authorized/);
    await assert.rejects(as(n,"select public.link_client_account($1,'user4@example.test')",[uid(99)]), /Not authorized/);
  }
  assert.equal((await as(4,'select public.account_access_status() as status')).rows[0].status,'pending');
  assert.equal((await as(4,'select * from public.cases')).rows.length,0);
  await as(4,"select set_config('request.path','rpc/update_own_profile',false)");
  await assert.rejects(as(4,'select public.enforce_staff_mfa_request()'), /Account approval is required/);
  for (const path of ['rpc/account_access_status','rpc/staff_mfa_status','contact_settings','legal_documents']) {
    await as(4,"select set_config('request.path',$1,false)",[path]);
    await as(4,'select public.enforce_staff_mfa_request()');
  }
  assert.equal((await as(1,'select count(*)::int as n from public.admin_pending_accounts()')).rows[0].n,7);
  await assert.rejects(as(1,"select public.admin_approve_account($1,'client','Unverified')",[uid(7)]), /Verified account not found/);
  await as(1,"select public.admin_invite_staff('user5@example.test','Lawyer','lawyer')");
  assert.equal((await as(5,'select public.claim_staff_invite() as claimed')).rows[0].claimed,false);
  assert.equal((await as(5,'select public.account_access_status() as status')).rows[0].status,'pending');
  await as(1,"select public.admin_approve_account($1,'lawyer','Lawyer')",[uid(5)]);
  assert.equal((await as(5,'select public.account_access_status() as status')).rows[0].status,'approved');
  await as(1,"select public.admin_approve_account($1,'client','Client')",[uid(4)]);
  const card=(await as(4,'select id from public.clients where user_id=$1',[uid(4)])).rows[0].id;
  assert.ok(card);
  await assert.rejects(as(1,"select public.admin_approve_account($1,'admin','Again')",[uid(4)]),/Account already assigned/);
  await assert.rejects(as(1,"select public.admin_approve_account($1,'client','Wrong client',$2)",[uid(6),card]),/Client card is unavailable/);
  const unlinked=(await as(3,"select public.staff_create_client('Existing','user6@example.test') as id")).rows[0].id;
  await as(1,"select public.admin_approve_account($1,'client','Existing',$2)",[uid(6),unlinked]);
  assert.equal((await as(6,'select public.account_access_status() as status')).rows[0].status,'approved');
  await as(1,"select public.admin_approve_account($1,'admin','Another admin')",[uid(8)]);
  assert.equal((await as(8,'select is_primary_admin from public.staff_members where user_id=$1',[uid(8)])).rows[0].is_primary_admin,false);
  await assert.rejects(as(8,"select public.admin_approve_account($1,'client','Client')",[uid(9)]),/Not authorized/);
  await as(1,"select public.admin_set_staff_access($1,'lawyer',false,'Test disable')",[uid(5)]);
  assert.equal((await as(5,'select public.account_access_status() as status')).rows[0].status,'disabled');
  await db.query("insert into auth.mfa_factors values(gen_random_uuid(),$1,'verified')",[uid(1)]);
  await assert.rejects(as(1,"select public.admin_approve_account($1,'client','Client')",[uid(9)],'aal1'),/Not authorized/);
  await assert.rejects(as(4,'select private.admin_add_staff($1,$2,$3)',['user9@example.test','Bypass','lawyer']), /permission denied/);
  assert.equal((await db.query("select count(*)::int as n from public.audit_events where entity_type='account' and action='approved'")).rows[0].n,4);
  console.log('OK account activation: primary-only RPCs, MFA, pending API gate, email verification, invitations, roles, existing cards, duplicate/dual-role rejection and audit');
} finally { await db.close(); }
