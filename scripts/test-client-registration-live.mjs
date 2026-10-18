import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const source = readFileSync('.env.db.local', 'utf8');
const raw = source.split(/\r?\n/).find(line => line.startsWith('DATABASE_URL=')).slice(13).trim().replace(/^['"]|['"]$/g, '');
const url = new URL(raw); url.search = '';
assert.ok(url.hostname === 'db.bdkrihsiprkmukyjyspv.supabase.co'
  || (url.hostname === 'aws-0-ap-northeast-2.pooler.supabase.com' && url.username === 'postgres.bdkrihsiprkmukyjyspv'));
const db = new pg.Client({ connectionString: url.toString(), ssl: {
  ca: readFileSync('supabase/certs/prod-ca-2021.crt', 'utf8'), rejectUnauthorized: true,
}, connectionTimeoutMillis: 12000 });

async function as(userId, sql, values = []) {
  await db.query('savepoint registration_check');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)",
      [userId, JSON.stringify({ sub: userId, role: 'authenticated', aal: 'aal2' })]);
    await db.query('set local role authenticated');
    const result = await db.query(sql, values);
    await db.query('reset role');
    await db.query('release savepoint registration_check');
    return result;
  } catch (error) {
    await db.query('rollback to savepoint registration_check');
    throw error;
  }
}

try {
  await db.connect();
  await db.query('begin');
  const exists = (await db.query("select to_regprocedure('public.admin_client_registrations(text,integer)') as fn")).rows[0].fn;
  if (!exists) await db.query(readFileSync('supabase/migrations/20261018008500_client_registration_approval.sql', 'utf8'));
  const admin = (await db.query('select user_id from public.staff_members where is_primary_admin')).rows[0].user_id;
  const user = randomUUID(), other = randomUUID(), email = `${randomUUID()}@example.test`;
  await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [user, email, other, `${other}@example.test`]);
  const result = (await as(admin, 'select public.admin_client_registrations($1,1) as result', [email])).rows[0].result;
  assert.equal(result.total_count, 1);
  assert.equal(result.items[0].user_id, user);
  assert.equal(result.items[0].email_confirmed, false);
  await assert.rejects(as(user, 'select public.admin_client_registrations()'), /Not authorized/);
  await assert.rejects(as(user, 'select public.admin_approve_client_registration($1)', [user]), /Not authorized/);
  const card = (await as(admin, 'select public.admin_approve_client_registration($1) as id', [user])).rows[0].id;
  assert.equal((await as(admin, 'select public.admin_approve_client_registration($1) as id', [user])).rows[0].id, card);
  assert.equal((await db.query('select iin from public.clients where id=$1', [card])).rows[0].iin, null);
  await as(user, 'select public.complete_own_client_identity($1,$2)', ['Transactional Test', '000000000001']);
  await assert.rejects(as(user, 'select public.complete_own_client_identity($1,$2)', ['Changed', '000000000002']), /Identity is already completed/);
  assert.equal((await as(other, 'select * from public.clients where id=$1', [card])).rowCount, 0);
  assert.equal((await as(other, 'select * from public.profiles where user_id=$1', [user])).rowCount, 0);
  await as(user, 'select public.update_own_profile($1,$2,$3)', ['Test', '+7 777 123 45 67', 'Almaty']);
  assert.equal((await db.query('select city from public.clients where id=$1', [card])).rows[0].city, 'Almaty');
  assert.equal((await as(admin, 'select public.admin_client_registrations($1,1) as result', [email])).rows[0].result.total_count, 0);
  console.log('OK connected database: immediate registration visibility, admin approval, retries, delayed IIN, privacy and contact sync. Synthetic data and any trial migration rolled back.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.query('rollback').catch(() => {});
  await db.end();
}
