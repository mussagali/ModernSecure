import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase/migrations");
const migrationName = "20261011005200_finance_task_integrity.sql";
const pg = new PGlite();
const admin = randomUUID();
const lawyer = randomUUID();
const client = randomUUID();
const card = randomUUID();
const service = randomUUID();
const version = randomUUID();
const caseId = randomUUID();
const hash = "a".repeat(64);
const wrongHash = "b".repeat(64);

async function asUser(userId, sql, params = []) {
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await pg.exec("set role authenticated");
  try { return await pg.query(sql, params); }
  finally { await pg.exec("reset role"); }
}

async function object(name, mime, userMetadata) {
  await pg.query(
    "insert into storage.objects (bucket_id, name, metadata, user_metadata) values ('modernsecure-files', $1, $2, $3)",
    [name, { size: 8, mimetype: mime }, userMetadata],
  );
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

  const migrations = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  assert(migrations.includes(migrationName));
  // Message state migration 050 is independent of these finance/task paths.
  for (const name of migrations.filter((entry) => entry < migrationName
    && entry !== "20261011005000_case_message_state.sql")) {
    if (name === "20261011000800_role_boundaries.sql") {
      await pg.query("insert into auth.users values ($1, 'ayanz2008@gmail.com', now())", [admin]);
      await pg.query(
        "insert into public.staff_members (user_id, display_name, role, can_confirm_payments) values ($1, 'Admin', 'admin', true)",
        [admin],
      );
    }
    if (name === "20261011004800_message_realtime.sql") {
      await pg.exec("create publication supabase_realtime");
    }
    try { await pg.exec(readFileSync(path.join(migrationsDir, name), "utf8")); }
    catch (error) { throw new Error(`${name}: ${error.message}`); }
  }
  const integrityMigration = readFileSync(path.join(migrationsDir, migrationName), "utf8");
  await assert.rejects(pg.exec(integrityMigration), /Storage user_metadata is required/);
  await pg.exec("alter table storage.objects add column user_metadata jsonb");
  await pg.exec(integrityMigration);

  await pg.query("insert into auth.users (id, email) values ($1, 'lawyer@example.test'), ($2, 'client@example.test')", [lawyer, client]);
  await pg.query("insert into public.staff_members (user_id, display_name, role) values ($1, 'Lawyer', 'lawyer')", [lawyer]);
  await pg.query(
    "insert into public.clients (id, user_id, full_name, linked_by, linked_at) values ($1, $2, 'Client', $3, now())",
    [card, client, admin],
  );
  await pg.query("insert into public.service_templates (id, code, name) values ($1, 'integrity', 'Integrity')", [service]);
  await pg.query("insert into public.service_template_versions (id, service_id, version_no) values ($1, $2, 1)", [version, service]);
  await pg.query(
    "insert into public.cases (id, case_number, client_id, service_version_id, title) values ($1, 'INT-1', $2, $3, 'Integrity')",
    [caseId, card, version],
  );
  await pg.query("insert into public.case_assignments (case_id, staff_user_id, assigned_by) values ($1, $2, $3)", [caseId, lawyer, admin]);

  const contractPath = `contracts/${caseId}/${randomUUID()}.pdf`;
  const contractSql = "select public.staff_register_contract($1, 'C-1', (now() at time zone 'Asia/Almaty')::date, 100, $2, $3, 8) as id";
  await object(contractPath, "application/pdf", null);
  await assert.rejects(asUser(admin, contractSql, [caseId, contractPath, hash]), /metadata mismatch/);
  await pg.query("update storage.objects set metadata = $2 where name = $1",
    [contractPath, { size: 8, mimetype: "application/pdf", sha256: hash }]);
  await assert.rejects(asUser(admin, contractSql, [caseId, contractPath, hash]), /metadata mismatch/);
  await pg.query("update storage.objects set user_metadata = $2 where name = $1", [contractPath, { sha256: wrongHash }]);
  await assert.rejects(asUser(admin, contractSql, [caseId, contractPath, hash]), /metadata mismatch/);
  await pg.query("update storage.objects set user_metadata = $2 where name = $1", [contractPath, { sha256: hash }]);
  const contractId = (await asUser(admin, contractSql, [caseId, contractPath, hash])).rows[0].id;
  assert.equal((await asUser(admin, contractSql, [caseId, contractPath, hash])).rows[0].id, contractId);

  const receiptPath = `receipts/${caseId}/${client}/${randomUUID()}.pdf`;
  const receiptSql = "select public.client_register_payment_receipt($1, $2, 'receipt.pdf', 'application/pdf', 8, $3, $4) as id";
  const receiptKey = randomUUID();
  await object(receiptPath, "application/pdf", { sha256: wrongHash });
  await assert.rejects(asUser(client, receiptSql, [caseId, receiptPath, hash, receiptKey]), /metadata mismatch/);
  await pg.query("update storage.objects set user_metadata = $2 where name = $1", [receiptPath, { sha256: hash }]);
  const receiptId = (await asUser(client, receiptSql, [caseId, receiptPath, hash, receiptKey])).rows[0].id;
  assert.equal((await asUser(client, receiptSql, [caseId, receiptPath, hash, receiptKey])).rows[0].id, receiptId);
  assert.equal((await pg.query("select count(*)::integer as n from public.audit_events where entity_id = $1 and action = 'submitted'", [receiptId])).rows[0].n, 1);

  const taskId = (await asUser(lawyer,
    "select public.staff_create_task($1, 'answer', 'Question', 'Please answer', null) as id", [caseId])).rows[0].id;
  await asUser(client, "select public.client_respond_task($1, 'Response')", [taskId]);
  await assert.rejects(asUser(lawyer, "select public.staff_review_task($1, null, null)", [taskId]), /decision is required/);
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [lawyer]);
  await assert.rejects(pg.query("select private.staff_review_task($1, null, null)", [taskId]), /Invalid task review/);
  const before = await pg.query("select status from public.tasks where id = $1", [taskId]);
  assert.equal(before.rows[0].status, "response_sent");
  assert.equal((await pg.query("select count(*)::integer as n from public.task_events where task_id = $1 and action = 'returned'", [taskId])).rows[0].n, 0);
  await assert.rejects(asUser(lawyer, "select public.staff_review_task($1, false, null)", [taskId]), /Invalid task review/);
  await asUser(lawyer, "select public.staff_review_task($1, false, 'Needs detail')", [taskId]);
  assert.equal((await pg.query("select status from public.tasks where id = $1", [taskId])).rows[0].status, "new");
  assert.equal((await pg.query("select reason from public.audit_events where entity_id = $1 and action = 'returned'", [taskId])).rows[0].reason, "Needs detail");
  await asUser(client, "select public.client_respond_task($1, 'Revised response')", [taskId]);
  await asUser(lawyer, "select public.staff_review_task($1, true, null)", [taskId]);
  assert.equal((await pg.query("select status from public.tasks where id = $1", [taskId])).rows[0].status, "completed");

  const sent = [];
  const sdk = createClient("https://local.invalid", "local-test-key", {
    global: { fetch: async (url, init) => {
      sent.push({ url: String(url), headers: new Headers(init.headers) });
      return new Response(JSON.stringify({ Id: randomUUID(), Key: "modernsecure-files/test.pdf" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const upload = await sdk.storage.from("modernsecure-files").upload("test.pdf", Buffer.from("PDF"), {
    contentType: "application/pdf", metadata: { sha256: hash }, upsert: false,
  });
  assert.equal(upload.error, null);
  assert.equal(sent.length, 1);
  assert.deepEqual(JSON.parse(Buffer.from(sent[0].headers.get("x-metadata"), "base64").toString("utf8")), { sha256: hash });
  for (const route of ["app/api/contracts/route.ts", "app/api/payment-receipts/route.ts"]) {
    assert.match(readFileSync(path.join(root, route), "utf8"), /metadata: \{ sha256: checked\.sha256 \}/);
  }
  console.log("OK finance/task integrity: Storage metadata preflight, hash binding, replay, NULL decision rejection, normal review, SDK header");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pg.close();
}
