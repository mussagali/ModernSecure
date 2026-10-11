import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const ids = {
  client: "10000000-0000-4000-8000-000000000001",
  lawyer: "10000000-0000-4000-8000-000000000002",
  outsider: "10000000-0000-4000-8000-000000000003",
  admin: "10000000-0000-4000-8000-000000000004",
  case: "20000000-0000-4000-8000-000000000001",
  request: "30000000-0000-4000-8000-000000000001",
  document: "40000000-0000-4000-8000-000000000001",
  contract: "40000000-0000-4000-8000-000000000002",
  receipt: "40000000-0000-4000-8000-000000000003",
  message: "50000000-0000-4000-8000-000000000001",
  attachment: "40000000-0000-4000-8000-000000000004",
  thread: "60000000-0000-4000-8000-000000000001",
  staffMessage: "70000000-0000-4000-8000-000000000001",
  staffAttachment: "40000000-0000-4000-8000-000000000005",
};
const recordSql = "select public.server_record_file_access($1,$2,$3,$4)";

async function denied(actor, type, id, action = "download_issued") {
  await assert.rejects(db.query(recordSql, [actor, type, id, action]));
}

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    create table public.clients (id uuid primary key, user_id uuid);
    create table public.cases (id uuid primary key, client_id uuid);
    create table public.staff_members (user_id uuid primary key, active boolean, role text);
    create table public.case_assignments (case_id uuid, staff_user_id uuid, revoked_at timestamptz);
    create table public.document_requests (id uuid primary key, case_id uuid);
    create table public.document_files (id uuid primary key, request_id uuid, status text);
    create table public.contracts (id uuid primary key, case_id uuid);
    create table public.payment_receipts (id uuid primary key, case_id uuid);
    create table public.messages (id uuid primary key, case_id uuid);
    create table public.message_attachments (id uuid primary key, message_id uuid);
    create table public.staff_threads (id uuid primary key, user_low uuid, user_high uuid);
    create table public.staff_messages (id uuid primary key, thread_id uuid);
    create table public.staff_message_attachments (id uuid primary key, message_id uuid);
    create table public.audit_events (
      id bigint generated always as identity primary key,
      actor_user_id uuid references auth.users(id),
      case_id uuid,
      entity_type text not null,
      entity_id uuid,
      action text not null,
      after_data jsonb
    );
  `);
  await db.exec(readFileSync("supabase/migrations/20261012006500_file_access_audit.sql", "utf8"));
  for (const actor of [ids.client, ids.lawyer, ids.outsider, ids.admin]) {
    await db.query("insert into auth.users (id) values ($1)", [actor]);
  }
  await db.query("insert into public.clients values ($1,$2)", [ids.client, ids.client]);
  await db.query("insert into public.cases values ($1,$2)", [ids.case, ids.client]);
  await db.query("insert into public.staff_members values ($1,true,'lawyer'),($2,true,'admin')", [ids.lawyer, ids.admin]);
  await db.query("insert into public.case_assignments values ($1,$2,null)", [ids.case, ids.lawyer]);
  await db.query("insert into public.document_requests values ($1,$2)", [ids.request, ids.case]);
  await db.query("insert into public.document_files values ($1,$2,'accepted')", [ids.document, ids.request]);
  await db.query("insert into public.contracts values ($1,$2)", [ids.contract, ids.case]);
  await db.query("insert into public.payment_receipts values ($1,$2)", [ids.receipt, ids.case]);
  await db.query("insert into public.messages values ($1,$2)", [ids.message, ids.case]);
  await db.query("insert into public.message_attachments values ($1,$2)", [ids.attachment, ids.message]);
  await db.query("insert into public.staff_threads values ($1,$2,$3)", [ids.thread, ids.admin, ids.lawyer]);
  await db.query("insert into public.staff_messages values ($1,$2)", [ids.staffMessage, ids.thread]);
  await db.query("insert into public.staff_message_attachments values ($1,$2)", [ids.staffAttachment, ids.staffMessage]);

  const files = [
    ["document_file", ids.document], ["contract", ids.contract],
    ["payment_receipt", ids.receipt], ["message_attachment", ids.attachment],
  ];
  for (const [type, id] of files) {
    await db.query(recordSql, [ids.client, type, id, "preview_issued"]);
    await db.query(recordSql, [ids.lawyer, type, id, "download_issued"]);
    await denied(ids.outsider, type, id);
  }
  await db.query(recordSql, [ids.admin, "staff_message_attachment", ids.staffAttachment, "preview_issued"]);
  await denied(ids.client, "staff_message_attachment", ids.staffAttachment);
  await denied(ids.outsider, "contract", "40000000-0000-4000-8000-000000000099");
  await denied(ids.client, "contract", ids.contract, "fabricated");
  await denied(ids.client, "fake", ids.contract);
  await db.query("update public.case_assignments set revoked_at=now() where staff_user_id=$1", [ids.lawyer]);
  await denied(ids.lawyer, "contract", ids.contract);
  await db.query("update public.staff_members set active=false where user_id=$1", [ids.admin]);
  await denied(ids.admin, "staff_message_attachment", ids.staffAttachment);

  const events = await db.query("select entity_type, action, case_id, after_data from public.audit_events order by id");
  assert.equal(events.rows.length, 9);
  assert.equal(events.rows.filter((row) => row.case_id === ids.case).length, 8);
  assert.equal(events.rows[8].after_data.thread_id, ids.thread);
  assert.equal(events.rows[8].case_id, null);

  await db.exec("set role authenticated");
  try { await denied(ids.client, "contract", ids.contract); }
  finally { await db.exec("reset role"); }
  const finalCount = await db.query("select count(*)::integer as count from public.audit_events");
  assert.equal(finalCount.rows[0].count, 9);
  console.log("OK file audit: 5 file types, case/thread boundaries, revoked access, forged events, service-only RPC");
} finally {
  await db.close();
}
