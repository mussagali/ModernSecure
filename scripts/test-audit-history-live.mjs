import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import pg from "pg";

const file = ".env.db.local";
assert.equal(statSync(file).mode & 0o077, 0, "DB credentials file must be private");
const line = readFileSync(file, "utf8").split(/\r?\n/)
  .find((part) => part.startsWith("DATABASE_URL="));
assert.ok(line, "DATABASE_URL is missing");
const url = new URL(line.slice("DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, ""));
assert.ok(url.hostname === "db.bdkrihsiprkmukyjyspv.supabase.co"
  || url.hostname === "aws-0-ap-northeast-2.pooler.supabase.com");
url.searchParams.delete("sslmode");
url.searchParams.delete("sslrootcert");
pg.types.setTypeParser(1184, (value) => value); // Preserve PostgreSQL microseconds in cursors.
const db = new pg.Client({
  connectionString: url.toString(),
  ssl: { ca: readFileSync("supabase/certs/prod-ca-2021.crt", "utf8"), rejectUnauthorized: true },
  connectionTimeoutMillis: 12000,
});
const query = "select * from public.admin_audit_page($1,$2,$3,$4,$5)";

try {
  await db.connect();
  const staff = await db.query(`select sm.user_id, sm.role from public.staff_members sm
    join auth.users u on u.id=sm.user_id
    where lower(u.email) in ('ayanz2008@gmail.com', 'qa-manager-modernsecure@example.test')`);
  const admin = staff.rows.find((row) => row.role === "admin");
  const manager = staff.rows.find((row) => row.role === "manager");
  assert.ok(admin && manager, "Known QA/admin accounts not found");
  await db.query("begin isolation level repeatable read read only");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [admin.user_id]);
  await db.query("set local role authenticated");
  const total = Number((await db.query("select count(*) as count from public.audit_events")).rows[0].count);
  await db.query("savepoint invalid_limit");
  await assert.rejects(db.query(query, [null, null, null, null, null]), /Invalid audit page request/);
  await db.query("rollback to savepoint invalid_limit");
  const seen = new Set();
  let beforeAt = null;
  let beforeId = null;
  let firstPage;
  for (let pageNo = 0; pageNo < 10000; pageNo += 1) {
    const { rows } = await db.query(query, [beforeAt, beforeId, null, null, 50]);
    if (!firstPage) firstPage = rows;
    const page = rows.slice(0, 50);
    for (const row of page) {
      assert.ok(!seen.has(row.id), "Duplicate audit event across pages");
      seen.add(row.id);
    }
    if (rows.length <= 50) break;
    assert.equal(rows.length, 51);
    const last = page.at(-1);
    beforeAt = last.occurred_at;
    beforeId = last.id;
  }
  assert.equal(seen.size, total, "History pagination omitted events");
  const caseId = firstPage.find((row) => row.case_id)?.case_id;
  const actorId = firstPage.find((row) => row.actor_user_id)?.actor_user_id;
  if (caseId) {
    const filtered = await db.query(query, [null, null, caseId, null, 50]);
    assert.ok(filtered.rows.every((row) => row.case_id === caseId));
  }
  if (actorId) {
    const filtered = await db.query(query, [null, null, null, actorId, 50]);
    assert.ok(filtered.rows.every((row) => row.actor_user_id === actorId));
  }
  const actions = await db.query("select distinct action from public.audit_events order by action");
  const entities = await db.query("select distinct entity_type from public.audit_events order by entity_type");
  await db.query("rollback");

  await db.query("begin read only");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [manager.user_id]);
  await db.query("set local role authenticated");
  await assert.rejects(db.query(query, [null, null, null, null, 50]), /Not authorized/);
  await db.query("rollback");

  console.log(`OK live audit history: ${total} events, every page visited once, filters work, manager denied`);
  console.log(`Actions: ${actions.rows.map((row) => row.action).join(", ")}`);
  console.log(`Entities: ${entities.rows.map((row) => row.entity_type).join(", ")}`);
} finally {
  await db.end().catch(() => {});
}
