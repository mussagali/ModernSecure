"use server";
import { redirect } from "next/navigation";
import { requireStaff } from "../../../../lib/staff";
import { uuidPattern } from "../../../../lib/client-case";

export async function publishLegalDocument(form: FormData) {
  const { supabase } = await requireStaff(["admin"]);
  const type = String(form.get("type") ?? "");
  const title = String(form.get("title") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  const expected = String(form.get("expectedId") ?? "");
  if (!["terms", "privacy", "marketing"].includes(type) || !title || title.length > 180 || !body || body.length > 60000 || (expected && !uuidPattern.test(expected)) || form.get("approved") !== "on") redirect("/staff/settings/legal?error=invalid");
  const { error } = await supabase.rpc("admin_publish_legal_document", { p_type: type, p_title: title, p_body: body, p_expected_id: expected || null });
  if (error) redirect(`/staff/settings/legal?error=${error.message === "Document changed" ? "conflict" : "save"}`);
  redirect("/staff/settings/legal?saved=1");
}
