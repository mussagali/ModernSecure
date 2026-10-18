import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { parseAlmatyDeadline } from '../lib/deadlines.ts';
import { safeAccountReturn } from '../lib/return-path.ts';

for (const tz of ['UTC', 'Asia/Seoul', 'Asia/Almaty', 'America/New_York']) {
  process.env.TZ = tz;
  assert.equal(parseAlmatyDeadline('2026-10-20T10:00'), '2026-10-20T05:00:00.000Z');
  assert.equal(parseAlmatyDeadline('2026-02-30T10:00'), null);
  assert.equal(parseAlmatyDeadline('2026-10-20T25:00'), null);
  assert.equal(parseAlmatyDeadline('2026-10-20T10:00Z'), null);
}
for (const invalid of ['//evil.test', '/account/../staff', '/account\\evil', '/account%2f..', 'https://evil.test', '/accounting']) assert.equal(safeAccountReturn(invalid), '/account');
assert.equal(safeAccountReturn('/account/cases/123/tasks#task-123'), '/account/cases/123/tasks#task-123');

const db = new PGlite();
const admin = '00000000-0000-4000-8000-000000000001';
const client = '00000000-0000-4000-8000-000000000002';
const stranger = '00000000-0000-4000-8000-000000000003';
const manager = '00000000-0000-4000-8000-000000000004';
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function as(user, sql, params = []) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)", [user, JSON.stringify({ sub: user, aal: 'aal2', role: 'authenticated' })]);
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
  for (const file of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()) {
    if (file.includes("0008")) {
  for (const [user, email] of [[admin,'ayanz2008@gmail.com'],[client,'client@example.test'],[stranger,'other@example.test'],[manager,'manager@example.test']]) await db.query('insert into auth.users values($1,$2,now())',[user,email]);
  await db.query("insert into public.staff_members(user_id,display_name,role) values($1,'Admin','admin'),($2,'Manager','manager')",[admin,manager]);
    }
    try { await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8')); }
    catch (error) { throw new Error(`${file}: ${error.message}`); }
  }
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims','{}',false)",[admin]);
  assert.equal((await db.query('select private.staff_mfa_passed() as ok')).rows[0].ok,true, 'Password-only staff access must be allowed without an enrolled factor');
  assert.equal((await db.query('select count(*)::int as n from public.staff_members where mfa_required')).rows[0].n,0);
  assert.equal((await db.query("select column_default from information_schema.columns where table_schema='public' and table_name='staff_members' and column_name='mfa_required'")).rows[0].column_default,'false');
  await db.query("insert into auth.mfa_factors values(gen_random_uuid(),$1,'verified'),(gen_random_uuid(),$2,'verified')",[admin,manager]);
  await db.query("insert into public.clients(id,user_id,full_name,linked_by,linked_at) values($1,$2,'Client',$3,now())",[id(1),client,admin]);
  await db.query("insert into public.service_templates(id,code,name) values($1,'TEST','Test')",[id(2)]);
  await db.query("insert into public.service_template_versions(id,service_id,version_no) values($1,$2,1)",[id(3),id(2)]);
  await db.query("insert into public.cases(id,case_number,client_id,service_version_id,title) values($1,'TEST-1',$2,$3,'Test')",[id(4),id(1),id(3)]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims','{}',false)",[admin]);
  assert.equal((await db.query('select private.staff_mfa_passed() as ok')).rows[0].ok,false);
  const task = (await as(admin,"select public.staff_create_task($1,'answer','Question',null,null) as id",[id(4)])).rows[0].id;
  for (const user of [client,stranger,manager]) await assert.rejects(as(user,"select public.staff_cancel_task($1,'new','Reason')",[task]),/Not authorized/);
  await assert.rejects(as(admin,"select public.staff_cancel_task($1,'new',' ')",[task]),/Reason is required/);
  await assert.rejects(as(admin,"select public.staff_cancel_task($1,'response_sent','Reason')",[task]),/Task changed/);
  await as(admin,"select public.staff_cancel_task($1,'new','No longer needed')",[task]);
  assert.equal((await as(client,'select status from public.tasks where id=$1',[task])).rows[0].status,'cancelled');
  assert.equal((await as(client,"select response_text from public.task_events where task_id=$1 and action='cancelled'",[task])).rows[0].response_text,'No longer needed');
  await assert.rejects(as(admin,"select public.staff_cancel_task($1,'new','Again')",[task]),/Task changed/);
  const request = (await as(admin,"select public.staff_create_document_request($1,'Document',null,true,null) as id",[id(4)])).rows[0].id;
  await assert.rejects(as(manager,"select public.staff_close_document_request($1,'not_required','No')",[request]),/Not authorized/);
  await as(admin,"select public.staff_close_document_request($1,'not_required','Not needed')",[request]);
  assert.equal((await as(client,'select closure_reason from public.document_requests where id=$1',[request])).rows[0].closure_reason,'Not needed');
  await assert.rejects(as(admin,"select public.staff_close_document_request($1,'cancelled','Again')",[request]),/Request changed/);
  await as(admin,"select public.admin_save_contact_settings(null,null,null,null,null,null,'Bank details')");
  await assert.rejects(as(admin,"select public.admin_save_contact_settings(null,null,null,null,null,null,'Stale')"),/Settings changed/);
  assert.equal((await as(client,'select payment_details from public.contact_settings')).rows[0].payment_details,'Bank details');
  const faq = (await as(admin,"select public.admin_upsert_faq(null,'Q','A',1,true,null) as id")).rows[0].id;
  const revision=(await as(admin,'select updated_at from public.faq_entries where id=$1',[faq])).rows[0].updated_at;
  await as(admin,"select public.admin_upsert_faq($1,'Q','New',1,true,$2)",[faq,revision]);
  await assert.rejects(as(admin,"select public.admin_upsert_faq($1,'Q','Stale',1,true,$2)",[faq,revision]),/Settings changed/);
  assert.equal((await as(client,'select public.client_consent_status() as ok')).rows[0].ok,true);
  await assert.rejects(as(client,"select public.admin_publish_legal_document('terms','T','B',null)"),/Not authorized/);
  const publish = async (type, expected=null) => (await as(admin,"select public.admin_publish_legal_document($1,'Test only','Local test text',$2) as id",[type,expected])).rows[0].id;
  const terms = await publish('terms'); const privacy=await publish('privacy'); const marketing=await publish('marketing');
  assert.equal((await as(client,'select public.client_consent_status() as ok')).rows[0].ok,false);
  await assert.rejects(as(client,'select public.accept_client_consents($1)',[[terms]]),/required consent missing/);
  await assert.rejects(as(client,'select public.accept_client_consents($1)',[[terms,privacy,id(999)]]),/required consent missing/);
  await as(client,'select public.accept_client_consents($1)',[[terms,privacy]]);
  await as(client,'select public.accept_client_consents($1)',[[terms,privacy]]);
  assert.equal((await as(client,'select count(*)::int as n from public.consent_records')).rows[0].n,2,'Marketing must remain optional, retry must not duplicate');
  assert.equal((await as(stranger,'select count(*)::int as n from public.consent_records')).rows[0].n,0);
  assert.equal((await as(client,'select public.client_consent_status() as ok')).rows[0].ok,true);
  await assert.rejects(publish('terms'),/Document changed/);
  const newTerms=await publish('terms',terms);
  assert.equal((await as(client,'select public.client_consent_status() as ok')).rows[0].ok,false);
  await assert.rejects(as(client,'select public.accept_client_consents($1)',[[terms,privacy,marketing]]),/required consent missing/);
  await as(client,'select public.accept_client_consents($1)',[[newTerms,privacy]]);
  const uploadTask=(await as(admin,"select public.staff_create_task($1,'upload_document','Upload identity','All pages',null) as id",[id(4)])).rows[0].id;
  const linked=(await as(client,'select document_request_id from public.tasks where id=$1',[uploadTask])).rows[0].document_request_id;
  assert.ok(linked);
  await assert.rejects(as(admin,"select public.staff_cancel_task($1,'new','Cancel')",[uploadTask]),/linked document request/);
  const addUpload = async (position) => (await db.query(`insert into public.document_files(request_id,version_no,file_position,storage_path,original_name,detected_mime_type,size_bytes,status,uploaded_by,content_sha256)
    values($1,1,$2,$3,'test.pdf','application/pdf',8,'under_review',$4,repeat(($2::integer)::text,64)) returning id`,[linked,position,`test/${position}.pdf`,client])).rows[0].id;
  const file1=await addUpload(1); const file2=await addUpload(2);
  const taskStatus=async()=>(await as(client,'select status from public.tasks where id=$1',[uploadTask])).rows[0].status;
  assert.equal(await taskStatus(),'response_sent');
  await as(admin,'select public.staff_review_document_file($1,true,null)',[file1]);
  assert.equal(await taskStatus(),'response_sent');
  await as(admin,'select public.staff_review_document_file($1,true,null)',[file2]);
  assert.equal(await taskStatus(),'completed');
  const cancelUpload=(await as(admin,"select public.staff_create_task($1,'upload_document','Optional request',null,null) as id",[id(4)])).rows[0].id;
  const cancelLinked=(await as(client,'select document_request_id from public.tasks where id=$1',[cancelUpload])).rows[0].document_request_id;
  await as(admin,"select public.staff_close_document_request($1,'not_required','Not needed')",[cancelLinked]);
  assert.equal((await as(client,'select status from public.tasks where id=$1',[cancelUpload])).rows[0].status,'cancelled');
  // Use direct fixture writes: file guards are covered by the existing finance suite.
  await db.exec('alter table public.contracts disable trigger user; alter table public.payment_schedule disable trigger user');
  await db.query("insert into public.contracts(id,case_id,version_no,contract_number,price_kzt,storage_path) values($1,$2,1,'QA',1000,'qa/contract.pdf')",[id(5),id(4)]);
  await db.query("insert into public.payment_schedule(id,case_id,contract_id,due_on,amount_kzt) values($1,$3,$4,'2030-01-02',100),($2,$3,$4,'2030-01-02',100)",[id(6),id(7),id(4),id(5)]);
  await db.query("insert into public.payments(case_id,schedule_id,amount_kzt,paid_on,confirmed_by) values($1,$2,40,'2030-01-01',$4),($1,$3,100,'2030-01-01',$4)",[id(4),id(6),id(7),admin]);
  await db.query('insert into public.payment_allocations(payment_id,schedule_id,case_id,amount_kzt) select id,schedule_id,case_id,amount_kzt from public.payments');
  assert.equal((await db.query("select private.enqueue_payment_deadline_reminders('2030-01-01') as n")).rows[0].n,1);
  assert.equal((await db.query("select private.enqueue_payment_deadline_reminders('2030-01-01') as n")).rows[0].n,0);
  assert.equal((await db.query("select private.enqueue_payment_deadline_reminders('2030-01-02') as n")).rows[0].n,1);
  assert.ok((await db.query("select body from public.notifications where kind='payment_deadline'")).rows.every(row=>row.body.includes('60.00')));
  console.log('OK all migrations + deadline timezones, safe return, cancellations/roles/history, settings conflicts, versioned consents/privacy, partial payment reminders/deduplication');
} finally { await db.close(); }
