import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pg = new PGlite();
const ids = Object.fromEntries([
  "admin", "client", "lawyer", "manager", "noPermission", "unassigned", "revoked", "inactive",
].map((name) => [name, randomUUID()]));
const caseA = randomUUID();
const caseB = randomUUID();
const staffNames = ["admin", "lawyer", "manager", "noPermission", "unassigned", "revoked", "inactive"];

async function addReceipt(caseId, hashLetter) {
  const id = randomUUID();
  const storagePath = `receipts/${caseId}/${ids.client}/${id}.pdf`;
  await pg.query(
    "insert into storage.objects (bucket_id, name, metadata) values ('modernsecure-files', $1, $2)",
    [storagePath, { size: 123, mimetype: "application/pdf" }],
  );
  await pg.query(`insert into public.payment_receipts
    (id, case_id, uploaded_by, storage_path, original_name, size_bytes, detected_mime_type,
      content_sha256, idempotency_key)
    values ($1, $2, $3, $4, 'receipt.pdf', 123, 'application/pdf', $5, $6)`,
    [id, caseId, ids.client, storagePath, hashLetter.repeat(64), randomUUID()],
  );
  return id;
}

async function checkReceipt(receiptId, caseId, expectedNames) {
  const key = `receipt-submitted:${receiptId}`;
  const result = await pg.query(`select recipient_user_id, case_id, kind, title, body, target_path, dedupe_key
    from public.notifications where dedupe_key = $1 order by recipient_user_id`, [key]);
  assert.deepEqual(
    result.rows.map((row) => row.recipient_user_id).sort(),
    expectedNames.map((name) => ids[name]).sort(),
    `wrong recipients for ${key}`,
  );
  for (const row of result.rows) {
    assert.equal(row.case_id, caseId);
    assert.equal(row.kind, "payment_receipt");
    assert.equal(row.title, "Новый чек клиента");
    assert.equal(row.body, "Проверьте документ. Чек сам по себе не подтверждает оплату.");
    assert.equal(row.target_path, `/staff/cases/${caseId}/payments`);
    assert.equal(row.dedupe_key, key);
  }
  for (const name of staffNames) {
    await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [ids[name]]);
    const allowed = await pg.query("select private.can_manage_payments($1) as allowed", [caseId]);
    assert.equal(allowed.rows[0].allowed, expectedNames.includes(name),
      `authorization differs for ${name}`);
  }
}

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
    .filter((name) => name.endsWith(".sql") && name <= "20261011004100_completed_document_upload_replay.sql")
    .sort();
  for (const name of migrations) {
    if (name === "20261011000800_role_boundaries.sql") {
      await pg.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'ayanz2008@gmail.com', now())", [ids.admin]);
      await pg.query("insert into public.staff_members (user_id, display_name, role) values ($1, 'Admin', 'admin')", [ids.admin]);
    }
    try { await pg.exec(readFileSync(path.join(root, "supabase/migrations", name), "utf8")); }
    catch (error) { throw new Error(`${name}: ${error.message}`); }
  }
  assert.equal(migrations.at(-1), "20261011004100_completed_document_upload_replay.sql");
  const migration = "20261011004400_receipt_notification_finance_scope.sql";
  await pg.exec(readFileSync(path.join(root, "supabase/migrations", migration), "utf8"));
  const triggerCount = await pg.query(`select count(*)::integer as count from pg_trigger
    where tgrelid = 'public.payment_receipts'::regclass and tgname = 'modernsecure_receipt_submitted_notify'`);
  assert.equal(triggerCount.rows[0].count, 1, "migration must retain one submission trigger");

  for (const name of ["client", ...staffNames.filter((value) => value !== "admin")]) {
    await pg.query("insert into auth.users (id, email) values ($1, $2)", [ids[name], `${name}@example.test`]);
  }
  for (const [name, role, permission, active] of [
    ["lawyer", "lawyer", true, true],
    ["manager", "manager", true, true],
    ["noPermission", "lawyer", false, true],
    ["unassigned", "lawyer", true, true],
    ["revoked", "lawyer", true, true],
    ["inactive", "lawyer", true, false],
  ]) {
    await pg.query(`insert into public.staff_members
      (user_id, display_name, role, can_confirm_payments, active) values ($1, $2, $3, $4, $5)`,
      [ids[name], name, role, permission, active]);
  }
  const clientRecord = randomUUID();
  const service = randomUUID();
  const version = randomUUID();
  await pg.query(`insert into public.clients (id, user_id, full_name, linked_by, linked_at)
    values ($1, $2, 'Client', $3, now())`, [clientRecord, ids.client, ids.admin]);
  await pg.query("insert into public.service_templates (id, code, name) values ($1, 'receipt-notice', 'Receipt notice')", [service]);
  await pg.query("insert into public.service_template_versions (id, service_id, version_no) values ($1, $2, 1)", [version, service]);
  await pg.query(`insert into public.cases (id, case_number, client_id, service_version_id, title)
    values ($1, 'N-1', $3, $4, 'Case A'), ($2, 'N-2', $3, $4, 'Case B')`,
    [caseA, caseB, clientRecord, version]);
  for (const name of ["admin", "lawyer", "manager", "noPermission", "revoked", "inactive"]) {
    await pg.query(`insert into public.case_assignments (case_id, staff_user_id, assigned_by)
      values ($1, $2, $3)`, [caseA, ids[name], ids.admin]);
  }
  await pg.query(`update public.case_assignments set revoked_at = clock_timestamp()
    where case_id = $1 and staff_user_id = $2`, [caseA, ids.revoked]);

  const first = await addReceipt(caseA, "a");
  await checkReceipt(first, caseA, ["lawyer", "manager"]);

  await pg.query("update public.staff_members set can_confirm_payments = true where user_id = $1", [ids.admin]);
  await pg.query("update public.staff_members set can_confirm_payments = false where user_id = $1", [ids.lawyer]);
  await pg.exec(`create trigger test_receipt_submission_replay after insert on public.payment_receipts
    for each row execute function private.notify_payment_receipt_submitted()`);
  const second = await addReceipt(caseA, "b");
  await checkReceipt(second, caseA, ["admin", "manager"]);
  const otherCase = await addReceipt(caseB, "c");
  await checkReceipt(otherCase, caseB, ["admin"]);

  await pg.query("update public.staff_members set active = false where user_id = $1", [ids.manager]);
  const afterDeactivation = await addReceipt(caseA, "d");
  await checkReceipt(afterDeactivation, caseA, ["admin"]);
  console.log("OK receipt notification recipients match finance authorization, including admin permission, assignments, revocation, inactivity, case scope, and dedupe");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pg.close();
}
