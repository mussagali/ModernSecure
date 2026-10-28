import { loadListPage } from "../../../lib/list-page";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountHeader } from "../../../components/AccountHeader";
import { NavIcon } from "../../../components/NavIcon";
import { ListPagination, ListSearch } from "../../../components/ListControls";
import { queryPage, queryText, textSearch, listHref, type ListParams } from "../../../lib/list-query";
import { createClient } from "../../../lib/supabase/server";

export default async function SelectCasePage({ searchParams }: { searchParams: Promise<ListParams> }) {
  const params = await searchParams;
  const section = queryText(params.section);
  const q = queryText(params.q);
  let page = queryPage(params.page);
  const status = ["open", "closed", "cancelled"].includes(queryText(params.status)) ? queryText(params.status) : "all";
  const sections: Record<string, string> = { documents: "Документы", payments: "Договор и оплаты", messages: "Сообщения", tasks: "Задачи" };
  const suffix = section in sections ? `/${section}` : "";
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) redirect("/login");
  const { data: client, error } = await supabase.from("clients").select("id").eq("user_id", auth.claims.sub).maybeSingle();
  if (error) throw new Error("Не удалось загрузить клиента");
  let request = supabase.from("cases").select("id, title, case_number, status, is_suspended, updated_at", { count: "exact" }).eq("client_id", client?.id ?? "00000000-0000-0000-0000-000000000000");
  if (q) request = request.or(textSearch(["title", "case_number"], q));
  if (status !== "all") request = request.eq("status", status);
  request = request.order("updated_at", { ascending: false }).order("id");
  const result = await loadListPage(target => request.range((target - 1) * 25, target * 25 - 1), page);
  const { data: cases, error: casesError, count } = result;
  page = result.page;
  if (casesError) throw new Error("Не удалось загрузить дела");
  return <main className="account-page"><AccountHeader /><div className="account-content">
    <div className="client-greeting"><div><h1>{sections[section] ?? "Мои дела"}</h1><p>{section in sections ? "Выберите дело, чтобы продолжить работу." : "Все ваши дела, их состояние и последние изменения."}</p></div><span className="account-count">{count ?? 0}</span></div>
    <ListSearch action="/account/select-case" query={q} label="Поиск ваших дел" placeholder="Название или номер дела" hidden={{ ...(section ? { section } : {}), status }} resetHref={q ? listHref("/account/select-case", { section }) : undefined} />
    <nav className="workspace-tabs" aria-label="Статус дел">{[["all", "Все дела"], ["open", "В работе"], ["closed", "Завершённые"], ["cancelled", "Отменённые"]].map(([value, label]) => <Link key={value} href={listHref("/account/select-case", { section, q, status: value })} aria-current={value === status ? "page" : undefined}>{label}</Link>)}</nav>
    {cases?.length ? <div className="client-case-directory">{cases.map(item => <Link key={item.id} href={`/account/cases/${item.id}${suffix}`}><span className="directory-case-number">№ {item.case_number}</span><span className="client-case-copy"><strong>{item.title}</strong><small>Обновлено {new Intl.DateTimeFormat("ru", { dateStyle: "medium", timeZone: "Asia/Almaty" }).format(new Date(item.updated_at))}</small></span><span className="directory-status" data-active={item.status === "open" && !item.is_suspended}>{item.is_suspended ? "Приостановлено" : item.status === "open" ? "В работе" : item.status === "closed" ? "Завершено" : "Отменено"}</span><NavIcon name="chevron" size={18} /></Link>)}</div>
      : <section className="directory-empty"><NavIcon name={q ? "search" : "cases"} size={32} /><h2>{q || status !== "all" || page > 1 ? "Дела не найдены" : "Здесь будут ваши дела"}</h2><p>{q || status !== "all" || page > 1 ? "Измените запрос или вернитесь ко всем делам." : "Когда сотрудник создаст дело, вы сможете отслеживать этапы, отправлять документы и общаться с командой."}</p><Link href={q || status !== "all" || page > 1 ? listHref("/account/select-case", { section }) : "/account/help"}>{q || status !== "all" || page > 1 ? "Показать все дела" : "Помощь и контакты"}</Link></section>}
    <ListPagination path="/account/select-case" page={page} count={count ?? 0} params={{ q, section, status }} />
  </div></main>;
}
