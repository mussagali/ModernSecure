import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const credentialPath = path.join(root, ".test-accounts.local.json");
const project = "bdkrihsiprkmukyjyspv";
const roles = [
  { key: "client", email: "qa-client-modernsecure@example.test", name: "ТЕСТ — Клиент" },
  { key: "lawyer", email: "qa-lawyer-modernsecure@example.test", name: "ТЕСТ — Юрист" },
  { key: "manager", email: "qa-manager-modernsecure@example.test", name: "ТЕСТ — Менеджер" },
];

function secret(file, name) {
  if (statSync(file).mode & 0o077) throw new Error(`${path.basename(file)} должен иметь права 600`);
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((part) => part.trimStart().startsWith(`${name}=`));
  return line?.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "") || null;
}

const dbUrl = new URL(secret(path.join(root, ".env.db.local"), "DATABASE_URL"));
const allowedDb =
  (dbUrl.hostname === `db.${project}.supabase.co` && dbUrl.username === "postgres") ||
  (dbUrl.hostname === "aws-0-ap-northeast-2.pooler.supabase.com" && dbUrl.username === `postgres.${project}`);
if (!allowedDb || dbUrl.protocol !== "postgresql:" || dbUrl.port !== "5432" || dbUrl.pathname !== "/postgres"
  || !dbUrl.password || dbUrl.hash || [...dbUrl.searchParams.keys()].some((key) => !["sslmode", "sslrootcert"].includes(key))) {
  throw new Error("DATABASE_URL не указывает на согласованный проект Supabase");
}
dbUrl.searchParams.delete("sslmode");
dbUrl.searchParams.delete("sslrootcert");
const baseUrl = secret(path.join(root, ".env.local"), "NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = secret(path.join(root, ".env.local"), "SUPABASE_SECRET_KEY");
const publicKey = secret(path.join(root, ".env.local"), "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
if (baseUrl !== `https://${project}.supabase.co` || !/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(serviceKey ?? "") || !publicKey) {
  throw new Error("Ключи Supabase для согласованного проекта не настроены");
}

const database = new pg.Client({
  connectionString: dbUrl.toString(),
  ssl: { ca: readFileSync(path.join(root, "supabase", "certs", "prod-ca-2021.crt"), "utf8"), rejectUnauthorized: true, servername: dbUrl.hostname },
  connectionTimeoutMillis: 12000,
});
const admin = createClient(baseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

function saveCredentials(data, first = false) {
  writeFileSync(credentialPath, JSON.stringify(data, null, 2) + "\n", { flag: first ? "wx" : "w", mode: 0o600 });
}

async function inspect() {
  const emails = roles.map((role) => role.email);
  const existing = await database.query("select lower(email) as email from auth.users where lower(email) = any($1::text[])", [emails]);
  const owner = await database.query("select count(*)::integer as n from public.staff_members sm join auth.users u on u.id = sm.user_id where lower(u.email) = 'ayanz2008@gmail.com' and sm.role = 'admin' and sm.active");
  if (owner.rows[0]?.n !== 1) throw new Error("Главный администратор не найден или неактивен");
  return existing.rows.map((row) => row.email);
}

async function verifyPasswords(data) {
  for (const role of roles) {
    const account = data.accounts[role.key];
    const browser = createClient(baseUrl, publicKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: signed, error } = await browser.auth.signInWithPassword({ email: role.email, password: account.password });
    if (error || signed.user?.id !== account.id) throw new Error(`Вход тестового ${role.key} не прошёл`);
    const table = role.key === "client" ? "clients" : "staff_members";
    const column = role.key === "client" ? "user_id" : "user_id";
    const { data: linked, error: readError } = await browser.from(table).select("user_id").eq(column, account.id).maybeSingle();
    if (readError || linked?.user_id !== account.id) throw new Error(`Роль тестового ${role.key} не видна после входа`);
    await browser.auth.signOut();
  }
}

let transaction = false;
try {
  await database.connect();
  if (!database.connection.stream.encrypted || !database.connection.stream.authorized) throw new Error("Соединение с БД не защищено TLS");
  const existing = await inspect();
  if (process.argv[2] === "--plan") {
    console.log(`План: ${roles.map((role) => role.key).join(", ")}; уже существуют: ${existing.length}; файл паролей: ${existsSync(credentialPath) ? "есть" : "нет"}.`);
  } else if (process.argv[2] === "--inventory") {
    if (!existsSync(credentialPath) || (statSync(credentialPath).mode & 0o077)) throw new Error("Нет защищённого файла тестовых аккаунтов");
    const saved = JSON.parse(readFileSync(credentialPath, "utf8"));
    if (saved.project !== project || saved.status !== "ready") throw new Error("Тестовые аккаунты ещё не готовы");
    const cards = await database.query("select id from public.clients where user_id = $1 and lower(email) = $2", [saved.accounts.client.id, roles[0].email]);
    if (cards.rows.length !== 1) throw new Error("Карточка тестового клиента не найдена однозначно");
    const cases = await database.query("select id, case_number, title, status from public.cases where client_id = $1 order by created_at", [cards.rows[0].id]);
    const assignments = await database.query("select case_id, staff_user_id from public.case_assignments where case_id = any($1::uuid[]) and revoked_at is null", [cases.rows.map((row) => row.id)]);
    const versions = await database.query("select v.id, s.name, v.version_no from public.service_template_versions v join public.service_templates s on s.id = v.service_id where s.active and v.published_at is not null order by s.created_at desc, v.version_no desc limit 10");
    console.log(JSON.stringify({ clientCardId: cards.rows[0].id, cases: cases.rows,
      assignments: assignments.rows.map((row) => ({ caseId: row.case_id,
        role: row.staff_user_id === saved.accounts.lawyer.id ? "lawyer" : row.staff_user_id === saved.accounts.manager.id ? "manager" : "other" })),
      publishedServiceVersions: versions.rows }, null, 2));
  } else if (process.argv[2] === "--prepare-case") {
    if (!existsSync(credentialPath) || (statSync(credentialPath).mode & 0o077)) throw new Error("Нет защищённого файла тестовых аккаунтов");
    const saved = JSON.parse(readFileSync(credentialPath, "utf8"));
    if (saved.project !== project || saved.status !== "ready") throw new Error("Тестовые аккаунты ещё не готовы");
    const title = "ТЕСТ — проверка субагентами";
    const card = await database.query("select id from public.clients where id = $1 and user_id = $2 and lower(email) = $3", [saved.client_card_id, saved.accounts.client.id, roles[0].email]);
    if (card.rows.length !== 1) throw new Error("Карточка тестового клиента не найдена");
    const existingCase = await database.query("select id, case_number from public.cases where client_id = $1 and title = $2 and status = 'open'", [saved.client_card_id, title]);
    if (existingCase.rows.length) throw new Error("Активное дело агентской проверки уже существует; повторно не создаю");
    await database.query("begin");
    transaction = true;
    const owner = await database.query("select sm.user_id from public.staff_members sm join auth.users u on u.id = sm.user_id where lower(u.email) = 'ayanz2008@gmail.com' and sm.role = 'admin' and sm.active");
    if (owner.rows.length !== 1) throw new Error("Главный администратор не найден");
    await database.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.rows[0].user_id]);
    await database.query("set local role authenticated");
    const versions = await database.query("select version_id from public.available_service_versions() where service_name = 'ТЕСТ — проверка файлов' order by version_no desc limit 1");
    if (versions.rows.length !== 1) throw new Error("Нет опубликованной тестовой услуги");
    const created = await database.query("select public.staff_create_case($1, $2, $3) as id", [saved.client_card_id, versions.rows[0].version_id, title]);
    const caseId = created.rows[0]?.id;
    if (!caseId) throw new Error("Тестовое дело не создано");
    await database.query("select public.staff_assign_case($1, $2)", [caseId, saved.accounts.lawyer.id]);
    await database.query("select public.staff_assign_case($1, $2)", [caseId, saved.accounts.manager.id]);
    await database.query("reset role");
    const item = await database.query("select case_number from public.cases where id = $1", [caseId]);
    await database.query("commit");
    transaction = false;
    console.log(JSON.stringify({ id: caseId, caseNumber: item.rows[0]?.case_number, title }));
  } else if (process.argv[2] === "--apply") {
    let data;
    if (existsSync(credentialPath)) {
      if (statSync(credentialPath).mode & 0o077) throw new Error("Файл тестовых паролей должен иметь права 600");
      data = JSON.parse(readFileSync(credentialPath, "utf8"));
      if (data.project !== project || data.status === "ready") throw new Error("Тестовые аккаунты уже созданы или файл относится к другому проекту");
    } else {
      if (existing.length) throw new Error("Один из тестовых email уже занят; новые аккаунты не создавались");
      data = { project, status: "pending", accounts: Object.fromEntries(roles.map((role) => [role.key, {
        email: role.email, name: role.name, password: randomBytes(24).toString("base64url"), id: null,
      }])) };
      saveCredentials(data, true);
    }

    for (const role of roles) {
      const account = data.accounts[role.key];
      if (account.email !== role.email || account.name !== role.name || !account.password) throw new Error("Файл тестовых паролей не соответствует плану");
      if (account.id) continue;
      if (existing.includes(role.email)) throw new Error(`Аккаунт ${role.key} уже существует без сохранённого ID; требуется ручная сверка`);
      const { data: created, error } = await admin.auth.admin.createUser({
        email: account.email, password: account.password, email_confirm: true,
        user_metadata: { display_name: account.name, qa_marker: "modernsecure_test_accounts" },
      });
      if (error || !created.user?.id) throw new Error(`Не удалось создать Auth-аккаунт ${role.key}: ${error?.message ?? "нет ID"}`);
      account.id = created.user.id;
      saveCredentials(data);
      console.log(`Auth-аккаунт ${role.key} создан.`);
    }

    await database.query("begin");
    transaction = true;
    const owner = await database.query("select sm.user_id from public.staff_members sm join auth.users u on u.id = sm.user_id where lower(u.email) = 'ayanz2008@gmail.com' and sm.role = 'admin' and sm.active");
    for (const role of roles) {
      const account = data.accounts[role.key];
      const actual = await database.query("select id, email_confirmed_at is not null as confirmed from auth.users where id = $1 and lower(email) = $2", [account.id, account.email]);
      if (actual.rows.length !== 1 || !actual.rows[0].confirmed) throw new Error(`Тестовый ${role.key} не найден или email не подтверждён`);
    }
    await database.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.rows[0].user_id]);
    await database.query("set local role authenticated");
    for (const role of roles.filter((entry) => entry.key !== "client")) {
      const account = data.accounts[role.key];
      const granted = await database.query("select public.admin_add_staff($1, $2, $3::public.staff_role) as id", [role.email, role.name, role.key]);
      if (granted.rows[0]?.id !== account.id) throw new Error(`Роль ${role.key} не выдана`);
    }
    const client = data.accounts.client;
    const card = await database.query("select public.staff_create_client($1, $2, null, null) as id", [client.name, client.email]);
    if (!card.rows[0]?.id) throw new Error("Карточка тестового клиента не создана");
    await database.query("select public.link_client_account($1, $2)", [card.rows[0].id, client.email]);
    await database.query("reset role");
    await database.query("insert into public.audit_events (actor_user_id, entity_type, action, reason, after_data) values (null, 'qa_setup', 'test_accounts_provisioned', 'По запросу владельца: тестовые аккаунты без доступа к реальным делам', jsonb_build_object('client_card_id', $1::uuid, 'staff_user_ids', $2::uuid[]))", [card.rows[0].id, [data.accounts.lawyer.id, data.accounts.manager.id]]);
    await database.query("commit");
    transaction = false;
    data.status = "ready";
    data.client_card_id = card.rows[0].id;
    saveCredentials(data);
    await verifyPasswords(data);
    console.log(`Готово: клиент, юрист и менеджер; вход проверен. Пароли только в ${credentialPath}`);
  } else {
    throw new Error("Использование: node scripts/provision-test-accounts.mjs --plan|--inventory|--prepare-case|--apply");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (transaction) await database.query("rollback").catch(() => {});
  await database.end().catch(() => {});
}
