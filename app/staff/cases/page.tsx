import type { Metadata } from "next";
import Link from "next/link";
import { SubmitButton } from "../../../components/SubmitButton";
import { requireStaff } from "../../../lib/staff";
import { countLabel, getStaffWorklist, worklistAttention, worklistCount, worklistDate, worklistPage, worklistStatus } from "../../../lib/staff-worklist";
import { createCase } from "../actions";

export const metadata: Metadata = { title: "Дела — Современная защита" };

type AvailableVersion = { version_id: string; service_name: string; version_no: number };
type ClientChoice = { id: string; full_name: string; email?: string | null };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const attentionOptions = [
  { value: "all", label: "Все дела" },
  { value: "unread", label: "Новые сообщения" },
  { value: "documents", label: "Проверить документы" },
  { value: "overdue", label: "Просроченные задачи" },
] as const;

export default async function StaffCasesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, staff } = await requireStaff();
  const params = await searchParams;
  const str = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const query = str("q").trim().slice(0, 120);
  const status = worklistStatus(params.status);
  const attention = worklistAttention(params.attention);
  const staffId = uuidPattern.test(str("staff")) ? str("staff") : null;
  const serviceId = uuidPattern.test(str("service")) ? str("service") : null;
  const stageId = uuidPattern.test(str("stage")) ? str("stage") : null;
  const clientId = uuidPattern.test(str("client")) ? str("client") : null;
  const clientSearch = str("clientSearch").trim().slice(0, 120);
  let page = worklistPage(params.page);
  const filters = { query, status, attention, staffId, serviceId, stageId, clientId };
  const [worklist, staffResult, servicesResult, stagesResult, serviceVersionsResult, clientsResult, versionsResult, selectedClientResult] = await Promise.all([
    getStaffWorklist(supabase, { ...filters, page }),
    staff.role === "lawyer" ? Promise.resolve({ data: [], error: null }) : supabase.from("staff_members").select("user_id, display_name").eq("active", true).order("display_name"),
    supabase.from("service_templates").select("id, name").order("name"),
    supabase.from("stage_templates").select("id, title, position, version_id").order("title").limit(500),
    supabase.from("service_template_versions").select("id, version_no, service_id").limit(500),
    staff.role === "lawyer" ? Promise.resolve({ data: [], error: null }) : supabase.rpc("staff_search_clients", { p_query: clientSearch, p_page: 1 }),
    staff.role === "lawyer" ? Promise.resolve({ data: [], error: null }) : supabase.rpc("available_service_versions"),
    clientId && staff.role !== "lawyer" ? supabase.from("clients").select("id, full_name, email").eq("id", clientId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  let result = worklist;
  let count = worklistCount(result.items);
  if (!result.error && !result.items.length && page > 1) {
    const first = await getStaffWorklist(supabase, { ...filters, page: 1 });
    if (first.error) result = first;
    else {
      count = worklistCount(first.items);
      page = Math.max(1, Math.ceil(count / 25));
      result = page === 1 ? first : await getStaffWorklist(supabase, { ...filters, page });
    }
  }
  const clientChoices = (clientsResult.data ?? []) as ClientChoice[];
  if (selectedClientResult.data && !clientChoices.some((client) => client.id === selectedClientResult.data?.id)) clientChoices.unshift(selectedClientResult.data);
  const versions = (versionsResult.data ?? []) as AvailableVersion[];
  const versionById = new Map((serviceVersionsResult.data ?? []).map((version) => [version.id, version]));
  const serviceById = new Map((servicesResult.data ?? []).map((service) => [service.id, service.name]));
  const pages = Math.ceil(count / 25);
  const baseParams = new URLSearchParams({ ...(query ? { q: query } : {}), ...(status !== "all" ? { status } : {}), ...(staffId ? { staff: staffId } : {}), ...(serviceId ? { service: serviceId } : {}), ...(stageId ? { stage: stageId } : {}), ...(clientId ? { client: clientId } : {}) });
  const filterHref = (nextAttention: string, nextPage?: number) => {
    const next = new URLSearchParams(baseParams);
    if (nextAttention !== "all") next.set("attention", nextAttention);
    if (nextPage) next.set("page", String(nextPage));
    return `/staff/cases${next.size ? `?${next}` : ""}`;
  };

  return <><div className="staff-page-heading"><div><span className="staff-eyebrow">РАБОЧИЕ ДЕЛА</span><h1>{staff.role === "lawyer" ? "Мои дела" : "Дела"}</h1><p>Найдите нужное дело и сразу увидьте, где требуется ответ, проверка документа или действие по сроку.</p></div><span className="staff-role-pill">{attention === "all" ? countLabel(count, "дело", "дела", "дел") : `${count} найдено`}</span></div>
    {params.error && <div className="staff-alert is-error" role="alert">{params.error === "version" ? "Услуга обновилась. Выберите актуальную версию." : "Не удалось создать дело. Проверьте поля и попробуйте ещё раз."}</div>}
    <section className="staff-case-filter-panel" aria-label="Поиск и фильтры дел">
      <form action="/staff/cases" method="get" className="staff-case-filters">
        {clientId && <input type="hidden" name="client" value={clientId} />}{attention !== "all" && <input type="hidden" name="attention" value={attention} />}
        <div className="staff-case-filter-primary"><label className="staff-case-search">Поиск<input name="q" type="search" maxLength={120} defaultValue={query} placeholder="Номер дела, договор, название или клиент" /></label><div className="staff-case-filter-actions"><button type="submit">Найти дело</button><Link href="/staff/cases">Сбросить</Link></div></div>
        <details className="staff-advanced-filters" open={Boolean(status !== "all" || staffId || serviceId || stageId)}><summary>Дополнительные фильтры{status !== "all" || staffId || serviceId || stageId ? " · применены" : ""}</summary><div>
          <label>Статус<select name="status" defaultValue={status}><option value="all">Любой статус</option><option value="open">В работе</option><option value="suspended">Приостановлено</option><option value="closed">Завершено</option></select></label>
          {staff.role !== "lawyer" && <label>Сотрудник<select name="staff" defaultValue={staffId ?? ""}><option value="">Все сотрудники</option>{staffResult.data?.map((person) => <option key={person.user_id} value={person.user_id}>{person.display_name}</option>)}</select></label>}
          <label>Услуга<select name="service" defaultValue={serviceId ?? ""}><option value="">Все услуги</option>{servicesResult.data?.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
          <label>Этап<select name="stage" defaultValue={stageId ?? ""}><option value="">Любой этап</option>{stagesResult.data?.map((stage) => { const version = versionById.get(stage.version_id); return <option key={stage.id} value={stage.id}>{stage.title}{version ? ` · ${serviceById.get(version.service_id) ?? "Услуга"} v${version.version_no}` : ""}</option>; })}</select></label>
        </div><button type="submit" className="staff-advanced-apply">Применить фильтры</button></details>
      </form>
      <nav className="staff-filter-tabs" aria-label="Быстрые фильтры дел">{attentionOptions.map((option) => <Link key={option.value} href={filterHref(option.value)} className={attention === option.value ? "is-active" : ""} aria-current={attention === option.value ? "page" : undefined}>{option.label}</Link>)}</nav>
      {clientId && <p className="staff-filter-context">Дела клиента: <strong>{selectedClientResult.data?.full_name ?? "выбранная карточка"}</strong> <Link href="/staff/cases">Показать все</Link></p>}
      {[staffResult.error, servicesResult.error, stagesResult.error, serviceVersionsResult.error].some(Boolean) && <p className="staff-alert is-error">Некоторые фильтры не загрузились. Обновите страницу.</p>}
    </section>
    <section className="staff-list-section staff-worklist-section"><div className="staff-section-heading"><h2>Список дел</h2><span>{countLabel(count, "результат", "результата", "результатов")}</span></div>{result.error ? <div className="staff-alert is-error" role="alert">Не удалось загрузить дела. Обновите страницу.</div> : result.items.length ? <div className="staff-case-list">{result.items.map((item) => <Link href={`/staff/cases/${item.case_id}`} className="staff-case-list-row" key={item.case_id}><span className="staff-case-list-main"><span className="staff-case-list-meta">№ {item.case_number} · {item.service_name}</span><strong>{item.title}</strong><small>{item.client_name}{item.stage_name ? ` · ${item.stage_name}` : ""}</small></span><span className="staff-case-list-side"><span className="staff-case-list-tags">{Number(item.unread_count) > 0 && <span className="staff-signal is-unread">{item.unread_count} новых</span>}{Number(item.review_count) > 0 && <span className="staff-signal">{item.review_count} документов</span>}{Number(item.overdue_count) > 0 && <span className="staff-signal is-overdue">{item.overdue_count} просрочено</span>}{!Number(item.unread_count) && !Number(item.review_count) && !Number(item.overdue_count) && <span className="staff-signal is-neutral">{item.is_suspended ? "Приостановлено" : item.status === "open" ? "В работе" : item.status === "closed" ? "Завершено" : "Отменено"}</span>}</span><time dateTime={item.updated_at}>Обновлено {worklistDate(item.updated_at)}</time></span><span className="staff-case-list-arrow" aria-hidden="true">›</span></Link>)}</div> : <div className="staff-empty-box"><h3>Дела не найдены</h3><p>Попробуйте убрать часть фильтров или изменить запрос.</p><Link href="/staff/cases" className="staff-text-link">Сбросить фильтры →</Link></div>}
      {!result.error && pages > 1 && <nav className="staff-pagination" aria-label="Страницы дел">{page > 1 && <Link href={filterHref(attention, page - 1)}>← Назад</Link>}<span>Страница {page} из {pages}</span>{page < pages && <Link href={filterHref(attention, page + 1)}>Далее →</Link>}</nav>}
    </section>
    {staff.role !== "lawyer" && <details className="staff-create-case" open={Boolean(clientSearch || params.error || (count === 0 && attention === "all" && !query))}><summary><span><strong>Открыть новое дело</strong><small>На основе карточки клиента и опубликованной услуги</small></span><span aria-hidden="true">＋</span></summary><div className="staff-create-case-body"><form action="/staff/cases" method="get" className="staff-search-form"><label htmlFor="client-search">Найти клиента по имени, email или телефону</label><div><input id="client-search" name="clientSearch" type="search" maxLength={120} defaultValue={clientSearch} placeholder="Начните вводить данные клиента" />{clientId && <input type="hidden" name="client" value={clientId} />}<button type="submit">Найти</button></div></form>{clientsResult.error || versionsResult.error || selectedClientResult.error ? <div className="staff-alert is-error">Не удалось загрузить данные для создания дела.</div> : clientChoices.length && versions.length ? <form action={createCase} className="staff-form"><label>Клиент<select name="clientId" required defaultValue={clientId ?? ""}><option value="" disabled>Выберите клиента</option>{clientChoices.map((client) => <option value={client.id} key={client.id}>{client.full_name}</option>)}</select></label><label>Услуга<select name="versionId" required defaultValue=""><option value="" disabled>Выберите услугу</option>{versions.map((version) => <option value={version.version_id} key={version.version_id}>{version.service_name} · версия {version.version_no}</option>)}</select></label><label>Название дела<input name="title" required maxLength={180} placeholder="Кратко и понятно для клиента" /></label><SubmitButton>Открыть дело →</SubmitButton></form> : <p className="staff-panel-copy">Для нового дела сначала нужны <Link href="/staff/clients">карточка клиента</Link> и опубликованная услуга{staff.role === "admin" ? <> — <Link href="/staff/services">настроить услуги</Link></> : "."}</p>}</div></details>}
  </>;
}
