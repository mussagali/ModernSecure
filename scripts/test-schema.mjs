import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pg = new PGlite();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function asUser(userId, query) {
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await pg.exec("set role authenticated");
  try { return await pg.query(query); }
  finally { await pg.exec("reset role"); }
}

async function asService(query) {
  await pg.exec("set role service_role");
  try { return await pg.query(query); }
  finally { await pg.exec("reset role"); }
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
    create table storage.buckets (
      id text primary key, name text not null, public boolean not null,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (bucket_id text not null, name text not null, metadata jsonb, user_metadata jsonb,
      primary key (bucket_id, name));
  `);

  for (const file of [
    "20261010000100_core_schema.sql",
    "20261010000200_access_policies.sql",
    "20261010000300_private_storage.sql",
    "20261010000400_client_account_link.sql",
    "20261010000500_staff_workflows.sql",
    "20261011000600_case_workflows.sql",
    "20261011000700_admin_scope.sql",
  ]) {
    await pg.exec(readFileSync(path.join(root, "supabase", "migrations", file), "utf8"));
    console.log(`OK ${file}`);
  }

  const clientA = "00000000-0000-4000-8000-000000000001";
  const clientB = "00000000-0000-4000-8000-000000000002";
  const lawyer = "00000000-0000-4000-8000-000000000003";
  const unlinked = "00000000-0000-4000-8000-000000000004";
  const manager = "00000000-0000-4000-8000-000000000005";
  const admin = "00000000-0000-4000-8000-000000000006";
  const newStaff = "00000000-0000-4000-8000-000000000007";
  const caseA = "10000000-0000-4000-8000-000000000001";
  const caseB = "10000000-0000-4000-8000-000000000002";
  const caseC = "10000000-0000-4000-8000-000000000003";
  const clientRecordA = "20000000-0000-4000-8000-000000000001";
  const clientRecordB = "20000000-0000-4000-8000-000000000002";
  const clientRecordC = "20000000-0000-4000-8000-000000000003";
  const versionId = "30000000-0000-4000-8000-000000000001";
  const serviceId = "40000000-0000-4000-8000-000000000001";
  const stageId = "50000000-0000-4000-8000-000000000001";

  await pg.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'a@example.test', now()), ($2, 'b@example.test', now()), ($3, 'lawyer@example.test', now()), ($4, 'new@example.test', now()), ($5, 'manager@example.test', now()), ($6, 'ayanz2008@gmail.com', now()), ($7, 'newstaff@example.test', now())", [clientA, clientB, lawyer, unlinked, manager, admin, newStaff]);
  const profileCount = await pg.query("select count(*)::integer as count from public.profiles");
  assert(profileCount.rows[0].count === 7, "Регистрация должна создавать ограниченный профиль");

  await pg.query("insert into public.staff_members (user_id, display_name, role) values ($1, 'Lawyer', 'lawyer')", [lawyer]);
  await pg.query("insert into public.staff_members (user_id, display_name, role) values ($1, 'Manager', 'manager')", [manager]);
  await pg.query("insert into public.staff_members (user_id, display_name, role) values ($1, 'Admin', 'admin')", [admin]);
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011000800_role_boundaries.sql"), "utf8"));
  console.log("OK 20261011000800_role_boundaries.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011000900_staff_access_management.sql"), "utf8"));
  console.log("OK 20261011000900_staff_access_management.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011001000_staff_invitations.sql"), "utf8"));
  console.log("OK 20261011001000_staff_invitations.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011001100_exclusive_account_roles.sql"), "utf8"));
  console.log("OK 20261011001100_exclusive_account_roles.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011001200_document_uploads.sql"), "utf8"));
  console.log("OK 20261011001200_document_uploads.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011001300_payment_workflows.sql"), "utf8"));
  console.log("OK 20261011001300_payment_workflows.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011001400_document_access_hardening.sql"), "utf8"));
  console.log("OK 20261011001400_document_access_hardening.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011001500_payment_reference_uniqueness.sql"), "utf8"));
  console.log("OK 20261011001500_payment_reference_uniqueness.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011001600_own_profile.sql"), "utf8"));
  console.log("OK 20261011001600_own_profile.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011001700_message_rate_limit.sql"), "utf8"));
  console.log("OK 20261011001700_message_rate_limit.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011001800_help_settings.sql"), "utf8"));
  console.log("OK 20261011001800_help_settings.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011001900_notification_inbox.sql"), "utf8"));
  console.log("OK 20261011001900_notification_inbox.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011002000_resume_document_upload.sql"), "utf8"));
  console.log("OK 20261011002000_resume_document_upload.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011002100_upload_cleanup_safety.sql"), "utf8"));
  console.log("OK 20261011002100_upload_cleanup_safety.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011002200_assignment_deactivation_race.sql"), "utf8"));
  console.log("OK 20261011002200_assignment_deactivation_race.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011002300_case_lifecycle.sql"), "utf8"));
  console.log("OK 20261011002300_case_lifecycle.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011002400_case_close_consistency.sql"), "utf8"));
  console.log("OK 20261011002400_case_close_consistency.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011002500_service_document_versions.sql"), "utf8"));
  console.log("OK 20261011002500_service_document_versions.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011002600_current_service_version.sql"), "utf8"));
  console.log("OK 20261011002600_current_service_version.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011002700_client_search.sql"), "utf8"));
  console.log("OK 20261011002700_client_search.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011002800_client_search_role_guard.sql"), "utf8"));
  console.log("OK 20261011002800_client_search_role_guard.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011002900_contract_files.sql"), "utf8"));
  console.log("OK 20261011002900_contract_files.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011003000_receipt_workflow.sql"), "utf8"));
  console.log("OK 20261011003000_receipt_workflow.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011003100_payment_receipt_link.sql"), "utf8"));
  console.log("OK 20261011003100_payment_receipt_link.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011003200_financial_file_cleanup_guard.sql"), "utf8"));
  console.log("OK 20261011003200_financial_file_cleanup_guard.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011003300_financial_notifications.sql"), "utf8"));
  console.log("OK 20261011003300_financial_notifications.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011003400_versioned_task_acknowledgment.sql"), "utf8"));
  console.log("OK 20261011003400_versioned_task_acknowledgment.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011003500_task_deadline_reminders.sql"), "utf8"));
  console.log("OK 20261011003500_task_deadline_reminders.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011003600_unread_notifications_index.sql"), "utf8"));
  console.log("OK 20261011003600_unread_notifications_index.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011003700_authorize_split_document_upload.sql"), "utf8"));
  console.log("OK 20261011003700_authorize_split_document_upload.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011003800_revoke_assignments_on_role_change.sql"), "utf8"));
  console.log("OK 20261011003800_revoke_assignments_on_role_change.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011003900_admin_staff_email_read.sql"), "utf8"));
  console.log("OK 20261011003900_admin_staff_email_read.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011004000_document_upload_retry_idempotency.sql"), "utf8"));
  console.log("OK 20261011004000_document_upload_retry_idempotency.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011004100_completed_document_upload_replay.sql"), "utf8"));
  console.log("OK 20261011004100_completed_document_upload_replay.sql");
  await pg.exec(readFileSync(path.join(root, "supabase", "migrations", "20261011004200_document_review_notifications.sql"), "utf8"));
  console.log("OK 20261011004200_document_review_notifications.sql");
  await pg.exec("create publication supabase_realtime");
  for (const migration of [
    "20261011004300_unassigned_case_client_notifications.sql",
    "20261011004400_receipt_notification_finance_scope.sql",
    "20261011004500_payment_schedule_contract_version.sql",
    "20261011004600_message_attachments.sql",
    "20261011004700_admin_unassigned_case_queue.sql",
    "20261011004800_message_realtime.sql",
    "20261011004900_staff_case_worklist.sql",
    "20261011005000_case_message_state.sql",
    "20261011005100_document_draft_privacy.sql",
    "20261011005200_finance_task_integrity.sql",
    "20261011005300_account_link_and_stage_privacy.sql",
  ]) {
    await pg.exec(readFileSync(path.join(root, "supabase", "migrations", migration), "utf8"));
    console.log(`OK ${migration}`);
  }
  const realtime = await pg.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime'");
  assert(realtime.rows.length === 1 && realtime.rows[0].tablename === "messages", "Realtime публикует только сообщения");
  const adminProfiles = await asUser(admin, "select user_id, email from public.profiles");
  assert(adminProfiles.rows.length === 1 && adminProfiles.rows[0].user_id === admin,
    "Прямой доступ к чужим профилям остаётся закрытым даже администратору");
  const adminEmails = await asUser(admin, `select * from public.admin_staff_emails(array['${lawyer}'::uuid, '${manager}'::uuid, '${clientA}'::uuid])`);
  assert(adminEmails.rows.length === 2
    && adminEmails.rows.some((row) => row.user_id === lawyer && row.email === "lawyer@example.test")
    && adminEmails.rows.some((row) => row.user_id === manager && row.email === "manager@example.test")
    && adminEmails.rows.every((row) => Object.keys(row).sort().join() === "email,user_id"),
  "Администратор получает только ID и email сотрудников, но не клиентов и прочие поля профиля");
  const managerOtherEmail = await asUser(manager, `select email from public.profiles where user_id = '${lawyer}'`);
  const clientStaffEmail = await asUser(clientA, `select email from public.profiles where user_id = '${manager}'`);
  const lawyerOtherEmail = await asUser(lawyer, `select email from public.profiles where user_id = '${manager}'`);
  assert(managerOtherEmail.rows.length === 0 && clientStaffEmail.rows.length === 0 && lawyerOtherEmail.rows.length === 0,
    "Менеджер, юрист и клиент не получают чужие адреса через профили");
  for (const userId of [manager, lawyer, clientA]) {
    let denied = false;
    try { await asUser(userId, `select * from public.admin_staff_emails(array['${admin}'::uuid])`); }
    catch { denied = true; }
    assert(denied, "Только администратор может вызвать список email сотрудников");
  }
  let clientContactDenied = false;
  try { await asUser(clientA, "select public.admin_save_contact_settings('+7 777 123 45 67', 'office@example.test', null, null, null)"); }
  catch { clientContactDenied = true; }
  assert(clientContactDenied, "Клиент не управляет контактами компании");
  await asUser(admin, "select public.admin_save_contact_settings('+7 777 123 45 67', 'office@example.test', null, 'Пн–Пт', 'Ответим в рабочее время')");
  const publishedContact = await asUser(clientA, "select phone, email from public.contact_settings");
  assert(publishedContact.rows[0]?.email === "office@example.test", "Клиент видит контакты, опубликованные администратором");
  const faqEntry = await asUser(admin, "select public.admin_upsert_faq(null, 'Как связаться?', 'Напишите сотруднику по делу.', 1, false) as id");
  const faqId = faqEntry.rows[0].id;
  const hiddenFaq = await asUser(clientA, `select id from public.faq_entries where id = '${faqId}'`);
  assert(hiddenFaq.rows.length === 0, "Черновик FAQ не виден клиенту");
  await asUser(admin, `select public.admin_upsert_faq('${faqId}', 'Как связаться?', 'Напишите сотруднику по делу.', 1, true)`);
  const visibleFaq = await asUser(clientA, `select question from public.faq_entries where id = '${faqId}'`);
  assert(visibleFaq.rows[0]?.question === "Как связаться?", "Опубликованный FAQ виден клиенту");
  await asUser(clientA, "select public.update_own_profile('Клиент А', '+7 777 123 45 67', 'Алматы')");
  const ownProfile = await asUser(clientA, "select display_name, phone, city from public.profiles where user_id = auth.uid()");
  const foreignProfile = await asUser(clientB, `select display_name from public.profiles where user_id = '${clientA}'`);
  assert(ownProfile.rows[0]?.display_name === "Клиент А" && ownProfile.rows[0]?.city === "Алматы"
    && foreignProfile.rows.length === 0, "Профиль обновляется только владельцем и не виден другому клиенту");
  const profileAudit = await pg.query("select after_data from public.audit_events where action = 'profile_updated' and actor_user_id = $1", [clientA]);
  assert(profileAudit.rows.length === 1 && !JSON.stringify(profileAudit.rows[0].after_data).includes("777"), "Аудит профиля не копирует номер телефона");
  let malformedPhoneDenied = false;
  try { await asUser(clientA, "select public.update_own_profile('Test', 'http://invalid.example', 'City')"); }
  catch { malformedPhoneDenied = true; }
  assert(malformedPhoneDenied, "В профиле нельзя сохранить произвольный URL вместо телефона");
  let managerStaffDenied = false;
  try { await asUser(manager, "select public.admin_add_staff('newstaff@example.test', 'New Lawyer', 'lawyer')"); }
  catch { managerStaffDenied = true; }
  assert(managerStaffDenied, "Менеджер не может выдавать роли сотрудникам");
  const newStaffRole = await asUser(admin, "select public.admin_add_staff('newstaff@example.test', 'New Lawyer', 'lawyer') as id");
  assert(newStaffRole.rows[0].id === newStaff, "Админ подключает подтверждённый аккаунт юриста");
  const staffAuditForAdmin = await asUser(admin, "select action from public.audit_events where action = 'role_granted'");
  const staffAuditForManager = await asUser(manager, "select action from public.audit_events where action = 'role_granted'");
  assert(staffAuditForAdmin.rows.length === 1 && staffAuditForManager.rows.length === 0, "Глобальный аудит видит только админ");
  const pendingInvite = await asUser(admin, "select public.admin_invite_staff('invite@example.test', 'Invited Lawyer', 'lawyer') as status");
  assert(pendingInvite.rows[0].status === "pending", "Админ может назначить роль до регистрации сотрудника");
  const refreshedInvite = await asUser(admin, "select public.admin_invite_staff('INVITE@example.test', 'Invited Manager', 'manager') as status");
  const refreshedRows = await pg.query("select display_name, role from public.staff_invites where email = 'invite@example.test' and status = 'pending'");
  assert(refreshedInvite.rows[0].status === "pending" && refreshedRows.rows.length === 1 && refreshedRows.rows[0].role === "manager" && refreshedRows.rows[0].display_name === "Invited Manager", "Повторное приглашение обновляет роль без дубля");
  const adminInvites = await asUser(admin, "select email from public.staff_invites where status = 'pending'");
  const managerInvites = await asUser(manager, "select email from public.staff_invites");
  assert(adminInvites.rows.some((row) => row.email === "invite@example.test") && managerInvites.rows.length === 0, "Приглашения видны только админу");
  let managerInviteDenied = false;
  try { await asUser(manager, "select public.admin_invite_staff('wrong@example.test', 'Wrong', 'lawyer')"); }
  catch { managerInviteDenied = true; }
  assert(managerInviteDenied, "Менеджер не выдаёт приглашения");
  const invitedUser = "00000000-0000-4000-8000-000000000008";
  await pg.query("insert into auth.users (id, email) values ($1, 'invite@example.test')", [invitedUser]);
  const unverifiedClaim = await asUser(invitedUser, "select public.claim_staff_invite() as claimed");
  assert(unverifiedClaim.rows[0].claimed === false, "Неподтверждённый email не получает роль");
  await pg.query("update auth.users set email_confirmed_at = now() where id = $1", [invitedUser]);
  const verifiedClaim = await asUser(invitedUser, "select public.claim_staff_invite() as claimed");
  assert(verifiedClaim.rows[0].claimed === true, "После подтверждения email сотрудник активирует назначенную роль");
  const invitedRole = await asUser(invitedUser, "select role from public.staff_members where user_id = auth.uid()");
  assert(invitedRole.rows[0].role === "manager", "После принятия повторного приглашения новая роль доступна сотруднику");
  const repeatedClaim = await asUser(invitedUser, "select public.claim_staff_invite() as claimed");
  assert(repeatedClaim.rows[0].claimed === false, "Повторный вход не дублирует роль");
  const readyUser = "00000000-0000-4000-8000-000000000009";
  await pg.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'ready@example.test', now())", [readyUser]);
  const immediateInvite = await asUser(admin, "select public.admin_invite_staff('ready@example.test', 'Ready Manager', 'manager') as status");
  assert(immediateInvite.rows[0].status === "granted", "Подтверждённый аккаунт получает роль сразу");
  const cancelledInvite = await asUser(admin, "select public.admin_invite_staff('cancel@example.test', 'Cancelled', 'lawyer') as status");
  assert(cancelledInvite.rows[0].status === "pending", "Можно создать приглашение для нового адреса");
  const cancelId = await pg.query("select id from public.staff_invites where email = 'cancel@example.test' and status = 'pending'");
  await asUser(admin, `select public.admin_cancel_staff_invite('${cancelId.rows[0].id}')`);
  const cancelledUser = "00000000-0000-4000-8000-000000000010";
  await pg.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'cancel@example.test', now())", [cancelledUser]);
  const cancelledClaim = await asUser(cancelledUser, "select public.claim_staff_invite() as claimed");
  assert(cancelledClaim.rows[0].claimed === false, "Отменённое приглашение не выдаёт роль");
  let secondAdminDenied = false;
  try { await pg.query("update public.staff_members set role = 'admin' where user_id = $1", [manager]); }
  catch { secondAdminDenied = true; }
  assert(secondAdminDenied, "В базе может быть только один главный администратор");
  await pg.query("insert into public.clients (id, user_id, full_name, linked_by, linked_at) values ($1, $2, 'Client A', $3, now()), ($4, $5, 'Client B', $3, now())", [clientRecordA, clientA, lawyer, clientRecordB, clientB]);
  let clientInviteDenied = false;
  try { await asUser(admin, "select public.admin_invite_staff('a@example.test', 'Client as Staff', 'lawyer')"); }
  catch { clientInviteDenied = true; }
  assert(clientInviteDenied, "Привязанному клиенту нельзя выдать роль сотрудника через приглашение");
  let duplicateStaffDenied = false;
  try { await asUser(admin, "select public.admin_invite_staff('newstaff@example.test', 'Existing Staff', 'manager')"); }
  catch { duplicateStaffDenied = true; }
  assert(duplicateStaffDenied, "Существующему сотруднику нельзя повторно выдать роль через приглашение");
  await pg.query("insert into public.clients (id, full_name, email) values ($1, 'Client C', 'new@example.test')", [clientRecordC]);
  const clientSearch = await asUser(manager, "select id, total_count from public.staff_search_clients('client b', 1)");
  assert(clientSearch.rows.length === 1 && clientSearch.rows[0].id === clientRecordB
    && Number(clientSearch.rows[0].total_count) === 1, "Менеджер находит карточку клиента по ФИО без учёта регистра");
  let clientSearchDenied = false;
  try { await asUser(lawyer, "select * from public.staff_search_clients('client', 1)"); }
  catch { clientSearchDenied = true; }
  assert(clientSearchDenied, "Юрист не может просматривать глобальную картотеку через поиск");
  let ordinaryAccountSearchDenied = false;
  try { await asUser(clientA, "select * from public.staff_search_clients('client', 1)"); }
  catch { ordinaryAccountSearchDenied = true; }
  assert(ordinaryAccountSearchDenied, "Обычный клиентский аккаунт не получает глобальную картотеку");
  let staffToClientDenied = false;
  try { await asUser(manager, `select public.link_client_account('${clientRecordC}', 'lawyer@example.test')`); }
  catch { staffToClientDenied = true; }
  assert(staffToClientDenied, "Сотрудника нельзя привязать к клиентской карточке");
  let directDualRoleDenied = false;
  try { await pg.query("insert into public.staff_members (user_id, display_name, role) values ($1, 'Client as lawyer', 'lawyer')", [clientA]); }
  catch { directDualRoleDenied = true; }
  assert(directDualRoleDenied, "Инвариант ролей действует и при прямой записи в таблицы");
  await pg.query("insert into public.service_templates (id, code, name) values ($1, 'test', 'Test service')", [serviceId]);
  await pg.query("insert into public.service_template_versions (id, service_id, version_no) values ($1, $2, 1)", [versionId, serviceId]);
  await pg.query("insert into public.stage_templates (id, version_id, position, title) values ($1, $2, 1, 'Start')", [stageId, versionId]);
  await pg.query("insert into public.cases (id, case_number, client_id, service_version_id, title, current_stage_id) values ($1, 'A-1', $2, $5, 'Case A', $6), ($3, 'B-1', $4, $5, 'Case B', $6)", [caseA, clientRecordA, caseB, clientRecordB, versionId, stageId]);
  await pg.query("insert into public.cases (id, case_number, client_id, service_version_id, title, current_stage_id) values ($1, 'C-1', $2, $3, 'Case C', $4)", [caseC, clientRecordC, versionId, stageId]);
  await pg.query("insert into public.case_assignments (case_id, staff_user_id) values ($1, $2)", [caseA, lawyer]);
  const unassignedCases = await asUser(admin, "select case_id from public.admin_unassigned_cases()");
  assert(unassignedCases.rows.length === 2 && unassignedCases.rows.some((row) => row.case_id === caseB)
    && unassignedCases.rows.some((row) => row.case_id === caseC),
  "Администратор видит дела без активного ответственного");
  let lawyerUnassignedDenied = false;
  try { await asUser(lawyer, "select * from public.admin_unassigned_cases()"); }
  catch { lawyerUnassignedDenied = true; }
  assert(lawyerUnassignedDenied, "Юрист не получает глобальный список неназначенных дел");
  await pg.query("insert into public.case_internal_notes (case_id, author_user_id, body) values ($1, $2, 'Staff only')", [caseA, lawyer]);
  let financeDenied = false;
  try { await asUser(lawyer, `select public.staff_add_payment_installment('${caseA}', current_date, 10000, 'Первый платёж')`); }
  catch { financeDenied = true; }
  assert(financeDenied, "Юрист без отдельного финансового права не создаёт график");
  await asUser(admin, `select public.admin_set_payment_permission('${admin}', true, 'Ответственный за расчёты')`);
  let contractRequired = false;
  try { await asUser(admin, `select public.staff_add_payment_installment('${caseB}', current_date, 1000, 'Без договора')`); }
  catch { contractRequired = true; }
  assert(contractRequired, "График нельзя создать до регистрации договора по делу");
  const contractPath = `contracts/${caseA}/70000000-0000-4000-8000-000000000005.pdf`;
  await pg.query("insert into storage.objects (bucket_id, name, metadata, user_metadata) values ('modernsecure-files', $1, $2::jsonb, $3::jsonb)",
    [contractPath, JSON.stringify({ size: 8, mimetype: "application/pdf" }), JSON.stringify({ sha256: "a".repeat(64) })]);
  const contractCall = `select public.staff_register_contract('${caseA}', 'C-001', (now() at time zone 'Asia/Almaty')::date, 10000, '${contractPath}', '${"a".repeat(64)}', 8) as id`;
  let clientContractDenied = false;
  try { await asUser(clientA, contractCall); } catch { clientContractDenied = true; }
  assert(clientContractDenied, "Клиент не регистрирует договор через прямой RPC");
  const firstContract = await asUser(admin, contractCall);
  const installment = await asUser(admin, `select public.staff_add_payment_installment('${caseA}', current_date, 10000, 'Первый платёж') as id`);
  const installmentId = installment.rows[0].id;
  const paymentKey = "70000000-0000-4000-8000-000000000001";
  const paymentQuery = `select public.staff_confirm_payment('${installmentId}', 4000, (now() at time zone 'Asia/Almaty')::date, 'BANK-0001', 'Частичная оплата', '${paymentKey}') as id`;
  const firstPayment = await asUser(admin, paymentQuery);
  const repeatedPayment = await asUser(admin, paymentQuery);
  assert(firstPayment.rows[0].id === repeatedPayment.rows[0].id, "Повтор подтверждения оплаты не создаёт дубль");
  let duplicateReferenceDenied = false;
  try { await asUser(admin, `select public.staff_confirm_payment('${installmentId}', 1000, (now() at time zone 'Asia/Almaty')::date, ' bank-0001 ', null, '70000000-0000-4000-8000-000000000004')`); }
  catch { duplicateReferenceDenied = true; }
  assert(duplicateReferenceDenied, "Один банковский референс нельзя учесть повторно с другим техническим ключом");
  let overpaymentDenied = false;
  try { await asUser(admin, `select public.staff_confirm_payment('${installmentId}', 7000, (now() at time zone 'Asia/Almaty')::date, 'BANK-0002', null, '70000000-0000-4000-8000-000000000002')`); }
  catch { overpaymentDenied = true; }
  assert(overpaymentDenied, "Платёж сверх остатка графика отклоняется");
  await pg.query("update public.cases set is_suspended = true where id = $1", [caseA]);
  let suspendedPaymentDenied = false;
  try { await asUser(admin, `select public.staff_confirm_payment('${installmentId}', 1000, (now() at time zone 'Asia/Almaty')::date, 'BANK-0003', null, '70000000-0000-4000-8000-000000000003')`); }
  catch { suspendedPaymentDenied = true; }
  assert(suspendedPaymentDenied, "В приостановленном деле нельзя подтвердить новый платёж");
  await pg.query("update public.cases set is_suspended = false where id = $1", [caseA]);
  const clientPayments = await asUser(clientA, `select amount_kzt, status from public.payments where schedule_id = '${installmentId}'`);
  assert(clientPayments.rows.length === 1 && Number(clientPayments.rows[0].amount_kzt) === 4000, "Клиент видит подтверждённую частичную оплату");
  let staleScheduleDenied = false;
  try { await asUser(admin, `select public.staff_update_payment_installment('${installmentId}', '2000-01-01'::timestamptz, current_date, 12000, 'Исправление', 'Уточнение графика')`); }
  catch { staleScheduleDenied = true; }
  assert(staleScheduleDenied, "Устаревшая версия графика не перезаписывается");
  await asUser(admin, `select public.staff_void_payment('${firstPayment.rows[0].id}', 'Ошибочный банковский референс')`);
  const voided = await pg.query("select status from public.payments where id = $1", [firstPayment.rows[0].id]);
  assert(voided.rows[0].status === "void", "Ошибочный платёж сохраняется в истории как отменённый");
  let voidedRetryDenied = false;
  try { await asUser(admin, paymentQuery); }
  catch { voidedRetryDenied = true; }
  assert(voidedRetryDenied, "Повтор запроса не возвращает отменённую оплату как подтверждённую");
  const repeatedContract = await asUser(admin, contractCall);
  assert(firstContract.rows[0]?.id === repeatedContract.rows[0]?.id, "Повтор загрузки договора не создаёт вторую версию");
  const contractRecord = await asUser(clientA, `select version_no, price_kzt from public.contracts where id = '${firstContract.rows[0].id}'`);
  assert(contractRecord.rows[0]?.version_no === 1 && Number(contractRecord.rows[0]?.price_kzt) === 10000,
    "Клиент видит договор своего дела с ценой");
  const contractNotice = await asUser(clientA, `select title from public.notifications where dedupe_key = 'contract:${firstContract.rows[0].id}'`);
  assert(contractNotice.rows[0]?.title === 'Добавлен договор', "Новая версия договора уведомляет клиента");
  let changedContractDenied = false;
  try { await pg.query("update public.contracts set price_kzt = 1 where id = $1", [firstContract.rows[0].id]); }
  catch { changedContractDenied = true; }
  assert(changedContractDenied, "Опубликованную версию договора нельзя перезаписать");
  const foreignContract = await asUser(clientB, `select id from public.contracts where id = '${firstContract.rows[0].id}'`);
  assert(foreignContract.rows.length === 0, "Чужой договор скрыт RLS");
  const receiptKey = "70000000-0000-4000-8000-000000000006";
  const receiptPath = `receipts/${caseA}/${clientA}/${receiptKey}.pdf`;
  await pg.query("insert into storage.objects (bucket_id, name, metadata, user_metadata) values ('modernsecure-files', $1, $2::jsonb, $3::jsonb)",
    [receiptPath, JSON.stringify({ size: 8, mimetype: "application/pdf" }), JSON.stringify({ sha256: "b".repeat(64) })]);
  const registeredReceipt = await asUser(clientA, `select public.client_register_payment_receipt(
    '${caseA}', '${receiptPath}', 'check.pdf', 'application/pdf', 8, '${"b".repeat(64)}', '${receiptKey}') as id`);
  const receiptId = registeredReceipt.rows[0].id;
  const staffReceiptNotice = await asUser(admin, `select title from public.notifications where dedupe_key = 'receipt-submitted:${receiptId}'`);
  assert(staffReceiptNotice.rows[0]?.title === 'Новый чек клиента', "Новый чек появляется в уведомлениях администратора");
  const linkQuery = `select public.staff_confirm_payment_with_receipt('${installmentId}', 1000,
    (now() at time zone 'Asia/Almaty')::date, 'BANK-0004', null,
    '70000000-0000-4000-8000-000000000007', '${receiptId}') as id`;
  let unreviewedReceiptDenied = false;
  try { await asUser(admin, linkQuery); } catch { unreviewedReceiptDenied = true; }
  assert(unreviewedReceiptDenied, "Чек на проверке нельзя привязать к подтверждённой оплате");
  await asUser(admin, `select public.staff_review_payment_receipt('${receiptId}', true, 'Документ читаем')`);
  const clientReceiptNotice = await asUser(clientA, `select title from public.notifications where dedupe_key = 'receipt-reviewed:${receiptId}'`);
  assert(clientReceiptNotice.rows[0]?.title === 'Чек проверен', "Клиент получает результат проверки чека");
  const paidWithReceipt = await asUser(admin, linkQuery);
  const repeatedPaidWithReceipt = await asUser(admin, linkQuery);
  const linkedPayment = await pg.query("select receipt_id from public.payments where id = $1", [paidWithReceipt.rows[0].id]);
  assert(paidWithReceipt.rows[0].id === repeatedPaidWithReceipt.rows[0].id
    && linkedPayment.rows[0]?.receipt_id === receiptId, "Проверенный чек связан с одной оплатой, повтор не создаёт дубль");
  let reusedReceiptDenied = false;
  try { await asUser(admin, `select public.staff_confirm_payment_with_receipt('${installmentId}', 1000,
    (now() at time zone 'Asia/Almaty')::date, 'BANK-0005', null,
    '70000000-0000-4000-8000-000000000008', '${receiptId}')`); }
  catch { reusedReceiptDenied = true; }
  assert(reusedReceiptDenied, "Один чек нельзя привязать к двум подтверждённым платежам");
  await asUser(admin, `select public.admin_set_payment_permission('${admin}', false, 'Передача полномочий')`);
  let revokedFinanceDenied = false;
  try { await asUser(admin, `select public.staff_add_payment_installment('${caseA}', current_date, 1000, 'Новый платёж')`); }
  catch { revokedFinanceDenied = true; }
  assert(revokedFinanceDenied, "Администратор без отдельного финансового права не меняет оплаты");
  const documentRequestId = "60000000-0000-4000-8000-000000000002";
  await pg.query("insert into public.document_requests (id, case_id, title, created_by) values ($1, $2, 'Passport', $3)", [documentRequestId, caseA, lawyer]);
  const fileMetadata = JSON.stringify([{ name: "passport.pdf", mime: "application/pdf", size: 8, sha256: "a".repeat(64) }]);
  let foreignUploadDenied = false;
  try { await asUser(clientB, `select public.begin_document_upload('${documentRequestId}', 'foreign-key-123', '${fileMetadata}'::jsonb)`); }
  catch { foreignUploadDenied = true; }
  assert(foreignUploadDenied, "Чужой клиент не создаёт загрузку документа");
  const begun = await asUser(clientA, `select public.begin_document_upload('${documentRequestId}', 'upload-key-123', '${fileMetadata}'::jsonb) as batch`);
  const batch = begun.rows[0].batch;
  assert(batch.status === "pending" && batch.files.length === 1, "Клиент создаёт ожидающую загрузку только для своего дела");
  const authorizedFile = await asUser(clientA, `select public.authorize_document_file_upload('${batch.session_id}', '${batch.files[0].id}') as file`);
  assert(authorizedFile.rows[0].file.path === batch.files[0].path && authorizedFile.rows[0].file.sha256 === "a".repeat(64),
    "Владелец активной сессии получает точный путь и хеш своего файла");
  let foreignFileUploadDenied = false;
  try { await asUser(clientB, `select public.authorize_document_file_upload('${batch.session_id}', '${batch.files[0].id}')`); }
  catch { foreignFileUploadDenied = true; }
  assert(foreignFileUploadDenied, "Чужой клиент не может отправить байты в сессию");
  let staffHijackDenied = false;
  try { await asUser(lawyer, `select public.authorize_document_file_upload('${batch.session_id}', '${batch.files[0].id}')`); }
  catch { staffHijackDenied = true; }
  assert(staffHijackDenied, "Назначенный юрист не может перехватить клиентскую сессию");
  const retried = await asUser(clientA, `select public.begin_document_upload('${documentRequestId}', 'upload-key-123', '${fileMetadata}'::jsonb) as batch`);
  assert(retried.rows[0].batch.session_id === batch.session_id, "Повтор отправки использует прежнюю сессию");
  const resumed = await asUser(clientA, `select public.resume_or_begin_document_upload('${documentRequestId}', 'fresh-form-key-456', '${fileMetadata}'::jsonb) as batch`);
  assert(resumed.rows[0].batch.session_id === batch.session_id, "После перезагрузки страницы тот же набор файлов продолжает незавершённую отправку");
  let missingObjectDenied = false;
  try { await asUser(clientA, `select public.complete_document_upload('${batch.session_id}')`); }
  catch { missingObjectDenied = true; }
  assert(missingObjectDenied, "Без реального объекта отправка не завершается");
  await pg.query("insert into storage.objects (bucket_id, name, metadata) values ('modernsecure-files', $1, '{\"size\": 8}')", [batch.files[0].path]);
  let unverifiedObjectDenied = false;
  try { await asUser(clientA, `select public.complete_document_upload('${batch.session_id}')`); }
  catch { unverifiedObjectDenied = true; }
  assert(unverifiedObjectDenied, "Объект нужного размера без серверной проверки не завершает отправку");
  let clientVerificationDenied = false;
  try { await asUser(clientA, `select public.server_verify_document_file('${batch.session_id}', '${batch.files[0].id}', '${"a".repeat(64)}')`); }
  catch { clientVerificationDenied = true; }
  assert(clientVerificationDenied, "Клиент не может сам объявить файл проверенным");
  await asService(`select public.server_verify_document_file('${batch.session_id}', '${batch.files[0].id}', '${"a".repeat(64)}')`);
  await asUser(clientA, `select public.complete_document_upload('${batch.session_id}')`);
  const documentNoticeKey = `document-submitted:${batch.session_id}`;
  const adminDocumentNotice = await asUser(admin, `select kind, target_path from public.notifications where dedupe_key = '${documentNoticeKey}'`);
  const lawyerDocumentNotice = await asUser(lawyer, `select kind, target_path from public.notifications where dedupe_key = '${documentNoticeKey}'`);
  const managerDocumentNotice = await asUser(manager, `select id from public.notifications where dedupe_key = '${documentNoticeKey}'`);
  const clientDocumentNotice = await asUser(clientA, `select id from public.notifications where dedupe_key = '${documentNoticeKey}'`);
  assert(adminDocumentNotice.rows.length === 1 && lawyerDocumentNotice.rows.length === 1
    && adminDocumentNotice.rows[0].kind === "document_submission"
    && lawyerDocumentNotice.rows[0].target_path === `/staff/cases/${caseA}/documents`
    && managerDocumentNotice.rows.length === 0 && clientDocumentNotice.rows.length === 0,
  "Завершённая загрузка ставит документы в очередь только администратору и назначенному юристу");
  await asUser(clientA, `select public.complete_document_upload('${batch.session_id}')`);
  const repeatedDocumentNotices = await pg.query("select count(*)::integer as count from public.notifications where dedupe_key = $1", [documentNoticeKey]);
  assert(repeatedDocumentNotices.rows[0].count === 2, "Повтор завершения не дублирует уведомления");
  let completedFileUploadDenied = false;
  try { await asUser(clientA, `select public.authorize_document_file_upload('${batch.session_id}', '${batch.files[0].id}')`); }
  catch { completedFileUploadDenied = true; }
  assert(completedFileUploadDenied, "После завершения сессии байты нельзя перезаписать");
  const completedRetry = await asUser(clientA, `select public.resume_or_begin_document_upload('${documentRequestId}', 'upload-key-123', '${fileMetadata}'::jsonb) as batch`);
  assert(completedRetry.rows[0].batch.session_id === batch.session_id && completedRetry.rows[0].batch.status === "completed",
    "Повтор с исходным ключом после завершения не создаёт дубликат файла");
  const freshIdentical = await asUser(clientA, `select public.resume_or_begin_document_upload('${documentRequestId}', 'intentional-new-key-789', '${fileMetadata}'::jsonb) as batch`);
  assert(freshIdentical.rows[0].batch.session_id !== batch.session_id && freshIdentical.rows[0].batch.status === "pending",
    "Новая отправка тех же файлов не скрывается как потерянный ответ");
  const completedWithPendingPresent = await asUser(clientA, `select public.resume_or_begin_document_upload('${documentRequestId}', 'upload-key-123', '${fileMetadata}'::jsonb) as batch`);
  assert(completedWithPendingPresent.rows[0].batch.session_id === batch.session_id
    && completedWithPendingPresent.rows[0].batch.status === "completed"
    && completedWithPendingPresent.rows[0].batch.files[0].id === batch.files[0].id,
    "Повтор исходного ключа возвращает завершённую сессию даже при совпадающей незавершённой отправке");
  const pendingRetry = await asUser(clientA, `select public.resume_or_begin_document_upload('${documentRequestId}', 'intentional-new-key-789', '${fileMetadata}'::jsonb) as batch`);
  const pendingResume = await asUser(clientA, `select public.resume_or_begin_document_upload('${documentRequestId}', 'another-form-key-789', '${fileMetadata}'::jsonb) as batch`);
  const uploadSessionCount = await pg.query("select count(*)::integer as count from public.upload_sessions where request_id = $1 and uploader_user_id = $2", [documentRequestId, clientA]);
  assert(pendingRetry.rows[0].batch.session_id === freshIdentical.rows[0].batch.session_id
    && pendingResume.rows[0].batch.session_id === freshIdentical.rows[0].batch.session_id
    && pendingResume.rows[0].batch.status === "pending" && uploadSessionCount.rows[0].count === 2,
    "Незавершённая отправка продолжается с новым ключом без создания третьей сессии");
  let managerReviewDenied = false;
  try { await asUser(manager, `select public.staff_review_document_file('${batch.files[0].id}', true, null)`); }
  catch { managerReviewDenied = true; }
  assert(managerReviewDenied, "Менеджер не принимает юридический документ");
  await asUser(lawyer, `select public.staff_review_document_file('${batch.files[0].id}', false, 'Нужна читаемая копия')`);
  const returnedFile = await pg.query("select status, return_reason from public.document_files where id = $1", [batch.files[0].id]);
  assert(returnedFile.rows[0].status === "returned" && returnedFile.rows[0].return_reason === "Нужна читаемая копия", "Юрист возвращает документ с причиной");
  const lawyerPending = await asUser(lawyer, `select public.begin_document_upload('${documentRequestId}', 'lawyer-pending-123', '${fileMetadata}'::jsonb) as batch`);
  const pendingLawyerBatch = lawyerPending.rows[0].batch;
  const lawyerReviewable = await asUser(lawyer, `select public.begin_document_upload('${documentRequestId}', 'lawyer-reviewable-123', '${fileMetadata}'::jsonb) as batch`);
  const reviewableLawyerBatch = lawyerReviewable.rows[0].batch;
  await pg.query("insert into storage.objects (bucket_id, name, metadata) values ('modernsecure-files', $1, '{\"size\": 8}')", [pendingLawyerBatch.files[0].path]);
  await pg.query("insert into storage.objects (bucket_id, name, metadata) values ('modernsecure-files', $1, '{\"size\": 8}')", [reviewableLawyerBatch.files[0].path]);
  await asService(`select public.server_verify_document_file('${reviewableLawyerBatch.session_id}', '${reviewableLawyerBatch.files[0].id}', '${"a".repeat(64)}')`);
  await asUser(lawyer, `select public.complete_document_upload('${reviewableLawyerBatch.session_id}')`);
  await pg.query("update public.cases set is_suspended = true where id = $1", [caseA]);
  const suspendedReplay = await asUser(lawyer, `select public.resume_or_begin_document_upload('${documentRequestId}', 'lawyer-reviewable-123', '${fileMetadata}'::jsonb) as batch`);
  const suspendedDirectReplay = await asUser(clientA, `select public.begin_document_upload('${documentRequestId}', 'upload-key-123', '${fileMetadata}'::jsonb) as batch`);
  assert(suspendedReplay.rows[0].batch.session_id === reviewableLawyerBatch.session_id
    && suspendedReplay.rows[0].batch.status === "completed"
    && suspendedDirectReplay.rows[0].batch.session_id === batch.session_id,
    "Исходный ключ возвращает завершённую загрузку при приостановленном деле через оба API");
  let suspendedNewUploadDenied = false;
  try { await asUser(clientA, `select public.resume_or_begin_document_upload('${documentRequestId}', 'suspended-new-key', '${fileMetadata}'::jsonb)`); }
  catch { suspendedNewUploadDenied = true; }
  assert(suspendedNewUploadDenied, "Новый ключ не начинает и не возобновляет загрузку при приостановке");
  let suspendedPendingReplayDenied = false;
  try { await asUser(lawyer, `select public.resume_or_begin_document_upload('${documentRequestId}', 'lawyer-pending-123', '${fileMetadata}'::jsonb)`); }
  catch { suspendedPendingReplayDenied = true; }
  assert(suspendedPendingReplayDenied, "Исходный ключ незавершённой сессии не обходит приостановку");
  const changedMetadata = JSON.stringify([{ name: "changed.pdf", mime: "application/pdf", size: 8, sha256: "a".repeat(64) }]);
  let suspendedMetadataDenied = false;
  try { await asUser(clientA, `select public.resume_or_begin_document_upload('${documentRequestId}', 'upload-key-123', '${changedMetadata}'::jsonb)`); }
  catch { suspendedMetadataDenied = true; }
  assert(suspendedMetadataDenied, "Завершённый ключ нельзя повторить с изменёнными метаданными");
  let suspendedOtherUploaderDenied = false;
  try { await asUser(lawyer, `select public.begin_document_upload('${documentRequestId}', 'upload-key-123', '${fileMetadata}'::jsonb)`); }
  catch { suspendedOtherUploaderDenied = true; }
  assert(suspendedOtherUploaderDenied, "Другой пользователь с доступом к делу не получает чужую завершённую сессию");
  let pausedFileUploadDenied = false;
  try { await asUser(lawyer, `select public.authorize_document_file_upload('${pendingLawyerBatch.session_id}', '${pendingLawyerBatch.files[0].id}')`); }
  catch { pausedFileUploadDenied = true; }
  assert(pausedFileUploadDenied, "Приостановка дела блокирует отправку отдельного файла");
  let suspendedUploadDenied = false;
  try { await asUser(lawyer, `select public.complete_document_upload('${pendingLawyerBatch.session_id}')`); }
  catch { suspendedUploadDenied = true; }
  assert(suspendedUploadDenied, "Приостановка дела блокирует завершение начатой загрузки");
  let suspendedReviewDenied = false;
  try { await asUser(lawyer, `select public.staff_review_document_file('${reviewableLawyerBatch.files[0].id}', true, null)`); }
  catch { suspendedReviewDenied = true; }
  assert(suspendedReviewDenied, "В приостановленном деле нельзя принять документ");
  await pg.query("update public.cases set is_suspended = false where id = $1", [caseA]);
  await pg.query("update public.document_requests set status = 'cancelled' where id = $1", [documentRequestId]);
  const cancelledReplay = await asUser(clientA, `select public.resume_or_begin_document_upload('${documentRequestId}', 'upload-key-123', '${fileMetadata}'::jsonb) as batch`);
  assert(cancelledReplay.rows[0].batch.session_id === batch.session_id
    && cancelledReplay.rows[0].batch.files[0].id === batch.files[0].id,
    "Отменённый запрос сохраняет точный ответ завершённой загрузки");
  let cancelledNewUploadDenied = false;
  try { await asUser(clientA, `select public.begin_document_upload('${documentRequestId}', 'cancelled-new-key', '${fileMetadata}'::jsonb)`); }
  catch { cancelledNewUploadDenied = true; }
  assert(cancelledNewUploadDenied, "Отменённый запрос не принимает новую загрузку");
  let cancelledPendingReplayDenied = false;
  try { await asUser(clientA, `select public.resume_or_begin_document_upload('${documentRequestId}', 'intentional-new-key-789', '${fileMetadata}'::jsonb)`); }
  catch { cancelledPendingReplayDenied = true; }
  assert(cancelledPendingReplayDenied, "Отменённый запрос не возобновляет незавершённую сессию");
  await pg.query("update public.document_requests set status = 'active' where id = $1", [documentRequestId]);

  const aCases = await asUser(clientA, "select case_number from public.cases order by case_number");
  const bCases = await asUser(clientB, "select case_number from public.cases order by case_number");
  const lawyerCases = await asUser(lawyer, "select case_number from public.cases order by case_number");
  const unlinkedCases = await asUser(unlinked, "select case_number from public.cases");
  assert(aCases.rows.map((row) => row.case_number).join() === "A-1", "Клиент A не должен видеть чужое дело");
  assert(bCases.rows.map((row) => row.case_number).join() === "B-1", "Клиент B не должен видеть чужое дело");
  assert(lawyerCases.rows.map((row) => row.case_number).join() === "A-1", "Юрист видит только назначенное дело");
  assert(unlinkedCases.rows.length === 0, "Новый аккаунт без привязки не видит дела");

  let unauthorizedLinkDenied = false;
  try { await asUser(unlinked, `select public.link_client_account('${clientRecordC}', 'new@example.test')`); }
  catch { unauthorizedLinkDenied = true; }
  assert(unauthorizedLinkDenied, "Клиент не может привязать себя к карточке");
  let unverifiedLinkDenied = false;
  await pg.query("update auth.users set email_confirmed_at = null where id = $1", [unlinked]);
  try { await asUser(manager, `select public.link_client_account('${clientRecordC}', 'new@example.test')`); }
  catch { unverifiedLinkDenied = true; }
  assert(unverifiedLinkDenied, "Нельзя привязать неподтверждённый email");
  await pg.query("update auth.users set email_confirmed_at = now() where id = $1", [unlinked]);
  let mismatchedLinkDenied = false;
  try { await asUser(manager, `select public.link_client_account('${clientRecordC}', 'manager@example.test')`); }
  catch { mismatchedLinkDenied = true; }
  assert(mismatchedLinkDenied, "Менеджер не привязывает карточку к аккаунту с другим email");
  await asUser(manager, `select public.link_client_account('${clientRecordC}', 'new@example.test')`);
  const linkedCases = await asUser(unlinked, "select case_number from public.cases");
  assert(linkedCases.rows.map((row) => row.case_number).join() === "C-1", "После подтверждённой привязки клиент видит только своё дело");
  const linkedAudit = await pg.query("select actor_user_id, entity_id from public.audit_events where action = 'account_linked'");
  assert(linkedAudit.rows.length === 1 && linkedAudit.rows[0].actor_user_id === manager && linkedAudit.rows[0].entity_id === clientRecordC, "Привязка должна оставлять аудит");
  let repeatLinkDenied = false;
  try { await asUser(manager, `select public.link_client_account('${clientRecordC}', 'new@example.test')`); }
  catch { repeatLinkDenied = true; }
  assert(repeatLinkDenied, "Повторная привязка должна отклоняться");

  await pg.query("insert into public.case_stage_events (case_id, to_stage_id, actor_user_id, client_note, change_reason) values ($1, $2, $3, 'Visible update', 'Internal rationale')", [caseC, stageId, lawyer]);
  const clientEvent = await asUser(unlinked, `select client_note from public.case_stage_events where case_id = '${caseC}'`);
  assert(clientEvent.rows.length === 1 && clientEvent.rows[0].client_note === "Visible update", "Клиент видит публичное пояснение этапа");
  let internalReasonDenied = false;
  try { await asUser(unlinked, `select change_reason from public.case_stage_events where case_id = '${caseC}'`); }
  catch { internalReasonDenied = true; }
  assert(internalReasonDenied, "Клиент не получает внутреннее основание даже прямым запросом");
  const staffEvents = await asUser(admin, `select change_reason from public.staff_case_stage_events('${caseC}')`);
  assert(staffEvents.rows.length === 1 && staffEvents.rows[0].change_reason === "Internal rationale", "Сотрудник видит внутреннее основание через проверенный RPC");
  let clientStaffEventsDenied = false;
  try { await asUser(unlinked, `select change_reason from public.staff_case_stage_events('${caseC}')`); }
  catch { clientStaffEventsDenied = true; }
  assert(clientStaffEventsDenied, "Клиент не вызывает сотруднический RPC истории этапов");

  let clientCreateDenied = false;
  try { await asUser(unlinked, "select public.staff_create_client('Forbidden', null, null, null)"); }
  catch { clientCreateDenied = true; }
  assert(clientCreateDenied, "Клиент не должен создавать карточки");
  let serviceCreateDenied = false;
  try { await asUser(manager, "select public.admin_create_service('Forbidden', array['First'])"); }
  catch { serviceCreateDenied = true; }
  assert(serviceCreateDenied, "Только администратор создаёт услугу");
  let managerVersionDenied = false;
  try { await asUser(manager, `select public.admin_create_service_with_documents('Forbidden', array['Stage'], '[]'::jsonb)`); }
  catch { managerVersionDenied = true; }
  assert(managerVersionDenied, "Менеджер не публикует услугу с документами");

  const serviceCreated = await asUser(admin, `select public.admin_create_service_with_documents('New service',
    array['First stage', 'Second stage'], '[{"title":"Документ по услуге","instructions":"","required":true}]'::jsonb) as id`);
  const newServiceId = serviceCreated.rows[0].id;
  const newVersion = await pg.query("select id from public.service_template_versions where service_id = $1", [newServiceId]);
  const newStages = await pg.query("select id from public.stage_templates where version_id = $1 order by position", [newVersion.rows[0].id]);
  assert(newStages.rows.length === 2, "Услуга должна создаваться вместе с этапами");
  const serviceDocument = await pg.query("select id from public.document_templates where version_id = $1", [newVersion.rows[0].id]);
  assert(serviceDocument.rows.length === 1, "Услуга опубликована вместе со списком документов");

  const newClient = await asUser(manager, "select public.staff_create_client('New Person', 'person@example.test', null, null) as id");
  const newClientId = newClient.rows[0].id;
  const newCase = await asUser(manager, `select public.staff_create_case('${newClientId}', '${newVersion.rows[0].id}', 'New case') as id`);
  const newCaseId = newCase.rows[0].id;
  const createdCase = await pg.query("select case_number, current_stage_id from public.cases where id = $1", [newCaseId]);
  assert(createdCase.rows[0].case_number.startsWith("MS-") && createdCase.rows[0].current_stage_id === newStages.rows[0].id, "Дело получает номер и первый этап");
  const generatedRequest = await pg.query("select template_id, required from public.document_requests where case_id = $1", [newCaseId]);
  assert(generatedRequest.rows.length === 1 && generatedRequest.rows[0].template_id === serviceDocument.rows[0].id
    && generatedRequest.rows[0].required, "Обязательный документ шаблона появляется в новом деле");
  const secondVersion = await asUser(admin, `select public.admin_publish_service_version('${newServiceId}', '${newVersion.rows[0].id}',
    array['Новый старт', 'Новый финал'], '[{"title":"Обновлённый документ","instructions":"Проверьте актуальность","required":true}]'::jsonb) as id`);
  const publishedVersion = await pg.query("select version_no, published_at from public.service_template_versions where id = $1", [secondVersion.rows[0].id]);
  const pinnedCase = await pg.query("select service_version_id from public.cases where id = $1", [newCaseId]);
  assert(publishedVersion.rows[0]?.version_no === 2 && publishedVersion.rows[0]?.published_at
    && pinnedCase.rows[0]?.service_version_id === newVersion.rows[0].id, "Новая версия не переписывает открытое дело");
  let oldVersionDenied = false;
  try { await asUser(manager, `select public.staff_create_case('${newClientId}', '${newVersion.rows[0].id}', 'Outdated case')`); }
  catch { oldVersionDenied = true; }
  assert(oldVersionDenied, "Новое дело нельзя открыть на устаревшей версии услуги");
  const secondCase = await asUser(manager, `select public.staff_create_case('${newClientId}', '${secondVersion.rows[0].id}', 'Second case') as id`);
  const secondRequest = await pg.query("select title from public.document_requests where case_id = $1", [secondCase.rows[0].id]);
  assert(secondRequest.rows[0]?.title === 'Обновлённый документ', "Новые дела получают чек-лист новой версии");
  let invalidVersionDenied = false;
  try { await asUser(admin, `select public.admin_publish_service_version('${newServiceId}', '${secondVersion.rows[0].id}',
    array['Повтор', 'Повтор'], '[]'::jsonb)`); }
  catch { invalidVersionDenied = true; }
  assert(invalidVersionDenied, "Повторяющиеся этапы не публикуются как новая версия");
  let staleVersionDenied = false;
  try { await asUser(admin, `select public.admin_publish_service_version('${newServiceId}', '${newVersion.rows[0].id}',
    array['Устаревший экран'], '[]'::jsonb)`); }
  catch { staleVersionDenied = true; }
  assert(staleVersionDenied, "Старая вкладка не публикует новую версию поверх актуальной");
  const managerOwnCase = await asUser(manager, `select case_number from public.cases where id = '${newCaseId}'`);
  assert(managerOwnCase.rows.length === 1, "Менеджер автоматически назначается на созданное им дело");
  const managerForeignCase = await asUser(manager, `select case_number from public.cases where id = '${caseA}'`);
  assert(managerForeignCase.rows.length === 0, "Менеджер не видит чужое неназначенное дело");
  let managerLegalDenied = false;
  try { await asUser(manager, `select public.staff_change_case_stage('${newCaseId}', '${newStages.rows[0].id}', '${newStages.rows[1].id}', 'Forbidden', null)`); }
  catch { managerLegalDenied = true; }
  assert(managerLegalDenied, "Менеджер не меняет юридический этап даже своего дела");
  let managerTaskDenied = false;
  try { await asUser(manager, `select public.staff_create_task('${newCaseId}', 'answer', 'Forbidden', null, null)`); }
  catch { managerTaskDenied = true; }
  assert(managerTaskDenied, "Менеджер не создаёт юридическую задачу");
  let privateTaskDenied = false;
  try { await asUser(manager, `select private.staff_create_task('${newCaseId}', 'answer', 'Bypass', null, null)`); }
  catch { privateTaskDenied = true; }
  assert(privateTaskDenied, "Внутренняя реализация не доступна через прямой SQL-запрос сотрудника");
  let managerDocumentDenied = false;
  try { await asUser(manager, `select public.staff_create_document_request('${newCaseId}', 'Forbidden', null, true, null)`); }
  catch { managerDocumentDenied = true; }
  assert(managerDocumentDenied, "Менеджер не запрашивает юридический документ");
  await asUser(admin, `select public.staff_change_case_stage('${newCaseId}', '${newStages.rows[0].id}', '${newStages.rows[1].id}', 'Next step', null)`);
  const stageEvent = await pg.query("select count(*)::integer as count from public.case_stage_events where case_id = $1", [newCaseId]);
  assert(stageEvent.rows[0].count === 1, "Смена этапа должна сохраняться в истории");
  let staleStageDenied = false;
  try { await asUser(admin, `select public.staff_change_case_stage('${newCaseId}', '${newStages.rows[0].id}', '${newStages.rows[1].id}', 'Stale', null)`); }
  catch { staleStageDenied = true; }
  assert(staleStageDenied, "Устаревшее изменение этапа должно отклоняться");
  let rollbackWithoutReasonDenied = false;
  try { await asUser(admin, `select public.staff_change_case_stage('${newCaseId}', '${newStages.rows[1].id}', '${newStages.rows[0].id}', 'Rollback', null)`); }
  catch { rollbackWithoutReasonDenied = true; }
  assert(rollbackWithoutReasonDenied, "Откат этапа требует основания");
  await asUser(admin, `select public.staff_change_case_stage('${newCaseId}', '${newStages.rows[1].id}', '${newStages.rows[0].id}', 'Rollback', 'Incorrect stage')`);
  const stageAudit = await pg.query("select count(*)::integer as count from public.audit_events where case_id = $1 and action = 'stage_changed'", [newCaseId]);
  assert(stageAudit.rows[0].count === 2, "Каждое изменение этапа должно оставлять аудит");

  let managerAssignDenied = false;
  try { await asUser(manager, `select public.staff_assign_case('${caseB}', '${admin}')`); }
  catch { managerAssignDenied = true; }
  assert(managerAssignDenied, "Назначения контролирует администратор");
  const assigned = await asUser(admin, `select public.staff_assign_case('${caseB}', '${admin}') as id`);
  assert(assigned.rows[0].id, "Назначение сотрудника должно создаваться менеджером");
  const newLawyerBefore = await asUser(newStaff, "select case_number from public.cases");
  assert(newLawyerBefore.rows.length === 0, "Новый юрист не видит дела до назначения");
  const newLawyerAssignment = await asUser(admin, `select public.staff_assign_case('${caseB}', '${newStaff}') as id`);
  const newLawyerAfter = await asUser(newStaff, "select case_number from public.cases");
  assert(newLawyerAfter.rows.map((row) => row.case_number).join() === "B-1", "Назначенный юрист видит только своё дело");
  let managerAccessDenied = false;
  try { await asUser(manager, `select public.admin_set_staff_access('${newStaff}', 'manager', true, 'Unauthorized')`); }
  catch { managerAccessDenied = true; }
  assert(managerAccessDenied, "Менеджер не меняет роли сотрудников");
  let selfDisableDenied = false;
  try { await asUser(admin, `select public.admin_set_staff_access('${admin}', 'manager', false, 'Self change')`); }
  catch { selfDisableDenied = true; }
  assert(selfDisableDenied, "Главный администратор не может отключить себя");
  await asUser(admin, `select public.admin_revoke_case_assignment('${newLawyerAssignment.rows[0].id}', 'Reassignment')`);
  const revokedNewLawyer = await asUser(newStaff, "select case_number from public.cases");
  assert(revokedNewLawyer.rows.length === 0, "Отзыв назначения сразу убирает доступ юриста");
  await asUser(admin, `select public.staff_assign_case('${caseB}', '${newStaff}')`);
  await asUser(admin, `select public.admin_set_staff_access('${newStaff}', 'manager', true, 'Change duties')`);
  const afterRoleSwitch = await pg.query("select count(*)::integer as count from public.case_assignments where staff_user_id = $1 and revoked_at is null", [newStaff]);
  assert(afterRoleSwitch.rows[0].count === 0, "Смена роли должна отзывать старые назначения");
  await asUser(admin, `select public.admin_set_staff_access('${newStaff}', 'lawyer', true, 'Return to legal work')`);
  const afterRoleReturn = await asUser(newStaff, "select case_number from public.cases");
  assert(afterRoleReturn.rows.length === 0, "Возврат роли юриста не должен восстанавливать прежний доступ к делу");
  await asUser(admin, `select public.staff_assign_case('${caseB}', '${newStaff}')`);
  await asUser(admin, `select public.admin_set_staff_access('${newStaff}', 'manager', false, 'Employment ended')`);
  const inactiveNewStaff = await asUser(newStaff, "select case_number from public.cases");
  assert(inactiveNewStaff.rows.length === 0, "Отключение сотрудника отзывает доступ и назначения");
  const leftoverAssignments = await pg.query("select count(*)::integer as count from public.case_assignments where staff_user_id = $1 and revoked_at is null", [newStaff]);
  assert(leftoverAssignments.rows[0].count === 0, "Отключение сотрудника не оставляет активных назначений");
  let inactiveAssignmentDenied = false;
  try { await asUser(admin, `select public.staff_assign_case('${caseB}', '${newStaff}')`); }
  catch { inactiveAssignmentDenied = true; }
  assert(inactiveAssignmentDenied, "Отключённому сотруднику нельзя назначить дело");
  await asUser(admin, `select public.admin_set_staff_access('${newStaff}', 'manager', true, 'Возврат к работе')`);
  const reactivatedNewStaff = await asUser(newStaff, "select case_number from public.cases");
  assert(reactivatedNewStaff.rows.length === 0, "Повторное включение не возвращает старые назначения");
  const accessAudit = await pg.query("select count(*)::integer as count from public.audit_events where entity_id = $1 and action = 'access_changed'", [newStaff]);
  assert(accessAudit.rows[0].count === 4, "Смена роли, отключение и повторное включение фиксируются в журнале");
  const assignmentNotice = await asUser(admin, `select kind from public.notifications where case_id = '${caseB}'`);
  assert(assignmentNotice.rows.some((row) => row.kind === "case_assignment"), "Назначенный сотрудник получает уведомление");
  let clientAssignmentDenied = false;
  try { await asUser(clientA, `select public.staff_assign_case('${caseA}', '${manager}')`); }
  catch { clientAssignmentDenied = true; }
  assert(clientAssignmentDenied, "Клиент не может назначить сотрудника");

  const task = await asUser(lawyer, `select public.staff_create_task('${caseA}', 'answer', 'Confirm facts', 'Describe the facts', null) as id`);
  const taskId = task.rows[0].id;
  const taskVisible = await asUser(clientA, `select title from public.tasks where id = '${taskId}'`);
  assert(taskVisible.rows[0]?.title === "Confirm facts", "Задача сотрудника видна своему клиенту");
  const taskHidden = await asUser(clientB, `select id from public.tasks where id = '${taskId}'`);
  assert(taskHidden.rows.length === 0, "Чужая задача не видна клиенту");
  let crossResponseDenied = false;
  try { await asUser(clientB, `select public.client_respond_task('${taskId}', 'Stolen response')`); }
  catch { crossResponseDenied = true; }
  assert(crossResponseDenied, "Чужой клиент не может ответить на задачу");
  await asUser(clientA, `select public.client_respond_task('${taskId}', 'Facts confirmed')`);
  const responded = await asUser(lawyer, `select status from public.tasks where id = '${taskId}'`);
  assert(responded.rows[0].status === "response_sent", "Ответ клиента переводит задачу на проверку");
  await asUser(lawyer, `select public.staff_review_task('${taskId}', false, 'Add document number')`);
  const returned = await asUser(clientA, `select status from public.tasks where id = '${taskId}'`);
  assert(returned.rows[0].status === "new", "Возврат вновь открывает задачу клиенту");
  await asUser(clientA, `select public.client_respond_task('${taskId}', 'Document number 42')`);
  await asUser(lawyer, `select public.staff_review_task('${taskId}', true, null)`);
  const completed = await asUser(clientA, `select status from public.tasks where id = '${taskId}'`);
  assert(completed.rows[0].status === "completed", "Принятие ответа завершает задачу");
  const taskAudit = await pg.query("select count(*)::integer as count from public.audit_events where entity_id = $1", [taskId]);
  assert(taskAudit.rows[0].count === 5, "Каждый переход задачи оставляет аудит");
  let blankAcknowledgmentDenied = false;
  try { await asUser(lawyer, `select public.staff_create_task('${caseA}', 'acknowledge', 'Прочитать текст', null, null)`); }
  catch { blankAcknowledgmentDenied = true; }
  assert(blankAcknowledgmentDenied, "Задачу ознакомления нельзя создать без текста для прочтения");
  const acknowledgment = await asUser(lawyer, `select public.staff_create_task('${caseA}', 'acknowledge', 'Прочитать текст', 'Важное условие', null) as id`);
  const acknowledgementId = acknowledgment.rows[0].id;
  const acknowledgementSnapshot = "Прочитать текст\nВажное условие";
  const acknowledgementVersion = createHash("sha256").update(acknowledgementSnapshot, "utf8").digest("hex");
  let freeTextBypassDenied = false;
  try { await asUser(clientA, `select public.client_respond_task('${acknowledgementId}', 'Прочитал')`); }
  catch { freeTextBypassDenied = true; }
  assert(freeTextBypassDenied, "Ознакомление нельзя обойти через обычный ответ");
  let staleAckDenied = false;
  try { await asUser(clientA, `select public.client_acknowledge_task('${acknowledgementId}', '${"0".repeat(64)}')`); }
  catch { staleAckDenied = true; }
  assert(staleAckDenied, "Устаревшая версия текста не принимается");
  let foreignAckDenied = false;
  try { await asUser(clientB, `select public.client_acknowledge_task('${acknowledgementId}', '${acknowledgementVersion}')`); }
  catch { foreignAckDenied = true; }
  assert(foreignAckDenied, "Чужой клиент не может подтвердить ознакомление");
  await asUser(clientA, `select public.client_acknowledge_task('${acknowledgementId}', '${acknowledgementVersion}')`);
  await asUser(clientA, `select public.client_acknowledge_task('${acknowledgementId}', '${acknowledgementVersion}')`);
  const ackEvents = await asUser(clientA, `select acknowledged_text, acknowledged_version from public.task_events
    where task_id = '${acknowledgementId}' and action = 'acknowledged'`);
  assert(ackEvents.rows.length === 1 && ackEvents.rows[0].acknowledged_text === acknowledgementSnapshot
    && ackEvents.rows[0].acknowledged_version === acknowledgementVersion,
  "Ознакомление хранит точный текст и версию без дубля при повторе");
  await asUser(lawyer, `select public.staff_review_task('${acknowledgementId}', true, null)`);

  const dueTask = await asUser(lawyer, `select public.staff_create_task('${caseA}', 'answer', 'Напоминание по сроку', null, '2030-01-02T05:00:00Z') as id`);
  const dueTaskId = dueTask.rows[0].id;
  const tomorrowReminders = await pg.query("select private.enqueue_task_deadline_reminders('2030-01-01') as count");
  assert(tomorrowReminders.rows[0].count === 1, "За день до срока создано одно уведомление клиенту");
  const repeatedReminders = await pg.query("select private.enqueue_task_deadline_reminders('2030-01-01') as count");
  assert(repeatedReminders.rows[0].count === 0, "Повторный запуск не дублирует напоминание");
  const todayReminders = await pg.query("select private.enqueue_task_deadline_reminders('2030-01-02') as count");
  assert(todayReminders.rows[0].count === 1, "В день срока создано отдельное уведомление");
  const deadlineNotices = await asUser(clientA, `select title, target_path from public.notifications where dedupe_key like 'task-deadline:${dueTaskId}:%' order by title`);
  assert(deadlineNotices.rows.length === 2 && deadlineNotices.rows.every((row) => row.target_path === `/account/cases/${caseA}/tasks`),
    "Оба напоминания доступны клиенту и ведут к его задаче");
  const cancelledDueTask = await asUser(lawyer, `select public.staff_create_task('${caseA}', 'answer', 'Отменённый срок', null, '2030-01-02T05:00:00Z') as id`);
  await pg.query("update public.tasks set status = 'cancelled' where id = $1", [cancelledDueTask.rows[0].id]);
  const afterCancel = await pg.query("select private.enqueue_task_deadline_reminders('2030-01-01') as count");
  assert(afterCancel.rows[0].count === 0, "По отменённой задаче напоминание не отправляется");
  await asUser(lawyer, `select public.staff_create_task('${caseA}', 'answer', 'Пауза дела', null, '2030-01-02T05:00:00Z')`);
  await pg.query("update public.cases set is_suspended = true where id = $1", [caseA]);
  const whileSuspended = await pg.query("select private.enqueue_task_deadline_reminders('2030-01-01') as count");
  assert(whileSuspended.rows[0].count === 0, "По приостановленному делу напоминание не отправляется");
  await pg.query("update public.cases set is_suspended = false, status = 'closed', result_summary = 'Проверка напоминаний', closed_at = now() where id = $1", [caseA]);
  const afterClose = await pg.query("select private.enqueue_task_deadline_reminders('2030-01-01') as count");
  assert(afterClose.rows[0].count === 0, "По закрытому делу напоминание не отправляется");
  await pg.query("update public.cases set status = 'open', result_summary = null, closed_at = null where id = $1", [caseA]);

  const docRequest = await asUser(lawyer, `select public.staff_create_document_request('${caseA}', 'Identity card', 'Both sides', true, null) as id`);
  const docVisible = await asUser(clientA, `select title from public.document_requests where id = '${docRequest.rows[0].id}'`);
  assert(docVisible.rows[0]?.title === "Identity card", "Запрос документа виден клиенту в своём деле");
  let crossDocumentDenied = false;
  try { await asUser(clientB, `select public.staff_create_document_request('${caseA}', 'Wrong', null, true, null)`); }
  catch { crossDocumentDenied = true; }
  assert(crossDocumentDenied, "Клиент не может создать запрос документа");

  const sent = await asUser(clientA, `select public.post_case_message('${caseA}', 'Question', 'client-key-1') as id`);
  const sentAgain = await asUser(clientA, `select public.post_case_message('${caseA}', 'Question', 'client-key-1') as id`);
  assert(sent.rows[0].id === sentAgain.rows[0].id, "Повторная отправка с тем же ключом не дублирует сообщение");
  const staffInbox = await asUser(lawyer, `select body from public.messages where id = '${sent.rows[0].id}'`);
  assert(staffInbox.rows[0]?.body === "Question", "Сообщение клиента видно назначенному сотруднику");
  await asUser(lawyer, `select public.post_case_message('${caseA}', 'Answer', 'staff-key-1')`);
  const clientInbox = await asUser(clientA, `select body from public.messages where case_id = '${caseA}' order by created_at`);
  assert(clientInbox.rows.map((row) => row.body).includes("Answer"), "Ответ сотрудника виден клиенту");
  const lawyerWorklist = await asUser(lawyer, "select case_number, unread_count from public.staff_case_worklist()");
  assert(lawyerWorklist.rows.length === 1 && lawyerWorklist.rows[0].case_number === "A-1"
    && Number(lawyerWorklist.rows[0].unread_count) > 0, "Рабочая очередь показывает юристу только назначенное дело и непрочитанный ответ клиента");
  const adminWorklist = await asUser(admin, "select case_number from public.staff_case_worklist()");
  assert(["A-1", "B-1", "C-1"].every((number) => adminWorklist.rows.some((row) => row.case_number === number)), "Администратор видит все дела в рабочей очереди");
  const managerWorklist = await asUser(manager, "select case_number from public.staff_case_worklist()");
  assert(managerWorklist.rows.every((row) => row.case_number !== "A-1"), "Менеджер не видит чужое неназначенное дело в рабочей очереди");
  const contractSearch = await asUser(lawyer, "select case_number from public.staff_case_worklist(p_query => 'C-001')");
  assert(contractSearch.rows.length === 1 && contractSearch.rows[0].case_number === "A-1", "Поиск дела находит номер договора");
  const unreadWorklist = await asUser(lawyer, "select case_number from public.staff_case_worklist(p_attention => 'unread')");
  assert(unreadWorklist.rows.length === 1 && unreadWorklist.rows[0].case_number === "A-1", "Фильтр сообщений показывает непрочитанные диалоги");
  let clientWorklistDenied = false;
  try { await asUser(clientA, "select * from public.staff_case_worklist()"); }
  catch { clientWorklistDenied = true; }
  assert(clientWorklistDenied, "Клиенту запрещён доступ к рабочей очереди сотрудников");
  let crossMessageDenied = false;
  try { await asUser(clientB, `select public.post_case_message('${caseA}', 'Intrusion', 'foreign-key')`); }
  catch { crossMessageDenied = true; }
  assert(crossMessageDenied, "Чужой клиент не может писать в дело");
  const notices = await asUser(clientA, `select kind from public.notifications where case_id = '${caseA}'`);
  assert(["task", "document_request", "message", "task_review"].every((kind) => notices.rows.some((row) => row.kind === kind)), "Клиент получает события из связанных разделов");
  const readCount = await asUser(clientA, `select public.mark_case_messages_read('${caseA}') as count`);
  assert(readCount.rows[0].count === 1, "Клиент отмечает входящее сообщение прочитанным");
  const repeatRead = await asUser(clientA, `select public.mark_case_messages_read('${caseA}') as count`);
  assert(repeatRead.rows[0].count === 0, "Повторное чтение не дублирует отметку");
  const eventRead = await asUser(clientA, `select public.mark_case_notifications_read('${caseA}') as count`);
  assert(eventRead.rows[0].count > 0, "Клиент отмечает события дела прочитанными");
  let crossReadDenied = false;
  try { await asUser(clientB, `select public.mark_case_messages_read('${caseA}')`); }
  catch { crossReadDenied = true; }
  assert(crossReadDenied, "Чужой клиент не может читать сообщения другого дела");
  // The rate-limit rejection path is tested in test-case-message-state.mjs.
  // In the full PGlite fixture, a prior case-row FOR UPDATE makes its 21st
  // rejection spin inside PGlite; native PostgreSQL keeps that row lock.
  await pg.query("insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key) values ($1, $2, 'test', 'Тест уведомления', $3, 'inbox-test-client')", [clientA, caseA, `/account/cases/${caseA}`]);
  const inboxMarked = await asUser(clientA, "select public.mark_own_notifications_read() as count");
  assert(inboxMarked.rows[0].count >= 1, "Клиент отмечает собственные уведомления прочитанными");
  const otherUnread = await asUser(lawyer, "select count(*)::integer as count from public.notifications where read_at is null");
  assert(otherUnread.rows[0].count > 0, "Отметка клиента не затрагивает уведомления сотрудника");
  const inboxRepeat = await asUser(clientA, "select public.mark_own_notifications_read() as count");
  assert(inboxRepeat.rows[0].count === 0, "Повторная отметка уведомлений идемпотентна");

  const clientNotes = await asUser(clientA, "select id from public.case_internal_notes");
  const lawyerNotes = await asUser(lawyer, "select id from public.case_internal_notes");
  assert(clientNotes.rows.length === 0 && lawyerNotes.rows.length === 1, "Внутренние заметки не должны открываться клиенту");

  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [clientA]);
  await pg.exec("set role authenticated");
  let insertDenied = false;
  try { await pg.query("insert into public.messages (case_id, sender_user_id, body, idempotency_key) values ($1, $2, 'forbidden', 'x')", [caseA, clientA]); }
  catch { insertDenied = true; }
  finally { await pg.exec("reset role"); }
  assert(insertDenied, "Прямые записи из браузерной роли должны быть запрещены");

  await pg.query("select set_config('request.jwt.claim.sub', '', false)");
  await pg.query("insert into public.messages (case_id, sender_user_id, body, idempotency_key) values ($1, $2, 'Original', 'server-key')", [caseA, clientA]);
  let messageImmutable = false;
  try { await pg.exec("update public.messages set body = 'Changed'"); }
  catch { messageImmutable = true; }
  assert(messageImmutable, "Отправленное сообщение нельзя изменять");

  const requestId = "60000000-0000-4000-8000-000000000001";
  await pg.query("insert into public.document_requests (id, case_id, title) values ($1, $2, 'Test document')", [requestId, caseA]);
  await pg.query("insert into public.document_files (request_id, version_no, file_position, storage_path, original_name, detected_mime_type, size_bytes, content_sha256, status, uploaded_by, reviewed_by, reviewed_at) values ($1, 1, 1, 'test/file.pdf', 'file.pdf', 'application/pdf', 100, $4, 'accepted', $2, $3, now())", [requestId, clientA, lawyer, "a".repeat(64)]);
  let acceptedImmutable = false;
  try { await pg.exec("update public.document_files set original_name = 'changed.pdf'"); }
  catch { acceptedImmutable = true; }
  assert(acceptedImmutable, "Принятый документ нельзя перезаписать");

  let managerSuspendDenied = false;
  try { await asUser(manager, `select public.staff_suspend_case('${caseA}', 'Нужна проверка', now() + interval '1 day')`); }
  catch { managerSuspendDenied = true; }
  assert(managerSuspendDenied, "Менеджер не приостанавливает юридическое дело");
  await asUser(lawyer, `select public.staff_suspend_case('${caseA}', 'Ожидаем ответ ведомства', now() + interval '1 day')`);
  const suspended = await asUser(clientA, `select is_suspended, next_review_at from public.cases where id = '${caseA}'`);
  const visibleSuspension = await asUser(clientA, `select reason_for_client from public.case_suspensions where case_id = '${caseA}' and ended_at is null`);
  assert(suspended.rows[0]?.is_suspended === true && suspended.rows[0]?.next_review_at
    && visibleSuspension.rows[0]?.reason_for_client === 'Ожидаем ответ ведомства', "Клиент видит причину и контрольную дату приостановки");
  const suspendedRetry = await asUser(clientA, `select public.post_case_message('${caseA}', 'Question', 'client-key-1') as id`);
  assert(suspendedRetry.rows[0].id === sent.rows[0].id, "Точный повтор сообщения проходит после приостановки");
  // Rejected sends after the case-row lock are covered by the isolated message
  // test and native PostgreSQL smoke test; this full PGlite fixture can spin
  // after a lock-holding exception.
  let closeSuspendedDenied = false;
  try { await asUser(lawyer, `select public.staff_close_case('${caseA}', 'Результат')`); }
  catch { closeSuspendedDenied = true; }
  assert(closeSuspendedDenied, "Приостановленное дело нельзя завершить");
  await asUser(lawyer, `select public.staff_resume_case('${caseA}')`);
  const resumedCase = await asUser(clientA, `select is_suspended, next_review_at from public.cases where id = '${caseA}'`);
  const endedSuspension = await asUser(clientA, `select ended_at from public.case_suspensions where case_id = '${caseA}'`);
  assert(resumedCase.rows[0]?.is_suspended === false && resumedCase.rows[0]?.next_review_at === null
    && endedSuspension.rows[0]?.ended_at, "Возобновление закрывает приостановку и возвращает дело в работу");
  let missingRequiredDocumentDenied = false;
  try { await asUser(lawyer, `select public.staff_close_case('${caseA}', 'Результат')`); }
  catch { missingRequiredDocumentDenied = true; }
  assert(missingRequiredDocumentDenied, "Обязательный непринятый документ блокирует завершение");
  await pg.query("insert into public.document_files (request_id, version_no, file_position, storage_path, original_name, detected_mime_type, size_bytes, content_sha256, status, uploaded_by, reviewed_by, reviewed_at) values ($1, 1, 1, 'test/identity.pdf', 'identity.pdf', 'application/pdf', 100, $4, 'accepted', $2, $3, now())", [docRequest.rows[0].id, clientA, lawyer, "b".repeat(64)]);
  await pg.query("insert into public.document_files (request_id, version_no, file_position, storage_path, original_name, detected_mime_type, size_bytes, content_sha256, status, uploaded_by, reviewed_by, reviewed_at) values ($1, 100, 1, 'test/passport.pdf', 'passport.pdf', 'application/pdf', 100, $4, 'accepted', $2, $3, now())", [documentRequestId, clientA, lawyer, "c".repeat(64)]);
  const pendingCloseTask = await asUser(lawyer, `select public.staff_create_task('${caseA}', 'answer', 'Последний вопрос', null, null) as id`);
  await asUser(lawyer, `select public.staff_close_case('${caseA}', 'Юридическая работа завершена')`);
  const closed = await asUser(clientA, `select status, result_summary, closed_at from public.cases where id = '${caseA}'`);
  assert(closed.rows[0]?.status === 'closed' && closed.rows[0]?.result_summary === 'Юридическая работа завершена'
    && closed.rows[0]?.closed_at, "Клиент видит зафиксированный результат завершённого дела");
  const closedRetry = await asUser(clientA, `select public.post_case_message('${caseA}', 'Question', 'client-key-1') as id`);
  const closedStaffRetry = await asUser(lawyer, `select public.post_case_message('${caseA}', 'Answer', 'staff-key-1') as id`);
  assert(closedRetry.rows[0].id === sent.rows[0].id && closedStaffRetry.rows[0].id,
    "Клиент и назначенный сотрудник могут безопасно повторить прежнее сообщение после закрытия");
  const closedReplay = await asUser(clientA, `select public.resume_or_begin_document_upload('${documentRequestId}', 'upload-key-123', '${fileMetadata}'::jsonb) as batch`);
  const closedLawyerReplay = await asUser(lawyer, `select public.begin_document_upload('${documentRequestId}', 'lawyer-reviewable-123', '${fileMetadata}'::jsonb) as batch`);
  assert(closedReplay.rows[0].batch.session_id === batch.session_id
    && closedLawyerReplay.rows[0].batch.session_id === reviewableLawyerBatch.session_id,
    "Клиент и назначенный юрист получают свои завершённые сессии после закрытия дела");
  let closedNewUploadDenied = false;
  try { await asUser(clientA, `select public.resume_or_begin_document_upload('${documentRequestId}', 'closed-new-key-123', '${fileMetadata}'::jsonb)`); }
  catch { closedNewUploadDenied = true; }
  assert(closedNewUploadDenied, "Закрытое дело не принимает новую загрузку");
  const cancelledOnClose = await asUser(clientA, `select status from public.tasks where id = '${pendingCloseTask.rows[0].id}'`);
  assert(cancelledOnClose.rows[0]?.status === 'cancelled', "Незавершённые задачи отменяются при закрытии дела");
  const lifecycleAudit = await pg.query("select action from public.audit_events where case_id = $1 and action in ('started', 'ended', 'closed')", [caseA]);
  assert(lifecycleAudit.rows.length === 3, "Приостановка, возобновление и завершение записаны в аудит");

  await pg.query("insert into public.audit_events (actor_user_id, case_id, entity_type, action) values ($1, $2, 'case', 'created')", [lawyer, caseA]);
  let auditImmutable = false;
  try { await pg.exec("delete from public.audit_events"); }
  catch { auditImmutable = true; }
  assert(auditImmutable, "Аудит должен быть append-only");

  await pg.query("update public.case_assignments set revoked_at = now() where case_id = $1 and staff_user_id = $2", [caseA, lawyer]);
  const revokedLawyerCases = await asUser(lawyer, "select case_number from public.cases");
  assert(revokedLawyerCases.rows.length === 0, "После переназначения доступ прежнего юриста должен исчезнуть");
  const revokedWorklist = await asUser(lawyer, "select case_number from public.staff_case_worklist()");
  assert(revokedWorklist.rows.length === 0, "После отзыва назначения дело исчезает и из рабочей очереди");
  let revokedReplayDenied = false;
  try { await asUser(lawyer, `select public.resume_or_begin_document_upload('${documentRequestId}', 'lawyer-reviewable-123', '${fileMetadata}'::jsonb)`); }
  catch { revokedReplayDenied = true; }
  assert(revokedReplayDenied, "Отозванный юрист не получает даже свой завершённый ответ");
  const clientReplayAfterRevocation = await asUser(clientA, `select public.resume_or_begin_document_upload('${documentRequestId}', 'upload-key-123', '${fileMetadata}'::jsonb) as batch`);
  assert(clientReplayAfterRevocation.rows[0].batch.session_id === batch.session_id,
    "Отзыв доступа юриста не мешает клиенту повторить свою завершённую загрузку");
  let revokedUploadDenied = false;
  try { await asUser(lawyer, `select public.complete_document_upload('${pendingLawyerBatch.session_id}')`); }
  catch { revokedUploadDenied = true; }
  assert(revokedUploadDenied, "Отозванный юрист не завершает уже начатую загрузку");
  let revokedRetractionDenied = false;
  try { await asUser(lawyer, `select public.retract_document_file('${reviewableLawyerBatch.files[0].id}')`); }
  catch { revokedRetractionDenied = true; }
  assert(revokedRetractionDenied, "Отозванный юрист не отзывает уже загруженный файл");

  const buckets = await pg.query("select id, public from storage.buckets order by id");
  assert(buckets.rows.length === 2 && buckets.rows.every((row) => !row.public), "Хранилище должно быть закрытым");
  console.log("OK RLS: изоляция дел, непривязанный аккаунт, отзыв назначения, внутренние заметки, запрет прямой записи");
  console.log("OK invariants: неизменяемые сообщения/принятые файлы/аудит, закрытые бакеты");
} finally {
  await pg.close();
}
