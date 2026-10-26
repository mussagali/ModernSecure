import Link from "next/link";
import { requireStaff } from "../../../lib/staff";
import { getStaffWorklist, worklistPage, worklistCount } from "../../../lib/staff-worklist";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { supabase } = await requireStaff(["lawyer", "admin"]);
  const query = await searchParams;
  const q = (query.q ?? "").trim().slice(0, 120);
  const page = worklistPage(query.page);
  const result = await getStaffWorklist(supabase, { query: q, page });
  if (result.error) throw new Error("Не удалось загрузить дела");
  return <><div className="staff-page-heading"><div><h1>Оплаты</h1><p>Выберите дело, чтобы открыть договор, график и историю платежей.</p></div></div><form className="lawyer-search-row"><input name="q" aria-label="Поиск дела" placeholder="Номер дела или имя клиента…" defaultValue={q} maxLength={120} /><button>Найти</button></form><div className="lawyer-table-wrap"><table className="lawyer-table"><thead><tr><th>Дело</th><th>Клиент</th><th>Услуга</th><th>Действие</th></tr></thead><tbody>{result.items.map(item => <tr key={item.case_id}><td>№ {item.case_number}</td><td>{item.client_name}</td><td>{item.service_name}</td><td><Link href={`/staff/cases/${item.case_id}/payments`}>Договор и оплаты</Link></td></tr>)}</tbody></table>{!result.items.length && <div className="lawyer-empty"><h3>Дел пока нет</h3><p>Договоры и платежи появятся после назначения на дело.</p></div>}</div><nav className="staff-pagination" aria-label="Страницы дел">{page > 1 && <Link href={`?page=${page - 1}&q=${encodeURIComponent(q)}`}>Назад</Link>}{worklistCount(result.items) > page * 25 && <Link href={`?page=${page + 1}&q=${encodeURIComponent(q)}`}>Далее</Link>}</nav></>;
}
