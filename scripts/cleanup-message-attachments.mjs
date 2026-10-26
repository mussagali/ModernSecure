import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { CANDIDATE_SQL, RECHECK_SQL, MESSAGE_PATH_PATTERN, isMessagePath } from "../lib/message-attachment-cleanup.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = "bdkrihsiprkmukyjyspv";
const bucket = "modernsecure-files";
const dbEnvPath = path.join(root, ".env.db.local");
const appEnvPath = path.join(root, ".env.local");
const caPath = path.join(root, "supabase", "certs", "prod-ca-2021.crt");
const apply = process.argv[2] === "--apply";

if (process.argv.length > 3 || (process.argv[2] && !apply)) {
  console.error("Usage: npm run messages:cleanup [-- --apply]");
  process.exit(2);
}

function entry(filePath, key) {
  if (statSync(filePath).mode & 0o077) {
    throw new Error(`${path.basename(filePath)} must be accessible only to its owner (chmod 600).`);
  }
  const line = readFileSync(filePath, "utf8").split(/\r?\n/)
    .find((item) => item.trimStart().startsWith(`${key}=`));
  return line?.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "") || null;
}

function databaseClient() {
  const raw = entry(dbEnvPath, "DATABASE_URL");
  if (!raw) throw new Error("DATABASE_URL is missing from .env.db.local.");
  const url = new URL(raw);
  const direct = url.hostname === `db.${project}.supabase.co` && url.username === "postgres";
  const pooler = url.hostname === "aws-0-ap-northeast-2.pooler.supabase.com"
    && url.username === `postgres.${project}`;
  if ((!direct && !pooler) || url.protocol !== "postgresql:" || url.port !== "5432"
    || url.pathname !== "/postgres" || !url.password || url.hash
    || [...url.searchParams.keys()].some((key) => !["sslmode", "sslrootcert"].includes(key))) {
    throw new Error("DATABASE_URL does not identify the exact ModernSecure project database.");
  }
  url.searchParams.delete("sslmode");
  url.searchParams.delete("sslrootcert");
  return new pg.Client({
    connectionString: url.toString(),
    ssl: { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true, servername: url.hostname },
    connectionTimeoutMillis: 12000,
  });
}

function storageClient() {
  const baseUrl = entry(appEnvPath, "NEXT_PUBLIC_SUPABASE_URL");
  const key = entry(appEnvPath, "SUPABASE_SECRET_KEY");
  if (baseUrl !== `https://${project}.supabase.co` || !key) {
    throw new Error("The exact project URL and SUPABASE_SECRET_KEY are required in .env.local.");
  }
  return createClient(baseUrl, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

const database = databaseClient();
try {
  await database.connect();
  const identity = await database.query("select current_database() as db_name");
  if (identity.rows.length !== 1 || identity.rows[0].db_name !== "postgres"
    || database.connection.stream.encrypted !== true
    || database.connection.stream.authorized !== true) {
    throw new Error("The database connection is not the expected TLS-protected postgres database.");
  }
  const { rows } = await database.query(CANDIDATE_SQL, [bucket, MESSAGE_PATH_PATTERN]);
  if (rows.some((row) => !isMessagePath(row.name))) {
    throw new Error("A candidate path is outside the exact message upload layout.");
  }
  console.log(`Aged, unreferenced message objects in this batch: ${rows.length} (maximum 100).`);
  if (!apply) {
    console.log("Dry run only. To remove this batch: npm run messages:cleanup -- --apply");
  } else {
    const guards = await database.query(`
      select t.tgname from pg_catalog.pg_trigger t
      where t.tgenabled in ('O','A') and (t.tgtype & 7) = 7 and (
        (t.tgrelid = 'public.message_attachments'::regclass
          and t.tgname = 'modernsecure_message_attachment_insert_guard'
          and t.tgfoid = pg_catalog.to_regprocedure('private.guard_message_attachment_insert()'))
        or (t.tgrelid = 'public.staff_message_attachments'::regclass
          and t.tgname = 'modernsecure_staff_message_attachment_insert_guard'
          and t.tgfoid = pg_catalog.to_regprocedure('private.guard_staff_message_attachment_insert()'))
      )
    `);
    if (guards.rows.length !== 2) {
      throw new Error("Both message attachment INSERT guards must be installed and enabled.");
    }
    const storage = storageClient();
    let removed = 0;
    let skipped = 0;
    for (const row of rows) {
      if (!isMessagePath(row.name)) throw new Error("Invalid message object path.");
      await database.query("begin isolation level read committed");
      try {
        await database.query("select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))", [row.name]);
        const current = await database.query(RECHECK_SQL, [bucket, row.name, MESSAGE_PATH_PATTERN]);
        if (!current.rows.length) {
          skipped++;
        } else {
          const { error } = await storage.storage.from(bucket).remove([row.name]);
          if (error) throw new Error(`Storage removal failed for ${row.name}: ${error.message}`);
          const remaining = await database.query(
            "select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, row.name]);
          if (remaining.rows.length) throw new Error(`Storage still lists ${row.name}; stopping.`);
          removed++;
        }
        await database.query("commit");
      } catch (error) {
        await database.query("rollback").catch(() => {});
        throw error;
      }
    }
    console.log(`Removed: ${removed}; skipped after recheck: ${skipped}. Run again for another batch.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await database.end().catch(() => {});
}
