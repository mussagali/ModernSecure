import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pg = new PGlite();
const admin = randomUUID();
const client = randomUUID();
const otherClient = randomUUID();
const lawyer = randomUUID();
const staleLawyer = randomUUID();
const manager = randomUUID();

async function asUser(userId, sql, params = []) {
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await pg.exec("set role authenticated");
  try { return await pg.query(sql, params); }
  finally { await pg.exec("reset role"); }
}

async function notifications(dedupeKey) {
  const result = await pg.query(
    "select recipient_user_id, case_id, kind, target_path from public.notifications where dedupe_key = $1 order by recipient_user_id",
    [dedupeKey],
  );
  return result.rows;
}

async function expectRecipients(dedupeKey, caseId, kind, section, users) {
  const rows = await notifications(dedupeKey);
  assert.deepEqual(rows.map((row) => row.recipient_user_id).sort(), [...users].sort(), dedupeKey);
  for (const row of rows) {
    assert.equal(row.case_id, caseId);
    assert.equal(row.kind, kind);
    assert.equal(row.target_path, `/staff/cases/${caseId}/${section}`);
  }
}

async function sendMessage(caseId, key) {
  const result = await asUser(client,
    "select public.post_case_message($1, 'Client says hello', $2) as id", [caseId, key]);
  return result.rows[0].id;
}

async function makeTask(caseId, kind) {
  const description = kind === "acknowledge" ? "Please read this version" : "Please answer";
  const result = await asUser(admin,
    "select public.staff_create_task($1, $2::public.task_kind, 'Task title', $3) as id",
    [caseId, kind, description]);
  return { id: result.rows[0].id, description };
}

async function respond(taskId) {
  await asUser(client, "select public.client_respond_task($1, 'Response text')", [taskId]);
  return (await pg.query("select id from public.task_events where task_id = $1 and action = 'responded'", [taskId])).rows[0].id;
}

