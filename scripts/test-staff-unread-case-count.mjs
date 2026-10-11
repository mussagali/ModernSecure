import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const lawyer = "10000000-0000-4000-8000-000000000001";
const manager = "10000000-0000-4000-8000-000000000002";
const admin = "10000000-0000-4000-8000-000000000003";
const client = "10000000-0000-4000-8000-000000000004";
const caseOne = "20000000-0000-4000-8000-000000000001";
const caseTwo = "20000000-0000-4000-8000-000000000002";
const caseThree = "20000000-0000-4000-8000-000000000003";
const messageOne = "30000000-0000-4000-8000-000000000001";

async function countAs(userId) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
  try {
    return Number((await db.query("select public.staff_unread_case_count() as count")).rows[0].count);
  } finally {
    await db.exec("reset role");
  }
}

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
    create table public.staff_members (user_id uuid primary key, role public.staff_role not null, active boolean not null);
    create table public.cases (id uuid primary key);
    create table public.case_assignments (case_id uuid not null, staff_user_id uuid not null, revoked_at timestamptz);
    create table public.messages (id uuid primary key, case_id uuid not null, sender_user_id uuid not null);
    create table public.message_reads (message_id uuid not null, reader_user_id uuid not null,
      primary key (message_id, reader_user_id));
    create function private.staff_role_for_current_user() returns public.staff_role
      language sql stable security definer set search_path = '' as $$
      select s.role from public.staff_members s where s.user_id = auth.uid() and s.active
      $$;
    grant usage on schema auth, public to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
  await db.exec(readFileSync("supabase/migrations/20261012007000_staff_unread_case_count.sql", "utf8"));
  await db.query("insert into public.staff_members values ($1,'lawyer',true),($2,'manager',true),($3,'admin',true)", [lawyer, manager, admin]);
  await db.query("insert into public.cases values ($1),($2),($3)", [caseOne, caseTwo, caseThree]);
  await db.query("insert into public.case_assignments values ($1,$3,null),($2,$4,null)", [caseOne, caseTwo, lawyer, manager]);
  await db.query("insert into public.messages values ($1,$2,$3),(gen_random_uuid(),$2,$4),(gen_random_uuid(),$5,$3),(gen_random_uuid(),$6,$3)",
    [messageOne, caseOne, client, lawyer, caseTwo, caseThree]);

  assert.equal(await countAs(lawyer), 1, "lawyer sees only their assigned unread case");
  assert.equal(await countAs(manager), 1, "manager sees only their assigned unread case");
  assert.equal(await countAs(admin), 3, "admin sees all unread cases");
  await assert.rejects(countAs(client), /Not authorized/);

  await db.query("insert into public.message_reads values ($1,$2)", [messageOne, lawyer]);
  assert.equal(await countAs(lawyer), 0, "read message clears the case badge");
  await db.query("update public.case_assignments set revoked_at=now() where case_id=$1 and staff_user_id=$2", [caseTwo, manager]);
  assert.equal(await countAs(manager), 0, "revoked assignment clears access and badge");
  await db.query("update public.staff_members set active=false where user_id=$1", [lawyer]);
  await assert.rejects(countAs(lawyer), /Not authorized/);
  console.log("OK unread case count, read state, case scope, revocation and active role");
} finally {
  await db.close();
}
