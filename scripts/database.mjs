import { simulateMfaInTransaction } from "./transactional-mfa.mjs";
import { readFileSync, statSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env.db.local");
const caPath = path.join(root, "supabase", "certs", "prod-ca-2021.crt");
const expectedTargets = [
  { host: "db.bdkrihsiprkmukyjyspv.supabase.co", user: "postgres" },
  { host: "aws-0-ap-northeast-2.pooler.supabase.com", user: "postgres.bdkrihsiprkmukyjyspv" },
];
const projectTables = [
  "legal_documents", "profiles", "staff_members", "clients", "service_templates", "service_template_versions",
  "stage_templates", "document_templates", "cases", "case_assignments", "case_stage_events",
  "case_suspensions", "case_internal_notes", "document_requests", "upload_sessions",
  "document_files", "document_internal_notes", "tasks", "task_events", "messages",
  "message_attachments", "message_reads", "notifications", "contracts", "payment_schedule",
  "payment_receipts", "payments", "consent_records", "audit_events", "faq_entries",
  "contact_settings", "staff_invites", "staff_threads", "staff_messages", "staff_thread_reads", "staff_message_attachments", "staff_message_case_refs",
];
const requiredWorkflows = [
  "staff_cancel_task", "staff_close_document_request", "staff_reopen_template_document_request", "admin_publish_legal_document", "client_consent_status", "accept_client_consents",
  "link_client_account", "staff_create_client", "admin_create_service", "staff_create_case",
  "staff_change_case_stage", "staff_assign_case", "staff_create_task", "client_respond_task",
  "staff_review_task", "staff_create_document_request", "post_case_message",
  "mark_case_messages_read", "mark_case_messages_seen", "mark_case_notifications_read", "admin_add_staff",
  "admin_set_staff_access", "admin_revoke_case_assignment",
  "admin_invite_staff", "admin_cancel_staff_invite", "claim_staff_invite",
  "begin_document_upload", "complete_document_upload", "staff_review_document_file", "retract_document_file",
  "admin_set_payment_permission", "staff_add_payment_installment", "staff_update_payment_installment",
  "staff_confirm_payment", "staff_void_payment",
  "update_own_profile",
  "admin_save_contact_settings", "admin_upsert_faq",
  "mark_own_notifications_read",
  "open_own_notification",
  "resume_or_begin_document_upload",
  "staff_suspend_case", "staff_resume_case", "staff_close_case", "staff_cancel_case",
  "admin_create_service_with_documents", "admin_publish_service_version",
  "available_service_versions",
  "staff_search_clients",
  "staff_register_contract", "client_register_payment_receipt",
  "staff_review_payment_receipt", "staff_confirm_payment_with_receipt",
  "client_acknowledge_task",
  "authorize_document_file_upload",
  "admin_staff_emails",
  "post_case_message_with_attachments", "admin_unassigned_cases", "staff_case_worklist",
  "staff_directory", "staff_open_thread", "staff_send_message", "staff_mark_thread_read",
  "staff_message_page",
  "staff_chat_sidebar",
  "staff_send_message_with_attachments",
  "staff_can_reference_case", "staff_send_case_message", "staff_send_case_message_with_attachments",
  "case_message_authors",
  "case_message_page",
  "staff_add_case_note", "staff_case_note_page",
  "staff_mfa_status", "enforce_staff_mfa_request",
  "server_record_file_access",
  "admin_audit_page", "admin_auth_audit_page", "record_staff_mfa_entry",
  "staff_unread_case_count", "case_unread_message_count",
  "staff_stale_case_days", "staff_stale_case_page", "admin_set_stale_case_days",
];
const requiredWorkflowTriggers = [
  "modernsecure_document_task_files", "modernsecure_document_task_closed", "modernsecure_linked_document_task_guard",
  "modernsecure_contract_file_insert_guard", "modernsecure_receipt_file_insert_guard",
  "modernsecure_contract_notify", "modernsecure_receipt_submitted_notify",
  "modernsecure_receipt_reviewed_notify", "modernsecure_document_submission_notify",
  "modernsecure_message_attachments_immutable", "modernsecure_installment_contract_required",
  "modernsecure_installment_contract_immutable",
  "modernsecure_staff_message_attachment_insert_guard", "modernsecure_staff_messages_immutable",
  "modernsecure_staff_message_attachments_immutable",
  "modernsecure_staff_message_case_refs_immutable",
  "modernsecure_case_close_document_versions", "modernsecure_client_document_resubmission",
];

function getDatabaseUrl() {
  let source;
  try {
    source = readFileSync(envPath, "utf8");
  } catch {
    throw new Error("Нет .env.db.local. Добавьте DATABASE_URL локально, не в чат.");
  }
  const mode = statSync(envPath).mode & 0o777;
  if (mode & 0o077) console.warn("Предупреждение: ограничьте права на .env.db.local до 600.");
  const entry = source.split(/\r?\n/).find((line) => line.trimStart().startsWith("DATABASE_URL="));
  if (!entry) throw new Error("В .env.db.local нет строки DATABASE_URL=...");
  const raw = entry.slice(entry.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "");
  let url;
  try { url = new URL(raw); } catch { throw new Error("DATABASE_URL не является корректным URL."); }
  if (url.protocol !== "postgresql:" || !expectedTargets.some((target) => url.hostname === target.host && url.username === target.user) || url.port !== "5432" || url.pathname !== "/postgres") {
    throw new Error("DATABASE_URL не соответствует согласованному проекту Supabase. Ничего не выполнено.");
  }
  if (!url.password || url.password.includes("YOUR-PASSWORD") || url.password.includes("URL_ENCODED_PASSWORD")) {
    throw new Error("В DATABASE_URL всё ещё нет настоящего пароля.");
  }
  return url;
}

function createClient(url) {
  const connection = new URL(url);
  connection.searchParams.delete("sslmode");
  connection.searchParams.delete("sslrootcert");
  return new pg.Client({
    connectionString: connection.toString(),
    ssl: { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true },
    connectionTimeoutMillis: 12000,
  });
}

async function inspect(url) {
  const client = createClient(url);
  try {
    await client.connect();
    const identity = await client.query("select current_database() as database_name, current_user as database_user");
    const tables = await client.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name");
    const buckets = await client.query("select id, public from storage.buckets order by id");
    const conflict = tables.rows.map((row) => row.table_name).filter((name) => projectTables.includes(name));
    const bucketConflict = buckets.rows.filter((row) => row.id.startsWith("modernsecure-"));
    console.log(`Подключено: ${url.hostname}, БД ${identity.rows[0].database_name}, роль ${identity.rows[0].database_user}.`);
    console.log(`Таблиц в public: ${tables.rows.length}; бакетов: ${buckets.rows.length}.`);
    if (tables.rows.length) console.log(`Существующие public-таблицы: ${tables.rows.map((row) => row.table_name).join(", ")}`);
    if (conflict.length || bucketConflict.length) {
      throw new Error(`Найдены объекты ModernSecure: таблицы [${conflict.join(", ")}], бакеты [${bucketConflict.map((row) => row.id).join(", ")}]. Нужна проверка миграций; автоматическое применение остановлено.`);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

async function verify(url, preMigration = false) {
  const client = createClient(url);
  try {
    await client.connect();
    const checkedTables = preMigration ? projectTables.filter((name) => !["legal_documents", "staff_invites", "staff_threads", "staff_messages", "staff_thread_reads", "staff_message_attachments", "staff_message_case_refs"].includes(name)) : projectTables;
    const checkedWorkflows = preMigration ? [] : requiredWorkflows;
    const tables = await client.query("select tablename, rowsecurity from pg_tables where schemaname = 'public'");
    const matching = tables.rows.filter((row) => checkedTables.includes(row.tablename));
    const missing = checkedTables.filter((name) => !matching.some((row) => row.tablename === name));
    const withoutRls = matching.filter((row) => !row.rowsecurity).map((row) => row.tablename);
    const bucketRows = await client.query("select id, public from storage.buckets where id in ('modernsecure-files', 'modernsecure-previews')");
    const policies = await client.query("select count(*)::integer as count from pg_policies where schemaname = 'public' and tablename = any($1)", [projectTables]);
    const mfaPolicies = preMigration ? { rows: [] } : await client.query(`select tablename from pg_policies
      where schemaname = 'public' and tablename = any($1)
        and policyname = 'staff_mfa_guard' and permissive = 'RESTRICTIVE'`, [projectTables]);
    const missingMfaPolicies = preMigration ? [] : projectTables.filter((name) => !mfaPolicies.rows.some((row) => row.tablename === name));
    const mfaHook = preMigration ? { rows: [] } : await client.query(`select 1 from pg_roles
      where rolname = 'authenticator' and 'pgrst.db_pre_request=public.enforce_staff_mfa_request' = any(rolconfig)`);
    const mfaStoragePolicy = preMigration ? { rows: [] } : await client.query(`select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'modernsecure_storage_mfa_guard' and permissive = 'RESTRICTIVE'`);
    const readCursor = preMigration ? { rows: [{ ready: true }] } : await client.query(`select
      to_regprocedure('public.staff_mark_thread_read(uuid,uuid)') is not null
        and to_regprocedure('public.staff_mark_thread_read(uuid)') is null
        and exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'staff_thread_reads'
            and column_name = 'last_read_message_id')
        and not exists (select 1 from public.staff_thread_reads r
          join public.staff_messages m on m.id = r.last_read_message_id
          where m.thread_id <> r.thread_id or m.created_at <> r.read_at) as ready`);
    const functions = await client.query("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1)", [checkedWorkflows]);
    const missingWorkflows = checkedWorkflows.filter((name) => !functions.rows.some((row) => row.proname === name));
    const triggerNames = preMigration ? [] : requiredWorkflowTriggers;
    const triggers = await client.query(`select tgname from pg_catalog.pg_trigger
      where not tgisinternal and tgenabled in ('O', 'A') and tgname = any($1)`, [triggerNames]);
    const missingTriggers = triggerNames.filter((name) => !triggers.rows.some((row) => row.tgname === name));
    let reminderJobReady = preMigration;
    let messageRealtimeReady = preMigration;
    if (!preMigration) {
      const publication = await client.query(`select tablename from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public'
          and tablename in ('messages', 'staff_messages')`);
      messageRealtimeReady = ['messages', 'staff_messages'].every((name) => publication.rows.some((row) => row.tablename === name));
      const reminderFunction = await client.query(`select 1 from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname in ('enqueue_task_deadline_reminders', 'enqueue_payment_deadline_reminders')`);
      const cronTable = await client.query("select to_regclass('cron.job') as name");
      const reminderJob = cronTable.rows[0]?.name ? await client.query(`select 1 from cron.job
        where jobname = $1 and schedule = $2 and command = $3 and active`,
      ["modernsecure-task-deadlines", "0 * * * *", "select private.enqueue_task_deadline_reminders()"])
        : { rows: [] };
      const paymentJob = cronTable.rows[0]?.name ? await client.query(`select 1 from cron.job
        where jobname = 'modernsecure-payment-deadlines' and schedule = '5 * * * *'
          and command = 'select private.enqueue_payment_deadline_reminders()' and active`) : { rows: [] };
      reminderJobReady = reminderFunction.rows.length === 2 && reminderJob.rows.length > 0 && paymentJob.rows.length > 0;
    }
    if (preMigration) {
      const receiptMetadata = await client.query(`select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'payment_receipts' and column_name = 'content_sha256'`);
      if (!receiptMetadata.rows.length) {
        const existingReceipts = await client.query("select count(*)::integer as count from public.payment_receipts");
        if (existingReceipts.rows[0].count > 0) {
          throw new Error("В БД уже есть чеки без метаданных файла. Миграция остановлена до их ручной проверки.");
        }
      }
    }
    console.log(`Проверка: ${matching.length}/${checkedTables.length} таблиц, ${policies.rows[0].count} политик RLS, ${bucketRows.rows.length}/2 закрытых бакета, ${checkedWorkflows.length - missingWorkflows.length}/${checkedWorkflows.length} рабочих функций, ${triggerNames.length - missingTriggers.length}/${triggerNames.length} рабочих триггеров, напоминания ${reminderJobReady ? "активны" : "неактивны"}, realtime сообщений ${messageRealtimeReady ? "активен" : "неактивен"}, MFA ${preMigration ? "ожидает миграции" : `${mfaPolicies.rows.length}/${projectTables.length} таблиц`}.`);
    if (missing.length || withoutRls.length || bucketRows.rows.length !== 2 || bucketRows.rows.some((row) => row.public) || missingWorkflows.length || missingTriggers.length || !reminderJobReady || !messageRealtimeReady || missingMfaPolicies.length || !readCursor.rows[0].ready || (!preMigration && (!mfaHook.rows.length || !mfaStoragePolicy.rows.length))) {
      throw new Error(`Схема неполная. Нет таблиц: [${missing.join(", ")}]. Без RLS: [${withoutRls.join(", ")}]. Нет функций: [${missingWorkflows.join(", ")}]. Нет триггеров: [${missingTriggers.join(", ")}]. Нет MFA-guard: [${missingMfaPolicies.join(", ")}]. MFA hook: ${mfaHook.rows.length > 0}. Storage MFA: ${mfaStoragePolicy.rows.length > 0}. Курсор чата: ${readCursor.rows[0].ready}. Напоминания: ${reminderJobReady}. Realtime сообщений: ${messageRealtimeReady}. Проверьте бакеты.`);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

async function roleSmoke(url) {
  const client = createClient(url);
  let inTransaction = false;
  try {
    await client.connect();
    const owner = await client.query(`
      select sm.user_id, u.email from public.staff_members sm join auth.users u on u.id = sm.user_id
      where sm.is_primary_admin and sm.role = 'admin' and sm.active
    `);
    if (owner.rows.length !== 1) throw new Error("Главный администратор не найден; тест остановлен.");
    const email = `role-smoke-${randomUUID()}@example.test`;
    await client.query("begin");
    inTransaction = true;
    await simulateMfaInTransaction(client, owner.rows[0].user_id);
    const clientCard = await client.query("insert into public.clients (full_name) values ('Проверка границ ролей') returning id");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.rows[0].user_id]);
    await client.query("set local role authenticated");
    const visibleAdmin = await client.query("select role, active from public.staff_members where user_id = auth.uid()");
    if (visibleAdmin.rows[0]?.role !== "admin" || visibleAdmin.rows[0]?.active !== true) {
      throw new Error("Администратор не может прочитать свою роль через RLS, вход в админку будет нарушен.");
    }
    await client.query("savepoint staff_client_boundary");
    let dualRoleDenied = false;
    try {
      await client.query("select public.link_client_account($1, $2)", [clientCard.rows[0].id, owner.rows[0].email]);
    } catch (error) {
      dualRoleDenied = error instanceof Error && error.message.includes("Account is already staff");
      await client.query("rollback to savepoint staff_client_boundary");
    }
    if (!dualRoleDenied) throw new Error("Сотрудника удалось привязать как клиента.");
    const result = await client.query("select public.admin_invite_staff($1, $2, 'lawyer') as status", [email, "Проверка выдачи роли"]);
    const invite = await client.query("select id from public.staff_invites where email = $1 and status = 'pending'", [email]);
    if (result.rows[0]?.status !== "pending" || invite.rows.length !== 1) throw new Error("Приглашение не создано.");
    await client.query("reset role");
    const invitedUserId = randomUUID();
    await client.query("insert into auth.users (id, email) values ($1, $2)", [invitedUserId, email]);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [invitedUserId]);
    await client.query("set local role authenticated");
    const unverified = await client.query("select public.claim_staff_invite() as claimed");
    if (unverified.rows[0]?.claimed !== false) throw new Error("Неподтверждённый email получил роль.");
    await client.query("reset role");
    await client.query("update auth.users set email_confirmed_at = now() where id = $1", [invitedUserId]);
    await client.query("set local role authenticated");
    const verified = await client.query("select public.claim_staff_invite() as claimed");
    const verifiedAccess = await client.query("select public.account_access_status() as status");
    if (verified.rows[0]?.claimed !== false || verifiedAccess.rows[0]?.status !== "pending") {
      throw new Error("Подтверждение email выдало доступ без явной активации.");
    }
    await client.query("reset role");
    const unapprovedMember = await client.query("select user_id from public.staff_members where user_id = $1", [invitedUserId]);
    const unapprovedInvite = await client.query("select status from public.staff_invites where id = $1", [invite.rows[0].id]);
    if (unapprovedMember.rows.length !== 0 || unapprovedInvite.rows[0]?.status !== "pending") {
      throw new Error("Приглашение изменило роль до активации администратором.");
    }
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.rows[0].user_id]);
    await client.query("set local role authenticated");
    await client.query("select public.admin_approve_account($1, 'lawyer', $2)", [invitedUserId, "Проверка выдачи роли"]);
    const approvedInvite = await client.query("select status, accepted_user_id from public.staff_invites where id = $1", [invite.rows[0].id]);
    if (approvedInvite.rows[0]?.status !== "cancelled" || approvedInvite.rows[0]?.accepted_user_id !== null) {
      throw new Error("Явная активация не закрыла ожидающее приглашение.");
    }
    await client.query("reset role");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [invitedUserId]);
    await client.query("set local role authenticated");
    await client.query("select public.update_own_profile('Проверка профиля', '+7 777 123 45 67', 'Алматы')");
    const profileBeforeMfa = await client.query("select user_id from public.profiles where user_id = auth.uid()");
    if (profileBeforeMfa.rows.length !== 1) throw new Error("Новый сотрудник не увидел свой профиль при необязательном MFA.");
    await client.query("reset role");
    const editedProfile = await client.query("select display_name, phone, city from public.profiles where user_id = $1", [invitedUserId]);
    if (editedProfile.rows[0]?.display_name !== "Проверка профиля" || editedProfile.rows[0]?.city !== "Алматы") {
      throw new Error("Обновление собственного профиля не работает.");
    }
    const granted = await client.query("select role, active from public.staff_members where user_id = $1", [invitedUserId]);
    if (granted.rows[0]?.role !== "lawyer" || granted.rows[0]?.active !== true) throw new Error("Роль не появилась у сотрудника.");
    const existingEmail = `role-existing-${randomUUID()}@example.test`;
    const existingUserId = randomUUID();
    await client.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [existingUserId, existingEmail]);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.rows[0].user_id]);
    await client.query("set local role authenticated");
    const existingInvitation = await client.query("select public.admin_invite_staff($1, $2, 'manager') as status", [existingEmail, "Проверка существующего аккаунта"]);
    const existingPending = await client.query("select status from public.staff_invites where email = $1", [existingEmail]);
    const existingUnapproved = await client.query("select user_id from public.staff_members where user_id = $1", [existingUserId]);
    if (existingInvitation.rows[0]?.status !== "pending" || existingPending.rows[0]?.status !== "pending"
      || existingUnapproved.rows.length !== 0) {
      throw new Error("Приглашение подтверждённого аккаунта выдало роль без явной активации.");
    }
    await client.query("select public.admin_approve_account($1, 'manager', $2)", [existingUserId, "Проверка существующего аккаунта"]);
    await client.query("reset role");
    const existingGranted = await client.query("select role, active from public.staff_members where user_id = $1", [existingUserId]);
    const existingApprovedInvite = await client.query("select status, accepted_user_id from public.staff_invites where email = $1", [existingEmail]);
    if (existingGranted.rows[0]?.role !== "manager" || existingGranted.rows[0]?.active !== true
      || existingApprovedInvite.rows[0]?.status !== "cancelled" || existingApprovedInvite.rows[0]?.accepted_user_id !== null) {
      throw new Error("Выдача роли существующему аккаунту не завершилась корректно.");
    }
    // This transaction simulates the manager after a successful TOTP challenge.
    // The real Auth enrollment/challenge path is covered by test-staff-mfa-live.mjs.
    await client.query(`insert into auth.mfa_factors
      (id, user_id, factor_type, status, created_at, updated_at, secret)
      values (gen_random_uuid(), $1, 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP')`, [existingUserId]);
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "authenticated", aal: "aal2" })]);
    const syntheticClient = await client.query("insert into public.clients (full_name) values ('Проверка назначения') returning id");
    const syntheticClientUserId = randomUUID();
    await client.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())",
      [syntheticClientUserId, `role-client-${randomUUID()}@example.test`]);
    await client.query("update public.clients set user_id = $1, linked_by = $2, linked_at = now() where id = $3",
      [syntheticClientUserId, owner.rows[0].user_id, syntheticClient.rows[0].id]);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.rows[0].user_id]);
    await client.query("set local role authenticated");
    const adminStaffEmail = await client.query("select user_id, email from public.admin_staff_emails(array[$1::uuid, $2::uuid])",
      [existingUserId, syntheticClientUserId]);
    const adminDirectStaffProfile = await client.query("select email from public.profiles where user_id = $1", [existingUserId]);
    const adminClientProfile = await client.query("select email from public.profiles where user_id = $1", [syntheticClientUserId]);
    if (adminStaffEmail.rows.length !== 1 || adminStaffEmail.rows[0].user_id !== existingUserId
      || adminStaffEmail.rows[0].email !== existingEmail || adminDirectStaffProfile.rows.length !== 0
      || adminClientProfile.rows.length !== 0) {
      throw new Error("Список email сотрудников открыт неверному кругу записей.");
    }
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [syntheticClientUserId]);
    const clientStaffProfile = await client.query("select email from public.profiles where user_id = $1", [existingUserId]);
    if (clientStaffProfile.rows.length !== 0) throw new Error("Клиент увидел email сотрудника.");
    await client.query("savepoint client_staff_email");
    let clientStaffEmailDenied = false;
    try { await client.query("select * from public.admin_staff_emails(array[$1::uuid])", [existingUserId]); }
    catch (error) {
      clientStaffEmailDenied = error instanceof Error && error.message.includes("Not authorized");
      await client.query("rollback to savepoint client_staff_email");
    }
    if (!clientStaffEmailDenied) throw new Error("Клиент вызвал список email сотрудников.");
    await client.query("savepoint client_search_boundary");
    let clientSearchDenied = false;
    try { await client.query("select * from public.staff_search_clients('проверка', 1)"); }
    catch (error) {
      clientSearchDenied = error instanceof Error && error.message.includes("Not authorized");
      await client.query("rollback to savepoint client_search_boundary");
    }
    if (!clientSearchDenied) throw new Error("Обычный клиент получил доступ к поиску всей картотеки.");
    await client.query("reset role");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [existingUserId]);
    await client.query("set local role authenticated");
    const matchingClients = await client.query("select id from public.staff_search_clients('проверка назначения', 1)");
    if (matchingClients.rows[0]?.id !== syntheticClient.rows[0].id) throw new Error("Менеджер не нашёл клиента через серверный поиск.");
    const linkUserId = randomUUID();
    const linkEmail = `role-link-${randomUUID()}@example.test`;
    await client.query("reset role");
    await client.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [linkUserId, linkEmail]);
    const linkCard = await client.query("insert into public.clients (full_name, email) values ('Проверка привязки', $1) returning id", [linkEmail]);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [existingUserId]);
    await client.query("set local role authenticated");
    for (const candidateEmail of [existingEmail, linkEmail]) {
      await client.query("savepoint manager_client_link");
      let managerLinkDenied = false;
      try { await client.query("select public.link_client_account($1, $2)", [linkCard.rows[0].id, candidateEmail]); }
      catch (error) {
        managerLinkDenied = error instanceof Error && error.message.includes("Not authorized");
        await client.query("rollback to savepoint manager_client_link");
      }
      if (!managerLinkDenied) throw new Error("Менеджер активировал клиентский аккаунт без прав администратора.");
    }
    await client.query("reset role");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.rows[0].user_id]);
    await client.query("set local role authenticated");
    await client.query("select public.link_client_account($1, $2)", [linkCard.rows[0].id, linkEmail]);
    const linkedAccount = await client.query("select user_id from public.clients where id = $1", [linkCard.rows[0].id]);
    if (linkedAccount.rows[0]?.user_id !== linkUserId) throw new Error("Корректная привязка аккаунта не работает.");
    await client.query("reset role");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.rows[0].user_id]);
    await client.query("set local role authenticated");
    const syntheticService = await client.query("select public.admin_create_service_with_documents('Проверка ролей', array['Проверка'], '[]'::jsonb) as id");
    const syntheticVersion = await client.query("select id from public.service_template_versions where service_id = $1 and version_no = 1", [syntheticService.rows[0].id]);
    const newerVersion = await client.query("select public.admin_publish_service_version($1, $2, array['Проверка', 'Новая стадия'], $3::jsonb) as id",
      [syntheticService.rows[0].id, syntheticVersion.rows[0].id, JSON.stringify([{ title: "Документ новой версии", instructions: "Проверьте актуальность", required: true }])]);
    const availableVersions = await client.query("select version_id from public.available_service_versions() where version_id = $1", [newerVersion.rows[0].id]);
    if (availableVersions.rows.length !== 1) throw new Error("Актуальная версия услуги не доступна для нового дела.");
    await client.query("savepoint stale_service_version");
    let stalePublishDenied = false;
    try {
      await client.query("select public.admin_publish_service_version($1, $2, array['Устаревший экран'], '[]'::jsonb)",
        [syntheticService.rows[0].id, syntheticVersion.rows[0].id]);
    } catch (error) {
      stalePublishDenied = error instanceof Error && error.message.includes("Service version changed by another user");
      await client.query("rollback to savepoint stale_service_version");
    }
    if (!stalePublishDenied) throw new Error("Старая вкладка смогла опубликовать устаревший шаблон.");
    await client.query("savepoint stale_case_version");
    let staleCaseDenied = false;
    try {
      await client.query("select public.staff_create_case($1, $2, 'Устаревшая версия')", [syntheticClient.rows[0].id, syntheticVersion.rows[0].id]);
    } catch (error) {
      staleCaseDenied = error instanceof Error && error.message.includes("Service version is outdated");
      await client.query("rollback to savepoint stale_case_version");
    }
    if (!staleCaseDenied) throw new Error("Новое дело удалось открыть на устаревшей версии.");
    await client.query("reset role");
    const publishedDocument = await client.query("select title from public.document_templates where version_id = $1", [newerVersion.rows[0].id]);
    if (publishedDocument.rows[0]?.title !== "Документ новой версии") throw new Error("Новая версия услуги не получила документ.");
    const syntheticStage = await client.query("select id from public.stage_templates where version_id = $1 and position = 1", [syntheticVersion.rows[0].id]);
    const syntheticCase = await client.query("insert into public.cases (case_number, client_id, service_version_id, title, current_stage_id) values ($1, $2, $3, 'Проверка назначения', $4) returning id",
      [`ROLE-${randomUUID()}`, syntheticClient.rows[0].id, syntheticVersion.rows[0].id, syntheticStage.rows[0].id]);
    await client.query("insert into public.case_stage_events (case_id, to_stage_id, actor_user_id, client_note, change_reason) values ($1, $2, $3, 'Обновление для клиента', 'Внутреннее основание')", [syntheticCase.rows[0].id, syntheticStage.rows[0].id, owner.rows[0].user_id]);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [syntheticClientUserId]);
    await client.query("set local role authenticated");
    const clientStage = await client.query("select client_note from public.case_stage_events where case_id = $1", [syntheticCase.rows[0].id]);
    if (clientStage.rows[0]?.client_note !== "Обновление для клиента") throw new Error("Клиент не видит своё обновление этапа.");
    await client.query("savepoint client_internal_stage_reason");
    let internalStageDenied = false;
    try { await client.query("select change_reason from public.case_stage_events where case_id = $1", [syntheticCase.rows[0].id]); }
    catch (error) {
      internalStageDenied = error instanceof Error && error.message.includes("permission denied");
      await client.query("rollback to savepoint client_internal_stage_reason");
    }
    if (!internalStageDenied) throw new Error("Клиент смог получить внутреннее основание этапа.");
    await client.query("reset role");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.rows[0].user_id]);
    await client.query("set local role authenticated");
    const staffStage = await client.query("select change_reason from public.staff_case_stage_events($1)", [syntheticCase.rows[0].id]);
    if (staffStage.rows[0]?.change_reason !== "Внутреннее основание") throw new Error("Сотрудник не получил внутреннее основание этапа.");
    await client.query("select public.staff_assign_case($1, $2)", [syntheticCase.rows[0].id, existingUserId]);
    await client.query("select public.admin_set_staff_access($1, 'lawyer', true, 'Проверка смены роли')", [existingUserId]);
    const afterRoleSwitch = await client.query("select count(*)::integer as count from public.case_assignments where staff_user_id = $1 and revoked_at is null", [existingUserId]);
    if (afterRoleSwitch.rows[0].count !== 0) throw new Error("Смена роли оставила активное назначение.");
    await client.query("select public.admin_set_staff_access($1, 'manager', true, 'Возврат роли')", [existingUserId]);
    await client.query("select public.staff_assign_case($1, $2)", [syntheticCase.rows[0].id, existingUserId]);
    await client.query("select public.staff_suspend_case($1, 'Ожидаем проверку', now() + interval '1 day')", [syntheticCase.rows[0].id]);
    const suspension = await client.query("select is_suspended, next_review_at from public.cases where id = $1", [syntheticCase.rows[0].id]);
    if (!suspension.rows[0]?.is_suspended || !suspension.rows[0]?.next_review_at) throw new Error("Приостановка дела не сохранилась.");
    await client.query("select public.staff_resume_case($1)", [syntheticCase.rows[0].id]);
    const ackTask = await client.query("select public.staff_create_task($1, 'acknowledge', 'Проверка ознакомления', 'Сохранить текст и версию', null) as id",
      [syntheticCase.rows[0].id]);
    const ackText = "Проверка ознакомления\nСохранить текст и версию";
    const ackVersion = createHash("sha256").update(ackText, "utf8").digest("hex");
    await client.query("reset role");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [syntheticClientUserId]);
    await client.query("set local role authenticated");
    await client.query("select public.client_acknowledge_task($1, $2)", [ackTask.rows[0].id, ackVersion]);
    await client.query("select public.client_acknowledge_task($1, $2)", [ackTask.rows[0].id, ackVersion]);
    const ackEvents = await client.query("select acknowledged_text, acknowledged_version from public.task_events where task_id = $1 and action = 'acknowledged'",
      [ackTask.rows[0].id]);
    if (ackEvents.rows.length !== 1 || ackEvents.rows[0].acknowledged_text !== ackText
      || ackEvents.rows[0].acknowledged_version !== ackVersion) {
      throw new Error("Ознакомление не сохранило текст, версию или допустило дубль.");
    }
    await client.query("reset role");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.rows[0].user_id]);
    await client.query("set local role authenticated");
    const ackResponse = await client.query("select response_event_id from public.tasks where id=$1", [ackTask.rows[0].id]);
    await client.query("savepoint null_task_review");
    let nullReviewDenied = false;
    try { await client.query("select public.staff_review_task($1, $2, null, null)", [ackTask.rows[0].id, ackResponse.rows[0].response_event_id]); }
    catch (error) {
      nullReviewDenied = error instanceof Error && error.message.includes("Task review decision is required");
      await client.query("rollback to savepoint null_task_review");
    }
    if (!nullReviewDenied) throw new Error("NULL-решение по задаче не отклонено.");
    await client.query("select public.staff_review_task($1, $2, true, null)", [ackTask.rows[0].id, ackResponse.rows[0].response_event_id]);
    const dueTask = await client.query("select public.staff_create_task($1, 'answer', 'Проверка напоминаний', null, '2100-01-02T05:00:00Z') as id", [syntheticCase.rows[0].id]);
    await client.query("reset role");
    await client.query("select private.enqueue_task_deadline_reminders('2100-01-01')");
    await client.query("select private.enqueue_task_deadline_reminders('2100-01-01')");
    await client.query("select private.enqueue_task_deadline_reminders('2100-01-02')");
    const dueNotices = await client.query("select title from public.notifications where recipient_user_id = $1 and dedupe_key like $2",
      [syntheticClientUserId, `task-deadline:${dueTask.rows[0].id}:%`]);
    if (dueNotices.rows.length !== 2 || !dueNotices.rows.some((row) => row.title === "Срок задачи сегодня")
      || !dueNotices.rows.some((row) => row.title === "Срок задачи завтра")) {
      throw new Error("Напоминания не доставлены клиенту за день и в день срока или задублированы.");
    }
    await client.query("set local role authenticated");
    const pendingTask = await client.query("select public.staff_create_task($1, 'answer', 'Проверка закрытия', null, null) as id", [syntheticCase.rows[0].id]);
    await client.query("select public.staff_close_case($1, 'Проверка завершена')", [syntheticCase.rows[0].id]);
    const closedCase = await client.query("select status, is_suspended, result_summary from public.cases where id = $1", [syntheticCase.rows[0].id]);
    const cancelledTask = await client.query("select status from public.tasks where id = $1", [pendingTask.rows[0].id]);
    if (closedCase.rows[0]?.status !== "closed" || closedCase.rows[0]?.is_suspended
      || closedCase.rows[0]?.result_summary !== "Проверка завершена"
      || cancelledTask.rows[0]?.status !== "cancelled") throw new Error("Завершение дела не отменило ожидающую задачу.");
    await client.query("select public.admin_set_staff_access($1, 'manager', false, 'Проверка отключения')", [existingUserId]);
    await client.query("reset role");
    const afterDisable = await client.query("select count(*)::integer as count from public.case_assignments where staff_user_id = $1 and revoked_at is null", [existingUserId]);
    if (afterDisable.rows[0]?.count !== 0) throw new Error("Отключение оставило активное назначение.");
    await client.query("set local role authenticated");
    await client.query("select public.admin_set_staff_access($1, 'manager', true, 'Проверка повторного включения')", [existingUserId]);
    await client.query("reset role");
    const afterEnable = await client.query("select count(*)::integer as count from public.case_assignments where staff_user_id = $1 and revoked_at is null", [existingUserId]);
    if (afterEnable.rows[0]?.count !== 0) throw new Error("Повторное включение вернуло старое назначение.");
    const cancelEmail = `role-cancel-${randomUUID()}@example.test`;
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.rows[0].user_id]);
    await client.query("set local role authenticated");
    const cancelInvite = await client.query("select public.admin_invite_staff($1, $2, 'manager') as status", [cancelEmail, "Проверка отмены"]);
    if (cancelInvite.rows[0]?.status !== "pending") throw new Error("Приглашение для отмены не создано.");
    const cancelId = await client.query("select id from public.staff_invites where email = $1 and status = 'pending'", [cancelEmail]);
    await client.query("select public.admin_cancel_staff_invite($1)", [cancelId.rows[0].id]);
    const cancelled = await client.query("select status from public.staff_invites where id = $1", [cancelId.rows[0].id]);
    if (cancelled.rows[0]?.status !== "cancelled") throw new Error("Отмена приглашения не работает.");
    console.log("Удалённая проверка: роли, приглашение, назначения и переходы статуса дела работают. Транзакция будет отменена.");
  } finally {
    if (inTransaction) await client.query("rollback").catch(() => {});
    await client.end().catch(() => {});
  }
}