async function acknowledge(task) {
  const version = createHash("sha256").update(`Task title\n${task.description}`).digest("hex");
  await asUser(client, "select public.client_acknowledge_task($1, $2)", [task.id, version]);
  return (await pg.query("select id from public.task_events where task_id = $1 and action = 'acknowledged'", [task.id])).rows[0].id;
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
  const migrationDir = path.join(root, "supabase/migrations");
  const migrationNames = readdirSync(migrationDir)
    .filter((name) => name.endsWith(".sql") && name <= "20261011004300_unassigned_case_client_notifications.sql")
    .sort();
  assert.equal(migrationNames.at(-1), "20261011004300_unassigned_case_client_notifications.sql");
  for (const name of migrationNames) {
    if (name === "20261011000800_role_boundaries.sql") {
      await pg.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'ayanz2008@gmail.com', now())", [admin]);
    }
    try { await pg.exec(readFileSync(path.join(migrationDir, name), "utf8")); }
    catch (error) { throw new Error(`${name}: ${error.message}`); }
  }

  for (const [id, label] of [
    [client, "client"], [otherClient, "other-client"], [lawyer, "lawyer"],
    [staleLawyer, "stale-lawyer"], [manager, "manager"],
  ]) {
    await pg.query("insert into auth.users (id, email) values ($1, $2)", [id, `${label}@example.test`]);
  }
  await pg.query(`insert into public.staff_members (user_id, display_name, role, active)
    values ($1, 'Lawyer', 'lawyer', true), ($2, 'Stale Lawyer', 'lawyer', false),
      ($3, 'Manager', 'manager', true)`, [lawyer, staleLawyer, manager]);
  const clientCard = randomUUID();
  const otherCard = randomUUID();
  const service = randomUUID();
  const version = randomUUID();
  await pg.query(`insert into public.clients (id, user_id, full_name, linked_by, linked_at)
    values ($1, $2, 'Client', $3, now()), ($4, $5, 'Other client', $3, now())`,
  [clientCard, client, admin, otherCard, otherClient]);
  await pg.query("insert into public.service_templates (id, code, name) values ($1, 'routing-test', 'Routing test')", [service]);
  await pg.query("insert into public.service_template_versions (id, service_id, version_no, published_at) values ($1, $2, 1, now())", [version, service]);
  await pg.query("insert into public.stage_templates (version_id, position, title) values ($1, 1, 'Start')", [version]);

  const caseId = (await asUser(admin,
    "select public.staff_create_case($1, $2, 'Admin-created case') as id",
    [clientCard, version])).rows[0].id;
  assert.equal((await pg.query("select count(*)::integer as n from public.case_assignments where case_id = $1 and revoked_at is null", [caseId])).rows[0].n, 0);
  const initialMessage = await sendMessage(caseId, "initial");
  await expectRecipients(`message:${initialMessage}`, caseId, "message", "messages", [admin]);
  assert.equal(await sendMessage(caseId, "initial"), initialMessage);
  await expectRecipients(`message:${initialMessage}`, caseId, "message", "messages", [admin]);

  const answerTask = await makeTask(caseId, "answer");
  const answerEvent = await respond(answerTask.id);
  await expectRecipients(`task-response:${answerEvent}`, caseId, "task_response", "tasks", [admin]);
  await assert.rejects(asUser(client, "select public.client_respond_task($1, 'Again')", [answerTask.id]));
  await expectRecipients(`task-response:${answerEvent}`, caseId, "task_response", "tasks", [admin]);

  const ackTask = await makeTask(caseId, "acknowledge");
  const ackEvent = await acknowledge(ackTask);
  await expectRecipients(`task-acknowledged:${ackEvent}`, caseId, "task_response", "tasks", [admin]);
  assert.equal(await acknowledge(ackTask), ackEvent);
  await expectRecipients(`task-acknowledged:${ackEvent}`, caseId, "task_response", "tasks", [admin]);

  await assert.rejects(asUser(otherClient,
    "select public.post_case_message($1, 'Wrong client', 'wrong')", [caseId]));
  await assert.rejects(asUser(otherClient,
    "select public.client_respond_task($1, 'Wrong client')", [answerTask.id]));
  await assert.rejects(asUser(client,
    "select private.notify_case_staff_or_admins($1, 'message', 'Fake', 'messages', 'fake')", [caseId]));
  assert.deepEqual((await asUser(lawyer, "select id from public.messages where case_id = $1", [caseId])).rows, []);
  assert.deepEqual((await asUser(manager, "select id from public.notifications where case_id = $1", [caseId])).rows, []);

  const assignmentId = (await asUser(admin,
    "select public.staff_assign_case($1, $2) as id", [caseId, lawyer])).rows[0].id;
  const handedOffMessage = await sendMessage(caseId, "handed-off");
  await expectRecipients(`message:${handedOffMessage}`, caseId, "message", "messages", [lawyer]);
  const handedOffTask = await makeTask(caseId, "answer");
  const handedOffEvent = await respond(handedOffTask.id);
  await expectRecipients(`task-response:${handedOffEvent}`, caseId, "task_response", "tasks", [lawyer]);
  const handedOffAck = await makeTask(caseId, "acknowledge");
  const handedOffAckEvent = await acknowledge(handedOffAck);
  await expectRecipients(`task-acknowledged:${handedOffAckEvent}`, caseId, "task_response", "tasks", [lawyer]);

  await pg.query("update public.staff_members set active = false where user_id = $1", [lawyer]);
  const inactiveMessage = await sendMessage(caseId, "inactive");
  await expectRecipients(`message:${inactiveMessage}`, caseId, "message", "messages", [admin]);
  assert.deepEqual((await asUser(lawyer, "select id from public.messages where case_id = $1", [caseId])).rows, []);
  await pg.query("update public.staff_members set active = true where user_id = $1", [lawyer]);
  await asUser(admin, "select public.admin_revoke_case_assignment($1, 'Handoff ended')", [assignmentId]);
  const revokedMessage = await sendMessage(caseId, "revoked");
  await expectRecipients(`message:${revokedMessage}`, caseId, "message", "messages", [admin]);
  assert.deepEqual((await asUser(lawyer, "select id from public.messages where case_id = $1", [caseId])).rows, []);

  await pg.query("update public.staff_members set active = false where user_id = $1", [admin]);
  const noActiveAdminMessage = await sendMessage(caseId, "no-active-admin");
  await expectRecipients(`message:${noActiveAdminMessage}`, caseId, "message", "messages", []);
  await pg.query("update public.staff_members set active = true where user_id = $1", [admin]);

  const managerCase = (await asUser(manager,
    "select public.staff_create_case($1, $2, 'Manager-created case') as id",
    [clientCard, version])).rows[0].id;
  const managerMessage = await sendMessage(managerCase, "manager-case");
  await expectRecipients(`message:${managerMessage}`, managerCase, "message", "messages", [manager]);

  console.log("OK unassigned-case routing: admin fallback, handoff, active/revoked filtering, task events, access and deduplication");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await pg.close();
}
