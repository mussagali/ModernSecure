import { createClient } from "./supabase/server";

type CaseMessageRow = { id: string; sender_user_id: string; body: string; created_at: string };
type Attachment = {
  id: string; message_id: string; original_name: string; size_bytes: number;
  detected_mime_type: string | null; position: number;
};

export type CaseMessage = CaseMessageRow & { message_attachments: Omit<Attachment, "message_id">[] };
export type MessageCursor = { created_at: string; id: string };

export async function loadInitialCaseMessages(
  supabase: Awaited<ReturnType<typeof createClient>>, caseId: string,
) {
  const { data, error } = await supabase.rpc("case_message_page", {
    p_case_id: caseId, p_before_created_at: null, p_before_id: null, p_limit: 51,
  });
  if (error) throw new Error("Не удалось загрузить переписку");
  const rows = (data ?? []) as CaseMessageRow[];
  const shown = rows.slice(0, 50).reverse();
  const { data: attachments, error: attachmentError } = shown.length
    ? await supabase.from("message_attachments")
      .select("id, message_id, original_name, size_bytes, detected_mime_type, position")
      .in("message_id", shown.map((message) => message.id))
    : { data: [], error: null };
  if (attachmentError) throw new Error("Не удалось загрузить вложения переписки");
  const byMessage = new Map<string, Omit<Attachment, "message_id">[]>();
  for (const { message_id, ...attachment } of (attachments ?? []) as Attachment[]) {
    const list = byMessage.get(message_id) ?? [];
    list.push(attachment);
    byMessage.set(message_id, list);
  }
  const messages: CaseMessage[] = shown.map((message) => ({
    ...message,
    message_attachments: (byMessage.get(message.id) ?? []).sort((a, b) => a.position - b.position),
  }));
  return {
    messages,
    olderCursor: rows.length > 50 && shown[0]
      ? { created_at: shown[0].created_at, id: shown[0].id } satisfies MessageCursor
      : null,
  };
}
