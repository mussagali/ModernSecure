import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (auth?.claims?.sub) {
    const { data, error } = await supabase.rpc("client_consent_status");
    // MFA is handled by the existing staff routing; do not mask other API failures.
    if (error?.code === "MFA_REQUIRED") redirect("/staff-security");
    if (error) throw new Error("Не удалось проверить согласия");
    if (!error && data === false) redirect("/consent");
  }
  return children;
}
