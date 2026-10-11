"use server";

import { redirect } from "next/navigation";
import { requireStaff } from "../../lib/staff";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function value(formData: FormData, key: string) {
  const item = formData.get(key);
  return typeof item === "string" ? item.trim() : "";
}

function serviceDocuments(formData: FormData) {
  const raw = value(formData, "documents");
  if (raw.length > 50000) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length > 20) return null;
  const documents: Array<{ title: string; instructions: string; required: boolean }> = [];
  const titles = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (typeof row.title !== "string" || typeof row.instructions !== "string" || typeof row.required !== "boolean") return null;
    const title = row.title.trim();
    const instructions = row.instructions.trim();
    if (!title || title.length > 180 || instructions.length > 2000 || titles.has(title.toLowerCase())) return null;
    titles.add(title.toLowerCase());
    documents.push({ title, instructions, required: row.required });
  }
  return documents;
}

function serviceStages(formData: FormData) {
  const stages = value(formData, "stages").split(/\r?\n/).map((stage) => stage.trim()).filter(Boolean);
  if (stages.length < 1 || stages.length > 12 || stages.some((stage) => stage.length > 120)
    || new Set(stages.map((stage) => stage.toLowerCase())).size !== stages.length) return null;
  return stages;
}

export async function createClientCard(formData: FormData) {
  const { supabase } = await requireStaff(["manager", "admin"]);
  const fullName = value(formData, "fullName");
  const email = value(formData, "email");
  const phone = value(formData, "phone");
  const city = value(formData, "city");
  if (!fullName || fullName.length > 160 || email.length > 254 || phone.length > 40 || city.length > 120 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    redirect("/staff/clients?error=invalid");
  }
  const { error } = await supabase.rpc("staff_create_client", {
    p_full_name: fullName, p_email: email || null, p_phone: phone || null, p_city: city || null,
  });
  if (error) redirect("/staff/clients?error=create");
  redirect("/staff/clients?created=1");
}

export async function linkClientAccount(formData: FormData) {
  const { supabase } = await requireStaff(["manager", "admin"]);
  const clientId = value(formData, "clientId");
  const email = value(formData, "email");
  if (!uuidPattern.test(clientId) || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect("/staff/clients?error=invalid");
  }
  const { error } = await supabase.rpc("link_client_account", { p_client_id: clientId, p_email: email });
  if (error?.message === "Account is already staff") redirect("/staff/clients?error=staff");
  if (error?.message === "Account email must match client card") redirect("/staff/clients?error=email-mismatch");
  if (error) redirect("/staff/clients?error=link");
  redirect("/staff/clients?linked=1");
}

export async function createService(formData: FormData) {
  const { supabase } = await requireStaff(["admin"]);
  const name = value(formData, "name");
  const stages = serviceStages(formData);
  const documents = serviceDocuments(formData);
  if (!name || name.length > 160 || !stages || !documents) {
    redirect("/staff/services?error=invalid");
  }
  const { error } = await supabase.rpc("admin_create_service_with_documents", {
    p_name: name, p_stages: stages, p_documents: documents,
  });
  if (error) redirect("/staff/services?error=create");
  redirect("/staff/services?created=1");
}

export async function publishServiceVersion(formData: FormData) {
  const { supabase } = await requireStaff(["admin"]);
  const serviceId = value(formData, "serviceId");
  const expectedVersionId = value(formData, "expectedVersionId");
  const stages = serviceStages(formData);
  const documents = serviceDocuments(formData);
  if (!uuidPattern.test(serviceId) || !uuidPattern.test(expectedVersionId) || !stages || !documents) redirect("/staff/services?error=invalid");
  const { error } = await supabase.rpc("admin_publish_service_version", {
    p_service_id: serviceId, p_expected_version_id: expectedVersionId,
    p_stages: stages, p_documents: documents,
  });
  if (error?.message === "Service version changed by another user") redirect(`/staff/services/${serviceId}?error=stale`);
  if (error) redirect(`/staff/services/${serviceId}?error=publish`);
  redirect(`/staff/services/${serviceId}?published=1`);
}

