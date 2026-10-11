import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

function secret(file, name) {
  assert.equal(statSync(file).mode & 0o077, 0, `${file} must be private`);
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((part) => part.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, "");
}

const url = secret(".env.local", "NEXT_PUBLIC_SUPABASE_URL");
const publicKey = secret(".env.local", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const service = secret(".env.local", "SUPABASE_SECRET_KEY");
assert.equal(url, "https://bdkrihsiprkmukyjyspv.supabase.co");
const qa = JSON.parse(readFileSync(".test-accounts.local.json", "utf8")).accounts.client;
assert.equal(qa.email, "qa-client-modernsecure@example.test");
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const cookies = new Map();
const browser = createServerClient(url, publicKey, {
  cookies: {
    getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
    setAll: (entries) => entries.forEach(({ name, value }) => cookies.set(name, value)),
  },
  auth: { autoRefreshToken: false },
});

const signedIn = await browser.auth.signInWithPassword({ email: qa.email, password: qa.password });
assert.ifError(signedIn.error);
assert.equal(signedIn.data.user?.id, qa.id);
const direct = await browser.rpc("server_record_file_access", {
  p_actor_user_id: qa.id,
  p_entity_type: "contract",
  p_entity_id: "00000000-0000-4000-8000-000000000000",
  p_action: "download_issued",
});
assert.ok(direct.error, "Browser must not be able to call the server-only audit RPC");

const { data: qaCase, error: caseError } = await admin.from("cases")
  .select("id").eq("case_number", "MS-2026-000005").single();
assert.ifError(caseError);
const { data: requests, error: requestError } = await admin.from("document_requests")
  .select("id").eq("case_id", qaCase.id);
assert.ifError(requestError);
assert.ok(requests.length);
const { data: documents, error: documentError } = await admin.from("document_files")
  .select("id").in("request_id", requests.map((item) => item.id)).eq("status", "accepted").limit(1);
assert.ifError(documentError);
const { data: contracts, error: contractError } = await admin.from("contracts")
  .select("id").eq("case_id", qaCase.id).limit(1);
assert.ifError(contractError);
const { data: receipts, error: receiptError } = await admin.from("payment_receipts")
  .select("id").eq("case_id", qaCase.id).limit(1);
assert.ifError(receiptError);
assert.ok(documents.length && contracts.length && receipts.length, "QA case needs accepted document, contract and receipt");

const tests = [
  ["document_file", `/api/document-files/${documents[0].id}`, documents[0].id],
  ["contract", `/api/contracts/${contracts[0].id}`, contracts[0].id],
  ["payment_receipt", `/api/payment-receipts/${receipts[0].id}`, receipts[0].id],
];
const base = "http://localhost:3000";
const cookieHeader = (jar) => [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
const start = new Date().toISOString();
let qaContractBytes;
for (const [type, path, id] of tests) {
  const anonymous = await fetch(base + path, { cache: "no-store" });
  assert.equal(anonymous.status, 401, `${type}: anonymous access`);
  const response = await fetch(base + path, { headers: { cookie: cookieHeader(cookies) }, cache: "no-store" });
  assert.equal(response.status, 200, `${type}: authenticated download`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.byteLength > 0);
  if (type === "contract") qaContractBytes = bytes;
  assert.match(response.headers.get("content-disposition") ?? "", /^attachment/);
  const { data: events, error } = await admin.from("audit_events")
    .select("actor_user_id, case_id, entity_type, action")
    .eq("actor_user_id", qa.id).eq("entity_id", id)
    .eq("action", "download_issued").gte("occurred_at", start);
  assert.ifError(error);
  assert.equal(events.length, 1, `${type}: exactly one new audit event`);
  assert.equal(events[0].case_id, qaCase.id);
  assert.equal(events[0].entity_type, type);
}
const preview = await fetch(base + tests[1][1] + "?preview=1", {
  headers: { cookie: cookieHeader(cookies) }, cache: "no-store",
});
assert.equal(preview.status, 200);
assert.match(preview.headers.get("content-disposition") ?? "", /^inline/);
const { data: previewEvents, error: previewError } = await admin.from("audit_events")
  .select("id").eq("actor_user_id", qa.id).eq("entity_id", contracts[0].id)
  .eq("action", "preview_issued").gte("occurred_at", start);
assert.ifError(previewError);
assert.equal(previewEvents.length, 1);

const lawyer = JSON.parse(readFileSync(".test-accounts.local.json", "utf8")).accounts.lawyer;
assert.equal(lawyer.email, "qa-lawyer-modernsecure@example.test");
const staffCookies = new Map();
const staffBrowser = createServerClient(url, publicKey, {
  cookies: {
    getAll: () => [...staffCookies].map(([name, value]) => ({ name, value })),
    setAll: (entries) => entries.forEach(({ name, value }) => staffCookies.set(name, value)),
  },
  auth: { autoRefreshToken: false },
});
const staffSignIn = await staffBrowser.auth.signInWithPassword({
  email: lawyer.email, password: lawyer.password,
});
assert.ifError(staffSignIn.error);
assert.equal(staffSignIn.data.user?.id, lawyer.id);
const { data: messages, error: messageError } = await admin.from("messages")
  .select("id").eq("case_id", qaCase.id);
assert.ifError(messageError);
let { data: caseAttachments, error: attachmentError } = await admin.from("message_attachments")
  .select("id").in("message_id", messages.map((item) => item.id)).limit(1);
assert.ifError(attachmentError);
let caseAttachmentCaseId = qaCase.id;
if (!caseAttachments.length && process.argv.includes("--seed-case-attachment")) {
  assert.equal(secret(".env.local", "APP_ORIGIN"), base);
  const form = new FormData();
  form.set("caseId", qaCase.id);
  form.set("key", randomUUID());
  form.set("body", "ТЕСТ — проверка журнала скачивания вложения");
  form.set("view", "client");
  form.append("files", new File([qaContractBytes], "qa-file-access-audit.pdf", { type: "application/pdf" }));
  const sent = await fetch(base + "/api/message-attachments", {
    method: "POST", body: form,
    headers: { origin: base, accept: "application/json", cookie: cookieHeader(cookies) },
  });
  assert.equal(sent.status, 200, "QA attachment creation must succeed");
  assert.equal((await sent.json()).ok, true);
  const { data: newMessages, error: newMessageError } = await admin.from("messages")
    .select("id").eq("case_id", qaCase.id);
  assert.ifError(newMessageError);
  const { data: newAttachments, error: newAttachmentError } = await admin.from("message_attachments")
    .select("id").in("message_id", newMessages.map((item) => item.id)).limit(1);
  assert.ifError(newAttachmentError);
  assert.equal(newAttachments.length, 1);
  caseAttachments = newAttachments;
  console.log("Created one explicitly marked QA case-message attachment");
}
if (!caseAttachments.length) {
  const { data: candidates, error: candidateError } = await admin.from("message_attachments")
    .select("id,message_id").limit(100);
  assert.ifError(candidateError);
  if (candidates.length) {
    const { data: candidateMessages, error: candidateMessageError } = await admin.from("messages")
      .select("id,case_id").in("id", candidates.map((item) => item.message_id));
    assert.ifError(candidateMessageError);
    const { data: assignments, error: assignmentError } = await admin.from("case_assignments")
      .select("case_id").eq("staff_user_id", lawyer.id).is("revoked_at", null);
    assert.ifError(assignmentError);
    const assigned = new Set(assignments.map((item) => item.case_id));
    const candidate = candidates.find((item) => {
      const message = candidateMessages.find((row) => row.id === item.message_id);
      return message && assigned.has(message.case_id);
    });
    if (candidate) {
      caseAttachments = [candidate];
      caseAttachmentCaseId = candidateMessages.find((item) => item.id === candidate.message_id).case_id;
    }
  }
}
const { data: staffMessages, error: staffMessageError } = await admin.from("staff_messages")
  .select("id,thread_id").eq("sender_user_id", lawyer.id);
assert.ifError(staffMessageError);
const { data: staffAttachments, error: staffAttachmentError } = await admin.from("staff_message_attachments")
  .select("id,message_id").in("message_id", staffMessages.map((item) => item.id)).limit(1);
assert.ifError(staffAttachmentError);
const staffTests = [];
if (caseAttachments.length) staffTests.push([
  "message_attachment", `/api/message-attachments/${caseAttachments[0].id}`,
  caseAttachments[0].id, caseAttachmentCaseId,
]);
if (staffAttachments.length) staffTests.push([
  "staff_message_attachment", `/api/staff-message-attachments/${staffAttachments[0].id}`,
  staffAttachments[0].id, null,
]);
for (const [type, path, id, caseId] of staffTests) {
  const anonymous = await fetch(base + path, { cache: "no-store" });
  assert.equal(anonymous.status, 401);
  if (type === "staff_message_attachment") {
    const wrongRole = await fetch(base + path, {
      headers: { cookie: cookieHeader(cookies) }, cache: "no-store",
    });
    assert.equal(wrongRole.status, 404, "Client must not read staff chat attachments");
  }
  const response = await fetch(base + path, {
    headers: { cookie: cookieHeader(staffCookies) }, cache: "no-store",
  });
  assert.equal(response.status, 200, `${type}: authenticated download`);
  assert.ok((await response.arrayBuffer()).byteLength > 0);
  const { data: events, error } = await admin.from("audit_events")
    .select("case_id, entity_type, action, after_data")
    .eq("actor_user_id", lawyer.id).eq("entity_id", id)
    .eq("action", "download_issued").gte("occurred_at", start);
  assert.ifError(error);
  assert.equal(events.length, 1, `${type}: exactly one new audit event`);
  assert.equal(events[0].entity_type, type);
  assert.equal(events[0].case_id, caseId);
  if (type === "staff_message_attachment") assert.ok(events[0].after_data?.thread_id);
  if (type === "staff_message_attachment") {
    const { data: blockedEvents, error: blockedError } = await admin.from("audit_events")
      .select("id").eq("actor_user_id", qa.id).eq("entity_id", id)
      .gte("occurred_at", start);
    assert.ifError(blockedError);
    assert.equal(blockedEvents.length, 0, "Denied access must not create a successful-download event");
  }
}
console.log(`OK live file routes: anonymous denied, ${tests.length + staffTests.length} QA file types downloaded and logged; preview logged separately`);
if (!caseAttachments.length) console.log("SKIP live case-message attachment: no attachment on an assigned QA case");
if (!staffAttachments.length) console.log("SKIP live staff-message attachment: QA lawyer has no attachment");
