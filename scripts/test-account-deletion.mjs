// Fully isolated; never connects to a server or deletes a real account.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const id = n => `81000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function as(actor, sql, values = [], aal = 'aal1') {
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)", [actor ? id(actor) : '', JSON.stringify({ sub: actor ? id(actor) : null, role: 'authenticated', aal })]);
  await db.exec('set role authenticated');
  try { return await db.query(sql, values); } finally { await db.exec('reset role'); }
}
const remove = (actor, target, email = `account${target}@example.test`, reason = 'Isolated deletion test', aal = 'aal1') => as(actor, 'select public.primary_delete_account($1,$2,$3)', [id(target), email, reason], aal);
const count = async (table, where = 'true', values = []) => Number((await db.query(`select count(*) as n from ${table} where ${where}`, values)).rows[0].n);

try {
  await db.exec(`create role anon; create role authenticated; create role service_role; create role authenticator;
    create schema auth; create schema storage; create schema extensions;
    create function extensions.digest(text,text) returns bytea language sql as $$ select pg_catalog.sha256(convert_to($1, 'UTF8')) $$;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create table auth.mfa_factors(id uuid primary key, user_id uuid references auth.users(id) on delete cascade, status text);
    create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id) on delete cascade, aal text, not_after timestamptz);
    create table auth.refresh_tokens(id uuid primary key, user_id text, session_id uuid references auth.sessions(id) on delete cascade);
    create table auth.identities(id uuid primary key, user_id uuid references auth.users(id) on delete cascade);
    create table auth.audit_log_entries(id uuid, created_at timestamptz, payload jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
    grant usage on schema auth,public to authenticated;
    grant execute on function auth.uid(),auth.jwt() to authenticated;
    create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,metadata jsonb,user_metadata jsonb,primary key(bucket_id,name));
    create publication supabase_realtime;`);
  const files = readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).sort();
  for (const file of files) {
    if (file === '20261011000800_role_boundaries.sql') {
      await db.query("insert into auth.users values($1,'ayanz2008@gmail.com',now())", [id(1)]);
      await db.query("insert into public.staff_members(user_id,display_name,role) values($1,'Primary admin','admin')", [id(1)]);
    }
    try { await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8')); }
    catch (error) { throw new Error(`${file}: ${error.message}`); }
  }
  for (const n of [2, 3, 4, 5, 6, 7]) await db.query('insert into auth.users values($1,$2,now())', [id(n), `account${n}@example.test`]);
  await db.query("insert into public.staff_members(user_id,display_name,role,mfa_required) values($1,'Ordinary admin','admin',false),($2,'Historical lawyer','lawyer',false),($3,'Assigned lawyer','lawyer',false)", [id(2), id(3), id(4)]);
  await db.query("update public.profiles set display_name='Original client' where user_id=$1", [id(5)]);
  await db.query("insert into public.clients(id,user_id,full_name,linked_by,linked_at) values($1,$2,'Original client',$3,now())", [id(100), id(5), id(1)]);
  await db.query("insert into public.service_templates(id,code,name) values($1,'DELETE-QA','Deletion test')", [id(101)]);
  await db.query('insert into public.service_template_versions(id,service_id,version_no) values($1,$2,1)', [id(102), id(101)]);
  await db.query("insert into public.cases(id,case_number,client_id,service_version_id,title) values($1,'DELETE-1',$2,$3,'Preserved company case')", [id(103), id(100), id(102)]);
  await db.query('insert into public.case_assignments(id,case_id,staff_user_id,assigned_by) values($1,$2,$3,$4)', [id(104), id(103), id(4), id(1)]);
  await db.query("insert into public.document_requests(id,case_id,title,created_by) values($1,$2,'Preserved request',$3)", [id(105), id(103), id(3)]);
  await db.query("insert into public.document_files(id,request_id,version_no,file_position,storage_path,original_name,detected_mime_type,size_bytes,status,uploaded_by,reviewed_by,reviewed_at,content_sha256) values($1,$2,1,1,'documents/retained.pdf','retained.pdf','application/pdf',100,'accepted',$3,$4,now(),$5)", [id(106), id(105), id(5), id(3), 'a'.repeat(64)]);
  await db.query("insert into storage.objects values('modernsecure-files','documents/retained.pdf','{}','{}')");
  await db.query("insert into public.messages(id,case_id,sender_user_id,body,idempotency_key) values($1,$2,$3,'Preserved client message','delete-1'),($4,$2,$5,'Preserved staff message','delete-2')", [id(107), id(103), id(5), id(108), id(3)]);
  await db.query("insert into public.audit_events(actor_user_id,case_id,entity_type,entity_id,action) values($1,$2,'case',$2,'created'),($3,$2,'message',$4,'sent')", [id(3), id(103), id(5), id(107)]);
  await db.query("insert into public.consent_records(user_id,document_type,version,document_hash) values($1,'privacy','fixture','hash')", [id(5)]);
  await db.query("insert into public.staff_invites(email,display_name,role,created_by) values('account5@example.test','Pending invitation','lawyer',$1)", [id(1)]);
  for (const n of [3, 5, 6]) {
    await db.query("insert into auth.sessions values($1,$2,'aal1',null)", [id(n + 200), id(n)]);
    await db.query('insert into auth.refresh_tokens values($1,$2,$3),($4,$2,null)', [id(n + 300), id(n), id(n + 200), id(n + 400)]);
    await db.query('insert into auth.identities values($1,$2)', [id(n + 500), id(n)]);
    await db.query("insert into auth.mfa_factors values($1,$2,'unverified')", [id(n + 600), id(n)]);
  }
  for (const actor of [3, 5]) {
    await db.query("insert into public.document_requests(id,case_id,title) values($1,$2,'Pending retained upload')", [id(700 + actor), id(103)]);
    await db.query("insert into public.upload_sessions(request_id,uploader_user_id,idempotency_key,expires_at) values($1,$2,$3,now()+interval '1 hour')", [id(700 + actor), id(actor), `retained-${actor}`]);
    await db.query("insert into public.portal_requests(user_id,kind,subject,body) values($1,'director','Historical submission','Retained private body')", [id(actor)]);
  }
  const before = {};
  for (const table of ['cases', 'document_files', 'messages', 'audit_events', 'consent_records', 'upload_sessions', 'portal_requests']) before[table] = (await db.query(`select to_jsonb(t) as value from public.${table} t order by id`)).rows.map(row => row.value);

  await assert.rejects(remove(null, 6), /Not authorized/);
  await assert.rejects(remove(2, 6), /Not authorized/);
  await assert.rejects(remove(3, 6), /Not authorized/);
  await assert.rejects(remove(5, 6), /Not authorized/);
  await assert.rejects(remove(1, 1, 'ayanz2008@gmail.com'), /account_protected/);
  await assert.rejects(remove(2, 1, 'ayanz2008@gmail.com'), /Not authorized/);
  await assert.rejects(remove(1, 4), /account_active_assignments/);
  await assert.rejects(remove(1, 6, 'wrong@example.test'), /account_confirmation_mismatch/);
  await assert.rejects(remove(1, 6, undefined, ''), /account_invalid_reason/);
  await assert.rejects(as(2, 'select public.primary_account_directory()'), /Not authorized/);
  await assert.rejects(as(1, 'select * from private.account_actors'), /permission denied/);
  assert.equal((await as(1, "select public.primary_account_directory('account6',999) as data")).rows[0].data.page, 1);

  // Existing MFA policy is rechecked by SQL, even when the UI is bypassed.
  await db.query("insert into auth.mfa_factors values($1,$2,'verified')", [id(900), id(1)]);
  await assert.rejects(remove(1, 6), /Not authorized/);
  await db.query('delete from auth.mfa_factors where id=$1', [id(900)]);

  // An unexpected external FK must fail the whole operation, without false success.
  await db.exec('create table public.deletion_blocker(user_id uuid references auth.users(id) on delete restrict)');
  await db.query('insert into public.deletion_blocker values($1)', [id(6)]);
  await assert.rejects(remove(1, 6), /foreign key constraint/);
  assert.equal(await count('public.profiles', 'user_id=$1', [id(6)]), 1);
  assert.equal(await count('auth.sessions', 'user_id=$1', [id(6)]), 1);
  assert.equal(await count('private.account_actors', 'user_id=$1 and deleted_at is null', [id(6)]), 1);
  await db.exec('drop table public.deletion_blocker');

  await remove(1, 5); // Client with a case, accepted document, message, consent and audit.
  await remove(1, 3); // Staff with retained document review, messages and audit attribution.
  await remove(1, 6); // Pending registration.
  for (const n of [3, 5, 6]) {
    assert.equal(await count('auth.users', 'id=$1', [id(n)]), 0);
    assert.equal(await count('public.profiles', 'user_id=$1', [id(n)]), 0);
    for (const table of ['sessions', 'refresh_tokens', 'identities', 'mfa_factors']) assert.equal(await count(`auth.${table}`, 'user_id::text=$1', [id(n)]), 0);
    assert.equal(await count('private.account_actors', 'user_id=$1 and deleted_at is not null', [id(n)]), 1);
  }
  const card = (await db.query('select user_id,linked_by,linked_at,full_name from public.clients where id=$1', [id(100)])).rows[0];
  assert.deepEqual(card, { user_id: null, linked_by: null, linked_at: null, full_name: 'Original client' });
  assert.equal(await count('storage.objects'), 1);
  assert.equal(await count('public.staff_invites', "email='account5@example.test' and status='cancelled'"), 1);
  assert.equal(await count('public.staff_members', 'user_id=$1 and not active and deleted_at is not null', [id(3)]), 1);
  await assert.rejects(as(1, "select public.admin_set_staff_access($1,'lawyer',true,'Cannot resurrect')", [id(3)]), /deleted_staff_cannot_activate/);
  await assert.rejects(remove(1, 6), /account_not_found/);
  for (const table of ['cases', 'document_files', 'messages', 'consent_records', 'upload_sessions', 'portal_requests']) assert.deepEqual((await db.query(`select to_jsonb(t) as value from public.${table} t order by id`)).rows.map(row => row.value), before[table]);
  const audit = (await db.query('select to_jsonb(t) as value from public.audit_events t order by id')).rows.map(row => row.value);
  for (const old of before.audit_events) assert.deepEqual(audit.find(row => row.id === old.id), old);
  assert.equal(audit.filter(row => row.action === 'account_deleted').length, 3);
  const authors = (await as(1, 'select * from public.case_message_authors($1)', [id(103)])).rows;
  assert.equal(authors.find(row => row.user_id === id(5)).display_name, 'Original client');
  assert.equal((await as(3, 'select public.account_access_status() as status')).rows[0].status, 'disabled');
  assert.equal((await as(5, 'select count(*) as n from public.cases')).rows[0].n, 0);
  // Retained historical rows must never remain readable/writable with a stale JWT.
  for (const actor of [3, 5]) {
    for (const path of ['rpc/account_access_status', 'rpc/staff_mfa_status', 'rpc/claim_staff_invite', 'rpc/accept_client_consents', 'consent_records', 'legal_documents']) {
      await db.query("select set_config('request.path',$1,false)", [path]);
      await assert.rejects(as(actor, 'select public.enforce_staff_mfa_request()'), /ACCOUNT_REMOVED/);
    }
    assert.equal((await as(actor, 'select count(*) as n from public.consent_records')).rows[0].n, 0);
    assert.equal((await as(actor, 'select count(*) as n from public.staff_members')).rows[0].n, 0);
    for (const table of ['upload_sessions', 'portal_requests']) assert.equal((await as(actor, `select count(*) as n from public.${table}`)).rows[0].n, 0);
    await assert.rejects(as(actor, "select public.accept_client_consents('{}'::uuid[])"), /Not authorized/);
  }
  // Exercise the restrictive Storage policy with an intentionally broad fixture-only grant.
  await db.exec("alter table storage.objects enable row level security; grant usage on schema storage to authenticated; grant select on storage.objects to authenticated; create policy deletion_fixture_storage on storage.objects for select to authenticated using (true)");
  assert.equal((await as(5, 'select count(*) as n from storage.objects')).rows[0].n, 0);
  assert.equal((await as(1, 'select count(*) as n from storage.objects')).rows[0].n, 1);
  // Anonymous public pages and service requests retain their normal bypass; no user data granted.
  await db.query("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{\"role\":\"anon\"}',false)");
  await db.query('select public.enforce_staff_mfa_request()');
  await db.query("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)");
  await db.query('select public.enforce_staff_mfa_request()');
  await assert.rejects(db.query("update public.messages set body='rewrite' where id=$1", [id(107)]), /immutable/);
  await assert.rejects(db.query('delete from public.audit_events where actor_user_id=$1', [id(3)]), /append-only/);
  await assert.rejects(db.query('delete from public.document_files where id=$1', [id(106)]), /immutable/);
  console.log('PASS isolated deletion: primary-only/MFA/self/assignment/confirmation guards; atomic failure rollback; Auth/profile/sessions/tokens removed; immutable company history/files and attribution preserved; deleted staff cannot reactivate');
} finally { await db.close(); }
