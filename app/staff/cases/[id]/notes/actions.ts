"use server";

import { redirect } from "next/navigation";
import { requireStaffCase } from "../../../../../lib/staff-case";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function addCaseNote(formData: FormData) {
  const caseId = formData.get("caseId");
  const noteKey = formData.get("noteKey");
  const body = formData.get("body");
  if (typeof caseId !== "string" || !uuidPattern.test(caseId)) redirect("/staff/cases");
  const root = `/staff/cases/${caseId}/notes`;
  if (typeof noteKey !== "string" || !uuidPattern.test(noteKey)
    || typeof body !== "string" || !body.trim() || body.trim().length > 4000) {
    redirect(`${root}?error=invalid`);
  }
  const { supabase } = await requireStaffCase(caseId);
  const { error } = await supabase.rpc("staff_add_case_note", {
    p_case_id: caseId, p_body: body, p_idempotency_key: noteKey,
  });
  if (error) redirect(`${root}?error=save`);
  redirect(`${root}?added=1`);
}
