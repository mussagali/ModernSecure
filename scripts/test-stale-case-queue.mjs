import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const admin = "10000000-0000-4000-8000-000000000001";
const lawyer = "10000000-0000-4000-8000-000000000002";
const manager = "10000000-0000-4000-8000-000000000003";
const client = "10000000-0000-4000-8000-000000000004";
const oldCase = "20000000-0000-4000-8000-000000000001";
const updatedCase = "20000000-0000-4000-8000-000000000002";
const managerCase = "20000000-0000-4000-8000-000000000003";
const closedCase = "20000000-0000-4000-8000-000000000004";

async function asUser(userId, sql, params = []) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
  try { return await db.query(sql, params); }
  finally { await db.exec("reset role"); }
}
const page = (userId, pageNo = 1) => asUser(userId,
  "select * from public.staff_stale_case_page($1)", [pageNo]);

try {
  await db.exec(`
    create role authenticated;
    create role anon;
    create schema auth;
    create schema private;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create type public.staff_role as enum ('admin', 'lawyer', 'manager');
    create type public.case_status as enum ('open', 'closed', 'cancelled');
    create table public.staff_members (user_id uuid primary key, role public.staff_role not null, active boolean not null);
    create table public.clients (id uuid primary key, full_name text not null);
    create table public.cases (id uuid primary key, case_number text not null, title text not null,
      client_id uuid not null, status public.case_status not null, is_suspended boolean not null,
      created_at timestamptz not null);
    create table public.case_assignments (case_id uuid not null, staff_user_id uuid not null, revoked_at timestamptz);
    create table public.case_stage_events (case_id uuid not null, occurred_at timestamptz not null);
    create table public.audit_events (actor_user_id uuid, entity_type text, action text,
      before_data jsonb, after_data jsonb);
    create function private.staff_role_for_current_user() returns public.staff_role
      language sql stable security definer set search_path = '' as $$
        select sm.role from public.staff_members sm where sm.user_id = auth.uid() and sm.active
      $$;
    grant usage on schema auth, public to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
  await db.exec(readFileSync("supabase/migrations/20261012007700_stale_case_queue.sql", "utf8"));
  await db.query("insert into public.staff_members values ($1,'admin',true),($2,'lawyer',true),($3,'manager',true)", [admin, lawyer, manager]);
  await db.query("insert into public.clients values ($1,'QA Client')", [client]);
  await db.query(`insert into public.cases values
    ($1,'QA-1','Old case',$5,'open',false,now()-interval '20 days'),
    ($2,'QA-2','Recently updated',$5,'open',false,now()-interval '30 days'),
    ($3,'QA-3','Manager case',$5,'open',true,now()-interval '25 days'),
    ($4,'QA-4','Closed case',$5,'closed',false,now()-interval '40 days')`,
  [oldCase, updatedCase, managerCase, closedCase, client]);
  await db.query("insert into public.case_stage_events values ($1,now()-interval '5 days')", [updatedCase]);
  await db.query("insert into public.case_assignments values ($1,$3,null),($2,$3,null),($4,$3,null),($5,$6,null)",
    [oldCase, updatedCase, lawyer, closedCase, managerCase, manager]);

  assert.equal((await asUser(lawyer, "select public.staff_stale_case_days() as days")).rows[0].days, 14);
  assert.deepEqual((await page(lawyer)).rows.map((row) => row.case_id), [oldCase]);
  assert.deepEqual((await page(manager)).rows.map((row) => row.case_id), [managerCase]);
  assert.deepEqual((await page(admin)).rows.map((row) => row.case_id), [managerCase, oldCase]);
  assert.equal(Number((await page(admin)).rows[0].total_count), 2);
  assert.equal((await page(admin)).rows[0].is_suspended, true);
  await assert.rejects(page(client), /Not authorized/);
  await assert.rejects(page(lawyer, 0), /Invalid page/);
  await assert.rejects(asUser(manager, "select public.admin_set_stale_case_days(3)"), /Not authorized/);
  await assert.rejects(asUser(admin, "select public.admin_set_stale_case_days(0)"), /Invalid stale case threshold/);
  assert.equal((await asUser(admin, "select public.admin_set_stale_case_days(3) as days")).rows[0].days, 3);
  assert.deepEqual((await page(lawyer)).rows.map((row) => row.case_id), [oldCase, updatedCase]);
  await asUser(admin, "select public.admin_set_stale_case_days(3)");
  assert.equal((await db.query("select count(*)::integer as n from public.audit_events")).rows[0].n, 1,
    "Threshold changes are audited once, identical saves are not");
  assert.equal((await db.query("select has_table_privilege('authenticated','private.staff_work_settings','SELECT') as allowed")).rows[0].allowed,
    false, "Staff cannot read internal settings table directly");
  await db.query("update public.case_assignments set revoked_at=now() where case_id=$1 and staff_user_id=$2", [oldCase, lawyer]);
  assert.deepEqual((await page(lawyer)).rows.map((row) => row.case_id), [updatedCase]);
  console.log("OK stale queue: threshold, stage updates, role scope, suspension, audit and revocation");
} finally {
  await db.close();
}
