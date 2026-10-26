import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { auditActionLabel, auditEntityLabel } from "../lib/audit-labels.ts";
import { auditHref, parseAuditCursor } from "../lib/audit-pagination.ts";

const db = new PGlite();
const admin = "10000000-0000-4000-8000-000000000001";
const manager = "10000000-0000-4000-8000-000000000002";
const caseId = "20000000-0000-4000-8000-000000000001";
const otherCase = "20000000-0000-4000-8000-000000000002";
// PGlite maps timestamptz to JS Date (millisecond precision); cast to text so
// the test exercises the exact microsecond cursor returned by PostgREST.
const sql = "select id, case_id, actor_user_id, occurred_at::text as occurred_at from public.admin_audit_page($1,$2,$3,$4,$5)";

async function asUser(userId, query, params) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  await db.exec("set role authenticated");
  try { return await db.query(query, params); }
  finally { await db.exec("reset role"); }
}

try {
  for (const action of ["accepted", "account_linked", "acknowledged", "cancelled", "closed",
    "completed", "confirmed", "created", "created_from_template", "document_checklist_published",
    "documents_submitted", "download_issued", "installment_created", "invited",
    "payment_permission_changed", "preview_issued", "published", "receipt_linked", "returned",
    "role_granted", "sent", "stage_changed", "submitted", "test_accounts_provisioned", "uploaded"]) {
    assert.notEqual(auditActionLabel(action, "case"), action);
  }
  for (const entity of ["case", "case_assignment", "case_internal_note", "client", "contract",
    "document_file", "document_request", "message", "message_attachment", "payment",
    "payment_receipt", "payment_schedule", "qa_setup", "service_template",
    "service_template_version", "staff_invite", "staff_member", "staff_message",
    "staff_message_attachment", "task", "upload_session"]) {
    assert.notEqual(auditEntityLabel(entity), entity);
  }
  assert.equal(parseAuditCursor(["bad"]), null);
  assert.equal(parseAuditCursor("2026-10-12T10:11:12.123456+00:00|42")?.id, "42");
  assert.equal(parseAuditCursor("2026-10-12T10:11:12Z|0"), null);
  assert.equal(parseAuditCursor("2026-10-12T10:11:12Z|1),id.gt.0"), null);
  assert.equal(parseAuditCursor("not-a-date|1"), null);
  const url = auditHref(caseId, manager, { occurred_at: "2026-10-12T10:11:12.123456+00:00", id: 42 });
  const params = new URL(url, "http://localhost").searchParams;
  assert.equal(params.get("case"), caseId);
  assert.equal(params.get("actor"), manager);
  assert.equal(parseAuditCursor(params.get("before"))?.id, "42");

  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema auth, public to authenticated;
    grant execute on function auth.uid() to authenticated;
    create table public.staff_members (user_id uuid primary key, role text not null, active boolean not null);
    create table public.audit_events (
      id bigint generated always as identity primary key,
      case_id uuid, entity_type text not null, entity_id uuid,
      action text not null, reason text, occurred_at timestamptz not null,
      actor_user_id uuid
    );
  `);
  await db.exec(readFileSync("supabase/migrations/20261012006600_admin_audit_history.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261012006700_admin_audit_limit_guard.sql", "utf8"));
  await db.query("insert into public.staff_members values ($1,'admin',true),($2,'manager',true)", [admin, manager]);
  for (let i = 0; i < 120; i += 1) {
    await db.query(`insert into public.audit_events
      (case_id, entity_type, action, occurred_at, actor_user_id)
      values ($1,'task','created','2026-10-01T12:00:00.123456Z',$2)`,
    [i % 2 ? caseId : otherCase, i % 3 ? manager : admin]);
  }
  await assert.rejects(asUser(manager, sql, [null, null, null, null, 50]), /Not authorized/);
  await assert.rejects(asUser(admin, sql, [null, 1, null, null, 50]), /Invalid audit page request/);
  await assert.rejects(asUser(admin, sql, [null, null, null, null, 101]), /Invalid audit page request/);
  await assert.rejects(asUser(admin, sql, [null, null, null, null, null]), /Invalid audit page request/);

  const first = (await asUser(admin, sql, [null, null, null, null, 50])).rows;
  assert.equal(first.length, 51);
  assert.equal(first[0].id, 120);
  assert.equal(first[49].id, 71);
  await db.query(`insert into public.audit_events
    (case_id, entity_type, action, occurred_at, actor_user_id)
    values ($1,'task','created','2026-10-12T12:00:00Z',$2)`, [caseId, manager]);

  const visited = first.slice(0, 50).map((row) => row.id);
  let previous = first[49];
  while (true) {
    const next = (await asUser(admin, sql,
      [previous.occurred_at, previous.id, null, null, 50])).rows;
    const page = next.slice(0, 50);
    visited.push(...page.map((row) => row.id));
    if (next.length <= 50) break;
    previous = page.at(-1);
  }
  assert.equal(visited.length, 120);
  assert.equal(new Set(visited).size, 120);
  assert.ok(!visited.includes(121), "newer event must not shift older pages");

  const byCase = (await asUser(admin, sql, [null, null, caseId, null, 50])).rows;
  assert.equal(byCase.length, 51);
  assert.ok(byCase.every((row) => row.case_id === caseId));
  const byActor = (await asUser(admin, sql, [null, null, null, admin, 50])).rows;
  assert.equal(byActor.length, 40);
  assert.ok(byActor.every((row) => row.actor_user_id === admin));
  await db.query("update public.staff_members set active=false where user_id=$1", [admin]);
  await assert.rejects(asUser(admin, sql, [null, null, null, null, 50]), /Not authorized/);
  console.log("OK admin audit: full keyset history, stable concurrent insert, filters and revoked role");
} finally {
  await db.close();
}
