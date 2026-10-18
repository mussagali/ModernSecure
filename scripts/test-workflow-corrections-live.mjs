import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runWorkflowCorrections } from './fixtures/workflow-corrections.mjs';

const env = readFileSync('.env.db.local', 'utf8');
const raw = env.split(/\r?\n/).find(line=>line.startsWith('DATABASE_URL=')).slice(13).trim().replace(/^['"]|['"]$/g,'');
const url = new URL(raw); url.search = '';
if (!['db.bdkrihsiprkmukyjyspv.supabase.co','aws-0-ap-northeast-2.pooler.supabase.com'].includes(url.hostname)) throw new Error('Unexpected database target');
const connection = new pg.Client({ connectionString: url.toString(), ssl: { ca: readFileSync('supabase/certs/prod-ca-2021.crt','utf8'), rejectUnauthorized: true }, connectionTimeoutMillis: 12000 });
// Every expected failure stays inside a savepoint; all synthetic data rolls back.
const db = {
  async query(sql, params=[]) {
    await connection.query('savepoint regression_statement');
    try { const result=await connection.query(sql,params); await connection.query('release savepoint regression_statement'); return result; }
    catch(error) { await connection.query('rollback to savepoint regression_statement'); await connection.query('release savepoint regression_statement'); throw error; }
  },
  async exec(sql) { return this.query(sql); },
};
async function as(user,sql,params=[]) {
  await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[user,JSON.stringify({sub:user,role:'authenticated',aal:'aal2'})]);
  await db.exec('set local role authenticated');
  try { return await db.query(sql,params); } finally { await db.exec('reset role'); }
}
try {
  await connection.connect(); await connection.query('begin'); await connection.query("set local statement_timeout='15s'");
  const admin=(await db.query('select user_id from public.staff_members where is_primary_admin')).rows[0].user_id;
  const lawyer=randomUUID(), legacy=randomUUID();
  for(const id of [lawyer,legacy]) await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`${id}@example.test`]);
  await db.query("insert into public.staff_members(user_id,display_name,role) values($1,'Workflow test lawyer','lawyer')",[lawyer]);
  const approve=(user,target)=>as(user,'select public.admin_approve_client_registration($1) as id',[target]);
  const identity=(user,name,iin)=>as(user,'select public.complete_own_client_identity($1,$2)',[name,iin]);
  await runWorkflowCorrections({db,admin,lawyer,legacy,as,approve,identity});
} finally {
  await connection.query('rollback').catch(()=>{}); await connection.end();
  console.log('ROLLBACK: synthetic accounts, cases, payments and audit records removed; existing data unchanged.');
}