async function documentSmoke(url) {
  const client = createClient(url);
  let inTransaction = false;
  try {
    await client.connect();
    const owner = await client.query("select user_id from public.staff_members where is_primary_admin and role = 'admin' and active");
    if (!owner.rows[0]) throw new Error("Главный администратор не найден; тест остановлен.");
    await client.query("begin");
    inTransaction = true;
    await simulateMfaInTransaction(client, owner.rows[0].user_id);
    const clientId = randomUUID();
    const otherId = randomUUID();
    const clientCardId = randomUUID();
    const serviceId = randomUUID();
    const versionId = randomUUID();
    const stageId = randomUUID();
    const caseId = randomUUID();
    const requestId = randomUUID();
    const unique = randomUUID();
    await client.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()), ($3, $4, now())",
      [clientId, `doc-smoke-${unique}@example.test`, otherId, `doc-other-${unique}@example.test`]);
    await client.query("insert into public.clients (id, user_id, full_name, linked_by, linked_at) values ($1, $2, 'Проверка документов', $3, now())", [clientCardId, clientId, owner.rows[0].user_id]);
    await client.query("insert into public.service_templates (id, code, name) values ($1, $2, 'Проверка')", [serviceId, `smoke-${unique}`]);
    await client.query("insert into public.service_template_versions (id, service_id, version_no) values ($1, $2, 1)", [versionId, serviceId]);
    await client.query("insert into public.stage_templates (id, version_id, position, title) values ($1, $2, 1, 'Начало')", [stageId, versionId]);
    await client.query("insert into public.cases (id, case_number, client_id, service_version_id, title, current_stage_id) values ($1, $2, $3, $4, 'Проверка', $5)",
      [caseId, `SMOKE-${unique}`, clientCardId, versionId, stageId]);
    await client.query("insert into public.document_requests (id, case_id, title) values ($1, $2, 'Паспорт')", [requestId, caseId]);
    const messageFileId = randomUUID();
    const messagePath = `messages/${caseId}/${clientId}/${randomUUID()}/${messageFileId}`;
    await client.query("insert into storage.objects (bucket_id, name, metadata) values ('modernsecure-files', $1, $2::jsonb)",
      [messagePath, JSON.stringify({ size: 8, mimetype: "application/pdf" })]);
    const files = JSON.stringify([{ name: "test.pdf", mime: "application/pdf", size: 8, sha256: "a".repeat(64) }]);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [clientId]);
    await client.query("set local role authenticated");
    const attachmentKey = randomUUID();
    const attachmentMetadata = JSON.stringify([{ id: messageFileId, path: messagePath,
      name: "test.pdf", mime: "application/pdf", size: 8, sha256: "a".repeat(64) }]);
    const attachmentMessage = await client.query("select public.post_case_message_with_attachments($1, 'Файл по делу', $2, $3::jsonb) as result",
      [caseId, attachmentKey, attachmentMetadata]);
    const attachmentRetry = await client.query("select public.post_case_message_with_attachments($1, 'Файл по делу', $2, $3::jsonb) as result",
      [caseId, attachmentKey, attachmentMetadata]);
    const visibleAttachment = await client.query("select id from public.message_attachments where id = $1", [messageFileId]);
    if (!attachmentMessage.rows[0]?.result?.created || attachmentRetry.rows[0]?.result?.created
      || attachmentRetry.rows[0]?.result?.id !== attachmentMessage.rows[0]?.result?.id
      || visibleAttachment.rows.length !== 1) throw new Error("Вложение сообщения не зарегистрировано или повтор создал дубль.");
    await client.query("reset role");
    const handoffNotice = await client.query("select recipient_user_id from public.notifications where dedupe_key = $1",
      [`message:${attachmentMessage.rows[0].result.id}`]);
    const expectedAdmins = await client.query("select user_id from public.staff_members where role = 'admin' and active order by user_id");
    if (handoffNotice.rows.map(row => row.recipient_user_id).sort().join(",") !== expectedAdmins.rows.map(row => row.user_id).join(",")) {
      throw new Error("Сообщение без назначенного сотрудника не дошло администратору.");
    }
    await client.query("set local role authenticated");
    const first = await client.query("select public.begin_document_upload($1, $2, $3::jsonb) as batch", [requestId, "live-doc-key-123", files]);
    const retry = await client.query("select public.begin_document_upload($1, $2, $3::jsonb) as batch", [requestId, "live-doc-key-123", files]);
    if (first.rows[0]?.batch?.status !== "pending" || first.rows[0].batch.session_id !== retry.rows[0]?.batch?.session_id) {
      throw new Error("Загрузка не создаётся или повтор не идемпотентен.");
    }
    const pendingFileId = first.rows[0].batch.files[0].id;
    const uploaderDraft = await client.query("select id from public.document_files where id = $1", [pendingFileId]);
    if (uploaderDraft.rows.length !== 1) throw new Error("Автор загрузки не видит свой черновик документа.");
    await client.query("reset role");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.rows[0].user_id]);
    await client.query("set local role authenticated");
    const staffDraft = await client.query("select id from public.document_files where id = $1", [pendingFileId]);
    if (staffDraft.rows.length !== 0) throw new Error("Сотрудник увидел метаданные ещё не отправленного файла.");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [clientId]);
    const resumed = await client.query("select public.resume_or_begin_document_upload($1, $2, $3::jsonb) as batch", [requestId, "new-browser-form-key-456", files]);
    if (resumed.rows[0]?.batch?.session_id !== first.rows[0].batch.session_id) {
      throw new Error("Перезапуск формы не продолжил незавершённую загрузку.");
    }
    const authorized = await client.query("select public.authorize_document_file_upload($1, $2) as file",
      [first.rows[0].batch.session_id, first.rows[0].batch.files[0].id]);
    if (authorized.rows[0]?.file?.path !== first.rows[0].batch.files[0].path
      || authorized.rows[0]?.file?.sha256 !== "a".repeat(64)) {
      throw new Error("Отдельный файл не авторизован в своей сессии.");
    }
    await client.query("savepoint missing_object");
    let missingObjectDenied = false;
    try { await client.query("select public.complete_document_upload($1)", [first.rows[0].batch.session_id]); }
    catch { missingObjectDenied = true; await client.query("rollback to savepoint missing_object"); }
    if (!missingObjectDenied) throw new Error("Сессия завершилась без загруженного объекта.");
    await client.query("savepoint client_server_verify");
    let clientVerifyDenied = false;
    try {
      await client.query("select public.server_verify_document_file($1, $2, $3)",
        [first.rows[0].batch.session_id, first.rows[0].batch.files[0].id, "a".repeat(64)]);
    } catch (error) {
      clientVerifyDenied = error instanceof Error && error.message.includes("permission denied");
      await client.query("rollback to savepoint client_server_verify");
    }
    if (!clientVerifyDenied) throw new Error("Клиент смог вызвать доверенную серверную проверку файла.");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [otherId]);
    const foreignAttachment = await client.query("select id from public.message_attachments where id = $1", [messageFileId]);
    if (foreignAttachment.rows.length) throw new Error("Чужой аккаунт увидел вложение переписки.");
    await client.query("savepoint foreign_file");
    let foreignFileDenied = false;
    try { await client.query("select public.authorize_document_file_upload($1, $2)", [first.rows[0].batch.session_id, first.rows[0].batch.files[0].id]); }
    catch { foreignFileDenied = true; await client.query("rollback to savepoint foreign_file"); }
    if (!foreignFileDenied) throw new Error("Чужой аккаунт получил путь файла в загрузке.");
    await client.query("savepoint foreign_client");
    let foreignDenied = false;
    try { await client.query("select public.begin_document_upload($1, $2, $3::jsonb)", [requestId, "foreign-doc-key-123", files]); }
    catch { foreignDenied = true; await client.query("rollback to savepoint foreign_client"); }
    if (!foreignDenied) throw new Error("Чужой аккаунт начал загрузку документа.");
    await client.query("reset role");
    await client.query("insert into storage.objects (bucket_id, name, metadata) values ('modernsecure-files', $1, $2::jsonb)",
      [first.rows[0].batch.files[0].path, JSON.stringify({ size: 8, mimetype: "application/pdf" })]);
    await client.query("select public.server_verify_document_file($1, $2, $3)",
      [first.rows[0].batch.session_id, first.rows[0].batch.files[0].id, "a".repeat(64)]);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [clientId]);
    await client.query("set local role authenticated");
    await client.query("select public.complete_document_upload($1)", [first.rows[0].batch.session_id]);
    await client.query("savepoint unreviewed_resubmit");
    let unreviewedDenied = false;
    try { await client.query("select public.begin_document_upload($1, $2, $3::jsonb)",
      [requestId, "unreviewed-new-key-789", files]); }
    catch (error) {
      unreviewedDenied = error.message.includes("Current document version must be reviewed or retracted first");
      await client.query("rollback to savepoint unreviewed_resubmit");
    }
    if (!unreviewedDenied) throw new Error("Повторная отправка непроверенного документа должна быть запрещена.");
    await client.query("select public.retract_document_file($1)", [first.rows[0].batch.files[0].id]);
    const second = await client.query("select public.begin_document_upload($1, $2, $3::jsonb) as batch",
      [requestId, "intentional-new-key-789", files]);
    const exactRetry = await client.query("select public.resume_or_begin_document_upload($1, $2, $3::jsonb) as batch",
      [requestId, "live-doc-key-123", files]);
    if (second.rows[0]?.batch?.session_id === first.rows[0].batch.session_id
      || exactRetry.rows[0]?.batch?.session_id !== first.rows[0].batch.session_id
      || exactRetry.rows[0]?.batch?.status !== "completed") {
      throw new Error("Повтор завершённой отправки создал вторую сессию при ожидающем наборе.");
    }
    await client.query("reset role");
    await client.query("update public.cases set is_suspended = true, next_review_at = now() + interval '1 day' where id = $1", [caseId]);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [clientId]);
    await client.query("set local role authenticated");
    const closedRetry = await client.query("select public.resume_or_begin_document_upload($1, $2, $3::jsonb) as batch",
      [requestId, "live-doc-key-123", files]);
    if (closedRetry.rows[0]?.batch?.session_id !== first.rows[0].batch.session_id
      || closedRetry.rows[0]?.batch?.status !== "completed") {
      throw new Error("Повтор завершённой отправки после приостановки дела не восстановился.");
    }
    await client.query("savepoint closed_pending");
    let closedPendingDenied = false;
    try { await client.query("select public.resume_or_begin_document_upload($1, $2, $3::jsonb)",
      [requestId, "intentional-new-key-789", files]); }
    catch { closedPendingDenied = true; await client.query("rollback to savepoint closed_pending"); }
    if (!closedPendingDenied) throw new Error("Незавершённая загрузка продолжилась после приостановки дела.");
    console.log("Удалённая проверка: документы, вложение переписки, уведомление администратора, изоляция дела и повторы работают. Транзакция будет отменена.");
  } finally {
    if (inTransaction) await client.query("rollback").catch(() => {});
    await client.end().catch(() => {});
  }
}

