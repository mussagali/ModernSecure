import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";

assert.equal(statSync(".env.local").mode & 0o077, 0);
assert.equal(statSync(".test-accounts.local.json").mode & 0o077, 0);
const env = readFileSync(".env.local", "utf8");
const value = (name) => env.split(/\r?\n/).find((line) => line.startsWith(`${name}=`))
  ?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, "");
const url = value("NEXT_PUBLIC_SUPABASE_URL");
const key = value("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
assert.equal(url, "https://bdkrihsiprkmukyjyspv.supabase.co");
const accounts = JSON.parse(readFileSync(".test-accounts.local.json", "utf8")).accounts;
const base = new URL(process.env.TEST_BASE_URL ?? "http://localhost:3001");
assert.equal(base.protocol, "http:");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));

async function session(account) {
  const jar = new Map();
  const supabase = createServerClient(url, key, { cookies: {
    getAll: () => [...jar].map(([name, cookieValue]) => ({ name, value: cookieValue })),
    setAll: (items) => {
      for (const item of items) {
        if (item.options?.maxAge === 0) jar.delete(item.name);
        else jar.set(item.name, item.value);
      }
    },
  } });
  const login = await supabase.auth.signInWithPassword({ email: account.email, password: account.password });
  assert.ifError(login.error);
  assert.equal(login.data.user?.id, account.id);
  return { supabase, jar };
}

function cookie(jar) {
  return [...jar].map(([name, cookieValue]) => `${name}=${cookieValue}`).join("; ");
}

const lawyer = await session(accounts.lawyer);
const manager = await session(accounts.manager);
try {
  const { data: lawyerAssignments, error: lawyerError } = await lawyer.supabase
    .from("case_assignments").select("case_id").eq("staff_user_id", accounts.lawyer.id).is("revoked_at", null);
  assert.ifError(lawyerError);
  const { data: managerAssignments, error: managerError } = await manager.supabase
    .from("case_assignments").select("case_id").eq("staff_user_id", accounts.manager.id).is("revoked_at", null);
  assert.ifError(managerError);
  const managerCaseIds = new Set((managerAssignments ?? []).map((row) => row.case_id));
  const caseId = (lawyerAssignments ?? []).find((row) => managerCaseIds.has(row.case_id))?.case_id;
  assert.ok(caseId, "QA lawyer and manager need a shared case");
  const { data: caseRow, error: caseError } = await lawyer.supabase
    .from("cases").select("case_number, title").eq("id", caseId).single();
  assert.ifError(caseError);

  const caseResponse = await fetch(new URL(`/staff/cases/${caseId}`, base),
    { headers: { cookie: cookie(lawyer.jar) }, redirect: "manual" });
  assert.equal(caseResponse.status, 200, "QA lawyer cannot open case page");
  const caseHtml = await caseResponse.text();
  const chatHref = `/staff/chat?to=${accounts.manager.id}&amp;fromCase=${caseId}`;
  assert.ok(caseHtml.includes(chatHref), "Shared case has no link to manager chat");

  const chatPath = `/staff/chat?to=${accounts.manager.id}&fromCase=${caseId}`;
  const chatResponse = await fetch(new URL(chatPath, base),
    { headers: { cookie: cookie(lawyer.jar) }, redirect: "manual" });
  assert.equal(chatResponse.status, 200, "QA lawyer cannot open case-scoped chat");
  const chatHtml = (await chatResponse.text()).replaceAll("<!-- -->", "");
  assert.ok(chatHtml.includes(`Новые сообщения будут связаны с делом № ${caseRow.case_number}`),
    "Case context is missing in chat composer");

  const opened = await lawyer.supabase.rpc("staff_open_thread", { p_recipient_user_id: accounts.manager.id });
  assert.ifError(opened.error);
  assert.ok(opened.data);
  const permission = await lawyer.supabase.rpc("staff_can_reference_case",
    { p_thread_id: opened.data, p_case_id: caseId });
  assert.ifError(permission.error);
  assert.equal(permission.data, true);

  const idempotencyKey = "61e36d92-5d70-4f47-8eea-4d1f16789012";
  const body = "QA — проверка связи личного чата с делом";
  const sent = await lawyer.supabase.rpc("staff_send_case_message", {
    p_thread_id: opened.data, p_body: body, p_idempotency_key: idempotencyKey, p_case_id: caseId,
  });
  assert.ifError(sent.error);
  assert.ok(sent.data);
  const retried = await lawyer.supabase.rpc("staff_send_case_message", {
    p_thread_id: opened.data, p_body: body, p_idempotency_key: idempotencyKey, p_case_id: caseId,
  });
  assert.ifError(retried.error);
  assert.equal(retried.data, sent.data, "Retry created a duplicate message");

  const { data: ref, error: refError } = await manager.supabase.from("staff_message_case_refs")
    .select("case_id").eq("message_id", sent.data).single();
  assert.ifError(refError);
  assert.equal(ref.case_id, caseId, "Recipient cannot read the case link");
  const recipientResponse = await fetch(new URL(`/staff/chat?to=${accounts.lawyer.id}`, base),
    { headers: { cookie: cookie(manager.jar) }, redirect: "manual" });
  assert.equal(recipientResponse.status, 200, "QA manager cannot open recipient chat");
  const recipientHtml = (await recipientResponse.text()).replaceAll("<!-- -->", "");
  assert.ok(recipientHtml.includes(body), "Recipient page has no message body");
  assert.ok(recipientHtml.includes(`Дело № ${caseRow.case_number}`), "Recipient page has no case card");
  assert.ok(recipientHtml.includes(`href="/staff/cases/${caseId}"`), "Recipient cannot return to case");
  const lawyerOnlyCaseId = (lawyerAssignments ?? []).find((row) => !managerCaseIds.has(row.case_id))?.case_id;
  if (lawyerOnlyCaseId) {
    const denied = await lawyer.supabase.rpc("staff_can_reference_case",
      { p_thread_id: opened.data, p_case_id: lawyerOnlyCaseId });
    assert.ifError(denied.error);
    assert.equal(denied.data, false, "Unassigned recipient can reference lawyer-only case");
    const deniedResponse = await fetch(new URL(`/staff/chat?to=${accounts.manager.id}&fromCase=${lawyerOnlyCaseId}`, base),
      { headers: { cookie: cookie(lawyer.jar) }, redirect: "manual" });
    assert.equal(deniedResponse.status, 200);
    assert.ok(!(await deniedResponse.text()).includes("Новые сообщения будут связаны с делом"),
      "Chat composer shows a case that the recipient cannot access");
  }
  console.log(`OK live staff case chat: ${caseRow.case_number}, sender and recipient, idempotent case link`);
} finally {
  await Promise.all([lawyer.supabase.auth.signOut(), manager.supabase.auth.signOut()]);
}
