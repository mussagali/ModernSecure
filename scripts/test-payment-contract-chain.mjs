import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase/migrations");
const database = new PGlite();
const admin = randomUUID();
const client = randomUUID();
const clientCard = randomUUID();
const service = randomUUID();
const serviceVersion = randomUUID();
const noContractCase = randomUUID();
const versionedCase = randomUUID();
const otherCase = randomUUID();
const firstContract = randomUUID();
const secondContract = randomUUID();
const thirdContract = randomUUID();
const otherContract = randomUUID();

async function asAdmin(sql, params = []) {
  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
  await database.exec("set role authenticated");
  try { return await database.query(sql, params); }
  finally { await database.exec("reset role"); }
}

async function addContract(id, caseId, versionNo, price) {
  const storagePath = `contracts/${caseId}/${id}.pdf`;
  await database.query(
    "insert into storage.objects (bucket_id, name, metadata) values ('modernsecure-files', $1, $2::jsonb)",
    [storagePath, JSON.stringify({ size: 8, mimetype: "application/pdf" })],
  );
  await database.query(
    `insert into public.contracts (id, case_id, version_no, contract_number, price_kzt,
      storage_path, content_sha256, size_bytes, detected_mime_type)
      values ($1, $2, $3, $4, $5, $6, $7, 8, 'application/pdf')`,
    [id, caseId, versionNo, `C-${versionNo}`, price, storagePath, "a".repeat(64)],
  );
}

const addInstallment = "select public.staff_add_payment_installment($1, current_date, $2, 'Test installment') as id";

try {
  await database.exec(`
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

  const baseline = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql") && name <= "20261011004100_completed_document_upload_replay.sql")
    .sort();
  assert.equal(baseline.at(-1), "20261011004100_completed_document_upload_replay.sql");
  for (const name of baseline) {
    if (name === "20261011000800_role_boundaries.sql") {
      await database.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'ayanz2008@gmail.com', now())", [admin]);
      await database.query(
        "insert into public.staff_members (user_id, display_name, role, can_confirm_payments) values ($1, 'Admin', 'admin', true)",
        [admin],
      );
    }
    try { await database.exec(readFileSync(path.join(migrationsDir, name), "utf8")); }
    catch (error) { throw new Error(`${name}: ${error.message}`); }
  }

  await database.query("insert into auth.users (id, email) values ($1, 'client@example.test')", [client]);
  await database.query(
    "insert into public.clients (id, user_id, full_name, linked_by, linked_at) values ($1, $2, 'Client', $3, now())",
    [clientCard, client, admin],
  );
  await database.query("insert into public.service_templates (id, code, name) values ($1, 'finance-chain', 'Finance chain')", [service]);
  await database.query(
    "insert into public.service_template_versions (id, service_id, version_no) values ($1, $2, 1)",
    [serviceVersion, service],
  );
  for (const [id, number] of [[noContractCase, "F-1"], [versionedCase, "F-2"], [otherCase, "F-3"]]) {
    await database.query(
      "insert into public.cases (id, case_number, client_id, service_version_id, title) values ($1, $2, $3, $4, 'Finance case')",
      [id, number, clientCard, serviceVersion],
    );
  }

  await addContract(firstContract, versionedCase, 1, 100);
  await addContract(secondContract, versionedCase, 2, 100);
  await addContract(otherContract, otherCase, 1, 100);
  const oldWithoutContract = randomUUID();
  const oldWithVersions = randomUUID();
  const oldWithOneVersion = randomUUID();
  await database.query(
    `insert into public.payment_schedule (id, case_id, due_on, amount_kzt)
      values ($1, $2, current_date, 10), ($3, $4, current_date, 20), ($5, $6, current_date, 30)`,
    [oldWithoutContract, noContractCase, oldWithVersions, versionedCase, oldWithOneVersion, otherCase],
  );

  const migration = readFileSync(path.join(migrationsDir, "20261011004500_payment_schedule_contract_version.sql"), "utf8");
  await assert.rejects(database.exec(migration), /Legacy payment schedule contains a case without a contract/);
  await database.query("delete from public.payment_schedule where id = $1", [oldWithoutContract]);
  await database.exec(migration);
  const historical = await database.query(
    "select id, contract_id from public.payment_schedule where id in ($1, $2)",
    [oldWithVersions, oldWithOneVersion],
  );
  assert.equal(historical.rows.length, 2);
  assert(historical.rows.every((row) => row.contract_id === null), "Migration must not guess historical versions");

  await assert.rejects(asAdmin(addInstallment, [noContractCase, 10]), /Contract version is required/);
  await assert.rejects(database.query(
    "insert into public.payment_schedule (case_id, due_on, amount_kzt) values ($1, current_date, 10)",
    [versionedCase],
  ), /Contract version is required/);
  await assert.rejects(database.query(
    "insert into public.payment_schedule (case_id, contract_id, due_on, amount_kzt) values ($1, $2, current_date, 10)",
    [versionedCase, otherContract],
  ));

  const firstNew = (await asAdmin(addInstallment, [versionedCase, 200])).rows[0].id;
  let association = await database.query("select contract_id, amount_kzt from public.payment_schedule where id = $1", [firstNew]);
  assert.equal(association.rows[0].contract_id, secondContract, "New schedule uses the latest contract version");
  assert.equal(Number(association.rows[0].amount_kzt), 200, "Schedule is not capped at contract price");

  await addContract(thirdContract, versionedCase, 3, 300);
  const secondNew = (await asAdmin(addInstallment, [versionedCase, 50])).rows[0].id;
  association = await database.query("select id, contract_id from public.payment_schedule where id in ($1, $2)", [firstNew, secondNew]);
  assert.equal(association.rows.find((row) => row.id === firstNew).contract_id, secondContract);
  assert.equal(association.rows.find((row) => row.id === secondNew).contract_id, thirdContract);

  await assert.rejects(database.query("update public.payment_schedule set contract_id = $2 where id = $1", [firstNew, thirdContract]));
  await assert.rejects(database.query("update public.payment_schedule set contract_id = $2 where id = $1", [oldWithVersions, firstContract]));
  const oldUpdatedAt = (await database.query(
    "select updated_at from public.payment_schedule where id = $1", [oldWithVersions],
  )).rows[0].updated_at;
  await asAdmin(
    "select public.staff_update_payment_installment($1, $2, current_date, 25, 'Adjusted', 'Legacy schedule correction')",
    [oldWithVersions, oldUpdatedAt],
  );
  const legacy = await database.query("select contract_id, amount_kzt from public.payment_schedule where id = $1", [oldWithVersions]);
  assert.equal(legacy.rows[0].contract_id, null, "Legacy version stays unknown after schedule edit");
  assert.equal(Number(legacy.rows[0].amount_kzt), 25);

  const page = readFileSync(path.join(root, "app/staff/cases/[id]/payments/page.tsx"), "utf8");
  assert.match(page, /canChange && !latestContract/);
  assert.match(page, /canChange && latestContract && <section/);
  assert.match(page, /select\("id, contract_id, due_on/);
  assert.match(page, /версия договора не установлена/);
  console.log("OK payment contract chain: orphan preflight, unknown legacy versions, creation guard, same-case FK, version binding, UI gate");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await database.close();
}