async function financeSmoke(url) {
  const client = createClient(url);
  let inTransaction = false;
  try {
    await client.connect();
    const owner = await client.query("select user_id, can_confirm_payments from public.staff_members where is_primary_admin and role = 'admin' and active");
    if (!owner.rows[0]) throw new Error("Главный администратор не найден; тест остановлен.");
    await client.query("begin");
    inTransaction = true;
    await simulateMfaInTransaction(client, owner.rows[0].user_id);
    const ids = Array.from({ length: 7 }, () => randomUUID());
    const [clientUserId, clientCardId, serviceId, versionId, stageId, caseId, paymentKey] = ids;
    const unique = randomUUID();
    await client.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())",
      [clientUserId, `finance-smoke-${unique}@example.test`]);
    await client.query("insert into public.clients (id, user_id, full_name, linked_by, linked_at) values ($1, $2, 'Проверка оплат', $3, now())",
      [clientCardId, clientUserId, owner.rows[0].user_id]);
    await client.query("insert into public.service_templates (id, code, name) values ($1, $2, 'Проверка оплат')", [serviceId, `finance-${unique}`]);
    await client.query("insert into public.service_template_versions (id, service_id, version_no) values ($1, $2, 1)", [versionId, serviceId]);
    await client.query("insert into public.stage_templates (id, version_id, position, title) values ($1, $2, 1, 'Начало')", [stageId, versionId]);
    await client.query("insert into public.cases (id, case_number, client_id, service_version_id, title, current_stage_id) values ($1, $2, $3, $4, 'Проверка оплат', $5)",
      [caseId, `FIN-${unique}`, clientCardId, versionId, stageId]);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.rows[0].user_id]);
    await client.query("set local role authenticated");
    if (!owner.rows[0].can_confirm_payments) {
      await client.query("select public.admin_set_payment_permission($1, true, 'Транзакционная проверка')", [owner.rows[0].user_id]);
    }
    const contractPath = `contracts/${caseId}/${randomUUID()}.pdf`;
    await client.query("reset role");
    await client.query("insert into storage.objects (bucket_id, name, metadata, user_metadata) values ('modernsecure-files', $1, $2::jsonb, $3::jsonb)",
      [contractPath, JSON.stringify({ size: 8, mimetype: "application/pdf" }), JSON.stringify({ sha256: "a".repeat(64) })]);
    await client.query("set local role authenticated");
    await client.query("savepoint wrong_contract_hash");
    let wrongContractHashDenied = false;
    try { await client.query("select public.staff_register_contract($1, 'FIN-C-1', (now() at time zone 'Asia/Almaty')::date, 10000, $2, $3, 8)",
      [caseId, contractPath, "b".repeat(64)]); }
    catch (error) {
      wrongContractHashDenied = error instanceof Error && error.message.includes("metadata mismatch");
      await client.query("rollback to savepoint wrong_contract_hash");
    }
    if (!wrongContractHashDenied) throw new Error("Договор с неверным хешем принят.");
    await client.query("select public.staff_register_contract($1, 'FIN-C-1', (now() at time zone 'Asia/Almaty')::date, 10000, $2, $3, 8)",
      [caseId, contractPath, "a".repeat(64)]);
    const schedule = await client.query("select public.staff_add_payment_installment($1, current_date, 10000, 'Тестовый график') as id", [caseId]);
    const scheduleId = schedule.rows[0]?.id;
    const paymentArgs = [scheduleId, 4000, "BANK-SMOKE-1", paymentKey];
    const confirmSql = "select public.staff_confirm_payment($1, $2, (now() at time zone 'Asia/Almaty')::date, $3, null, $4) as id";
    const first = await client.query(confirmSql, paymentArgs);
    const retry = await client.query(confirmSql, paymentArgs);
    if (!first.rows[0]?.id || first.rows[0].id !== retry.rows[0]?.id) throw new Error("Повтор оплаты создал дубль.");
    await client.query("savepoint duplicate_bank_reference");
    let duplicateReferenceDenied = false;
    try { await client.query(confirmSql, [scheduleId, 1000, " bank-smoke-1 ", randomUUID()]); }
    catch { duplicateReferenceDenied = true; await client.query("rollback to savepoint duplicate_bank_reference"); }
    if (!duplicateReferenceDenied) throw new Error("Один банковский номер учтён дважды.");
    await client.query("reset role");
    const receiptKey = randomUUID();
    const receiptPath = `receipts/${caseId}/${clientUserId}/${receiptKey}.pdf`;
    await client.query("insert into storage.objects (bucket_id, name, metadata, user_metadata) values ('modernsecure-files', $1, $2::jsonb, $3::jsonb)",
      [receiptPath, JSON.stringify({ size: 8, mimetype: "application/pdf" }), JSON.stringify({ sha256: "b".repeat(64) })]);
    await client.query("set local role authenticated");
    const contract = await client.query("select public.staff_register_contract($1, 'FIN-C-1', (now() at time zone 'Asia/Almaty')::date, 10000, $2, $3, 8) as id",
      [caseId, contractPath, "a".repeat(64)]);
    if (!contract.rows[0]?.id) throw new Error("Договор не зарегистрирован.");
    await client.query("reset role");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [clientUserId]);
    await client.query("set local role authenticated");
    await client.query("savepoint wrong_receipt_hash");
    let wrongReceiptHashDenied = false;
    try { await client.query("select public.client_register_payment_receipt($1, $2, 'check.pdf', 'application/pdf', 8, $3, $4)",
      [caseId, receiptPath, "a".repeat(64), receiptKey]); }
    catch (error) {
      wrongReceiptHashDenied = error instanceof Error && error.message.includes("metadata mismatch");
      await client.query("rollback to savepoint wrong_receipt_hash");
    }
    if (!wrongReceiptHashDenied) throw new Error("Чек с неверным хешем принят.");
    const receipt = await client.query("select public.client_register_payment_receipt($1, $2, 'check.pdf', 'application/pdf', 8, $3, $4) as id",
      [caseId, receiptPath, "b".repeat(64), receiptKey]);
    if (!receipt.rows[0]?.id) throw new Error("Чек клиента не зарегистрирован.");
    const visibleContract = await client.query("select id from public.contracts where id = $1", [contract.rows[0].id]);
    if (visibleContract.rows.length !== 1) throw new Error("Клиент не видит договор своего дела.");
    const contractNotice = await client.query("select title from public.notifications where dedupe_key = $1",
      [`contract:${contract.rows[0].id}`]);
    if (contractNotice.rows[0]?.title !== "Добавлен договор") throw new Error("Клиент не получил уведомление о договоре.");
    await client.query("reset role");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.rows[0].user_id]);
    await client.query("set local role authenticated");
    const receiptNotice = await client.query("select title from public.notifications where dedupe_key = $1",
      [`receipt-submitted:${receipt.rows[0].id}`]);
    if (receiptNotice.rows[0]?.title !== "Новый чек клиента") throw new Error("Администратор не получил уведомление о чеке.");
    await client.query("select public.staff_review_payment_receipt($1, true, 'Проверка чека')", [receipt.rows[0].id]);
    const linked = await client.query(`select public.staff_confirm_payment_with_receipt($1, 1000,
      (now() at time zone 'Asia/Almaty')::date, 'BANK-SMOKE-2', null, $2, $3) as id`,
    [scheduleId, randomUUID(), receipt.rows[0].id]);
    const linkedRecord = await client.query("select receipt_id from public.payments where id = $1", [linked.rows[0].id]);
    if (linkedRecord.rows[0]?.receipt_id !== receipt.rows[0].id) throw new Error("Проверенный чек не связан с оплатой.");
    await client.query("reset role");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [clientUserId]);
    await client.query("set local role authenticated");
    const reviewNotice = await client.query("select title from public.notifications where dedupe_key = $1",
      [`receipt-reviewed:${receipt.rows[0].id}`]);
    if (reviewNotice.rows[0]?.title !== "Чек проверен") throw new Error("Клиент не получил результат проверки чека.");
    const clientPayments = await client.query("select amount_kzt from public.payments where case_id = $1 and status = 'confirmed'", [caseId]);
    if (clientPayments.rows.length !== 2 || clientPayments.rows.reduce((sum, row) => sum + Number(row.amount_kzt), 0) !== 5000) {
      throw new Error("Клиент не видит подтверждённую оплату своего дела.");
    }
    let firstMessageId;
    for (let number = 1; number <= 20; number += 1) {
      const sent = await client.query("select public.post_case_message($1, $2, $3) as id",
        [caseId, `Проверка лимита ${number}`, `smoke-message-${number}`]);
      if (number === 1) firstMessageId = sent.rows[0]?.id;
    }
    await client.query("savepoint message_limit");
    let messageFloodDenied = false;
    try { await client.query("select public.post_case_message($1, 'Лишнее сообщение', 'smoke-message-21')", [caseId]); }
    catch { messageFloodDenied = true; await client.query("rollback to savepoint message_limit"); }
    if (!messageFloodDenied) throw new Error("Лимит сообщений не сработал.");
    const messageRetry = await client.query("select public.post_case_message($1, 'Проверка лимита 1', 'smoke-message-1') as id", [caseId]);
    if (!firstMessageId || messageRetry.rows[0]?.id !== firstMessageId) throw new Error("Повтор сообщения заблокирован лимитом.");
    await client.query("savepoint client_finance_denied");
    let clientDenied = false;
    try { await client.query("select public.staff_add_payment_installment($1, current_date, 100, null)", [caseId]); }
    catch { clientDenied = true; await client.query("rollback to savepoint client_finance_denied"); }
    if (!clientDenied) throw new Error("Клиент смог изменить финансовый график.");
    await client.query("reset role");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.rows[0].user_id]);
    await client.query("set local role authenticated");
    await client.query("select public.staff_void_payment($1, 'Проверка исправления')", [first.rows[0].id]);
    const voided = await client.query("select status from public.payments where id = $1", [first.rows[0].id]);
    if (voided.rows[0]?.status !== 'void') throw new Error("Исправление оплаты не сохранилось.");
    console.log("Удалённая проверка: договор, чек, связанная оплата, клиентский доступ, исправление и лимит сообщений работают. Транзакция будет отменена.");
  } finally {
    if (inTransaction) await client.query("rollback").catch(() => {});
    await client.end().catch(() => {});
  }
}

