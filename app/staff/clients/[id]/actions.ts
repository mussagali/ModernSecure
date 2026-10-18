"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "../../../../lib/staff";
import { uuidPattern } from "../../../../lib/uuid";

export async function correctClientIdentity(form: FormData) {
  const { supabase } = await requireStaff(["admin", "manager"]);
  const field = (name: string) => typeof form.get(name) === "string" ? (form.get(name) as string).normalize("NFC").trim() : "";
  const id = field("clientId"), name = field("fullName"), iin = field("iin"), reason = field("reason");
  if (!uuidPattern.test(id)) redirect("/staff/clients?error=invalid");
  if (!name || name.length > 160 || (iin && !/^[0-9]{12}$/.test(iin)) || !reason || reason.length > 500) redirect(`/staff/clients/${id}?error=invalid`);
  const { error } = await supabase.rpc("staff_correct_client_identity", {
    p_client_id: id, p_expected_updated_at: field("expectedUpdatedAt"), p_full_name: name, p_iin: iin || null, p_reason: reason,
  });
  if (error) redirect(`/staff/clients/${id}?error=${error.message === "Client changed" ? "conflict" : "save"}`);
  revalidatePath("/staff/clients", "layout");
  revalidatePath("/account", "layout");
  redirect(`/staff/clients/${id}?saved=1`);
}
