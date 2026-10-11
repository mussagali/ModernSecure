import type { Metadata } from "next";
import { StaffChat } from "../../../components/StaffChat";
import { requireStaff } from "../../../lib/staff";
import { uuidPattern } from "../../../lib/uuid";

export const metadata: Metadata = { title: "Чат команды — Современная защита" };

export default async function StaffChatPage({ searchParams }: {
  searchParams: Promise<{ to?: string; fromCase?: string; beforeAt?: string; beforeId?: string }>;
}) {
  const { supabase, userId } = await requireStaff();
  const query = await searchParams;
  const { data: sidebar, error: sidebarError } = await supabase.rpc("staff_chat_sidebar");
  if (sidebarError) throw new Error("Не удалось загрузить чат команды");
  const conversations = ((sidebar ?? []) as Array<{
    user_id: string; display_name: string; role: "lawyer" | "manager" | "admin"; active: boolean;
    thread_id: string | null; last_message_at: string | null; last_message_body: string | null; unread_count: number;
  }>).map((person) => ({
    user_id: person.user_id,
    display_name: person.display_name,
    role: person.role,
    active: person.active,
    threadId: person.thread_id,
    lastMessageAt: person.last_message_at,
    lastMessage: person.last_message_body,
    unread: Number(person.unread_count),
  }));
  const requested = query.to;
  const requestedId = requested && uuidPattern.test(requested) ? requested.toLowerCase() : null;
  const selected = conversations.find((person) => person.user_id === requestedId) ?? null;
  const selectedId = selected?.user_id ?? null;
  let returnCase: { id: string; caseNumber: string } | null = null;
  if (selectedId && typeof query.fromCase === "string" && uuidPattern.test(query.fromCase)) {
    const caseId = query.fromCase.toLowerCase();
    const { data: item } = await supabase.from("cases")
      .select("id, case_number").eq("id", caseId).maybeSingle();
    if (item) {
      const { data: assignment } = await supabase.from("case_assignments")
        .select("id").eq("case_id", caseId).eq("staff_user_id", selectedId).is("revoked_at", null).maybeSingle();
      if (assignment || selected?.role === "admin") returnCase = { id: item.id, caseNumber: item.case_number };
    }
  }
  const historical = typeof query.beforeAt === "string" && !Number.isNaN(Date.parse(query.beforeAt))
    && typeof query.beforeId === "string" && uuidPattern.test(query.beforeId);
  const messagesResult = selected?.threadId
    ? await supabase.rpc("staff_message_page", {
      p_thread_id: selected.threadId,
      p_before_created_at: historical ? query.beforeAt : null,
      p_before_id: historical ? query.beforeId : null,
      p_limit: 101,
    })
    : { data: [], error: null };
  if (messagesResult.error) throw new Error("Не удалось загрузить сообщения команды");
  const pageRows = (messagesResult.data ?? []) as Array<{
    id: string; sender_user_id: string; body: string; created_at: string;
  }>;
  const hasOlder = pageRows.length > 100;
  const shownMessages = pageRows.slice(0, 100).reverse();
  const attachmentResult = shownMessages.length
    ? await supabase.from("staff_message_attachments")
      .select("id, message_id, original_name, detected_mime_type, size_bytes, position")
      .in("message_id", shownMessages.map((message) => message.id))
    : { data: [], error: null };
  if (attachmentResult.error) throw new Error("Не удалось загрузить вложения команды");
  const caseRefResult = shownMessages.length
    ? await supabase.from("staff_message_case_refs").select("message_id, case_id")
      .in("message_id", shownMessages.map((message) => message.id))
    : { data: [], error: null };
  if (caseRefResult.error) throw new Error("Не удалось загрузить ссылки на дела");
  const caseIds = [...new Set((caseRefResult.data ?? []).map((item) => item.case_id))];
  const casesResult = caseIds.length
    ? await supabase.from("cases").select("id, case_number, title").in("id", caseIds)
    : { data: [], error: null };
  if (casesResult.error) throw new Error("Не удалось загрузить дела");
  const casesById = new Map((casesResult.data ?? []).map((item) => [item.id, item]));
  const caseByMessage = new Map((caseRefResult.data ?? []).map((item) =>
    [item.message_id, casesById.get(item.case_id) ?? null]));
  const attachmentsByMessage = new Map<string, Array<{
    id: string; original_name: string; detected_mime_type: string; size_bytes: number; position: number;
  }>>();
  for (const attachment of attachmentResult.data ?? []) {
    const list = attachmentsByMessage.get(attachment.message_id) ?? [];
    list.push(attachment);
    attachmentsByMessage.set(attachment.message_id, list);
  }
  const oldest = shownMessages[0];
  const olderHref = selectedId && hasOlder && oldest
    ? `/staff/chat?${new URLSearchParams({ to: selectedId, ...(returnCase ? { fromCase: returnCase.id } : {}), beforeAt: oldest.created_at, beforeId: oldest.id })}` : null;
  return <StaffChat
    key={selectedId ?? "list"}
    userId={userId}
    selectedId={selectedId}
    selectedThreadId={selected?.threadId ?? null}
    returnCase={returnCase}
    conversations={conversations}
    messages={shownMessages.map((message) => ({ ...message,
      caseRef: caseByMessage.get(message.id) ?? null,
      attachments: (attachmentsByMessage.get(message.id) ?? []).sort((a, b) => a.position - b.position) }))}
    olderHref={olderHref}
    historical={historical}
    historyPageKey={historical ? query.beforeId! : "latest"}
  />;
}