async function inspectRoles(url) {
  const client = createClient(url);
  try {
    await client.connect();
    const target = await client.query(`
      select u.id, u.email, u.email_confirmed_at is not null as email_verified,
        sm.role, sm.active, sm.is_primary_admin, sm.display_name
      from auth.users u left join public.staff_members sm on sm.user_id = u.id
      where sm.is_primary_admin
    `);
    const admins = await client.query(`
      select u.email, sm.active, sm.is_primary_admin from public.staff_members sm
      join auth.users u on u.id = sm.user_id where sm.role = 'admin'
    `);
    const counts = await client.query(`
      select role::text, active, count(*)::integer as count
      from public.staff_members group by role, active order by role, active
    `);
    console.log(JSON.stringify({ target: target.rows, admins: admins.rows, staff: counts.rows }, null, 2));
  } finally {
    await client.end().catch(() => {});
  }
}

async function inspectCron(url) {
  const client = createClient(url);
  try {
    await client.connect();
    const result = await client.query(`
      select j.jobname, j.active, j.schedule, d.status, d.start_time, d.end_time
      from cron.job j
      left join lateral (
        select status, start_time, end_time
        from cron.job_run_details
        where jobid = j.jobid
        order by start_time desc
        limit 1
      ) d on true
      where j.jobname = any($1)
    `, [["modernsecure-task-deadlines", "modernsecure-payment-deadlines"]]);
    if (result.rows.length !== 2) throw new Error("Задания напоминаний не найдены.");
    for (const row of result.rows) {
    console.log(JSON.stringify({
      job: row.jobname,
      active: row.active,
      schedule: row.schedule,
      last_run: row.start_time,
      last_end: row.end_time,
      status: row.status ?? "not_run_yet",
    }, null, 2));
    if (!row.active || (row.status && row.status !== "succeeded")) {
      throw new Error("Почасовое задание неактивно или последний запуск завершился ошибкой.");
    }
    }
  } finally {
    await client.end().catch(() => {});
  }
}

