import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const admin = randomUUID(), manager = randomUUID(), lawyer = randomUUID();
const legacy = randomUUID(), fresh = randomUUID(), completed = randomUUID(), invited = randomUUID();
async function as(user, sql, params = []) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)",
    [user, JSON.stringify({ sub: user, aal: 'aal2', role: 'authenticated' })]);
  await db.exec('set role authenticated');
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
const approve = (user, target) => as(user, 'select public.admin_approve_client_registration($1) as id', [target]);
const identity = (user, name, iin = null) => as(user, 'select public.complete_own_client_identity($1,$2)', [name, iin]);
const queue = async (user = admin, search = '', page = 1) =>
  (await as(user, 'select public.admin_client_registrations($1,$2) as result', [search, page])).rows[0].result;

try {
  await db.exec(`create role anon; create role authenticated; create role service_role; create role authenticator;
    create schema auth; create schema storage; create schema extensions;
    create function extensions.digest(text,text) returns bytea language sql as $$ select pg_catalog.sha256(convert_to($1, 'UTF8')) $$;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table auth.mfa_factors(id uuid primary key,user_id uuid,status text);
    create table auth.sessions(id uuid,user_id uuid,aal text,not_after timestamptz);
    create table auth.audit_log_entries(id uuid,created_at timestamptz,payload jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
    grant usage on schema auth,public to authenticated;
    grant execute on function auth.uid(),auth.jwt() to authenticated;
    create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,metadata jsonb,user_metadata jsonb,primary key(bucket_id,name));
    create publication supabase_realtime;
  `);
  for (const file of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()) {
    if (file === '20261011000800_role_boundaries.sql') {
      for (const [id, email] of [[admin, 'ayanz2008@gmail.com'], [manager, 'manager@example.test'], [lawyer, 'lawyer@example.test'], [legacy, 'legacy@example.test']]) {
        await db.query('insert into auth.users values($1,$2,now())', [id, email]);
      }
      for (const [id, role] of [[admin, 'admin'], [manager, 'manager'], [lawyer, 'lawyer']]) {
        await db.query('insert into public.staff_members(user_id,display_name,role) values($1,$2,$2::text::public.staff_role)', [id, role]);
      }
    }
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
  assert.equal((await queue()).items[0].user_id, legacy, 'Previously registered accounts appear without backfill');
  await db.query('insert into auth.users values($1,$2,null)', [fresh, 'fresh@example.test']);
  const freshRow = (await queue(admin, 'FRESH')).items[0];
  assert.equal(freshRow.user_id, fresh, 'Signup is visible before email confirmation or first login');
  assert.equal(freshRow.email_confirmed, false);
  assert.equal(freshRow.has_iin, false);
  for (const actor of [manager, lawyer, fresh, legacy, '']) {
    await assert.rejects(queue(actor), /Not authorized/);
    await assert.rejects(approve(actor, fresh), /Not authorized/);
  }
  await db.exec('set role anon');
  await assert.rejects(db.query('select public.admin_client_registrations()'), /permission denied/);
  await db.exec('reset role');
  await assert.rejects(queue(admin, '', 0), /Invalid registration search/);
  await assert.rejects(queue(admin, 'x'.repeat(121)), /Invalid registration search/);
  await assert.rejects(identity('', 'Anonymous'), /Not authenticated/);
  await assert.rejects(identity(manager, 'Staff'), /Account is already staff/);
  await assert.rejects(approve(admin, lawyer), /Account is already staff/);

  const freshCard = (await approve(admin, fresh)).rows[0].id;
  assert.equal((await approve(admin, fresh)).rows[0].id, freshCard, 'Approval retries are idempotent');
  assert.equal((await queue(admin, 'fresh')).total_count, 0);
  const approved = (await db.query('select * from public.clients where id=$1', [freshCard])).rows[0];
  assert.equal(approved.user_id, fresh);
  assert.equal(approved.iin, null, 'IIN is not needed for approval');
  assert.equal(approved.full_name, 'fresh@example.test', 'No invented name is required');
  assert.equal((await db.query("select count(*)::int as n from public.audit_events where entity_id=$1 and action='registration_approved'", [freshCard])).rows[0].n, 1);
  for (const value of ['123', '1234567890123', '12345678901a', '１２３４５６７８９０１２']) {
    await assert.rejects(identity(fresh, 'Client', value), /Invalid identity/);
  }
  await assert.rejects(identity(fresh, ' \n ', null), /Invalid identity/);
  await identity(fresh, 'Client Full Name');
  await identity(fresh, 'Client Full Name', '000000000001');
  assert.equal((await as(fresh, 'select iin from public.clients where id=$1', [freshCard])).rows[0].iin, '000000000001');
  await assert.rejects(identity(fresh, 'Changed', '000000000002'), /Identity is already completed/);
  await as(fresh, 'select public.update_own_profile($1,$2,$3)', ['Client', '+7 777 123 45 67', 'Almaty']);
  const contacts = (await db.query('select phone,city from public.clients where id=$1', [freshCard])).rows[0];
  assert.deepEqual(contacts, { phone: '+7 777 123 45 67', city: 'Almaty' });
  assert.equal((await as(legacy, 'select * from public.profiles where user_id=$1', [fresh])).rows.length, 0);
  assert.equal((await as(legacy, 'select * from public.clients where id=$1', [freshCard])).rows.length, 0);
  await assert.rejects(as(fresh, 'update public.clients set iin=$1 where id=$2', ['000000000002', freshCard]), /permission denied/);
  assert.ok(!(await db.query('select after_data from public.audit_events where actor_user_id=$1', [fresh])).rows.some(row => JSON.stringify(row).includes('000000000001')), 'IIN must not enter audit payloads');

  await db.query('insert into auth.users values($1,$2,now())', [completed, 'completed@example.test']);
  await identity(completed, 'Before Approval', '000000000003');
  const completedRow = (await queue(admin, 'Before Approval')).items[0];
  assert.equal(completedRow.has_iin, true);
  assert.equal('iin' in completedRow, false, 'Queue never returns full government identifiers');
  const completedCard = (await approve(admin, completed)).rows[0].id;
  assert.equal((await db.query('select iin from public.clients where id=$1', [completedCard])).rows[0].iin, '000000000003');

  await as(admin, 'select public.admin_invite_staff($1,$2,$3)', ['invited@example.test', 'Invited staff', 'lawyer']);
  await db.query('insert into auth.users values($1,$2,null)', [invited, 'invited@example.test']);
  assert.equal((await queue(admin, 'invited')).total_count, 0);
  await assert.rejects(approve(admin, invited), /staff invitation/);
  await db.query('update auth.users set email_confirmed_at=now() where id=$1', [invited]);
  await as(invited, 'select public.claim_staff_invite()');
  assert.equal((await queue(admin, 'invited')).total_count, 0);

  const matching = (await as(admin, 'select public.staff_create_client($1,$2,null,null) as id', ['Existing client', 'legacy@example.test'])).rows[0].id;
  assert.equal((await queue(admin, 'legacy')).items[0].matching_client_id, matching);
  await assert.rejects(approve(admin, legacy), /Existing client card/);
  await db.query('update auth.users set email_confirmed_at=null where id=$1', [legacy]);
  await assert.rejects(as(admin, 'select public.link_client_account($1,$2)', [matching, 'legacy@example.test']), /Verified account not found/);
  await db.query('update auth.users set email_confirmed_at=now() where id=$1', [legacy]);
  await as(admin, 'select public.link_client_account($1,$2)', [matching, 'legacy@example.test']);
  assert.equal((await queue(admin, 'legacy')).total_count, 0);

  for (let index = 0; index < 26; index++) await db.query('insert into auth.users values($1,$2,null)', [randomUUID(), `paging-${index}@example.test`]);
  const last = await queue(admin, 'paging-', 10000);
  assert.equal(last.total_count, 26);
  assert.equal(last.page, 2);
  assert.equal(last.items.length, 1);
  assert.equal((await queue(admin, 'no-match', 10000)).page, 1);
  await db.query('update public.staff_members set active=false where user_id=$1', [manager]);
  assert.equal((await queue(admin, 'manager')).total_count, 0, 'Inactive staff never become pending clients');
  console.log('OK registration queue, existing accounts, role guards, unconfirmed signup, approval retries, optional IIN, identity privacy, contact sync, staff invitations, existing-card linking and pagination');
} catch (error) {
  console.error(error.message, error.where ?? '', error.query ?? '');
  process.exitCode = 1;
} finally { await db.close(); }
