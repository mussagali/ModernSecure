"use server";

import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function activateStaffInvitation() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) redirect("/login");
  const { data, error } = await supabase.rpc("claim_staff_invite");
  if (error) redirect("/account?inviteError=1");
  if (data === true) redirect("/staff");
  redirect("/account?invite=none");
}
