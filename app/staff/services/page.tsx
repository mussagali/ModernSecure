import { loadListPage } from "../../../lib/list-page";
import { ListSearch, ListPagination } from "../../../components/ListControls";
import { queryPage, queryText, searchPattern, type ListParams } from "../../../lib/list-query";
import type { Metadata } from "next";
import Link from "next/link";
import { ServiceDocumentFields } from "../../../components/ServiceDocumentFields";
import { SubmitButton } from "../../../components/SubmitButton";
import { requireStaff } from "../../../lib/staff";
import { createService } from "../actions";

export const metadata: Metadata = { title: "Услуги | Современная защита" };

export default async function StaffServicesPage({ searchParams }: { searchParams: Promise<ListParams> }) {
  const { supabase } = await requireStaff(["admin"]);
  const params = await searchParams;
  const q = queryText(params.q);
  let page = queryPage(params.page);
  const { created, error: actionError } = params;
  let request = supabase.from("service_templates").select("id, name, code, active, created_at, service_template_versions(version_no)", { count: "exact" });
  if (q) request = request.ilike("name", searchPattern(q));
  request = request.order("name").order("id").order("version_no", { referencedTable: "service_template_versions", ascending: false }).limit(1, { referencedTable: "service_template_versions" });
  const result = await loadListPage(target => request.range((target - 1) * 25, target * 25 - 1), page);
  const { data: services, error, count } = result;
  page = result.page;

  return <><div className="staff-page-heading"><div><h1>Услуги, этапы и документы</h1><p>Дело закрепляется за опубликованной версией услуги. Новая версия не переписывает уже открытые дела.</p></div></div>
    {created === "1" && <div className="staff-alert is-success" role="status">Услуга, этапы и список документов опубликованы. Теперь можно открыть дело.</div>}
    {actionError && <div className="staff-alert is-error" role="alert">Не удалось создать услугу. Проверьте название, этапы и список документов.</div>}
    <details className="form-disclosure"><summary>Добавить услугу</summary><div className="staff-form-panel"><div><p>Укажите этапы по одному на строку и документы, которые понадобятся клиенту. При создании дела запросы будут добавлены автоматически.</p></div><form action={createService} className="staff-form"><label>Название услуги <input name="name" required maxLength={160} placeholder="Например: сопровождение процедуры" /></label><label>Этапы <textarea name="stages" required rows={7} placeholder={"Первичная консультация\nСбор документов\nПодготовка заявления\nПодача заявления\nРассмотрение"} /></label><span className="staff-form-hint">От 1 до 12 этапов, каждый с новой строки.</span><ServiceDocumentFields /><SubmitButton>Опубликовать услугу</SubmitButton></form></div></details>
    <ListSearch action="/staff/services" query={q} placeholder="Найти услугу по названию" resetHref={q ? "/staff/services" : undefined} />
    <section className="staff-list-section"><div className="staff-section-heading"><h2>Доступные услуги</h2><span>{count ?? 0}</span></div>{error ? <p className="staff-alert is-error" role="alert">Не удалось загрузить услуги.</p> : services?.length ? <div className="staff-service-grid">{services.map((service) => <article key={service.id} className="staff-service-card"><h3>{service.name}</h3><p>Текущая версия: {service.service_template_versions?.[0]?.version_no ?? "Не указано"}</p><span className={service.active ? "staff-tag is-linked" : "staff-tag"}>{service.active ? "Активна" : "Отключена"}</span><Link href={`/staff/services/${service.id}`} className="staff-text-link">Версии и документы</Link></article>)}</div> : <div className="staff-empty-box"><h3>{q ? "Услуги не найдены" : "Услуг ещё нет"}</h3><p>{q ? "Попробуйте другую часть названия." : "Создайте первую услугу с этапами, чтобы можно было открыть дело."}</p></div>}</section>
    {!error && <ListPagination path="/staff/services" page={page} count={count ?? 0} params={{ q }} />}
  </>;
}
