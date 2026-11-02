import Link from "next/link";
import { requireStaff } from "../../../lib/staff";
import { getStaffWorklist, worklistCount } from "../../../lib/staff-worklist";
import { staffNavigation } from "../../../lib/workspace-navigation";
import { queryText, textSearch, type ListParams } from "../../../lib/list-query";
import { ListSearch } from "../../../components/ListControls";
import { NavIcon } from "../../../components/NavIcon";

export const metadata = { title: "Поиск | Современная защита" };

export default async function WorkspaceSearchPage({ searchParams }: { searchParams: Promise<ListParams> }) {
  const { supabase, staff } = await requireStaff();
  const q = queryText((await searchParams).q);
  const sections = staffNavigation(staff.role).filter(item => !q || item.label.toLocaleLowerCase("ru").includes(q.toLocaleLowerCase("ru")));
  const [cases, clients] = q ? await Promise.all([
    getStaffWorklist(supabase, { query: q, page: 1 }),
    staff.role === "lawyer"
      ? supabase.from("clients").select("id, full_name, email, phone", { count: "exact" }).or(textSearch(["full_name", "email", "phone"], q)).order("full_name").order("id").limit(6)
      : supabase.rpc("staff_search_clients", { p_query: q, p_page: 1 }),
  ]) : [null, null];
  const clientCount = clients && (staff.role === "lawyer" ? clients.count : Number(clients.data?.[0]?.total_count ?? 0));
  return <>
    <div className="staff-page-heading"><div><h1>Поиск</h1><p>Найдите дело, клиента или нужный раздел.</p></div></div>
    <ListSearch action="/staff/search" query={q} label="Поиск по делам и клиентам" placeholder="Имя, телефон, email, номер или название дела" resetHref={q ? "/staff/search" : undefined} />
    {q && <div className="search-results-grid">
      <section className="search-result-section"><header><h2>Дела</h2><Link href={`/staff/cases?q=${encodeURIComponent(q)}`}>Все результаты{cases && !cases.error ? ` (${worklistCount(cases.items)})` : ""}</Link></header>
        {cases?.error ? <p role="alert">Не удалось найти дела. Повторите поиск.</p> : cases?.items.length ? cases.items.slice(0, 6).map(item => <Link className="search-result-row" key={item.case_id} href={`/staff/cases/${item.case_id}`}><NavIcon name="cases" /><span><strong>{item.title}</strong><small>№ {item.case_number} · {item.client_name}</small></span><NavIcon name="chevron" size={16} /></Link>) : <p className="search-empty">Дела не найдены. Попробуйте имя клиента или часть номера.</p>}
      </section>
      <section className="search-result-section"><header><h2>Клиенты</h2><Link href={`/staff/clients?q=${encodeURIComponent(q)}`}>Все результаты{!clients?.error ? ` (${clientCount ?? 0})` : ""}</Link></header>
        {clients?.error ? <p role="alert">Не удалось найти клиентов. Повторите поиск.</p> : clients?.data?.length ? clients.data.slice(0, 6).map((client: { id: string; full_name: string; email: string | null; phone: string | null }) => <Link className="search-result-row" key={client.id} href={`/staff/cases?client=${client.id}`}><NavIcon name="clients" /><span><strong>{client.full_name}</strong><small>{client.email || client.phone || "Открыть дела клиента"}</small></span><NavIcon name="chevron" size={16} /></Link>) : <p className="search-empty">Клиенты не найдены. Проверьте имя или контактные данные.</p>}
      </section>
    </div>}
    <section className="search-destinations"><h2>{q ? "Разделы" : "Быстрый переход"}</h2><div>{sections.map(item => <Link key={item.href} href={item.href}><NavIcon name={item.icon} /><span>{item.label}</span><NavIcon name="chevron" size={16} /></Link>)}{!sections.length && <p className="search-empty">Нет разделов с таким названием.</p>}</div></section>
    {q && <p className="search-hint">Для поиска задач и файлов используйте поиск в соответствующем разделе.</p>}
  </>;
}
