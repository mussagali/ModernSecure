import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runWorkflowCorrections({ db, admin, lawyer, legacy, as, approve, identity }) {
  await db.query('update public.staff_members set can_confirm_payments=true where user_id=$1', [admin]);
  const customer = legacy;
  const card = (await approve(admin, customer)).rows[0].id;
  await db.query("update public.clients set phone='+7 777 123 45 67', city='Old city' where id=$1", [card]);
  await as(customer, "select public.update_own_profile('Client',null,'New city')");
  assert.deepEqual((await db.query('select phone, city from public.clients where id=$1', [card])).rows[0],
    {phone: '+7 777 123 45 67', city: 'New city'}, 'Editing city preserves a phone absent from the profile');
  await identity(customer, 'Client', '000000000001');
  const revision = (await db.query('select updated_at::text from public.clients where id=$1', [card])).rows[0].updated_at;
  const correct = (actor, timestamp = revision) => as(actor, "select public.staff_correct_client_identity($1,$2,'Correct Name','000000000002','Confirmed with client')", [card,timestamp]);
  await assert.rejects(correct(customer), /Not authorized/);
  await assert.rejects(correct(lawyer), /Not authorized/);
  await correct(admin);
  await assert.rejects(correct(admin), /Client changed/);
  assert.equal((await db.query('select iin from public.profiles where user_id=$1', [customer])).rows[0].iin, '000000000002');
  assert.ok(!(await db.query("select after_data from public.audit_events where action='identity_corrected'")).rows.some(r => JSON.stringify(r).includes('000000000002')));
  await assert.rejects(as(customer,"select public.save_own_profile('Client',null,'City','2000-01-01')"), /Profile changed/);
  const service = randomUUID(), version = randomUUID();
  await db.query("insert into public.service_templates(id,code,name) values($1,$2,'Test service')", [service, service]);
  await db.query('insert into public.service_template_versions(id,service_id,version_no,published_at) values($1,$2,1,now())', [version,service]);
  async function newCase() {
    const id=randomUUID();
    await db.query("insert into public.cases(id,case_number,client_id,service_version_id,title) values($1,$2,$3,$4,'Workflow test')", [id,id,card,version]);
    return id;
  }
  async function contract(c, amount) {
    const path=`contracts/${c}/${randomUUID()}.pdf`, sha='a'.repeat(64);
    await db.query("insert into storage.objects(bucket_id,name,metadata,user_metadata) values('modernsecure-files',$1,$2,$3)", [path,{size:8,mimetype:'application/pdf'},{sha256:sha}]);
    return as(admin,"select public.staff_register_contract($1,'TEST',current_date,$2,$3,$4,8) as id", [c,amount,path,sha]);
  }
  const term = async (c, amount) => (await as(admin, 'select public.staff_add_payment_installment($1,current_date,$2,null) as id', [c,amount])).rows[0].id;
  const record = async (c, amount, key=randomUUID(), ref=randomUUID(), receipt=null, actor=admin) =>
    (await as(actor, 'select public.staff_record_payment($1,$2,current_date,$3,null,$4,$5) as id', [c,amount,ref,key,receipt])).rows[0].id;
  const c=await newCase(); await contract(c,100000);
  const a=await term(c,50000); await term(c,50000);
  const key=randomUUID(), ref=randomUUID();
  const p=await record(c,100000,key,ref);
  assert.equal(await record(c,100000,key,ref),p,'Replay returns the same bank transaction');
  assert.deepEqual((await db.query('select amount_kzt from public.payment_allocations where payment_id=$1', [p])).rows.map(r=>Number(r.amount_kzt)),[50000,50000]);
  assert.equal((await as(customer,'select count(*)::int as n from public.payment_allocations where payment_id=$1',[p])).rows[0].n,2);
  await assert.rejects(record(c,1,key,ref), /key cannot be reused/);
  await assert.rejects(record(c,1,randomUUID(),ref), /unique constraint/);
  await assert.rejects(record(c,1), /exceeds active schedule/);
  await assert.rejects(record(c,1,randomUUID(),randomUUID(),null,customer), /Not authorized/);
  await assert.rejects(as(customer, 'insert into public.payment_allocations values($1,$2,$3,1)', [p,a,c]), /permission denied/);
  await as(admin, "select public.staff_close_case($1,'Completed')", [c]);
  await as(admin, "select public.staff_void_payment($1,'Wrong reference')",[p]);
  await record(c,100000);
  assert.equal((await db.query('select status from public.cases where id=$1',[c])).rows[0].status,'closed','Settlement never reopens the case');
  const suspended=await newCase();await contract(suspended,100);await term(suspended,100);
  await as(admin,"select public.staff_suspend_case($1,'Waiting',now()+interval '1 day')",[suspended]);
  const receiptKey=randomUUID(),receiptPath=`receipts/${suspended}/${customer}/${receiptKey}.pdf`;
  await db.query("insert into storage.objects(bucket_id,name,metadata,user_metadata) values('modernsecure-files',$1,$2,$3)", [receiptPath,{size:8,mimetype:'application/pdf'},{sha256:'b'.repeat(64)}]);
  const receipt=(await as(customer,"select public.client_register_payment_receipt($1,$2,'check.pdf','application/pdf',8,$3,$4) as id",[suspended,receiptPath,'b'.repeat(64),receiptKey])).rows[0].id;
  await as(admin,"select public.staff_review_payment_receipt($1,true,'Verified')",[receipt]);
  await record(suspended,100,randomUUID(),randomUUID(),receipt);
  const revised=await newCase();await contract(revised,100000);const old=await term(revised,100000);
  await record(revised,20000);
  await contract(revised,80000);
  await assert.rejects(term(revised,60000),/Schedule exceeds remaining contract price/);
  const oldRevision=(await db.query('select updated_at::text from public.payment_schedule where id=$1',[old])).rows[0].updated_at;
  await as(admin,"select public.staff_cancel_payment_installment($1,$2,'Replaced by new contract')",[old,oldRevision]);
  const replacement=await term(revised,60000);
  await assert.rejects(as(admin,"select public.staff_confirm_payment($1,1,current_date,'OLD-REF',null,$2)",[old,randomUUID()]), /exceeds active schedule/);
  await db.query('select private.enqueue_payment_deadline_reminders(current_date)');
  assert.equal((await db.query("select count(*)::int as n from public.notifications where dedupe_key like $1",[`payment-deadline:${old}:%`])).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int as n from public.notifications where dedupe_key like $1",[`payment-deadline:${replacement}:%`])).rows[0].n,1);
  assert.equal(Number((await db.query('select private.installment_paid($1) as paid',[old])).rows[0].paid),20000,'Cancellation preserves paid money and allocations');
  const waivedCase=await newCase(), cancelledCase=await newCase(), template=randomUUID();
  await db.query("insert into public.document_templates(id,version_id,title,required) values($1,$2,'Required template',true)",[template,version]);
  for (const [caseId,status] of [[waivedCase,'not_required'],[cancelledCase,'cancelled']]) {
    const request=randomUUID();
    await db.query("insert into public.document_requests(id,case_id,template_id,title,required,created_by) values($1,$2,$3,'Required',true,$4)",[request,caseId,template,admin]);
    await as(admin,'select public.staff_close_document_request($1,$2::public.document_request_status,$3)',[request,status,'Not applicable']);
  }
  await as(admin,"select public.staff_close_case($1,'Done with waiver')",[waivedCase]);
  await assert.rejects(as(admin,"select public.staff_close_case($1,'Wrongly cancelled')",[cancelledCase]), /Required documents are not accepted/);
  await assert.rejects(db.query("update public.cases set status='closed',closed_at=now(),result_summary='Bypass' where id=$1",[cancelledCase]), /Latest required document versions/);
  await assert.rejects(as(customer, "select public.server_prepare_temporary_upload($1,'/api/contracts','{}','x.pdf',10)",[customer]), /permission denied/);
  await db.exec('set role service_role');
  const ticket = await db.query("select public.server_prepare_temporary_upload($1,'/api/contracts','{}','x.pdf',10) as id",[customer]);
  await db.exec('reset role');
  assert.ok(ticket.rows[0].id);
  await assert.rejects(as(customer, 'select * from public.temporary_uploads'), /permission denied/);
  console.log('OK contacts, identity correction/privacy/concurrency, allocation/replay/duplicate guards, suspended receipts, closed settlement, schedule revision, reminders and document waivers');
}
