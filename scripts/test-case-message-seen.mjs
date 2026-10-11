import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const client = "10000000-0000-4000-8000-000000000001";
const staff = "10000000-0000-4000-8000-000000000002";
const stranger = "10000000-0000-4000-8000-000000000003";
const caseId = "20000000-0000-4000-8000-000000000001";
const otherCase = "20000000-0000-4000-8000-000000000002";
const first = "30000000-0000-4000-8000-000000000001";
const unseen = "30000000-0000-4000-8000-000000000002";
const tiedFirst = "30000000-0000-4000-8000-000000000003";
const tiedSecond = "30000000-0000-4000-8000-000000000004";

async function asUser(userId, sql, params = []) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
  try { return await db.query(sql, params); }
  finally { await db.exec("reset role"); }
}

const seen = (userId, targetCase, messageId) => asUser(userId,
  "select public.mark_case_messages_seen($1,$2) as changed", [targetCase, messageId]);

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
    create table public.messages (id uuid primary key, case_id uuid not null, sender_user_id uuid not null,
      created_at timestamptz not null);
    create table public.message_reads (message_id uuid not null, reader_user_id uuid not null,
      primary key (message_id, reader_user_id));
    create table public.notifications (recipient_user_id uuid not null, case_id uuid not null,
      kind text not null, dedupe_key text not null, read_at timestamptz);
    create function private.can_read_case(p_case_id uuid) returns boolean
      language sql stable security definer set search_path = '' as $$
        select exists (select 1 from public.cases c where c.id = p_case_id and c.client_user_id = auth.uid())
          or exists (select 1 from public.case_assignments ca
            where ca.case_id = p_case_id and ca.staff_user_id = auth.uid() and ca.revoked_at is null)
      $$;
    grant usage on schema auth, public to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
  await db.exec(readFileSync("supabase/migrations/20261012007600_case_message_seen_cursor.sql", "utf8"));
  await db.query("insert into public.cases values ($1,$2),($3,$4)", [caseId, client, otherCase, stranger]);
  await db.query("insert into public.case_assignments values ($1,$2,null)", [caseId, staff]);
  await db.query(`insert into public.messages values
    ($1,$5,$6,'2026-10-11T00:00:00Z'),
    ($2,$5,$6,'2026-10-11T00:00:02Z'),
    ($3,$5,$6,'2026-10-11T00:00:01Z'),
    ($4,$5,$6,'2026-10-11T00:00:01Z')`,
  [first, unseen, tiedFirst, tiedSecond, caseId, staff]);
  await db.query("insert into public.messages values (gen_random_uuid(),$1,$2,'2026-10-11T00:00:01Z')", [caseId, client]);
  await db.query(`insert into public.notifications(recipient_user_id,case_id,kind,dedupe_key)
    select $1,$2,'message','message:' || id::text from public.messages
    where case_id=$2 and sender_user_id=$3`, [client, caseId, staff]);
  await db.query("insert into public.notifications values ($1,$2,'task','task:unrelated',null)", [client, caseId]);

  assert.equal(Number((await seen(client, caseId, tiedFirst)).rows[0].changed), 4,
    "Only the two received messages through the visible cursor and their notices change");
  const read = await db.query("select message_id from public.message_reads where reader_user_id=$1 order by message_id", [client]);
  assert.deepEqual(read.rows.map((row) => row.message_id), [first, tiedFirst]);
  const unreadNotices = await db.query("select dedupe_key from public.notifications where recipient_user_id=$1 and read_at is null order by dedupe_key", [client]);
  assert.deepEqual(unreadNotices.rows.map((row) => row.dedupe_key), [`message:${unseen}`, `message:${tiedSecond}`, "task:unrelated"].sort());
  assert.equal(Number((await seen(client, caseId, tiedFirst)).rows[0].changed), 0, "Retry is idempotent");
  await assert.rejects(seen(stranger, caseId, tiedFirst), /Not authorized/);
  await assert.rejects(seen(client, otherCase, tiedFirst), /Not authorized/);
  await assert.rejects(seen(client, caseId, "30000000-0000-4000-8000-000000000099"), /Message is not in this case/);
  await db.query("update public.case_assignments set revoked_at=now() where case_id=$1", [caseId]);
  await assert.rejects(seen(staff, caseId, tiedFirst), /Not authorized/);
  assert.equal((await db.query("select has_function_privilege('anon','public.mark_case_messages_seen(uuid,uuid)','EXECUTE') as allowed")).rows[0].allowed,
    false, "Anonymous callers cannot mark messages read");
  console.log("OK bounded case read marker, concurrent message, tied timestamp, notices and access");
} finally {
  await db.close();
}