export async function createCase(formData: FormData) {
  const { supabase } = await requireStaff(["manager", "admin"]);
  const clientId = value(formData, "clientId");
  const versionId = value(formData, "versionId");
  const title = value(formData, "title");
  if (!uuidPattern.test(clientId) || !uuidPattern.test(versionId) || !title || title.length > 180) {
    redirect("/staff/cases?error=invalid");
  }
  const { data, error } = await supabase.rpc("staff_create_case", {
    p_client_id: clientId, p_version_id: versionId, p_title: title,
  });
  if (error?.message === "Service version is outdated" || error?.message === "Service is inactive") {
    redirect("/staff/cases?error=version");
  }
  if (error || typeof data !== "string") redirect("/staff/cases?error=create");
  redirect(`/staff/cases/${data}?created=1`);
}

export async function changeCaseStage(formData: FormData) {
  const { supabase } = await requireStaff();
  const caseId = value(formData, "caseId");
  const expectedStageId = value(formData, "expectedStageId");
  const toStageId = value(formData, "toStageId");
  const clientNote = value(formData, "clientNote");
  const changeReason = value(formData, "changeReason");
  if (!uuidPattern.test(caseId) || !uuidPattern.test(toStageId) || (expectedStageId && !uuidPattern.test(expectedStageId)) || !clientNote || clientNote.length > 2000 || changeReason.length > 1000) {
    redirect("/staff/cases?error=invalid");
  }
  const { error } = await supabase.rpc("staff_change_case_stage", {
    p_case_id: caseId,
    p_expected_stage_id: expectedStageId || null,
    p_to_stage_id: toStageId,
    p_client_note: clientNote,
    p_change_reason: changeReason || null,
  });
  if (error) redirect(`/staff/cases/${caseId}?error=stage`);
  redirect(`/staff/cases/${caseId}?updated=1`);
}

export async function suspendCase(formData: FormData) {
  const { supabase } = await requireStaff(["lawyer", "admin"]);
  const caseId = value(formData, "caseId");
  const reason = value(formData, "reason");
  const controlAt = value(formData, "controlAt");
  if (!uuidPattern.test(caseId) || !reason || reason.length > 2000
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(controlAt)) redirect("/staff/cases?error=invalid");
  const controlDate = new Date(`${controlAt}:00+05:00`);
  const exactLocalTime = !Number.isNaN(controlDate.getTime())
    && new Date(controlDate.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 16) === controlAt;
  if (!exactLocalTime || controlDate.getTime() <= Date.now()) {
    redirect(`/staff/cases/${caseId}?error=suspend`);
  }
  const { error } = await supabase.rpc("staff_suspend_case", {
    p_case_id: caseId, p_reason_for_client: reason, p_control_at: controlDate.toISOString(),
  });
  if (error) redirect(`/staff/cases/${caseId}?error=suspend`);
  redirect(`/staff/cases/${caseId}?suspended=1`);
}

export async function resumeCase(formData: FormData) {
  const { supabase } = await requireStaff(["lawyer", "admin"]);
  const caseId = value(formData, "caseId");
  if (!uuidPattern.test(caseId)) redirect("/staff/cases?error=invalid");
  const { error } = await supabase.rpc("staff_resume_case", { p_case_id: caseId });
  if (error) redirect(`/staff/cases/${caseId}?error=resume`);
  redirect(`/staff/cases/${caseId}?resumed=1`);
}

export async function closeCase(formData: FormData) {
  const { supabase } = await requireStaff(["lawyer", "admin"]);
  const caseId = value(formData, "caseId");
  const result = value(formData, "result");
  if (!uuidPattern.test(caseId) || !result || result.length > 4000) redirect("/staff/cases?error=invalid");
  const { error } = await supabase.rpc("staff_close_case", { p_case_id: caseId, p_result_summary: result });
  if (error?.message === "Required documents are not accepted") redirect(`/staff/cases/${caseId}?error=required-documents`);
  if (error) redirect(`/staff/cases/${caseId}?error=close`);
  redirect(`/staff/cases/${caseId}?closed=1`);
}

export async function assignCase(formData: FormData) {
  const { supabase } = await requireStaff(["admin"]);
  const caseId = value(formData, "caseId");
  const staffUserId = value(formData, "staffUserId");
  if (!uuidPattern.test(caseId) || !uuidPattern.test(staffUserId)) redirect("/staff/cases?error=invalid");
  const { error } = await supabase.rpc("staff_assign_case", { p_case_id: caseId, p_staff_user_id: staffUserId });
  if (error) redirect(`/staff/cases/${caseId}?error=assignment`);
  redirect(`/staff/cases/${caseId}?assigned=1`);
}

