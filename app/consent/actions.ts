"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "../../lib/supabase/server";
import { uuidPattern } from "../../lib/client-case";

export async function acceptConsents(form: FormData) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) redirect("/login");
  const ids = form.getAll("documentId");
  if (ids.length > 3 || ids.some((id) => typeof id !== "string" || !uuidPattern.test(id))) redirect("/consent?error=1");
  const { error } = await supabase.rpc("accept_client_consents", { p_document_ids: ids });
  if (error) {
    console.error("Failed to save client consents", { code: error.code, message: error.message });
    redirect("/consent?error=1");
  }
  const { data: accepted, error: statusError } = await supabase.rpc("client_consent_status");
  if (statusError || accepted !== true) {
    console.error("Client consent status was not confirmed", { code: statusError?.code });
    redirect("/consent?error=1");
  }
  revalidatePath("/account", "layout");
  redirect("/account");
}
