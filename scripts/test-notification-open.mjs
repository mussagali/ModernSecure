import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { notificationHref, notificationActionLabel, notificationDestination } from "../lib/notification-links.ts";
import { taskEventLabel } from "../lib/task-event-label.ts";

const staff = "10000000-0000-4000-8000-000000000001";
const colleague = "10000000-0000-4000-8000-000000000002";
const noticeOne = "20000000-0000-4000-8000-000000000001";
const noticeTwo = "20000000-0000-4000-8000-000000000002";
const noticeOther = "20000000-0000-4000-8000-000000000003";
const db = new PGlite();

async function asUser(id, sql, params = []) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
  try { return await db.query(sql, params); }
  finally { await db.exec("reset role"); }
}

try {
  assert.equal(notificationHref(`/staff/chat?to=${colleague}`, "staff"), `/staff/chat?to=${colleague}`);
  assert.equal(notificationActionLabel(`/staff/chat?to=${colleague}`, "staff"), "Открыть диалог →");
  assert.equal(notificationHref(`/staff/chat?to=${colleague}`, "client"), "/account");
  assert.equal(notificationHref(`/staff/chat?to=${colleague}&next=https://evil.test`, "staff"), "/staff/cases");
  assert.equal(notificationHref("//evil.test", "staff"), "/staff/cases");
  assert.equal(notificationHref(`/account/cases/${colleague}/documents`, "client"), `/account/cases/${colleague}/documents`);
  assert.equal(notificationActionLabel(`/account/cases/${colleague}/documents`, "client"), "Открыть документы →");
  assert.equal(notificationHref(`/staff/cases/${colleague}/messages`, "staff"), `/staff/cases/${colleague}/messages`);
  const clientDocuments = `/account/cases/${colleague}/documents`;
  const clientTasks = `/account/cases/${colleague}/tasks`;
  assert.equal(notificationDestination({ target_path: `${clientTasks}#task-${noticeOne}`, kind: "task_cancelled", dedupe_key: `task-cancelled:${noticeOne}` }, "client"), `${clientTasks}#task-${noticeOne}`);
  assert.equal(notificationDestination({ target_path: `${clientDocuments}#request-${noticeOne}`, kind: "document_request_closed", dedupe_key: `document-request-closed:${noticeOne}` }, "client"), `${clientDocuments}#request-${noticeOne}`);
  assert.equal(notificationActionLabel(`${clientTasks}#task-${noticeOne}`, "client"), "Открыть задачи →");
  for (const path of [`${clientTasks}#request-${noticeOne}`, `${clientDocuments}#task-${noticeOne}`, `${clientTasks}#task-${noticeOne}?next=https://evil.test`]) assert.equal(notificationHref(path, "client"), "/account");
  assert.equal(notificationDestination({ target_path: clientDocuments, kind: "document_request",
    dedupe_key: `document-request:${noticeOne}` }, "client"), `${clientDocuments}#request-${noticeOne}`);
  assert.equal(notificationDestination({ target_path: clientDocuments, kind: "document_review",
    dedupe_key: `document-review:${noticeTwo}` }, "client"), `${clientDocuments}#file-${noticeTwo}`);
  assert.equal(notificationDestination({ target_path: clientTasks, kind: "task",
    dedupe_key: `task:${noticeOne}` }, "client"), `${clientTasks}#task-${noticeOne}`);
  assert.equal(notificationDestination({ target_path: clientTasks, kind: "task_review",
    dedupe_key: `task-review:${noticeOne}:${noticeTwo}` }, "client"), `${clientTasks}#task-${noticeOne}`);
  assert.equal(notificationDestination({ target_path: clientTasks, kind: "task_deadline",
    dedupe_key: `task-deadline:${noticeOne}:2026-10-12:today` }, "client"), `${clientTasks}#task-${noticeOne}`);
  assert.equal(notificationDestination({ target_path: clientTasks, kind: "task",
    dedupe_key: `task:${noticeOne}#evil` }, "client"), clientTasks);
  assert.equal(notificationDestination({ target_path: "//evil.test", kind: "document_review",
    dedupe_key: `document-review:${noticeTwo}` }, "client"), "/account");
  const staffDocuments = `/staff/cases/${colleague}/documents`;
  const staffTasks = `/staff/cases/${colleague}/tasks`;
  assert.equal(notificationDestination({ target_path: staffDocuments, kind: "document_submission",
    dedupe_key: `document-submitted:${noticeOne}` }, "staff", noticeTwo),
    `${staffDocuments}#request-${noticeTwo}`);
  assert.equal(notificationDestination({ target_path: staffTasks, kind: "task_response",
    dedupe_key: `task-response:${noticeOne}` }, "staff", noticeTwo),
    `${staffTasks}#task-${noticeTwo}`);
  assert.equal(notificationDestination({ target_path: staffTasks, kind: "task_response",
    dedupe_key: `task-acknowledged:${noticeOne}` }, "staff", noticeTwo),
    `${staffTasks}#task-${noticeTwo}`);
  assert.equal(notificationDestination({ target_path: staffTasks, kind: "task_response",
    dedupe_key: `task-response:${noticeOne}` }, "staff", "not-a-uuid"), staffTasks);
  assert.equal(notificationDestination({ target_path: "https://evil.test", kind: "document_submission",
    dedupe_key: `document-submitted:${noticeOne}` }, "staff", noticeTwo), "/staff/cases");
  assert.equal(notificationDestination({ target_path: staffDocuments, kind: "message",
    dedupe_key: `document-submitted:${noticeOne}` }, "staff", noticeTwo), staffDocuments);
  assert.equal(taskEventLabel("created", "staff"), "Задача создана");
  assert.equal(taskEventLabel("responded", "staff"), "Ответ клиента");
  assert.equal(taskEventLabel("responded", "client"), "Ваш ответ");
  assert.equal(taskEventLabel("cancelled", "client"), "Задача отменена");

  await db.exec(`
    create role authenticated;
    create role anon;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
    $$;
    create table public.notifications (
      id uuid primary key, recipient_user_id uuid not null, target_path text, read_at timestamptz
    );
    grant usage on schema auth, public to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
  await db.exec(readFileSync("supabase/migrations/20261012006400_open_notification.sql", "utf8"));
  await db.query(`insert into public.notifications (id, recipient_user_id, target_path) values
    ($1,$4,$5),($2,$4,$6),($3,$7,$8)`, [noticeOne, noticeTwo, noticeOther, staff,
    `/staff/chat?to=${colleague}`, `/staff/cases/${colleague}/tasks`, colleague, `/staff/chat?to=${staff}`]);
  const openSql = "select public.open_own_notification($1) as target";
  assert.equal((await asUser(staff, openSql, [noticeOne])).rows[0].target, `/staff/chat?to=${colleague}`);
  assert.equal((await asUser(staff, openSql, [noticeOther])).rows[0].target, null);
  const first = await db.query("select read_at from public.notifications where id=$1", [noticeOne]);
  assert.ok(first.rows[0].read_at);
  assert.equal((await asUser(staff, openSql, [noticeOne])).rows[0].target, `/staff/chat?to=${colleague}`);
  const after = await db.query("select id, read_at from public.notifications order by id");
  assert.equal(after.rows[0].read_at.getTime(), first.rows[0].read_at.getTime());
  assert.equal(after.rows[1].read_at, null);
  assert.equal(after.rows[2].read_at, null);
  assert.equal((await asUser(colleague, openSql, [noticeOther])).rows[0].target, `/staff/chat?to=${staff}`);
  console.log("OK notification links, one-at-a-time read state, idempotence and recipient isolation");
} finally {
  await db.close();
}
