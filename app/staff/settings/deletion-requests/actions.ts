"use server";
import { redirect } from "next/navigation";
import { requirePrimaryAdmin } from "../../../../lib/staff";
import { uuidPattern } from "../../../../lib/uuid";

export async function updateDeletionRequest(form: FormData) {
  const { supabase } = await requirePrimaryAdmin();
  const candidatePage = Number(form.get("page"));
  const page = Number.isSafeInteger(candidatePage) && candidatePage > 0 && candidatePage <= 100000 ? candidatePage : 1;
  const destination = `/staff/settings/deletion-requests?page=${page}`;
  const id = String(form.get("id") ?? "");
  const status = String(form.get("status") ?? "");
  const response = String(form.get("response") ?? "").trim();
  if (!uuidPattern.test(id) || !["in_progress", "completed"].includes(status) || response.length > 2000) redirect(`${destination}&error=invalid`);
  const { error } = await supabase.rpc("admin_update_account_deletion", { p_id: id, p_status: status, p_response: response, p_confirm_completed: form.get("completed") === "on" });
  if (error) redirect(`${destination}&error=save`);
  redirect(`${destination}&saved=1`);
}
