import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pg = new PGlite();
const client = randomUUID();
const otherClient = randomUUID();
const staff = randomUUID();
const unassignedStaff = randomUUID();
const admin = randomUUID();
const caseId = randomUUID();
const otherCaseId = randomUUID();
const hash = "a".repeat(64);
const fileId = randomUUID();
const key = randomUUID();
const filePath = `receipts/${caseId}/${client}/${fileId}.pdf`;

async function asUser(user, sql, params = []) {
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  await pg.exec("set role authenticated");
  try { return await pg.query(sql, params); }
  finally { await pg.exec("reset role"); }
}

async function denied(user, sql, params = []) {
  await assert.rejects(asUser(user, sql, params));
}

const registerSql = `select public.client_register_payment_receipt(
  $1, $2, $3, $4, $5, $6, $7) as id`;
const reviewSql = `select public.staff_review_payment_receipt($1, $2, $3)`;
const registration = [caseId, filePath, "receipt.pdf", "application/pdf", 123, hash, key];

try {
  await pg.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to authenticated;
    grant execute on function auth.uid() to authenticated;
    create schema storage;
    create table storage.buckets (id text primary key, name text not null,
      public boolean not null, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (bucket_id text not null, name text not null,
      metadata jsonb, primary key (bucket_id, name));
  `);
  const migrations = readdirSync(path.join(root, "supabase/migrations"))
    .filter((name) => name.endsWith(".sql") && name <= "20261011003000_receipt_workflow.sql")
    .sort();
  for (const name of migrations) {
    if (name === "20261011000800_role_boundaries.sql") {
      await pg.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'ayanz2008@gmail.com', now())", [admin]);
      await pg.query("insert into public.staff_members (user_id, display_name, role, can_confirm_payments) values ($1, 'Admin', 'admin', true)", [admin]);
    }
    try { await pg.exec(readFileSync(path.join(root, "supabase/migrations", name), "utf8")); }
    catch (error) { throw new Error(`${name}: ${error.message}`); }
  }
  assert.equal(migrations.at(-1), "20261011003000_receipt_workflow.sql");

  for (const [id, label] of [[client, "Client"], [otherClient, "Other"], [staff, "Staff"], [unassignedStaff, "Unassigned"]]) {
    await pg.query("insert into auth.users (id, email) values ($1, $2)", [id, `${label.toLowerCase()}@example.test`]);
  }
  await pg.query("insert into public.staff_members (user_id, display_name, role, can_confirm_payments) values ($1, 'Staff', 'lawyer', true), ($2, 'Unassigned', 'lawyer', true)", [staff, unassignedStaff]);
  const clientCard = randomUUID();
  const otherCard = randomUUID();
  const service = randomUUID();
  const version = randomUUID();
  await pg.query("insert into public.clients (id, user_id, full_name, linked_by, linked_at) values ($1, $2, 'Client', $3, now()), ($4, $5, 'Other', $3, now())", [clientCard, client, admin, otherCard, otherClient]);
  await pg.query("insert into public.service_templates (id, code, name) values ($1, 'receipt-test', 'Receipt test')", [service]);
  await pg.query("insert into public.service_template_versions (id, service_id, version_no) values ($1, $2, 1)", [version, service]);
  await pg.query("insert into public.cases (id, case_number, client_id, service_version_id, title) values ($1, 'R-1', $2, $3, 'Case 1'), ($4, 'R-2', $5, $3, 'Case 2')", [caseId, clientCard, version, otherCaseId, otherCard]);
  await pg.query("insert into public.case_assignments (case_id, staff_user_id, assigned_by) values ($1, $2, $3)", [caseId, staff, admin]);

  await denied(client, registerSql, registration);
  await pg.query("insert into storage.objects (bucket_id, name, metadata) values ('modernsecure-previews', $1, $2)", [filePath, { size: 123, mimetype: "application/pdf" }]);
  await denied(client, registerSql, registration);
  await pg.query("insert into storage.objects (bucket_id, name, metadata) values ('modernsecure-files', $1, $2)", [filePath, { size: 122, mimetype: "application/pdf" }]);
  await denied(client, registerSql, registration);
  await pg.query("update storage.objects set metadata = $2 where bucket_id = 'modernsecure-files' and name = $1", [filePath, { size: 123, mimetype: "image/png" }]);
  await denied(client, registerSql, registration);
  await pg.query("update storage.objects set metadata = $2 where bucket_id = 'modernsecure-files' and name = $1", [filePath, { size: 123, mimetype: "application/pdf" }]);
  await denied(otherClient, registerSql, registration);
  await denied(staff, registerSql, registration);
  await denied(client, registerSql, [otherCaseId, ...registration.slice(1)]);
  await denied(client, registerSql, [caseId, `receipts/${caseId}/${otherClient}/${fileId}.pdf`, ...registration.slice(2)]);
  await denied(client, registerSql, [caseId, `receipts/${caseId}/${client}/../${fileId}.pdf`, ...registration.slice(2)]);
  await denied(client, registerSql, [caseId, ...registration.slice(1, 3), "image/png", ...registration.slice(4)]);
  await denied(client, registerSql, [caseId, ...registration.slice(1, 4), 124, ...registration.slice(5)]);
  await denied(client, registerSql, [caseId, ...registration.slice(1, 5), "A".repeat(64), key]);
  await denied(client, registerSql, [caseId, filePath, "../receipt.pdf", ...registration.slice(3)]);
  await denied(client, registerSql, [caseId, filePath, "receipt.pdf", "application/pdf", 20971521, hash, key]);
  await pg.query("update public.cases set is_suspended = true where id = $1", [caseId]);
  await denied(client, registerSql, registration);
  await pg.query("update public.cases set is_suspended = false where id = $1", [caseId]);
  const first = await asUser(client, registerSql, registration);
  const receiptId = first.rows[0].id;
  assert.equal((await asUser(client, registerSql, registration)).rows[0].id, receiptId);
  await denied(client, registerSql, [caseId, filePath, "changed.pdf", ...registration.slice(3)]);
  await denied(client, registerSql, [caseId, filePath, "receipt.pdf", "application/pdf", 123, hash, randomUUID()]);
  const duplicatePath = `receipts/${caseId}/${client}/${randomUUID()}.pdf`;
  await pg.query("insert into storage.objects (bucket_id, name, metadata) values ('modernsecure-files', $1, $2)", [duplicatePath, { size: 123, mimetype: "application/pdf" }]);
  await denied(client, registerSql, [caseId, duplicatePath, "receipt.pdf", "application/pdf", 123, hash, randomUUID()]);
  await denied(client, "insert into public.payment_receipts (case_id, uploaded_by, storage_path, original_name, size_bytes, detected_mime_type, content_sha256, idempotency_key) values ($1, $2, $3, 'direct.pdf', 123, 'application/pdf', $4, $5)", [caseId, client, duplicatePath, hash, randomUUID()]);
  await denied(client, reviewSql, [receiptId, true, "Looks valid"]);
  await denied(unassignedStaff, reviewSql, [receiptId, true, "Looks valid"]);
  await pg.query("update public.staff_members set can_confirm_payments = false where user_id = $1", [staff]);
  await denied(staff, reviewSql, [receiptId, true, "Looks valid"]);
  await pg.query("update public.staff_members set can_confirm_payments = true where user_id = $1", [staff]);
  await denied(staff, reviewSql, [receiptId, true, "  "]);
  await pg.query("update public.cases set is_suspended = true where id = $1", [caseId]);
  await denied(staff, reviewSql, [receiptId, true, "Looks valid"]);
  await pg.query("update public.cases set is_suspended = false where id = $1", [caseId]);
  await asUser(staff, reviewSql, [receiptId, true, "Looks valid"]);
  await asUser(staff, reviewSql, [receiptId, true, "Looks valid"]);
  await denied(staff, reviewSql, [receiptId, false, "Changed"]);
  const state = await pg.query("select status, review_note, reviewed_by, reviewed_at from public.payment_receipts where id = $1", [receiptId]);
  assert.equal(state.rows[0].status, "accepted");
  assert.equal(state.rows[0].review_note, "Looks valid");
  assert.equal(state.rows[0].reviewed_by, staff);
  assert.ok(state.rows[0].reviewed_at);
  const audits = await pg.query("select action from public.audit_events where entity_type = 'payment_receipt' and entity_id = $1 order by id", [receiptId]);
  assert.deepEqual(audits.rows.map((row) => row.action), ["submitted", "accepted"]);
  const rejectedPath = `receipts/${caseId}/${client}/${randomUUID()}.pdf`;
  const rejectedHash = "b".repeat(64);
  await pg.query("insert into storage.objects (bucket_id, name, metadata) values ('modernsecure-files', $1, $2)", [rejectedPath, { size: 123, mimetype: "application/pdf" }]);
  const rejected = await asUser(client, registerSql, [caseId, rejectedPath, "other.pdf", "application/pdf", 123, rejectedHash, randomUUID()]);
  await asUser(admin, reviewSql, [rejected.rows[0].id, false, "Unreadable"]);
  const rejection = await pg.query("select status, review_note from public.payment_receipts where id = $1", [rejected.rows[0].id]);
  assert.deepEqual([rejection.rows[0].status, rejection.rows[0].review_note], ["rejected", "Unreadable"]);
  assert.equal((await pg.query("select count(*)::integer as count from public.payments")).rows[0].count, 0);
  console.log("OK receipt registration, ownership, Storage match, replay, finance review, audit, and payment separation");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pg.close();
}
