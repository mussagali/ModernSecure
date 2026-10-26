"use server";

import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { uuidPattern } from "../../lib/client-case";

export async function acceptConsents(form: FormData) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) redirect("/login");
  const ids = form.getAll("documentId");
  if (ids.length > 3 || ids.some((id) => typeof id !== "string" || !uuidPattern.test(id))) redirect("/consent?error=1");
  const { error } = await supabase.rpc("accept_client_consents", { p_document_ids: ids });
  if (error) redirect("/consent?error=1");
  redirect("/account");
}
