import type { createClient } from "./supabase/server";

export type StaffWorkItem = {
  case_id: string;
  case_number: string;
  title: string;
  client_name: string;
  status: "open" | "closed" | "cancelled";
  is_suspended: boolean;
  stage_name: string | null;
  service_name: string;
  updated_at: string;
  last_message_at: string | null;
  last_message_body: string | null;
  unread_count: number;
  overdue_count: number;
  review_count: number;
  total_count: number;
};

export type WorklistStatus = "all" | "open" | "closed" | "suspended" | "cancelled";
export type WorklistAttention = "all" | "unread" | "overdue" | "documents" | "messages";

export function worklistStatus(value: unknown): WorklistStatus {
  return value === "open" || value === "closed" || value === "suspended" || value === "cancelled" ? value : "all";
}

export function worklistAttention(value: unknown): WorklistAttention {
  return value === "unread" || value === "overdue" || value === "documents" || value === "messages" ? value : "all";
}

export function worklistPage(value: unknown) {
  return typeof value === "string" && /^\d+$/.test(value) ? Math.max(1, Math.min(10000, Number(value))) : 1;
}

export async function getStaffWorklist(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filters: {
    query?: string;
    status?: WorklistStatus;
    attention?: WorklistAttention;
    staffId?: string | null;
    serviceId?: string | null;
    stageId?: string | null;
    clientId?: string | null;
    page?: number;
    sort?: "activity" | "message";
  } = {},
) {
  const result = await supabase.rpc("staff_case_worklist", {
    p_query: filters.query ?? "",
    p_status: filters.status ?? "all",
    p_attention: filters.attention ?? "all",
    p_staff: filters.staffId ?? null,
    p_service: filters.serviceId ?? null,
    p_stage: filters.stageId ?? null,
    p_client: filters.clientId ?? null,
    p_page: filters.page ?? 1,
    p_sort: filters.sort ?? "activity",
  });
  return { items: (result.data ?? []) as StaffWorkItem[], error: result.error };
}

export function worklistCount(items: StaffWorkItem[]) {
  return Number(items[0]?.total_count ?? 0);
}

export function countLabel(count: number, one: string, few: string, many: string) {
  const form = new Intl.PluralRules("ru-RU").select(count);
  return `${count} ${form === "one" ? one : form === "few" ? few : many}`;
}

export function worklistDate(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty",
  }).format(new Date(value));
}