async function runCli(url, dryRun) {
  const cli = path.join(root, "node_modules", ".bin", "supabase");
  const cliUrl = new URL(url);
  cliUrl.searchParams.set("sslmode", "verify-full");
  cliUrl.searchParams.set("sslrootcert", caPath);
  const args = ["db", "push", "--skip-vault", "--db-url", cliUrl.toString()];
  if (dryRun) args.push("--dry-run");
  else args.push("--yes");
  const result = await new Promise((resolve, reject) => {
    const child = spawn(cli, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
  const secretValues = [cliUrl.toString(), url.toString(), url.password];
  try { secretValues.push(decodeURIComponent(url.password)); } catch { /* Invalid escaping is reported by the DB connection. */ }
  const safeOutput = secretValues.filter(Boolean).reduce((output, secret) => output.replaceAll(secret, "[REDACTED]"), result.output);
  console.log(safeOutput.trim());
  if (result.code !== 0) process.exitCode = result.code || 1;
}

const action = process.argv[2];
if (!["inspect", "plan", "apply", "migrate", "verify", "roles", "role-smoke", "document-smoke", "finance-smoke", "cron-status"].includes(action)) {
  console.error("Использование: npm run db:inspect | db:plan | db:apply | db:migrate | db:verify | db:roles | db:role-smoke | db:document-smoke | db:finance-smoke | db:cron-status");
  process.exit(2);
}

try {
  const url = getDatabaseUrl();
  if (action === "inspect") await inspect(url);
  if (action === "plan") { await inspect(url); await runCli(url, true); }
  if (action === "apply") { await inspect(url); await runCli(url, false); if (!process.exitCode) await verify(url); }
  if (action === "migrate") { await verify(url, true); await runCli(url, true); if (!process.exitCode) await runCli(url, false); if (!process.exitCode) await verify(url); }
  if (action === "verify") await verify(url);
  if (action === "roles") await inspectRoles(url);
  if (action === "cron-status") await inspectCron(url);
  if (action === "role-smoke") await roleSmoke(url);
  if (action === "document-smoke") await documentSmoke(url);
  if (action === "finance-smoke") await financeSmoke(url);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
