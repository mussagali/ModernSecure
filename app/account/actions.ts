"use server";

import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";

export async function signOutAction() {
  const supabase = await createClient({ allowStaffSession: true });
  await supabase.rpc("unregister_push_session");
  await supabase.auth.signOut();
  redirect("/login");
}

