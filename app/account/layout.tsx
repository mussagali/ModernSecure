import { MobilePush } from "../../components/MobilePush";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { getStaffStatus } from "../../lib/staff";
import { workspaceDestination } from "../../lib/workspace-destination";
import { requireAccountApproval } from "../../lib/account-access";

import { ClientDataSync } from "../../components/ClientDataSync";
import { ClientShell } from "../../components/ClientShell";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (auth?.claims?.sub) {
    const { staff, error: staffError } = await getStaffStatus(supabase);
    if (staffError) throw new Error("Не удалось проверить роль аккаунта");
    if (staff) redirect(workspaceDestination(staff));
    await requireAccountApproval(supabase);
    const { data, error } = await supabase.rpc("client_consent_status");
    if (error) throw new Error("Не удалось проверить согласия");
    if (!error && data === false) redirect("/consent");
  }
  const { data: client } = auth?.claims?.sub ? await supabase.from("clients").select("id").eq("user_id", auth.claims.sub).maybeSingle() : { data: null };
  const { data: cases } = client ? await supabase.from("cases").select("id").eq("client_id", client.id).order("updated_at", { ascending: false }).limit(1) : { data: [] };
  const { count: unreadCount } = auth?.claims?.sub ? await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_user_id", auth.claims.sub).is("read_at", null) : { count: 0 };
  return <ClientShell caseId={cases?.[0]?.id} unreadCount={unreadCount ?? 0}>{auth?.claims?.sub && <ClientDataSync userId={auth.claims.sub} />}{children}<MobilePush /></ClientShell>;
}
