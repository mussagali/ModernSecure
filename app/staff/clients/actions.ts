"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "../../../lib/staff";
import { uuidPattern } from "../../../lib/uuid";

export async function addRegisteredClient(form: FormData) {
  const { supabase } = await requireStaff(["admin"]);
  const field = (name: string) => String(form.get(name) ?? "").trim();
  const email = field("email").toLowerCase();
  const name = field("displayName");
  const clientId = field("clientId");
  const back = `/staff/clients?new=1&email=${encodeURIComponent(email.slice(0, 254))}`;
  if (!name || name.length > 160 || email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || (clientId && !uuidPattern.test(clientId))) {
    redirect(`${back}&error=lookup-invalid`);
  }
  // The audited RPC rechecks verified email, current permissions, protected
  // invitations and ownership of the selected card under its account lock.
  const { error } = await supabase.rpc("admin_add_client_account", {
    p_email: email, p_display_name: name, p_client_id: clientId || null,
  });
  if (error?.message === "Existing client card") redirect(`${back}&error=lookup-card`);
  if (error?.message === "Account has a staff invitation" || error?.message === "Protected administrator") redirect(`${back}&error=lookup-invited`);
  if (error?.message === "Account already assigned") redirect(`${back}&error=lookup-assigned`);
  if (error?.message === "Verified account not found") redirect(`${back}&error=lookup-unverified`);
  if (error) redirect(`${back}&error=lookup-approval`);
  revalidatePath("/staff", "layout");
  redirect(`/staff/clients?added=1&q=${encodeURIComponent(email)}`);
}
