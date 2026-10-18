// Uses isolated, clearly labelled fixtures; removes only IDs created by this run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import pg from 'pg';

const env=readFileSync('.env.local','utf8');
const value=name=>env.split(/\r?\n/).find(line=>line.startsWith(`${name}=`))?.slice(name.length+1).trim().replace(/^['"]|['"]$/g,'');
const base=new URL(process.env.TEST_BASE_URL ?? 'http://localhost:3000');
assert.equal(base.protocol,'http:');assert.ok(['localhost','127.0.0.1'].includes(base.hostname));
assert.equal(value('NEXT_PUBLIC_SUPABASE_URL'),'https://bdkrihsiprkmukyjyspv.supabase.co');
const dbEnv=readFileSync('.env.db.local','utf8');
const dbUrl=new URL(dbEnv.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^['"]|['"]$/g,'')); dbUrl.search='';
assert.ok(['db.bdkrihsiprkmukyjyspv.supabase.co','aws-0-ap-northeast-2.pooler.supabase.com'].includes(dbUrl.hostname));
const db=new pg.Client({connectionString:dbUrl.toString(),ssl:{ca:readFileSync('supabase/certs/prod-ca-2021.crt','utf8'),rejectUnauthorized:true}});
const accounts=JSON.parse(readFileSync('.workspace-accounts.local.json','utf8')).accounts;
const admin=createClient(value('NEXT_PUBLIC_SUPABASE_URL'),value('SUPABASE_SECRET_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
const sessions=[];
async function session(role) {
  const jar=new Map();
  const supabase=createServerClient(value('NEXT_PUBLIC_SUPABASE_URL'),value('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:cookies=>cookies.forEach(({name,value})=>jar.set(name,value))}});
  const login=await supabase.auth.signInWithPassword({email:accounts[role].email,password:accounts[role].password});assert.equal(login.error,null);
  const auth={supabase,cookie:()=>[...jar].map(([name,value])=>`${name}=${value}`).join('; '),id:login.data.user.id};sessions.push(auth);return auth;
}
const caseId=randomUUID(),service=randomUUID(),version=randomUUID();
const tickets=[], permanent=[];
let created=false;
async function page(auth,path) {
  const response=await fetch(new URL(path,base),{headers:{cookie:auth.cookie()}});
  assert.equal(response.status,200);assert.equal(new URL(response.url).pathname,path);
  return response.text();
}
async function upload(auth,target,fields,name,bytes) {
  const headers={'Content-Type':'application/json',cookie:auth.cookie(),origin:base.origin};
  const prepared=await fetch(new URL('/api/uploads/prepare',base),{method:'POST',headers,body:JSON.stringify({target,fields,name,size:bytes.length})});
  assert.equal(prepared.status,200,`Prepare failed: ${prepared.status}`);
  const result=await prepared.json();tickets.push({id:result.ticket,user:auth.id});
  const put=await fetch(result.signedUrl,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes});assert.ok(put.ok,`Upload failed: ${put.status}`);
  const response=await fetch(new URL(target,base),{method:'POST',headers,redirect:'manual',body:JSON.stringify({fields:Object.entries(fields),files:[{field:'file',ticket:result.ticket}]})});
  assert.equal(response.status,303,`Finalize failed: ${response.status}`);
  assert.ok(response.headers.get('location')?.includes('Uploaded=1'),`Finalization did not succeed`);
}
try {
  await db.connect();
  const owner=await session('owner'),client=await session('client');
  const card=(await db.query('select id from public.clients where user_id=$1',[client.id])).rows[0].id;
  assert.equal((await db.query('select can_confirm_payments from public.staff_members where user_id=$1',[owner.id])).rows[0].can_confirm_payments,true,'Test requires already authorized financial owner; no permissions are changed');
  await db.query('begin');
  await db.query("insert into public.service_templates(id,code,name) values($1,$2,'QA financial regression')",[service,`qa-${service}`]);
  await db.query('insert into public.service_template_versions(id,service_id,version_no,published_at) values($1,$2,1,now())',[version,service]);
  await db.query("insert into public.cases(id,case_number,client_id,service_version_id,title) values($1,$2,$3,$4,'QA temporary financial regression')",[caseId,`QA-${caseId}`,card,version]);
  await db.query('commit');created=true;
  const template=readFileSync('scripts/fixtures/storage-check.pdf');
  const big=Buffer.concat([template,Buffer.alloc(5*1024*1024,32),Buffer.from('\n%%EOF')]);
  const key=randomUUID();permanent.push(`contracts/${caseId}/${key}.pdf`);
  await upload(owner,'/api/contracts',{caseId,key,contractNumber:'QA-ONLY',price:'100000',signedOn:''},'qa-contract.pdf',big);
  const contract=(await db.query('select id from public.contracts where case_id=$1',[caseId])).rows[0].id;
  const download=await fetch(new URL(`/api/contracts/${contract}`,base),{headers:{cookie:client.cookie()}});
  assert.equal(download.status,200);assert.equal(download.headers.get('content-length'),null,'File response must stream');
  assert.equal(createHash('sha256').update(Buffer.from(await download.arrayBuffer())).digest('hex'),createHash('sha256').update(big).digest('hex'));
  assert.equal((await fetch(new URL(`/api/contracts/${contract}`,base))).status,401);
  for (let i=0;i<2;i++) {
    const term=await owner.supabase.rpc('staff_add_payment_installment',{p_case_id:caseId,p_due_on:'2026-10-18',p_amount_kzt:50000,p_description:'QA only'});assert.equal(term.error,null);
  }
  const staffHtml=await page(owner,`/staff/cases/${caseId}/payments`);
  assert.ok(staffHtml.includes('Подтвердить банковский перевод'));
  assert.ok(staffHtml.includes('Отменить неоплаченный остаток срока'));
  const before=await page(client,`/account/cases/${caseId}`);
  assert.ok(before.includes('Откройте реквизиты и график'));
  assert.ok(!before.includes('Сейчас от вас ничего не требуется.'));
  const receiptKey=randomUUID();permanent.push(`receipts/${caseId}/${client.id}/${receiptKey}.pdf`);
  await upload(client,'/api/payment-receipts',{caseId,key:receiptKey},'qa-receipt.pdf',template);
  const pending=await page(client,`/account/cases/${caseId}`);assert.ok(pending.includes('Ожидается проверка оплаты'));
  const receipt=(await db.query('select id from public.payment_receipts where case_id=$1',[caseId])).rows[0].id;
  assert.equal((await owner.supabase.rpc('staff_review_payment_receipt',{p_receipt_id:receipt,p_accept:true,p_note:'QA verification'})).error,null);
  const payment=await owner.supabase.rpc('staff_record_payment',{p_case_id:caseId,p_amount_kzt:100000,p_paid_on:'2026-10-18',p_reference:`QA-${randomUUID()}`,p_client_note:'QA only',p_idempotency_key:randomUUID(),p_receipt_id:receipt});assert.equal(payment.error,null);
  const paid=await page(client,`/account/cases/${caseId}/payments`);
  assert.ok(paid.includes('Оплата подтверждена по этому чеку'));assert.ok(paid.includes('Реквизиты пока не опубликованы'));
  assert.ok((await page(client,`/account/cases/${caseId}`)).includes('Сейчас от вас ничего не требуется.'));
  assert.equal((await owner.supabase.rpc('staff_close_case',{p_case_id:caseId,p_result_summary:'QA complete'})).error,null);
  const closed=await page(client,`/account/cases/${caseId}/payments`);assert.ok(closed.includes('Отправить чек на проверку'));
  const profile=await page(client,'/account/profile');assert.ok(profile.includes('name="expectedUpdatedAt"'));
  const edit=await page(owner,`/staff/clients/${card}`);assert.ok(edit.includes('Сохранить исправление'));
  const settings=await page(owner,'/staff/settings');assert.ok(settings.includes('Сохранить контакты и реквизиты'));
  console.log('OK local HTTP + real Supabase: authorized direct upload/finalization, streamed 5MB download/hash/privacy, financial pages, two-installment transfer/receipt, client action states, closed receipt form, profile and settings.');
} finally {
  await db.query('rollback').catch(()=>{});
  if(created) {
    await db.query('begin');
    // Immutable history is bypassed only inside this cleanup transaction and
    // only for this run\'s synthetic case, never for pre-existing records.
    await db.query("set local session_replication_role='replica'");
    const fixture=await db.query('select id from public.cases where id=$1 and case_number=$2',[caseId,`QA-${caseId}`]);
    assert.equal(fixture.rows.length,1,'Refuse cleanup unless the exact test case is present');
    for(const table of ['payment_allocations','payments','payment_receipts','payment_schedule','contracts','notifications','audit_events']) await db.query(`delete from public.${table} where case_id=$1`,[caseId]);
    await db.query('delete from public.cases where id=$1',[caseId]);
    await db.query('delete from public.service_template_versions where id=$1',[version]);
    await db.query('delete from public.service_templates where id=$1',[service]);
    await db.query('commit');
  }
  if(permanent.length) { const r=await admin.storage.from('modernsecure-files').remove(permanent);assert.equal(r.error,null); }
  for(const ticket of tickets) {
    assert.equal((await admin.storage.from('modernsecure-staging').remove([`${ticket.user}/${ticket.id}`])).error,null);
    assert.equal((await admin.from('temporary_uploads').delete().eq('id',ticket.id)).error,null);
  }
  for(const auth of sessions) await auth.supabase.auth.signOut({scope:'local'});
  await db.end();
  console.log('Isolated case, files, tickets, payments and related test history removed. Existing client and settings unchanged.');
}
