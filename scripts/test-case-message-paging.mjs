import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const pg = new PGlite();
const client = "10000000-0000-4000-8000-000000000001";
const staff = "10000000-0000-4000-8000-000000000002";
const stranger = "10000000-0000-4000-8000-000000000003";
const caseId = "20000000-0000-4000-8000-000000000001";
const otherCase = "20000000-0000-4000-8000-000000000002";

async function asUser(userId, sql, params = []) {
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await pg.exec("set role authenticated");
  try { return await pg.query(sql, params); }
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
    create table public.cases (id uuid primary key);
    create table public.case_access (case_id uuid not null, user_id uuid not null);
    create table public.messages (id uuid primary key default gen_random_uuid(),
      case_id uuid not null, sender_user_id uuid not null, body text not null,
      created_at timestamptz not null default now());
    create function private.can_read_case(p_case_id uuid) returns boolean
      language sql stable security definer set search_path = '' as $$
        select exists (select 1 from public.case_access a
          where a.case_id = p_case_id and a.user_id = auth.uid())
      $$;
  `);
  await pg.exec(readFileSync("supabase/migrations/20261011006000_case_message_paging.sql", "utf8"));
  await pg.query("insert into public.cases values ($1),($2)", [caseId, otherCase]);
  await pg.query("insert into public.case_access values ($1,$2),($1,$3)", [caseId, client, staff]);
  await pg.query(`insert into public.messages(case_id,sender_user_id,body,created_at)
    select $1, $2, 'History ' || n,
      now() - interval '2 days' + (n / 3) * interval '1 second'
    from generate_series(1,208) as g(n)`, [caseId, client]);
  const query = "select * from public.case_message_page($1,$2,$3,$4)";
  const seen = new Set();
  let beforeAt = null;
  let beforeId = null;
  let pages = 0;
  do {
    const rows = (await asUser(client, query, [caseId, beforeAt, beforeId, 51])).rows;
    const visible = rows.slice(0, 50);
    assert(visible.length > 0);
    for (const row of visible) {
      assert(!seen.has(row.id), "A history page repeated a message");
      seen.add(row.id);
    }
    pages++;
    if (pages === 1) {
      await pg.query(`insert into public.messages(case_id,sender_user_id,body,created_at)
        values ($1,$2,'New while paging',now() + interval '1 day')`, [caseId, staff]);
    }
    if (rows.length <= 50) break;
    beforeAt = visible.at(-1).created_at;
    beforeId = visible.at(-1).id;
  } while (pages < 10);
  assert.equal(seen.size, 208);
  assert.equal(pages, 5);
  const newest = (await asUser(staff, query, [caseId, null, null, 1])).rows[0];
  assert.equal(newest.body, "New while paging");
  await assert.rejects(asUser(stranger, query, [caseId, null, null, 51]), /Not authorized/);
  await assert.rejects(asUser(client, query, [otherCase, null, null, 51]), /Not authorized/);
  await assert.rejects(asUser(client, query, [caseId, new Date().toISOString(), null, 51]), /invalid page/);
  await assert.rejects(asUser(client, query, [caseId, null, null, null]), /invalid page/);
  await pg.query("delete from public.case_access where case_id=$1 and user_id=$2", [caseId, staff]);
  await assert.rejects(asUser(staff, query, [caseId, null, null, 51]), /Not authorized/);
  console.log("OK case history cursor, same-time ordering, new-message stability and access revocation");
} finally {
  await pg.close();
}
