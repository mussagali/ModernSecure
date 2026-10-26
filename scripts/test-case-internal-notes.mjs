import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const pg = new PGlite();
const client = "10000000-0000-4000-8000-000000000001";
const lawyer = "10000000-0000-4000-8000-000000000002";
const manager = "10000000-0000-4000-8000-000000000003";
const admin = "10000000-0000-4000-8000-000000000004";
const stranger = "10000000-0000-4000-8000-000000000005";
const caseId = "20000000-0000-4000-8000-000000000001";
const otherCase = "20000000-0000-4000-8000-000000000002";
const key = "30000000-0000-4000-8000-000000000001";

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
    create type public.staff_role as enum ('lawyer', 'manager', 'admin');
    create table public.staff_members(user_id uuid primary key, display_name text not null,
      role public.staff_role not null, active boolean not null default true);
    create table public.cases(id uuid primary key);
    create table public.case_assignments(case_id uuid not null, staff_user_id uuid not null,
      revoked_at timestamptz);
    create table public.case_internal_notes(id uuid primary key default gen_random_uuid(),
      case_id uuid not null references public.cases(id), author_user_id uuid not null,
      body text not null, created_at timestamptz not null default now());
    create table public.audit_events(id bigint generated always as identity primary key,
      actor_user_id uuid, case_id uuid, entity_type text, entity_id uuid,
      action text, occurred_at timestamptz default now());
    create function private.is_staff_for_case(p_case_id uuid) returns boolean
      language sql stable security definer set search_path = '' as $$
        select exists(select 1 from public.staff_members s
          where s.user_id = auth.uid() and s.active and
          (s.role = 'admin' or exists(select 1 from public.case_assignments a
            where a.case_id = p_case_id and a.staff_user_id = s.user_id
              and a.revoked_at is null)))
      $$;
    alter table public.case_internal_notes enable row level security;
    create policy notes_staff_read on public.case_internal_notes for select to authenticated
      using(private.is_staff_for_case(case_id));
    grant select on public.case_internal_notes to authenticated;
  `);
  await pg.exec(readFileSync("supabase/migrations/20261011006100_case_internal_notes.sql", "utf8"));
  await pg.query("insert into public.cases values ($1),($2)", [caseId, otherCase]);
  await pg.query(`insert into public.staff_members values
    ($1,'QA юрист','lawyer',true),($2,'QA менеджер','manager',true),
    ($3,'QA администратор','admin',true),($4,'Посторонний','lawyer',true)`, [lawyer, manager, admin, stranger]);
  await pg.query("insert into public.case_assignments values ($1,$2,null),($1,$3,null)", [caseId, lawyer, manager]);

  const write = "select public.staff_add_case_note($1,$2,$3) as id";
  const page = "select * from public.staff_case_note_page($1,$2,$3,$4)";
  const noteId = (await asUser(lawyer, write, [caseId, "  Только для команды  ", key])).rows[0].id;
  assert.equal((await asUser(lawyer, write, [caseId, "Только для команды", key])).rows[0].id, noteId);
  await assert.rejects(asUser(lawyer, write, [caseId, "Подмена текста", key]), /Note retry conflict/);
  assert.equal((await asUser(manager, page, [caseId, null, null, 31])).rows[0].body, "Только для команды");
  assert.equal((await asUser(admin, page, [caseId, null, null, 31])).rowCount, 1);
  assert.equal((await asUser(client, "select * from public.case_internal_notes")).rowCount, 0);
  await assert.rejects(asUser(client, page, [caseId, null, null, 31]), /Not authorized/);
  await assert.rejects(asUser(stranger, page, [caseId, null, null, 31]), /Not authorized/);
  await assert.rejects(asUser(client, write, [caseId, "Чужая запись", key]), /Not authorized/);
  await assert.rejects(asUser(lawyer, write, [otherCase, "Чужое дело", key]), /Not authorized/);
  await assert.rejects(asUser(lawyer, "insert into public.case_internal_notes(case_id,author_user_id,body) values($1,$2,'raw')", [caseId, lawyer]), /permission denied/);
  await assert.rejects(asUser(lawyer, write, [caseId, " ", key]), /Invalid note/);
  await assert.rejects(asUser(lawyer, page, [caseId, new Date().toISOString(), null, 31]), /invalid page/);
  assert.equal((await pg.query("select count(*)::int as n from public.audit_events where entity_type='case_internal_note'")).rows[0].n, 1);

  await pg.query(`insert into public.case_internal_notes(case_id,author_user_id,body,created_at)
    select $1, $2, 'History ' || n,
      now() - interval '2 days' + (n / 2) * interval '1 second'
      from generate_series(1,75) as g(n)`, [caseId, lawyer]);
  const seen = new Set();
  let beforeAt = null;
  let beforeId = null;
  let pages = 0;
  do {
    const rows = (await asUser(manager, page, [caseId, beforeAt, beforeId, 31])).rows;
    const visible = rows.slice(0, 30);
    for (const row of visible) {
      assert(!seen.has(row.id), "History page repeated a note");
      seen.add(row.id);
    }
    pages++;
    if (pages === 1) await asUser(lawyer, write, [caseId, "New during paging", "30000000-0000-4000-8000-000000000002"]);
    if (rows.length <= 30) break;
    beforeAt = visible.at(-1).created_at;
    beforeId = visible.at(-1).id;
  } while (pages < 10);
  assert.equal(seen.size, 76);
  assert.equal(pages, 3);

  await pg.query("update public.case_assignments set revoked_at=now() where case_id=$1 and staff_user_id=$2", [caseId, manager]);
  await assert.rejects(asUser(manager, page, [caseId, null, null, 31]), /Not authorized/);
  await assert.rejects(asUser(manager, write, [caseId, "После отзыва", "30000000-0000-4000-8000-000000000003"]), /Not authorized/);
  console.log("OK case notes: private access, reassignment, replay, audit and stable history");
} finally {
  await pg.close();
}
