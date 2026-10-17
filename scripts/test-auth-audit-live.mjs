import { simulateMfaInTransaction } from "./transactional-mfa.mjs";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import pg from "pg";

assert.equal(statSync(".env.db.local").mode & 0o077, 0, "DB credentials file must be private");
const line = readFileSync(".env.db.local", "utf8").split(/\r?\n/)
  .find((part) => part.startsWith("DATABASE_URL="));
assert.ok(line, "DATABASE_URL is missing");
const url = new URL(line.slice("DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, ""));
assert.ok(url.hostname === "db.bdkrihsiprkmukyjyspv.supabase.co"
  || url.hostname === "aws-0-ap-northeast-2.pooler.supabase.com");
url.searchParams.delete("sslmode");
url.searchParams.delete("sslrootcert");
pg.types.setTypeParser(1184, (value) => value);
const db = new pg.Client({
  connectionString: url.toString(),
  ssl: { ca: readFileSync("supabase/certs/prod-ca-2021.crt", "utf8"), rejectUnauthorized: true },
  connectionTimeoutMillis: 12000,
});
const query = "select * from public.admin_auth_audit_page($1,$2,$3,$4)";

try {
  await db.connect();
  const staff = await db.query(`select sm.user_id, sm.role from public.staff_members sm
    join auth.users u on u.id = sm.user_id
    where lower(u.email) in ('ayanz2008@gmail.com', 'qa-manager-modernsecure@example.test')`);
  const admin = staff.rows.find((row) => row.role === "admin");
  const manager = staff.rows.find((row) => row.role === "manager");
  assert.ok(admin && manager, "Known staff accounts not found");
  const clientId = JSON.parse(readFileSync(".test-accounts.local.json", "utf8")).accounts.client.id;
  const count = Number((await db.query("select count(*) as total from auth.audit_log_entries")).rows[0].total);
  assert.ok(count >= 2, "Expected the QA sign-in and sign-out in Supabase Auth audit");

  await db.query("begin isolation level repeatable read");
  await simulateMfaInTransaction(db, admin.user_id);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [admin.user_id]);
  await db.query("set local role authenticated");
  await db.query("savepoint invalid_limit");
  await assert.rejects(db.query(query, [null, null, null, null]), /Invalid auth audit page request/);
  await db.query("rollback to savepoint invalid_limit");
  await db.query("savepoint invalid_cursor");
  await assert.rejects(db.query(query, [new Date().toISOString(), null, null, 50]), /Invalid auth audit page request/);
  await db.query("rollback to savepoint invalid_cursor");
  const seen = new Set();
  const actions = new Set();
  let beforeAt = null;
  let beforeId = null;
  for (let pageNo = 0; pageNo <= count; pageNo += 1) {
    const { rows } = await db.query(query, [beforeAt, beforeId, null, 1]);
    for (const row of rows.slice(0, 1)) {
      assert.deepEqual(Object.keys(row).sort(),
        ["id", "occurred_at", "action", "actor_user_id", "actor_email", "provider"].sort());
      assert.ok(!seen.has(row.id), "Duplicate event across pages");
      seen.add(row.id);
      actions.add(row.action);
    }
    if (rows.length <= 1) break;
    const last = rows[0];
    beforeAt = last.occurred_at;
    beforeId = last.id;
  }
  assert.equal(seen.size, count, "Pagination omitted Auth events");
  assert.ok(actions.has("login") && actions.has("logout"));
  const actorRows = await db.query(query, [null, null, manager.user_id, 50]);
  assert.ok(actorRows.rows.length >= 2 && actorRows.rows.every((row) => row.actor_user_id === manager.user_id));
  await db.query("rollback");

  await db.query("begin read only");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [manager.user_id]);
  await db.query("set local role authenticated");
  await assert.rejects(db.query(query, [null, null, null, 50]), /Not authorized/);
  await db.query("rollback");

  await db.query("begin read only");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [clientId]);
  await db.query("set local role authenticated");
  await assert.rejects(db.query(query, [null, null, null, 50]), /Not authorized/);
  await db.query("rollback");

  await db.query("begin read only");
  await db.query("set local role anon");
  await assert.rejects(db.query(query, [null, null, null, 50]), /permission denied/);
  await db.query("rollback");
  console.log(`OK live Auth audit: ${count} events, pagination/filter work; manager, client and anon denied; IP/payload omitted`);
} finally {
  await db.end().catch(() => {});
}
