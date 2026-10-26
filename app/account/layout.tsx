import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { getStaffStatus } from "../../lib/staff";
import { workspaceDestination } from "../../lib/workspace-destination";

import { ClientNavigation } from "../../components/ClientNavigation";
import { ClientDataSync } from "../../components/ClientDataSync";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (auth?.claims?.sub) {
    const { staff, error: staffError } = await getStaffStatus(supabase);
    if (staffError) throw new Error("Не удалось проверить роль аккаунта");
    if (staff) redirect(workspaceDestination(staff));
    const { data, error } = await supabase.rpc("client_consent_status");
    if (error) throw new Error("Не удалось проверить согласия");
    if (!error && data === false) redirect("/consent");
  }
  const { data: client } = auth?.claims?.sub ? await supabase.from("clients").select("id").eq("user_id", auth.claims.sub).maybeSingle() : { data: null };
  const { data: cases } = client ? await supabase.from("cases").select("id").eq("client_id", client.id).order("updated_at", { ascending: false }).limit(1) : { data: [] };
  return <div className="client-app">{auth?.claims?.sub && <ClientDataSync userId={auth.claims.sub} />}{children}<ClientNavigation caseId={cases?.[0]?.id} /></div>;
}
