import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const source = readFileSync('.env.db.local', 'utf8');
const raw = source.split(/\r?\n/).find(x => x.startsWith('DATABASE_URL=')).slice(13).trim().replace(/^['"]|['"]$/g, '');
const url = new URL(raw); url.search = '';
assert.ok(url.hostname === 'db.bdkrihsiprkmukyjyspv.supabase.co' || (url.hostname === 'aws-0-ap-northeast-2.pooler.supabase.com' && url.username === 'postgres.bdkrihsiprkmukyjyspv'));
const db = new pg.Client({connectionString:url.toString(),ssl:{ca:readFileSync('supabase/certs/prod-ca-2021.crt','utf8'),rejectUnauthorized:true}});
async function asUser(id, sql, values = []) {
  await db.query('savepoint role_test');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);
    await db.query('set local role authenticated');
    const result = await db.query(sql, values);
    await db.query('reset role');
    await db.query('release savepoint role_test');
    return result;
  } catch(error) { await db.query('rollback to savepoint role_test'); throw error; }
}
try {
  await db.connect(); await db.query('begin');
  const exists = await db.query("select 1 from information_schema.columns where table_schema='public' and table_name='staff_members' and column_name='is_primary_admin'");
  if (!exists.rowCount) await db.query(readFileSync('supabase/migrations/20261017008400_primary_administrator.sql','utf8'));
  const owner = (await db.query('select user_id from public.staff_members where is_primary_admin')).rows[0].user_id;
  const admin = randomUUID(), other = randomUUID(), lawyer = randomUUID(), client = randomUUID(), invited = randomUUID();
  for (const id of [admin,other,lawyer,client,invited]) await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`${id}@example.test`]);
  for (const [id,role] of [[admin,'admin'],[other,'admin'],[lawyer,'lawyer']]) await db.query('insert into public.staff_members(user_id,display_name,role) values($1,$2,$3)',[id,'Transactional role test',role]);
  const access = 'select public.admin_set_staff_access($1,$2,$3,$4)';
  const args = (id,role,active=true) => [id,role,active,'Transactional hierarchy test'];
  for (const id of [owner,other]) {
    await assert.rejects(asUser(admin,access,args(id,'manager')),/Protected administrator/);
    await assert.rejects(asUser(admin,'select public.admin_set_payment_permission($1,true,$2)',[id,'test']),/Protected administrator/);
  }
  await assert.rejects(asUser(admin,access,args(lawyer,'admin')),/Invalid staff access/);
  await assert.rejects(asUser(client,access,args(lawyer,'manager')),/Not authorized/);
  await assert.rejects(asUser(lawyer,access,args(admin,'manager')),/Not authorized/);
  await asUser(admin,access,args(lawyer,'manager'));
  await asUser(owner,access,args(other,'admin',false));
  await asUser(owner,access,args(other,'admin',true));
  await asUser(owner,access,args(other,'manager'));
  await asUser(owner,access,args(other,'admin'));
  await assert.rejects(asUser(owner,access,args(owner,'manager')),/Invalid staff access/);
  await assert.rejects(asUser(admin,'select public.admin_add_staff($1,$2,$3)',[`${invited}@example.test`,'New admin','admin']),/Invalid staff details/);
  await asUser(owner,'select public.admin_add_staff($1,$2,$3)',[`${invited}@example.test`,'New admin','admin']);
  const email = `${randomUUID()}@example.test`;
  await assert.rejects(asUser(admin,'select public.admin_invite_staff($1,$2,$3)',[email,'Invitation','admin']),/Invalid staff invitation/);
  await asUser(owner,'select public.admin_invite_staff($1,$2,$3)',[email,'Invitation','admin']);
  const inviteId = (await db.query('select id from public.staff_invites where email=$1',[email])).rows[0].id;
  await assert.rejects(asUser(admin,'select public.admin_invite_staff($1,$2,$3)',[email,'Overwrite','lawyer']),/Protected administrator/);
  await assert.rejects(asUser(admin,'select public.admin_cancel_staff_invite($1)',[inviteId]),/Protected administrator/);
  await asUser(owner,'select public.admin_cancel_staff_invite($1)',[inviteId]);
  const status = await asUser(owner,'select public.staff_mfa_status() as status');
  assert.equal(status.rows[0].status.is_primary_admin,true);
  assert.equal((await asUser(admin,'select public.staff_mfa_status() as status')).rows[0].status.is_primary_admin,false);
  await assert.rejects(asUser(admin,'update public.staff_members set is_primary_admin=true where user_id=$1',[admin]),/permission denied/);
  console.log('OK primary administrator: invitations, promotions, demotions, activation, finance, self-protection and escalation denial; all changes rolled back');
} finally { await db.query('rollback').catch(()=>{}); await db.end(); }
