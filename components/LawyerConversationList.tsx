import Link from "next/link";
import { requireStaff } from "../lib/staff";
import { getStaffWorklist } from "../lib/staff-worklist";

export async function LawyerConversationList({ caseId }: { caseId: string }) {
  const { supabase, staff } = await requireStaff();
  if (staff.role !== "lawyer") return null;
  const result = await getStaffWorklist(supabase, { attention: "messages", sort: "message" });
  return <aside className="lawyer-conversations"><h2>Сообщения</h2><form action="/staff/inbox"><input type="search" name="q" placeholder="Поиск по имени или делу…" aria-label="Поиск переписки" maxLength={120} /></form>{result.error ? <p role="status">Не удалось загрузить диалоги. <Link href="/staff/inbox">Открыть список</Link></p> : result.items.map(item => <Link className={item.case_id === caseId ? "is-active" : ""} href={`/staff/cases/${item.case_id}/messages`} key={item.case_id}><span className="lawyer-avatar">{item.client_name.slice(0, 1)}</span><span><strong>{item.client_name}</strong><small>{item.last_message_body || `№ ${item.case_number}`}</small></span>{Number(item.unread_count) > 0 && <b>{item.unread_count}</b>}</Link>)}<Link className="lawyer-all-conversations" href="/staff/inbox">Все диалоги</Link></aside>;
}
