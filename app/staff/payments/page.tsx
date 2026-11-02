import { ListSearch, ListPagination } from "../../../components/ListControls";
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
  return <><div className="staff-page-heading"><div><h1>Оплаты</h1><p>Выберите дело, чтобы открыть договор, график и историю платежей.</p></div></div><ListSearch action="/staff/payments" query={q} placeholder="Номер дела или имя клиента" resetHref={q ? "/staff/payments" : undefined} /><div className="lawyer-table-wrap"><table className="lawyer-table"><thead><tr><th>Дело</th><th>Клиент</th><th>Услуга</th><th>Действие</th></tr></thead><tbody>{result.items.map(item => <tr key={item.case_id}><td data-label="Дело">№ {item.case_number}</td><td data-label="Клиент">{item.client_name}</td><td data-label="Услуга">{item.service_name}</td><td data-label="Действие"><Link href={`/staff/cases/${item.case_id}/payments`}>Договор и оплаты</Link></td></tr>)}</tbody></table>{!result.items.length && <div className="lawyer-empty"><h3>{q ? "Дела не найдены" : "Дел пока нет"}</h3><p>{q ? "Проверьте номер или попробуйте другое имя клиента." : "Договоры и платежи появятся после назначения на дело."}</p></div>}</div><ListPagination path="/staff/payments" page={page} count={worklistCount(result.items)} params={{ q }} /></>;
}
