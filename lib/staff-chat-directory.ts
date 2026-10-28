import type { SupabaseClient } from "@supabase/supabase-js";
import { searchPattern } from "./list-query";

export function staffChatDirectory(supabase: SupabaseClient, query: string, page: number, unreadOnly: boolean) {
  let request = supabase.rpc("staff_chat_sidebar", {}, { count: "exact" });
  if (query) request = request.ilike("display_name", searchPattern(query));
  if (unreadOnly) request = request.gt("unread_count", 0);
  return request.order("last_message_at", { ascending: false, nullsFirst: false }).order("display_name").order("user_id").range((page - 1) * 25, page * 25 - 1);
}
