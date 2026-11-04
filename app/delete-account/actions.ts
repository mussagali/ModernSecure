"use server";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";

export async function requestAccountDeletion(form: FormData) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login?next=%2Fdelete-account");
  if (form.get("confirm") !== "on") redirect("/delete-account?error=confirm");
  const { error } = await supabase.rpc("request_own_account_deletion");
  if (error) redirect("/delete-account?error=save");
  redirect("/delete-account?sent=1");
}