export async function createTask(formData: FormData) {
  const { supabase } = await requireStaff();
  const caseId = value(formData, "caseId");
  const title = value(formData, "title");
  const description = value(formData, "description");
  const kind = value(formData, "kind");
  const dueAt = value(formData, "dueAt");
  if (!uuidPattern.test(caseId)) redirect("/staff/cases?error=invalid");
  if (!title || title.length > 180 || description.length > 2000 || (kind === "acknowledge" && !description) || !["answer", "acknowledge", "contact"].includes(kind) || (dueAt && Number.isNaN(Date.parse(dueAt)))) redirect(`/staff/cases/${caseId}/tasks?error=invalid`);
  const { error } = await supabase.rpc("staff_create_task", { p_case_id: caseId, p_kind: kind, p_title: title, p_description: description || null, p_due_at: dueAt ? new Date(dueAt).toISOString() : null });
  if (error) redirect(`/staff/cases/${caseId}/tasks?error=create`);
  redirect(`/staff/cases/${caseId}/tasks?created=1`);
}

export async function reviewTask(formData: FormData) {
  const { supabase } = await requireStaff();
  const caseId = value(formData, "caseId");
  const taskId = value(formData, "taskId");
  const decision = value(formData, "decision");
  const note = value(formData, "note");
  if (!uuidPattern.test(caseId) || !uuidPattern.test(taskId) || !["accept", "return"].includes(decision) || note.length > 2000 || (decision === "return" && !note)) redirect("/staff/cases?error=invalid");
  const { error } = await supabase.rpc("staff_review_task", { p_task_id: taskId, p_accept: decision === "accept", p_note: note || null });
  if (error) redirect(`/staff/cases/${caseId}/tasks?error=review`);
  redirect(`/staff/cases/${caseId}/tasks?reviewed=1`);
}

export async function createDocumentRequest(formData: FormData) {
  const { supabase } = await requireStaff();
  const caseId = value(formData, "caseId");
  const title = value(formData, "title");
  const instructions = value(formData, "instructions");
  const dueAt = value(formData, "dueAt");
  if (!uuidPattern.test(caseId) || !title || title.length > 180 || instructions.length > 2000 || (dueAt && Number.isNaN(Date.parse(dueAt)))) redirect("/staff/cases?error=invalid");
  const { error } = await supabase.rpc("staff_create_document_request", { p_case_id: caseId, p_title: title, p_instructions: instructions || null, p_required: formData.get("required") === "on", p_due_at: dueAt ? new Date(dueAt).toISOString() : null });
  if (error) redirect(`/staff/cases/${caseId}/documents?error=create`);
  redirect(`/staff/cases/${caseId}/documents?created=1`);
}

export async function reviewDocumentFile(formData: FormData) {
  const { supabase } = await requireStaff(["lawyer", "admin"]);
  const caseId = value(formData, "caseId");
  const fileId = value(formData, "fileId");
  const decision = value(formData, "decision");
  const reason = value(formData, "reason");
  if (!uuidPattern.test(caseId) || !uuidPattern.test(fileId)
    || !["accept", "return"].includes(decision) || (decision === "return" && !reason)
    || reason.length > 1000) redirect("/staff/cases?error=invalid");
  const { error } = await supabase.rpc("staff_review_document_file", {
    p_file_id: fileId, p_accept: decision === "accept", p_reason: reason || null,
  });
  if (error) redirect(`/staff/cases/${caseId}/documents?error=review`);
  redirect(`/staff/cases/${caseId}/documents?reviewed=1`);
}

export async function sendStaffMessage(formData: FormData) {
  const { supabase } = await requireStaff();
  const caseId = value(formData, "caseId");
  const body = value(formData, "body");
  const key = value(formData, "key");
  if (!uuidPattern.test(caseId) || !uuidPattern.test(key) || !body || body.length > 4000) redirect("/staff/cases?error=invalid");
  const { error } = await supabase.rpc("post_case_message", { p_case_id: caseId, p_body: body, p_idempotency_key: key });
  if (error?.message === "Message rate limit exceeded") redirect(`/staff/cases/${caseId}/messages?error=rate`);
  if (error) redirect(`/staff/cases/${caseId}/messages?error=send`);
  redirect(`/staff/cases/${caseId}/messages?sent=1`);
}

