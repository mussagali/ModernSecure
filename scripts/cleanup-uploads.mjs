import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbEnvPath = path.join(root, ".env.db.local");
const appEnvPath = path.join(root, ".env.local");
const caPath = path.join(root, "supabase", "certs", "prod-ca-2021.crt");
const expectedProject = "bdkrihsiprkmukyjyspv";
const apply = process.argv[2] === "--apply";
if (process.argv.length > 3 || (process.argv[2] && !apply)) {
  console.error("Использование: npm run uploads:cleanup [-- --apply]");
  process.exit(2);
}

function readEntry(filePath, name) {
  const entry = readFileSync(filePath, "utf8").split(/\r?\n/)
    .find((line) => line.trimStart().startsWith(`${name}=`));
  return entry?.slice(entry.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "") || null;
}

function databaseClient() {
  const mode = statSync(dbEnvPath).mode & 0o777;
  if (mode & 0o077) throw new Error("Ограничьте права .env.db.local до 600.");
  const raw = readEntry(dbEnvPath, "DATABASE_URL");
  if (!raw) throw new Error("В .env.db.local нет DATABASE_URL.");
  const url = new URL(raw);
  const allowed = (url.hostname === `db.${expectedProject}.supabase.co` && url.username === "postgres")
    || (url.hostname === "aws-0-ap-northeast-2.pooler.supabase.com" && url.username === `postgres.${expectedProject}`);
  if (!allowed || url.protocol !== "postgresql:" || url.port !== "5432" || url.pathname !== "/postgres" || !url.password) {
    throw new Error("DATABASE_URL не соответствует проекту ModernSecure.");
  }
  url.searchParams.delete("sslmode");
  url.searchParams.delete("sslrootcert");
  return new pg.Client({
    connectionString: url.toString(),
    ssl: { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true },
    connectionTimeoutMillis: 12000,
  });
}

function storageClient() {
  const mode = statSync(appEnvPath).mode & 0o777;
  if (mode & 0o077) throw new Error("Ограничьте права .env.local до 600.");
  const baseUrl = readEntry(appEnvPath, "NEXT_PUBLIC_SUPABASE_URL");
  const key = readEntry(appEnvPath, "SUPABASE_SECRET_KEY");
  if (baseUrl !== `https://${expectedProject}.supabase.co` || !key) {
    throw new Error("Для удаления нужен SUPABASE_SECRET_KEY того же проекта в .env.local.");
  }
  return createClient(baseUrl, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

const database = databaseClient();
try {
  await database.connect();
  // Signed staging uploads expire after two hours. Retain their rows for a
  // full day so deleting bytes cannot reset the per-account daily quota.
  const temporary = await database.query(`select id,user_id from public.temporary_uploads
    where created_at < now()-interval '1 day' and expires_at < now() order by created_at limit 100`);
  console.log(`Просроченных временных файлов: ${temporary.rows.length}.`);
  if (apply && temporary.rows.length) {
    const storage = storageClient();
    const { error } = await storage.storage.from('modernsecure-staging')
      .remove(temporary.rows.map(row => `${row.user_id}/${row.id}`));
    if (error) throw new Error('Не удалось очистить временное хранилище; повторите запуск.');
    await database.query('delete from public.temporary_uploads where id=any($1::uuid[])', [temporary.rows.map(row=>row.id)]);
  }
  const { rows } = await database.query(`
    select us.id, us.status, us.cleanup_passes, us.last_cleanup_at,
      array_remove(array_agg(df.storage_path order by df.file_position), null) as paths
    from public.upload_sessions us
    left join public.document_files df on df.upload_session_id = us.id
    where us.expires_at < now() - interval '2 hours'
      and ((us.status = 'pending' and us.cleanup_passes = 0)
        or (us.status = 'expired' and us.cleanup_passes = 0)
        or (us.status = 'expired' and us.cleanup_passes = 1
          and us.last_cleanup_at < now() - interval '1 day'))
    group by us.id
    order by min(coalesce(us.last_cleanup_at, us.created_at))
    limit 100
  `);
  const pathCount = rows.reduce((sum, row) => sum + row.paths.length, 0);
  console.log(`В очередной партии (до 100) сессий: ${rows.length}; файловых путей: ${pathCount}.`);
  if (!apply) {
    console.log("Просмотр без изменений. Для очистки: npm run uploads:cleanup -- --apply");
  } else {
    const storage = storageClient();
    let cleaned = 0;
    for (const row of rows) {
      const result = await database.query(`
        update public.upload_sessions set status = 'expired'
        where id = $1 and status = 'pending' and cleanup_passes = 0
          and expires_at < now() - interval '2 hours'
        returning id
      `, [row.id]);
      if (row.status === "pending" && !result.rows.length) continue;
      if (row.paths.length) {
        const { error } = await storage.storage.from("modernsecure-files").remove(row.paths);
        if (error) throw new Error(`Storage не удалила объекты просроченной сессии; выполните задачу повторно: ${error.message}`);
      }
      const recorded = await database.query(`
        update public.upload_sessions set cleanup_passes = cleanup_passes + 1,
          last_cleanup_at = clock_timestamp()
        where id = $1 and status = 'expired' and cleanup_passes = $2
        returning id
      `, [row.id, row.cleanup_passes]);
      if (recorded.rows.length) cleaned += 1;
    }
    console.log(`Обработано просроченных сессий: ${cleaned}. Повторный запуск безопасен.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await database.end().catch(() => {});
}
