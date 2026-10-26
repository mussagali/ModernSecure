import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const client = "10000000-0000-4000-8000-000000000001";
const staff = "10000000-0000-4000-8000-000000000002";
const stranger = "10000000-0000-4000-8000-000000000003";
const caseId = "20000000-0000-4000-8000-000000000001";
const otherCaseId = "20000000-0000-4000-8000-000000000002";

async function countAs(userId, targetCase = caseId) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
  try {
    const result = await db.query("select public.case_unread_message_count($1) as count", [targetCase]);
    return Number(result.rows[0].count);
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
    create table public.cases (id uuid primary key, client_user_id uuid not null);
    create table public.case_assignments (case_id uuid not null, staff_user_id uuid not null, revoked_at timestamptz);
    create table public.messages (id uuid primary key default gen_random_uuid(), case_id uuid not null, sender_user_id uuid not null);
    create table public.message_reads (message_id uuid not null, reader_user_id uuid not null,
      primary key (message_id, reader_user_id));
    create function private.can_read_case(p_case_id uuid) returns boolean
      language sql stable security definer set search_path = '' as $$
        select exists (select 1 from public.cases c where c.id = p_case_id and c.client_user_id = auth.uid())
          or exists (select 1 from public.case_assignments ca
            where ca.case_id = p_case_id and ca.staff_user_id = auth.uid() and ca.revoked_at is null)
      $$;
    grant usage on schema auth, public to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
  await db.exec(readFileSync("supabase/migrations/20261012007400_case_unread_message_count.sql", "utf8"));
  await db.query("insert into public.cases values ($1,$2),($3,$4)", [caseId, client, otherCaseId, stranger]);
  await db.query("insert into public.case_assignments values ($1,$2,null)", [caseId, staff]);
  await db.query("insert into public.messages (case_id, sender_user_id) select $1,$2 from generate_series(1,1002)", [caseId, staff]);
  await db.query("insert into public.messages (case_id, sender_user_id) values ($1,$2),($3,$2)", [caseId, client, otherCaseId]);

  assert.equal(await countAs(client), 1002, "count must not stop at the PostgREST 1000-row limit");
  assert.equal(await countAs(staff), 1, "own messages are excluded from staff unread count");
  await db.query("insert into public.message_reads select id,$1 from public.messages where case_id=$2 and sender_user_id=$3 limit 2", [client, caseId, staff]);
  assert.equal(await countAs(client), 1000, "read markers lower the exact count");
  await assert.rejects(countAs(stranger), /Not authorized/);
  await assert.rejects(countAs(client, otherCaseId), /Not authorized/);
  await db.query("update public.case_assignments set revoked_at=now() where case_id=$1", [caseId]);
  await assert.rejects(countAs(staff), /Not authorized/);
  const permission = await db.query("select has_function_privilege('anon','public.case_unread_message_count(uuid)','EXECUTE') as allowed");
  assert.equal(permission.rows[0].allowed, false, "anonymous callers cannot execute the count RPC");
  console.log("OK exact unread count beyond 1000 messages, own/read exclusion and case access");
} finally {
  await db.close();
}