export async function markStaffMessagesRead(formData: FormData) {
  const { supabase } = await requireStaff();
  const caseId = value(formData, "caseId");
  if (!uuidPattern.test(caseId)) redirect("/staff/cases");
  const { error } = await supabase.rpc("mark_case_messages_read", { p_case_id: caseId });
  if (error) redirect(`/staff/cases/${caseId}/messages?error=read`);
  redirect(`/staff/cases/${caseId}/messages`);
}

export async function addStaffMember(formData: FormData) {
  const { supabase } = await requireStaff(["admin"]);
  const email = value(formData, "email").toLowerCase();
  const displayName = value(formData, "displayName");
  const role = value(formData, "role");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !displayName || displayName.length > 160 || !["lawyer", "manager"].includes(role)) redirect("/staff/team?error=invalid");
  const { data, error } = await supabase.rpc("admin_invite_staff", { p_email: email, p_display_name: displayName, p_role: role });
  if (error?.message === "Account already has a role") redirect("/staff/team?error=assigned");
  if (error || (data !== "pending" && data !== "granted")) redirect("/staff/team?error=invite");
  redirect(`/staff/team?invited=${data}`);
}

export async function cancelStaffInvitation(formData: FormData) {
  const { supabase } = await requireStaff(["admin"]);
  const inviteId = value(formData, "inviteId");
  if (!uuidPattern.test(inviteId)) redirect("/staff/team?error=invalid");
  const { error } = await supabase.rpc("admin_cancel_staff_invite", { p_invite_id: inviteId });
  if (error) redirect("/staff/team?error=cancel");
  redirect("/staff/team?cancelled=1");
}

export async function changeStaffAccess(formData: FormData) {
  const { supabase } = await requireStaff(["admin"]);
  const staffUserId = value(formData, "staffUserId");
  const role = value(formData, "role");
  const active = value(formData, "active");
  const reason = value(formData, "reason");
  if (!uuidPattern.test(staffUserId) || !["lawyer", "manager"].includes(role) || !["true", "false"].includes(active) || !reason || reason.length > 500) redirect("/staff/team?error=invalid");
  const { data: current, error: lookupError } = await supabase.from("staff_members")
    .select("role, active").eq("user_id", staffUserId).maybeSingle();
  if (lookupError) redirect("/staff/team?error=access");
  if (current && current.role === role && current.active === (active === "true")) redirect("/staff/team?unchanged=1");
  const { error } = await supabase.rpc("admin_set_staff_access", { p_staff_user_id: staffUserId, p_role: role, p_active: active === "true", p_reason: reason });
  if (error?.message === "Access is unchanged") redirect("/staff/team?unchanged=1");
  if (error) redirect("/staff/team?error=access");
  redirect("/staff/team?changed=1");
}

export async function setPaymentPermission(formData: FormData) {
  const { supabase } = await requireStaff(["admin"]);
  const staffUserId = value(formData, "staffUserId");
  const allowed = value(formData, "allowed");
  const reason = value(formData, "reason");
  if (!uuidPattern.test(staffUserId) || !["true", "false"].includes(allowed)
    || !reason || reason.length > 500) redirect("/staff/team?error=invalid");
  const { error } = await supabase.rpc("admin_set_payment_permission", {
    p_staff_user_id: staffUserId, p_allowed: allowed === "true", p_reason: reason,
  });
  if (error) redirect("/staff/team?error=finance");
  redirect("/staff/team?financeChanged=1");
}

export async function revokeCaseAssignment(formData: FormData) {
  const { supabase } = await requireStaff(["admin"]);
  const caseId = value(formData, "caseId");
  const assignmentId = value(formData, "assignmentId");
  const reason = value(formData, "reason");
  if (!uuidPattern.test(caseId) || !uuidPattern.test(assignmentId) || !reason || reason.length > 500) redirect("/staff/cases?error=invalid");
  const { error } = await supabase.rpc("admin_revoke_case_assignment", { p_assignment_id: assignmentId, p_reason: reason });
  if (error) redirect(`/staff/cases/${caseId}?error=revoke`);
  redirect(`/staff/cases/${caseId}?revoked=1`);
}
