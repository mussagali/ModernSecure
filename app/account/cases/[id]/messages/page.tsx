import CaseConversation from "../../../../../components/CaseConversation";
import { loadInitialCaseMessages } from "../../../../../lib/case-message-history";
import { requireClientCase } from "../../../../../lib/client-case";
import { markClientMessagesRead } from "../actions";

const errors: Record<string, string> = {
  invalid: "Напишите сообщение или прикрепите файл.",
  files: "Можно приложить до 5 PDF или изображений: 20 МБ на файл, 40 МБ вместе.",
  upload: "Не удалось загрузить файл. Повторите отправку.",
  rate: "Слишком много сообщений. Подождите и попробуйте позже.",
  send: "Не удалось отправить сообщение. Повторите попытку.",
};

export default async function ClientMessages({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string; error?: string }> }) {
  const { id } = await params;
  const { supabase, userId, item } = await requireClientCase(id);
  const query = await searchParams;
  const [history, authorsResult, contactResult] = await Promise.all([
    loadInitialCaseMessages(supabase, id),
    supabase.rpc("case_message_authors", { p_case_id: id }),
    supabase.from("contact_settings").select("business_hours, response_expectation").eq("id", true).maybeSingle(),
  ]);
  const { messages, olderCursor } = history;
  const { data: reads, error: readsError } = messages.length
    ? await supabase.from("message_reads").select("message_id")
      .eq("reader_user_id", userId).in("message_id", messages.map((message) => message.id))
    : { data: [], error: null };
  if (readsError || authorsResult.error) throw new Error("Не удалось загрузить переписку");
  const senderNames = Object.fromEntries((authorsResult.data ?? []).map((author: { user_id: string; display_name: string }) => [author.user_id, author.display_name]));
  const readIds = new Set((reads ?? []).map((read) => read.message_id));
  const unread = messages.filter((message) => message.sender_user_id !== userId && !readIds.has(message.id)).length;
  return <div className="case-conversation-screen">
    <CaseConversation key={id} caseId={id} caseNumber={item.case_number} caseTitle={item.title} backHref={`/account/cases/${id}`} contactName="Команда юристов" viewer="client" userId={userId} messages={messages} olderCursor={olderCursor} senderNames={senderNames} businessHours={contactResult.data?.business_hours ?? null} responseExpectation={contactResult.data?.response_expectation ?? null} canSend={item.status === "open" && !item.is_suspended} unread={unread} initialNotice={query.sent ? "Сообщение отправлено" : undefined} initialError={query.error ? errors[query.error] ?? errors.send : undefined}
      readControl={unread > 0 ? <form action={markClientMessagesRead}><input type="hidden" name="caseId" value={id} /><button type="submit">Отметить все прочитанными</button></form> : undefined} />
  </div>;
}
