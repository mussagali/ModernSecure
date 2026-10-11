"use server";

import { redirect } from "next/navigation";
import { uuidPattern, requireClientCase } from "../../../../../lib/client-case";

export async function retractDocumentFile(formData: FormData) {
  const caseId = formData.get("caseId");
  const fileId = formData.get("fileId");
  if (typeof caseId !== "string" || !uuidPattern.test(caseId)
    || typeof fileId !== "string" || !uuidPattern.test(fileId)) redirect("/account");
  const { supabase } = await requireClientCase(caseId);
  const { error } = await supabase.rpc("retract_document_file", { p_file_id: fileId });
  if (error) redirect(`/account/cases/${caseId}/documents?error=retract`);
  redirect(`/account/cases/${caseId}/documents?retracted=1`);
}
