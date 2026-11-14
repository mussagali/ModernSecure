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
  const sections: Record<string, { title: string; choose: string; empty: string; description: string }> = {
    documents: { title: "Документы", choose: "Выберите дело, чтобы открыть документы.", empty: "Документы пока не запрошены", description: "Когда сотрудник создаст дело и запросит документы, вы сможете загрузить их в этом разделе." },
    payments: { title: "Договор и оплаты", choose: "Выберите дело, чтобы открыть договор и оплаты.", empty: "Договоров пока нет", description: "Здесь появятся договор и график платежей, когда сотрудник добавит их в ваше дело." },
    messages: { title: "Чат с юристом", choose: "Выберите дело, чтобы открыть переписку с юристом.", empty: "Чат появится вместе с делом", description: "Переписка с юристом привязана к вашему делу. Пока оно не создано, свяжитесь с компанией через раздел «Контакты»." },
    tasks: { title: "Задачи", choose: "Выберите дело, чтобы открыть задачи.", empty: "Задач пока нет", description: "Когда сотрудник создаст дело и назначит вам задачи, они появятся здесь." },
  };
  const currentSection = Object.hasOwn(sections, section) ? sections[section] : undefined;
  const suffix = currentSection ? `/${section}` : "";
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
  const filtered = Boolean(q) || status !== "all";
  if (currentSection && !filtered && count === 1 && cases?.length === 1) {
    redirect(`/account/cases/${cases[0].id}${suffix}`);
  }
  const emptyAccount = !filtered && (count ?? 0) === 0;
  return <main className="account-page"><AccountHeader /><div className="account-content">
    <div className="client-greeting"><div><h1>{currentSection?.title ?? "Мои дела"}</h1>{!emptyAccount && <p>{currentSection?.choose ?? "Все ваши дела, их состояние и последние изменения."}</p>}</div>{!emptyAccount && <span className="account-count">{count ?? 0}</span>}</div>
    {!emptyAccount && <><ListSearch action="/account/select-case" query={q} label="Поиск ваших дел" placeholder="Название или номер дела" hidden={{ ...(currentSection ? { section } : {}), status }} resetHref={q ? listHref("/account/select-case", { section }) : undefined} />
    <nav className="workspace-tabs" aria-label="Статус дел">{[["all", "Все дела"], ["open", "В работе"], ["closed", "Завершённые"], ["cancelled", "Отменённые"]].map(([value, label]) => <Link key={value} href={listHref("/account/select-case", { section, q, status: value })} aria-current={value === status ? "page" : undefined}>{label}</Link>)}</nav></>}
    {cases?.length ? <div className="client-case-directory">{cases.map(item => <Link key={item.id} href={`/account/cases/${item.id}${suffix}`}><span className="directory-case-number">№ {item.case_number}</span><span className="client-case-copy"><strong>{item.title}</strong><small>Обновлено {new Intl.DateTimeFormat("ru", { dateStyle: "medium", timeZone: "Asia/Almaty" }).format(new Date(item.updated_at))}</small></span><span className="directory-status" data-active={item.status === "open" && !item.is_suspended}>{item.is_suspended ? "Приостановлено" : item.status === "open" ? "В работе" : item.status === "closed" ? "Завершено" : "Отменено"}</span><NavIcon name="chevron" size={18} /></Link>)}</div>
      : <section className="directory-empty"><NavIcon name={filtered ? "search" : section === "messages" ? "messages" : "cases"} size={32} /><h2>{filtered ? "Дела не найдены" : currentSection?.empty ?? "Здесь будут ваши дела"}</h2><p>{filtered ? "Измените запрос или вернитесь ко всем делам." : currentSection?.description ?? "Когда сотрудник создаст дело, вы сможете отслеживать этапы, отправлять документы и общаться с командой."}</p><Link href={filtered ? listHref("/account/select-case", { section }) : "/account/contacts"}>{filtered ? "Показать все дела" : "Связаться с компанией"}</Link></section>}
    <ListPagination path="/account/select-case" page={page} count={count ?? 0} params={{ q, section, status }} />
  </div></main>;
}
