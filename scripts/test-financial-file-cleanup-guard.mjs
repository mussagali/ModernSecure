import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const database = new PGlite();
const contract = "contracts/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.pdf";
const receipt = "receipts/11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444.png";

try {
  await database.exec(`
    create role anon;
    create role authenticated;
    create schema private;
    create schema storage;
    create table storage.objects (bucket_id text not null, name text not null, metadata jsonb);
    create table public.contracts (storage_path text not null, size_bytes bigint, detected_mime_type text);
    create table public.payment_receipts (storage_path text not null, size_bytes bigint, detected_mime_type text);
  `);
  await database.exec(readFileSync(path.join(root, "supabase/migrations/20261011003200_financial_file_cleanup_guard.sql"), "utf8"));

  await assert.rejects(database.query(
    "insert into public.contracts values ($1, 42, 'application/pdf')", [contract],
  ));
  await database.query(
    "insert into storage.objects values ('modernsecure-previews', $1, $2)",
    [contract, { size: 42, mimetype: "application/pdf" }],
  );
  await assert.rejects(database.query(
    "insert into public.contracts values ($1, 42, 'application/pdf')", [contract],
  ));
  await database.query(
    "insert into storage.objects values ('modernsecure-files', $1, $2)",
    [contract, { size: 41, mimetype: "application/pdf" }],
  );
  await assert.rejects(database.query(
    "insert into public.contracts values ($1, 42, 'application/pdf')", [contract],
  ));
  await database.query(
    "update storage.objects set metadata = $2 where bucket_id = 'modernsecure-files' and name = $1",
    [contract, { size: 42, mimetype: "application/pdf" }],
  );
  await database.query("insert into public.contracts values ($1, 42, 'application/pdf')", [contract]);

  await database.query(
    "insert into storage.objects values ('modernsecure-files', $1, $2)",
    [receipt, { size: 100, mimetype: "application/pdf" }],
  );
  await assert.rejects(database.query(
    "insert into public.payment_receipts values ($1, 100, 'image/png')", [receipt],
  ));
  await database.query(
    "update storage.objects set metadata = $2 where bucket_id = 'modernsecure-files' and name = $1",
    [receipt, { size: 100, mimetype: "image/png" }],
  );
  await database.query("insert into public.payment_receipts values ($1, 100, 'image/png')", [receipt]);
  assert.equal((await database.query("select count(*)::integer as count from public.contracts")).rows[0].count, 1);
  assert.equal((await database.query("select count(*)::integer as count from public.payment_receipts")).rows[0].count, 1);
  console.log("OK financial-file insert guards: missing object, wrong bucket, size, MIME, and matching object");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await database.close();
}
