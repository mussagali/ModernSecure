import { notFound, redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requireClientCase(id: string) {
  if (!uuidPattern.test(id)) notFound();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");
  const { data: client, error: clientError } = await supabase.from("clients").select("id").eq("user_id", userId).maybeSingle();
  if (clientError) throw new Error("Не удалось проверить доступ к делу");
  if (!client) notFound();
  const { data: item, error } = await supabase.from("cases")
    .select("id, case_number, title, status, is_suspended, current_stage_id, service_version_id, next_review_at, result_summary, updated_at")
    .eq("id", id).eq("client_id", client.id).maybeSingle();
  if (error) throw new Error("Не удалось загрузить дело");
  if (!item) notFound();
  return { supabase, userId, clientId: client.id, item };
}

export function formatKzDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Almaty" }).format(new Date(value));
}
