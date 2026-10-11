"use server";

import { redirect } from "next/navigation";
import { requireClientCase, uuidPattern } from "../../../../lib/client-case";
import { taskAcknowledgmentVersion } from "../../../../lib/task-acknowledgment";

function field(data: FormData, name: string) {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function respondToTask(data: FormData) {
  const caseId = field(data, "caseId");
  const taskId = field(data, "taskId");
  const response = field(data, "response");
  if (!uuidPattern.test(caseId)) redirect("/account");
  const { supabase } = await requireClientCase(caseId);
  if (!uuidPattern.test(taskId) || !response || response.length > 2000) redirect(`/account/cases/${caseId}/tasks?error=invalid`);
  const { data: task, error: taskError } = await supabase.from("tasks").select("case_id, kind").eq("id", taskId).maybeSingle();
  if (taskError || !task || task.case_id !== caseId || task.kind === "acknowledge") redirect(`/account/cases/${caseId}/tasks?error=invalid`);
  const { error } = await supabase.rpc("client_respond_task", { p_task_id: taskId, p_response: response });
  if (error) redirect(`/account/cases/${caseId}/tasks?error=respond`);
  redirect(`/account/cases/${caseId}/tasks?sent=1`);
}

export async function acknowledgeTask(data: FormData) {
  const caseId = field(data, "caseId");
  const taskId = field(data, "taskId");
  const expectedVersion = field(data, "expectedVersion");
  if (!uuidPattern.test(caseId)) redirect("/account");
  const { supabase } = await requireClientCase(caseId);
  if (!uuidPattern.test(taskId) || !/^[0-9a-f]{64}$/.test(expectedVersion) || data.get("confirmed") !== "on") {
    redirect(`/account/cases/${caseId}/tasks?error=invalid`);
  }
  const { data: task, error: taskError } = await supabase.from("tasks")
    .select("case_id, kind, title, description, status").eq("id", taskId).maybeSingle();
  if (taskError || !task || task.case_id !== caseId || task.kind !== "acknowledge") {
    redirect(`/account/cases/${caseId}/tasks?error=invalid`);
  }
  if (task.status !== "new" || taskAcknowledgmentVersion(task) !== expectedVersion) {
    redirect(`/account/cases/${caseId}/tasks?error=stale`);
  }
  const { error } = await supabase.rpc("client_acknowledge_task", {
    p_task_id: taskId, p_expected_version: expectedVersion,
  });
  if (error) redirect(`/account/cases/${caseId}/tasks?error=acknowledge`);
  redirect(`/account/cases/${caseId}/tasks?acknowledged=1`);
}

export async function sendClientMessage(data: FormData) {
  const caseId = field(data, "caseId");
  const body = field(data, "body");
  const key = field(data, "key");
  if (!uuidPattern.test(caseId)) redirect("/account");
  const { supabase } = await requireClientCase(caseId);
  if (!body || body.length > 4000 || !uuidPattern.test(key)) redirect(`/account/cases/${caseId}/messages?error=invalid`);
  const { error } = await supabase.rpc("post_case_message", { p_case_id: caseId, p_body: body, p_idempotency_key: key });
  if (error?.message === "Message rate limit exceeded") redirect(`/account/cases/${caseId}/messages?error=rate`);
  if (error) redirect(`/account/cases/${caseId}/messages?error=send`);
  redirect(`/account/cases/${caseId}/messages?sent=1`);
}

export async function markClientMessagesRead(data: FormData) {
  const caseId = field(data, "caseId");
  if (!uuidPattern.test(caseId)) redirect("/account");
  const { supabase } = await requireClientCase(caseId);
  const { error } = await supabase.rpc("mark_case_messages_read", { p_case_id: caseId });
  if (error) redirect(`/account/cases/${caseId}/messages?error=read`);
  redirect(`/account/cases/${caseId}/messages`);
}

export async function markClientNotificationsRead(data: FormData) {
  const caseId = field(data, "caseId");
  if (!uuidPattern.test(caseId)) redirect("/account");
  const { supabase } = await requireClientCase(caseId);
  const { error } = await supabase.rpc("mark_case_notifications_read", { p_case_id: caseId });
  if (error) redirect(`/account/cases/${caseId}?error=read`);
  redirect(`/account/cases/${caseId}`);
}
