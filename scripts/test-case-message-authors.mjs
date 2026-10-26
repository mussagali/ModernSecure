import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const pg = new PGlite();
const client = "10000000-0000-4000-8000-000000000001";
const lawyer = "10000000-0000-4000-8000-000000000002";
const former = "10000000-0000-4000-8000-000000000003";
const stranger = "10000000-0000-4000-8000-000000000004";
const caseId = "20000000-0000-4000-8000-000000000001";
const otherCase = "20000000-0000-4000-8000-000000000002";
const clientId = "30000000-0000-4000-8000-000000000001";

async function asUser(userId, caseToRead) {
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await pg.exec("set role authenticated");
  try { return await pg.query("select * from public.case_message_authors($1)", [caseToRead]); }
  finally { await pg.exec("reset role"); }
}

try {
  await pg.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create schema private;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to authenticated;
    grant execute on function auth.uid() to authenticated;
    create table public.clients (id uuid primary key, user_id uuid, full_name text not null);
    create table public.cases (id uuid primary key, client_id uuid not null);
    create table public.staff_members (user_id uuid primary key, display_name text not null);
    create table public.messages (id uuid primary key, case_id uuid not null, sender_user_id uuid not null);
    create table public.case_access (case_id uuid not null, user_id uuid not null);
    create function private.can_read_case(p_case_id uuid) returns boolean
      language sql stable security definer set search_path = '' as $$
        select exists (select 1 from public.case_access a
          where a.case_id = p_case_id and a.user_id = auth.uid())
      $$;
  `);
  await pg.exec(readFileSync("supabase/migrations/20261011005900_case_message_authors.sql", "utf8"));
  await pg.query("insert into public.clients values ($1,$2,'Клиент QA')", [clientId, client]);
  await pg.query("insert into public.cases values ($1,$2),($3,$2)", [caseId, clientId, otherCase]);
  await pg.query("insert into public.staff_members values ($1,'Текущий юрист'),($2,'Бывший юрист')", [lawyer, former]);
  await pg.query("insert into public.case_access values ($1,$2),($1,$3)", [caseId, client, lawyer]);
  await pg.query(`insert into public.messages values
    ('40000000-0000-4000-8000-000000000001',$1,$2),
    ('40000000-0000-4000-8000-000000000002',$1,$3),
    ('40000000-0000-4000-8000-000000000003',$1,$4)`, [caseId, client, lawyer, former]);
  const expected = new Map([[client, "Клиент QA"], [lawyer, "Текущий юрист"], [former, "Бывший юрист"]]);
  for (const user of [client, lawyer]) {
    const rows = (await asUser(user, caseId)).rows;
    assert.equal(rows.length, 3);
    assert.deepEqual(new Map(rows.map((row) => [row.user_id, row.display_name])), expected);
    assert.deepEqual(Object.keys(rows[0]).sort(), ["display_name", "user_id"]);
  }
  await assert.rejects(asUser(former, caseId), /Not authorized/);
  await assert.rejects(asUser(stranger, caseId), /Not authorized/);
  await assert.rejects(asUser(client, otherCase), /Not authorized/);
  await assert.rejects(asUser(client, "20000000-0000-4000-8000-000000000099"), /Not authorized/);
  console.log("OK case message author names, former staff history and case-scoped access");
} finally {
  await pg.close();
}
