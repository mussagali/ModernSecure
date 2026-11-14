"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePrimaryAdmin } from "../../../lib/staff";
import { uuidPattern } from "../../../lib/uuid";

function value(data: FormData, key: string) {
  const item = data.get(key);
  return typeof item === "string" ? item.trim() : "";
}

export async function deleteAccount(data: FormData) {
  const { supabase, userId: actorId } = await requirePrimaryAdmin();
  const userId = value(data, "userId");
  const email = value(data, "confirmationEmail");
  const reason = value(data, "reason");
  if (!uuidPattern.test(userId)) redirect("/staff/accounts?error=invalid");
  const destination = `/staff/accounts/${userId}`;
  if (userId === actorId) redirect(`${destination}?error=protected`);
  if (!email || email.length > 254 || !reason || reason.length > 500) redirect(`${destination}?error=invalid`);
  const { error } = await supabase.rpc("primary_delete_account", {
    p_user_id: userId, p_confirmation_email: email, p_reason: reason,
  });
  if (error) {
    const errors: Record<string, string> = {
      account_confirmation_mismatch: "confirmation", account_active_assignments: "assignments",
      account_protected: "protected", account_invalid_reason: "invalid", account_not_found: "missing",
    };
    redirect(`${destination}?error=${errors[error.message] ?? "delete"}`);
  }
  revalidatePath("/staff", "layout");
  redirect("/staff/accounts?deleted=1");
}
