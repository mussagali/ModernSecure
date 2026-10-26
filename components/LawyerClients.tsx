import Link from "next/link";
import { requireStaff } from "../lib/staff";

export async function LawyerClients({ query = "", page = 1 }: { query?: string; page?: number }) {
  const { supabase } = await requireStaff(["lawyer"]);
  let request = supabase.from("clients").select("id, full_name, email, phone", { count: "exact" }).order("full_name");
  if (query) request = request.ilike("full_name", `%${query.replace(/[%_]/g, "")}%`);
  const { data: clients, error, count } = await request.range((page - 1) * 25, page * 25 - 1);
  if (error) throw new Error("Не удалось загрузить клиентов");
  const ids = (clients ?? []).map(client => client.id);
  const { data: cases, error: casesError } = ids.length ? await supabase.from("cases").select("id, client_id, case_number, status, updated_at").in("client_id", ids).order("updated_at", { ascending: false }) : { data: [], error: null };
  if (casesError) throw new Error("Не удалось загрузить дела клиентов");
  return <><div className="staff-page-heading"><div><h1>Клиенты</h1><p>Клиенты дел, к которым у вас есть доступ.</p></div><span className="staff-role-pill">{count ?? 0} клиентов</span></div>
    <form className="lawyer-search-row" action="/staff/clients"><input name="q" type="search" aria-label="Имя клиента" placeholder="Поиск по имени клиента…" defaultValue={query} maxLength={120} /><button>Найти</button></form>
    <div className="lawyer-table-wrap"><table className="lawyer-table"><thead><tr><th>Клиент</th><th>Контакты</th><th>Дела</th><th>Статус</th></tr></thead><tbody>{clients?.map(client => {
      const assigned = (cases ?? []).filter(item => item.client_id === client.id);
      return <tr key={client.id}><td><span className="lawyer-person"><span className="lawyer-avatar">{client.full_name.slice(0, 1)}</span><strong>{client.full_name}</strong></span></td><td>{client.phone && <a href={`tel:${client.phone}`}>{client.phone}</a>}<small>{client.email ?? "Email не указан"}</small></td><td>{assigned.map(item => <Link key={item.id} href={`/staff/cases/${item.id}`}>№ {item.case_number}<br /></Link>)}</td><td><span className={`lawyer-status ${assigned.some(item => item.status === "open") ? "green" : ""}`}>{assigned.some(item => item.status === "open") ? "Активные дела" : "Нет активных дел"}</span></td></tr>;
    })}</tbody></table>{!clients?.length && <div className="lawyer-empty"><h3>{query ? "Клиенты не найдены" : "Клиентов пока нет"}</h3><p>{query ? "Попробуйте изменить поисковый запрос." : "Здесь появятся клиенты назначенных вам дел."}</p></div>}</div>
    <nav className="staff-pagination" aria-label="Страницы клиентов">{page > 1 && <Link href={`?page=${page - 1}&q=${encodeURIComponent(query)}`}>Назад</Link>}{(count ?? 0) > page * 25 && <Link href={`?page=${page + 1}&q=${encodeURIComponent(query)}`}>Далее</Link>}</nav>
  </>;
}
