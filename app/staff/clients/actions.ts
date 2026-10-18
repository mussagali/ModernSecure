"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "../../../lib/staff";

export async function approveClientRegistration(form: FormData) {
  const { supabase } = await requireStaff(["admin"]);
  const userId = form.get("userId");
  if (typeof userId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    redirect("/staff/clients?error=invalid");
  }
  const { error } = await supabase.rpc("admin_approve_client_registration", { p_user_id: userId });
  if (error?.message === "Existing client card") redirect("/staff/clients?error=existing-card");
  if (error?.message === "Account is already staff" || error?.message === "Account has a staff invitation") {
    redirect("/staff/clients?error=staff");
  }
  if (error) redirect("/staff/clients?error=approve");
  revalidatePath("/staff/clients");
  revalidatePath("/account", "layout");
  redirect("/staff/clients?approved=1");
}
