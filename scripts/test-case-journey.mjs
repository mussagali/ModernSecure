import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const report = {scope:'Full migrations plus authenticated local RPC/RLS workflows; UI source review', limitations:['No browser interactions','Storage metadata simulated; upload RPCs executed','No production writes'], passed:[], findings:[]};
const scalar = async(n,sql,args=[]) => Object.values((await as(n,sql,args)).rows[0])[0];
const review = async(n,id,accept,note=null) => scalar(n,'select public.staff_review_task($1,$2,$3,$4)',[id,await scalar(n,'select response_event_id from public.tasks where id=$1',[id]),accept,note]);
const pass = title => {report.passed.push(title);console.log('PASS '+title);};
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
  for(let n=2;n<=6;n++) await db.query('insert into auth.users values($1,$2,now())',[uid(n),`journey${n}@example.test`]);
  for(const [n,role] of [[2,'manager'],[3,'lawyer'],[5,'lawyer']]) await scalar(1,'select public.admin_approve_account($1,$2,$3)',[uid(n),role,`Journey ${role} ${n}`]);
  const card=await scalar(2,"select public.staff_create_client('Journey Client','journey4@example.test','+70000000000','Almaty')");
  await scalar(1,"select public.admin_approve_account($1,'client','Journey Client',$2)",[uid(4),card]);
  await scalar(1,"select public.admin_approve_account($1,'client','Unrelated Client')",[uid(6)]);
  const documents=JSON.stringify([{title:'Identity',instructions:'All pages',required:true},{title:'Optional evidence',instructions:'If available',required:false}]);
  const service=await scalar(1,'select public.admin_create_service_with_documents($1,$2,$3::jsonb)',['Journey service',['Intake','Preparation','Resolution'],documents]);
  const version=await scalar(2,'select version_id from public.available_service_versions()');
  const caseId=await scalar(2,'select public.staff_create_case($1,$2,$3)',[card,version,'Journey case']);
  assert.equal(await scalar(2,'select count(*)::int from public.case_assignments where case_id=$1 and staff_user_id=$2 and revoked_at is null',[caseId,uid(2)]),1);
  assert.equal(await scalar(4,'select count(*)::int from public.document_requests where case_id=$1',[caseId]),2);
  assert.equal(await scalar(6,'select count(*)::int from public.cases where id=$1',[caseId]),0);
  assert.equal(await scalar(3,'select count(*)::int from public.cases where id=$1',[caseId]),0);
  const lawyerAssignment=await scalar(1,'select public.staff_assign_case($1,$2)',[caseId,uid(3)]);
  assert.equal(await scalar(3,'select count(*)::int from public.cases where id=$1',[caseId]),1);
  await assert.rejects(as(2,'select public.staff_assign_case($1,$2)',[caseId,uid(5)]),/Not authorized/);
  pass('Service → client → account link → manager-created case → lawyer assignment; template instantiation and role-scoped reads');

  const version2=await scalar(1,'select public.admin_publish_service_version($1,$2,$3,$4::jsonb)',[service,version,['Intake v2','Resolution v2'],documents]);
  await assert.rejects(as(2,'select public.staff_create_case($1,$2,$3)',[card,version,'Stale service case']),/outdated/);
  await assert.rejects(as(1,'select public.admin_publish_service_version($1,$2,$3,$4::jsonb)',[service,version,['Intake'],documents]),/changed by another user/);
  assert.equal(await scalar(4,'select service_version_id from public.cases where id=$1',[caseId]),version);
  const stages=(await as(3,'select id,position from public.stage_templates where version_id=$1 order by position',[version])).rows;
  await assert.rejects(as(2,'select public.staff_change_case_stage($1,$2,$3,$4)',[caseId,stages[0].id,stages[1].id,'Wrong actor']),/Not authorized/);
  await scalar(3,'select public.staff_change_case_stage($1,$2,$3,$4)',[caseId,stages[0].id,stages[1].id,'Preparing application']);
  await assert.rejects(as(3,'select public.staff_change_case_stage($1,$2,$3,$4)',[caseId,stages[0].id,stages[2].id,'Stale view']),/changed by another user/);
  await assert.rejects(as(3,'select public.staff_change_case_stage($1,$2,$3,$4)',[caseId,stages[1].id,stages[0].id,'Rollback']),/Rollback reason/);
  await scalar(3,'select public.staff_change_case_stage($1,$2,$3,$4,$5)',[caseId,stages[1].id,stages[0].id,'More documents needed','Internal diagnostic reason']);
  await assert.rejects(as(4,'select change_reason from public.case_stage_events where case_id=$1',[caseId]),/permission denied/);
  await assert.rejects(as(4,'select public.staff_case_stage_events($1)',[caseId]),/Not authorized/);
  pass('Service-version publishing/conflicts; old cases retain original version; stage transitions/conflicts/rollback and internal-reason privacy');

  const answer=await scalar(3,"select public.staff_create_task($1,'answer','Confirm facts','Confirm the address',now()+interval '2 days')",[caseId]);
  await assert.rejects(as(6,'select public.client_respond_task($1,$2)',[answer,'Wrong client']),/Not authorized/);
  await scalar(4,'select public.client_respond_task($1,$2)',[answer,'First response']);
  await review(3,answer,false,'Please add a date');
  await scalar(4,'select public.client_respond_task($1,$2)',[answer,'Corrected response, 2026-10-28']);
  await review(3,answer,true);
  assert.equal(await scalar(4,'select status from public.tasks where id=$1',[answer]),'completed');
  await assert.rejects(as(4,'select public.client_respond_task($1,$2)',[answer,'Duplicate']),/Invalid task response/);
  const staleTask=await scalar(3,"select public.staff_create_task($1,'answer','Parallel review',null,null)",[caseId]);
  await scalar(4,"select public.client_respond_task($1,'Response A')",[staleTask]);
  const staleRevision=await scalar(3,'select response_event_id from public.tasks where id=$1',[staleTask]);
  await review(1,staleTask,false,'Correct A');
  await scalar(4,"select public.client_respond_task($1,'Response B, different facts')",[staleTask]);
  await assert.rejects(as(3,'select public.staff_review_task($1,$2,true,null)',[staleTask,staleRevision]),/Task response changed/);
  await assert.rejects(as(3,'select public.staff_review_task($1,true,null)',[staleTask]),/permission denied/);
  assert.equal(await scalar(4,'select status from public.tasks where id=$1',[staleTask]),'response_sent');
  const freshRevision=await scalar(3,'select response_event_id from public.tasks where id=$1',[staleTask]);
  assert.notEqual(freshRevision,staleRevision);
  for(const actor of [2,4,5,6]) await assert.rejects(as(actor,'select public.staff_review_task($1,$2,true,null)',[staleTask,freshRevision]),/Not authorized/);
  await assert.rejects(as(3,'select public.staff_review_task($1,$2,null,null)',[staleTask,freshRevision]),/decision is required/);
  await review(3,staleTask,true);
  assert.equal(await scalar(4,'select status from public.tasks where id=$1',[staleTask]),'completed');
  report.findings.push({id:'CASE-04',severity:'P2',title:'Stale task reviewer could accept an unseen replacement response',scenario:'Lawyer reads response A → another reviewer returns A → client submits B → first lawyer accepts from stale form.',actual:'Old API checked response_sent only and accepted response B.',resolution:'Fixed locally: response-event revision captured atomically; form supplies exact event ID; DB verifies revision and revokes unversioned API.',sources:['supabase/migrations/20261028009200_case_recovery_and_cancellation.sql','app/staff/actions.ts','app/staff/cases/[id]/tasks/page.tsx']});
  pass('CASE-04 response A/B race rejects stale reviewer and legacy API; fresh authorized review succeeds');
  const ack=await scalar(3,"select public.staff_create_task($1,'acknowledge','Review explanation','Acknowledge this exact explanation',null)",[caseId]);
  const ackRow=(await as(4,'select id,title,description,kind,created_at from public.tasks where id=$1',[ack])).rows[0];
  const {taskAcknowledgmentVersion}=await import('../lib/task-acknowledgment.ts');
  await assert.rejects(as(4,'select public.client_acknowledge_task($1,$2)',[ack,'stale']),/changed|Invalid/i);
  await scalar(4,'select public.client_acknowledge_task($1,$2)',[ack,taskAcknowledgmentVersion(ackRow)]);
  await review(3,ack,true);
  const cancel=await scalar(3,"select public.staff_create_task($1,'contact','Call the office',null,null)",[caseId]);
  await scalar(3,"select public.staff_cancel_task($1,'new','Resolved during meeting')",[cancel]);
  const {notificationDestination}=await import('../lib/notification-links.ts');
  const cancelNotice=(await as(4,'select * from public.notifications where dedupe_key=$1',[`task-cancelled:${cancel}`])).rows[0];
  assert.equal(notificationDestination(cancelNotice,'client'),`/account/cases/${caseId}/tasks#task-${cancel}`);
  const responseNotice=(await as(3,"select * from public.notifications where case_id=$1 and kind='task_response' order by created_at desc limit 1",[caseId])).rows[0];
  const responseTask=await scalar(3,'select task_id from public.task_events where id=$1',[responseNotice.dedupe_key.split(':')[1]]);
  assert.equal(notificationDestination(responseNotice,'staff',responseTask),`/staff/cases/${caseId}/tasks#task-${responseTask}`);
  pass('Answer/reject/resubmit/accept; versioned acknowledgment; explicit cancellation; task notification anchors');

  async function upload(request,key,count=1) {
    const files=Array.from({length:count},(_,i)=>({name:`page-${i+1}.pdf`,mime:'application/pdf',size:8,sha256:String(i+1).repeat(64)}));
    const batch=await scalar(4,'select public.resume_or_begin_document_upload($1,$2,$3::jsonb)',[request,key,JSON.stringify(files)]);
    for(const file of batch.files) {
      await scalar(4,'select public.authorize_document_file_upload($1,$2)',[batch.session_id,file.id]);
      // Only Storage transport is simulated. All business writes use production RPCs.
      await db.query("insert into storage.objects(bucket_id,name,metadata) values('modernsecure-files',$1,$2::jsonb)",[file.path,JSON.stringify({size:file.size})]);
      await db.query('select public.server_verify_document_file($1,$2,$3)',[batch.session_id,file.id,file.sha256]);
    }
    await scalar(4,'select public.complete_document_upload($1)',[batch.session_id]);
    return batch;
  }
  const required=await scalar(4,'select id from public.document_requests where case_id=$1 and required',[caseId]);
  await assert.rejects(as(3,'select public.staff_close_case($1,$2)',[caseId,'Premature closure']),/Required documents/);
  const initial=await upload(required,'journey-identity-one',2);
  await scalar(3,'select public.staff_review_document_file($1,true,null)',[initial.files[0].id]);
  await scalar(3,"select public.staff_review_document_file($1,false,'Last page unreadable')",[initial.files[1].id]);
  await assert.rejects(as(3,'select public.staff_close_case($1,$2)',[caseId,'Partially accepted']),/Required documents/);
  const corrected=await upload(required,'journey-identity-two',2);
  for(const file of corrected.files) await scalar(3,'select public.staff_review_document_file($1,true,null)',[file.id]);
  const uploadTask=await scalar(3,"select public.staff_create_task($1,'upload_document','Additional evidence','Upload the full document',null)",[caseId]);
  const uploadRequest=await scalar(4,'select document_request_id from public.tasks where id=$1',[uploadTask]);
  const batch=await upload(uploadRequest,'journey-evidence-one',2);
  assert.equal(await scalar(4,'select status from public.tasks where id=$1',[uploadTask]),'response_sent');
  await scalar(3,'select public.staff_review_document_file($1,true,null)',[batch.files[0].id]);
  assert.equal(await scalar(4,'select status from public.tasks where id=$1',[uploadTask]),'response_sent');
  await scalar(3,'select public.staff_review_document_file($1,true,null)',[batch.files[1].id]);
  assert.equal(await scalar(4,'select status from public.tasks where id=$1',[uploadTask]),'completed');
  const optional=await scalar(4,'select id from public.document_requests where case_id=$1 and not required',[caseId]);
  const optionalBatch=await upload(optional,'journey-optional-pending');
  const worklist=async(id,status='all') => (await as(1,"select * from public.staff_case_worklist('', $1) where case_id=$2",[status,id])).rows[0];
  assert.equal(Number((await worklist(caseId)).review_count),1);
  pass('Upload RPC sequence with simulated storage; multi-page return/correction; latest-version closure gate; upload-task synchronization');

  const clientMessage=await scalar(4,'select public.post_case_message($1,$2,$3)',[caseId,'I supplied every page','journey-client-message']);
  assert.equal(await scalar(4,'select public.post_case_message($1,$2,$3)',[caseId,'I supplied every page','journey-client-message']),clientMessage);
  await assert.rejects(as(4,'select public.post_case_message($1,$2,$3)',[caseId,'Changed retry','journey-client-message']),/key cannot be reused/);
  const staffMessage=await scalar(3,'select public.post_case_message($1,$2,$3)',[caseId,'Thank you, reviewing now','journey-lawyer-message']);
  assert.equal(await scalar(4,'select public.case_unread_message_count($1)',[caseId]),1);
  await scalar(4,'select public.mark_case_messages_seen($1,$2)',[caseId,staffMessage]);
  assert.equal(await scalar(4,'select public.case_unread_message_count($1)',[caseId]),0);
  const pending=await scalar(3,"select public.staff_create_task($1,'answer','Final question',null,null)",[caseId]);
  await scalar(3,"select public.staff_suspend_case($1,'Waiting for court',now()+interval '3 days')",[caseId]);
  assert.equal(Number((await worklist(caseId)).review_count),0,'Suspended documents do not count as actionable reviews');
  for(const [actor,sql,args] of [[4,'select public.post_case_message($1,$2,$3)',[caseId,'During suspension','suspended-message']],[4,'select public.client_respond_task($1,$2)',[pending,'Suspended answer']],[3,"select public.staff_create_task($1,'answer','Suspended task',null,null)",[caseId]],[3,'select public.staff_close_case($1,$2)',[caseId,'Suspended closure']]]) await assert.rejects(as(actor,sql,args),/not active|Not authorized|cannot be closed/);
  await scalar(3,'select public.staff_resume_case($1)',[caseId]);
  assert.equal(Number((await worklist(caseId)).review_count),1,'Resumed case returns to actionable document review');
  await scalar(3,'select public.staff_close_case($1,$2)',[caseId,'Application resolved successfully']);
  assert.equal(await scalar(4,'select status from public.cases where id=$1',[caseId]),'closed');
  assert.equal(await scalar(4,'select status from public.tasks where id=$1',[pending]),'cancelled');
  assert.equal(await scalar(4,'select count(*)::int from public.messages where case_id=$1',[caseId]),2);
  assert.equal(Number((await worklist(caseId)).review_count),0,'Closed optional uploads must not remain actionable reviews');
  assert.equal(await scalar(4,'select status from public.document_files where id=$1',[optionalBatch.files[0].id]),'under_review','Archive remains readable with original file status');
  await assert.rejects(as(3,'select public.staff_review_document_file($1,true,null)',[optionalBatch.files[0].id]),/no longer active/);
  await assert.rejects(as(4,'select public.post_case_message($1,$2,$3)',[caseId,'New closed message','closed-message']),/not active/);
  await scalar(1,'select public.admin_revoke_case_assignment($1,$2)',[lawyerAssignment,'Transfer completed']);
  for(const table of ['cases','tasks','messages']) assert.equal(await scalar(3,`select count(*)::int from public.${table} where ${table==='cases'?'id':'case_id'}=$1`,[caseId]),0);
  await assert.rejects(as(3,'select public.post_case_message($1,$2,$3)',[caseId,'Thank you, reviewing now','journey-lawyer-message']),/Not authorized/);
  assert.equal(await scalar(4,'select count(*)::int from public.cases where id=$1',[caseId]),1);
  pass('Message idempotency/unread cursor; suspend/resume; completion cancels pending tasks; archive read; revoked lawyer loses case access');

  const stuckCase=await scalar(2,'select public.staff_create_case($1,$2,$3)',[card,version2,'Cancelled template recovery']);
  await scalar(1,'select public.staff_assign_case($1,$2)',[stuckCase,uid(5)]);
  const stuckRequest=await scalar(5,'select id from public.document_requests where case_id=$1 and required',[stuckCase]);
  await scalar(5,"select public.staff_close_document_request($1,'cancelled','Created in error')",[stuckRequest]);
  await assert.rejects(as(5,"select public.staff_close_document_request($1,'not_required','Actually waived')",[stuckRequest]),/Request changed/);
  const replacement=await scalar(5,"select public.staff_create_document_request($1,'Identity','Replacement for cancelled template',true,null)",[stuckCase]);
  const replacementBatch=await upload(replacement,'journey-replacement');
  for(const file of replacementBatch.files) await scalar(5,'select public.staff_review_document_file($1,true,null)',[file.id]);
  await assert.rejects(as(5,"select public.staff_close_case($1,'Resolved after corrected document')",[stuckCase]),/Required documents are not accepted/);
  assert.equal(await scalar(5,'select template_id is null from public.document_requests where id=$1',[replacement]),true);
  report.findings.push({id:'CASE-01',severity:'P1',title:'Cancelling a required template request permanently blocks case completion',scenario:'Create service with required document → create case → cancel its instantiated request → try waiver or accepted replacement → close case.',expected:'Recover cancellation through audited reopen/replacement, or reject cancellation with clear guidance.',actual:'Changing cancelled request to not_required raises Request changed; accepted replacement has null template_id; close raises Required documents are not accepted.',sources:['supabase/migrations/20261016007800_audit_workflow_fixes.sql:56','supabase/migrations/20261018008600_profile_and_document_corrections.sql:90','app/staff/cases/[id]/documents/page.tsx'],minimalFix:'Prevent cancelling required template requests without replacement, or provide audited reopen/relink/waiver correction and UI.'});
  for(const actor of [2,3,4,6]) await assert.rejects(as(actor,"select public.staff_reopen_template_document_request($1,'Restore')",[stuckRequest]),/Not authorized/);
  await assert.rejects(as(5,"select public.staff_reopen_template_document_request($1,' ')",[stuckRequest]),/Reason is required/);
  await scalar(5,"select public.staff_reopen_template_document_request($1,'Cancellation was mistaken; required by this service')",[stuckRequest]);
  assert.equal(await scalar(5,'select status from public.document_requests where id=$1',[stuckRequest]),'active');
  await assert.rejects(as(5,"select public.staff_reopen_template_document_request($1,'Duplicate restore')",[stuckRequest]),/cannot be restored/);
  await scalar(5,"select public.staff_close_document_request($1,'not_required','Verified externally; reasoned waiver')",[stuckRequest]);
  await scalar(5,"select public.staff_close_case($1,'Resolved after reasoned waiver')",[stuckCase]);
  assert.equal(await scalar(4,'select status from public.cases where id=$1',[stuckCase]),'closed');
  assert.equal(await scalar(1,"select count(*)::int from public.audit_events where entity_id=$1 and action='reopened'",[stuckRequest]),1);
  assert.equal(await scalar(4,"select count(*)::int from public.notifications where case_id=$1 and kind='document_request_closed'",[stuckCase]),2,'Restoration permits a new closure notification without a dedupe conflict');
  report.findings.at(-1).resolution='Fixed locally in migration092 and document UI: audited restoration of cancelled required template request, followed by upload or reasoned waiver; full journey passes.';
  pass('CASE-01 recovery: actor/reason guards → restore original template request → waiver → close, with audit and safe duplicate rejection');
  const restoredCase=await scalar(2,'select public.staff_create_case($1,$2,$3)',[card,version2,'Restore and submit required evidence']);
  await scalar(1,'select public.staff_assign_case($1,$2)',[restoredCase,uid(5)]);
  const restoredRequest=await scalar(5,'select id from public.document_requests where case_id=$1 and required',[restoredCase]);
  await scalar(5,"select public.staff_close_document_request($1,'cancelled','Mistaken cancellation')",[restoredRequest]);
  await scalar(5,"select public.staff_reopen_template_document_request($1,'Restore for original required document')",[restoredRequest]);
  const restoredUpload=await upload(restoredRequest,'journey-restored-required');
  await scalar(5,'select public.staff_review_document_file($1,true,null)',[restoredUpload.files[0].id]);
  await scalar(5,"select public.staff_close_case($1,'Required original document accepted')",[restoredCase]);
  assert.equal(await scalar(4,'select status from public.cases where id=$1',[restoredCase]),'closed');
  pass('Restored required template also completes through real upload/review RPCs without waiver');

  const cancelFunctions=await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname ilike '%cancel%case%'");
  assert.equal(cancelFunctions.rows.length,1);
  report.findings.push({id:'CASE-02',severity:'P2',title:'No operational case cancellation workflow',scenario:'Cancel a duplicate/abandoned case without declaring successful completion.',expected:'Authorized actor can cancel with reason, audit and client notification.',actual:'Cancelled enum exists, but no cancellation RPC/action/button; only suspend/resume/close exist. Close requires accepted/waived template documents and a result.',sources:['supabase/migrations/20261010000100_core_schema.sql:7','app/staff/cases/[id]/page.tsx:74','app/staff/actions.ts:166'],minimalFix:'Add authorized audited cancellation and UI, with defined document/task/message/access behavior.'});
  const cancelledCase=await scalar(2,'select public.staff_create_case($1,$2,$3)',[card,version2,'Duplicate matter to cancel']);
  const cancelAssignment=await scalar(1,'select public.staff_assign_case($1,$2)',[cancelledCase,uid(5)]);
  const taskToCancel=await scalar(5,"select public.staff_create_task($1,'answer','Open question',null,null)",[cancelledCase]);
  const docTaskToCancel=await scalar(5,"select public.staff_create_task($1,'upload_document','Pending document task',null,null)",[cancelledCase]);
  const pendingRequest=await scalar(4,'select document_request_id from public.tasks where id=$1',[docTaskToCancel]);
  const pendingUpload=await upload(pendingRequest,'journey-cancel-pending-document');
  const finishedTask=await scalar(5,"select public.staff_create_task($1,'upload_document','Completed evidence',null,null)",[cancelledCase]);
  const finishedRequest=await scalar(4,'select document_request_id from public.tasks where id=$1',[finishedTask]);
  const finishedUpload=await upload(finishedRequest,'journey-cancel-completed-document');
  await scalar(5,'select public.staff_review_document_file($1,true,null)',[finishedUpload.files[0].id]);
  const waivedRequest=await scalar(5,"select public.staff_create_document_request($1,'Waived evidence',null,false,null)",[cancelledCase]);
  await upload(waivedRequest,'journey-waived-document');
  assert.equal(Number((await worklist(cancelledCase)).review_count),2);
  await scalar(5,"select public.staff_close_document_request($1,'not_required','Not relevant')",[waivedRequest]);
  assert.equal(Number((await worklist(cancelledCase)).review_count),1,'Waived request leaves actionable review count');
  for(const actor of [2,3,4,6]) await assert.rejects(as(actor,"select public.staff_cancel_case($1,'Wrong actor')",[cancelledCase]),/Not authorized/);
  await assert.rejects(as(5,"select public.staff_cancel_case($1,' ')",[cancelledCase]),/Reason is required/);
  await scalar(5,"select public.staff_suspend_case($1,'Pending decision',now()+interval '3 days')",[cancelledCase]);
  await scalar(5,"select public.staff_cancel_case($1,'Duplicate case; original matter continues')",[cancelledCase]);
  const cancelled=(await as(4,'select status,is_suspended,next_review_at,result_summary,closed_at from public.cases where id=$1',[cancelledCase])).rows[0];
  assert.equal(cancelled.status,'cancelled'); assert.equal(cancelled.is_suspended,false); assert.equal(cancelled.next_review_at,null); assert.ok(cancelled.closed_at); assert.match(cancelled.result_summary,/Duplicate/);
  for(const task of [taskToCancel,docTaskToCancel]) assert.equal(await scalar(4,'select status from public.tasks where id=$1',[task]),'cancelled');
  assert.equal(await scalar(4,'select status from public.tasks where id=$1',[finishedTask]),'completed','Cancellation preserves completed evidence tasks');
  assert.equal(await scalar(4,'select status from public.document_files where id=$1',[finishedUpload.files[0].id]),'accepted');
  assert.equal(await scalar(4,'select count(*)::int from public.case_suspensions where case_id=$1 and ended_at is null',[cancelledCase]),0);
  assert.equal(Number((await worklist(cancelledCase,'cancelled')).review_count),0);
  assert.equal(await scalar(4,'select count(*)::int from public.notifications where dedupe_key=$1',[`case-cancelled:${cancelledCase}`]),1);
  await assert.rejects(as(5,"select public.staff_cancel_case($1,'Repeated click')",[cancelledCase]),/cannot be cancelled/);
  await assert.rejects(as(5,'select public.staff_resume_case($1)',[cancelledCase]),/not suspended/);
  await assert.rejects(as(5,'select public.staff_review_document_file($1,true,null)',[pendingUpload.files[0].id]),/no longer active/);
  await assert.rejects(as(4,"select public.post_case_message($1,'Cannot send','cancelled-message')",[cancelledCase]),/not active/);
  await assert.rejects(as(4,"select public.client_respond_task($1,'Cannot answer')",[taskToCancel]),/Not authorized/);
  await scalar(1,'select public.admin_revoke_case_assignment($1,$2)',[cancelAssignment,'Archive transferred']);
  assert.equal(await scalar(5,'select count(*)::int from public.cases where id=$1',[cancelledCase]),0);
  report.findings.at(-1).resolution='Fixed locally: audited legal-editor cancellation; case/task/request/suspension transitions, client notice, archive access, cancelled filter and status/reason UI.';
  pass('CASE-02 cancellation: guards, suspended-case cleanup, linked tasks, preserve completed evidence, notify, reject stale repeats, freeze writes and retain archive');
  report.findings.push({id:'CASE-03',severity:'P2',title:'Review queues advertised files that cannot be reviewed',scenario:'Upload optional document then close case, or waive request, or suspend case.',actual:'Raw under_review count and queue included files whose review RPC is blocked.',resolution:'Fixed locally: worklist/default review queue count active requests in open, unsuspended cases; all/history remains readable.',sources:['app/staff/review/page.tsx','supabase/migrations/20261028009200_case_recovery_and_cancellation.sql']});
  pass('CASE-03 actionable review counts agree across active, waived, suspended, resumed, closed and cancelled lifecycle states');
  report.summary={passedJourneys:report.passed.length,reproducedFindings:report.findings.length,migrations:readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).length};
} catch(error) {
  report.harnessError={message:error.message,stack:error.stack};
  throw error;
} finally {
  mkdirSync('artifacts/workflow-qa',{recursive:true});
  writeFileSync('artifacts/workflow-qa/cases.json',JSON.stringify(report,null,2)+'\n');
  await db.close();
}
