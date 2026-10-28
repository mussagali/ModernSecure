import { redirect } from "next/navigation";
import type { createClient } from "./supabase/server";

export async function requireAccountApproval(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase.rpc("account_access_status");
  if (error) throw new Error("Не удалось проверить активацию аккаунта");
  if (data === "anonymous") redirect("/login");
  if (data === "disabled") redirect("/access-denied");
  if (data !== "approved") redirect("/awaiting-approval");
}
