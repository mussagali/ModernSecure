import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ServiceDocumentFields } from "../../../../components/ServiceDocumentFields";
import { SubmitButton } from "../../../../components/SubmitButton";
import { requireStaff } from "../../../../lib/staff";
import { publishServiceVersion } from "../../actions";

export const metadata: Metadata = { title: "Версии услуги | Современная защита" };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ServiceDetail({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ published?: string; error?: string; page?: string }>;
}) {
  const { id } = await params;
  if (!uuidPattern.test(id)) notFound();
  const { supabase } = await requireStaff(["admin"]);
  const query = await searchParams;
  const page = Math.max(1, Math.min(10000, Number.parseInt(query.page ?? "1", 10) || 1));
  const pageSize = 10;
  const [{ data: service, error: serviceError }, { data: versions, count, error: versionError }, { data: latest, error: latestError }] = await Promise.all([
    supabase.from("service_templates").select("id, name, active").eq("id", id).maybeSingle(),
    supabase.from("service_template_versions").select("id, version_no, published_at", { count: "exact" }).eq("service_id", id).order("version_no", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1),
    supabase.from("service_template_versions").select("id, version_no, published_at").eq("service_id", id).not("published_at", "is", null).order("version_no", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (serviceError || versionError || latestError) throw new Error("Не удалось загрузить услугу");
  if (!service) notFound();
  const versionIds = [...new Set([...(versions ?? []).map((version) => version.id), ...(latest ? [latest.id] : [])])];
  const [{ data: stages, error: stageError }, { data: documents, error: documentError }] = versionIds.length ? await Promise.all([
    supabase.from("stage_templates").select("id, version_id, position, title").in("version_id", versionIds).order("position"),
    supabase.from("document_templates").select("id, version_id, position, title, instructions, required").in("version_id", versionIds).order("position"),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (stageError || documentError) throw new Error("Не удалось загрузить этапы и документы");
  const latestStages = (stages ?? []).filter((stage) => stage.version_id === latest?.id);
  const latestDocuments = (documents ?? []).filter((document) => document.version_id === latest?.id);
  const totalPages = Math.ceil((count ?? 0) / pageSize);

  return <><Link href="/staff/services" className="staff-back">Все услуги</Link>
    <div className="staff-page-heading"><div><h1>{service.name}</h1><p>Дела используют версию, опубликованную на момент открытия. Новая версия предназначена для будущих дел.</p></div><span className="staff-role-pill">Версия {latest?.version_no ?? "Не указано"}</span></div>
    {query.published === "1" && <div className="staff-alert is-success" role="status">Новая версия опубликована. Существующие дела остались на прежней версии.</div>}
    {query.error && <div className="staff-alert is-error" role="alert">{query.error === "stale" ? "Пока форма была открыта, появилась новая версия. Обновите страницу и внесите изменения поверх актуального списка." : "Не удалось опубликовать версию. Проверьте этапы и документы, затем повторите попытку."}</div>}
    {service.active && latest && <section className="staff-form-panel"><div><h2>Обновить маршрут и документы</h2><p>Поля заполнены из последней версии. Изменения вступят в силу только для дел, созданных после публикации.</p></div><form action={publishServiceVersion} className="staff-form"><input type="hidden" name="serviceId" value={id} /><input type="hidden" name="expectedVersionId" value={latest.id} /><label>Этапы по одному на строку<textarea name="stages" required rows={Math.max(5, latestStages.length + 1)} defaultValue={latestStages.map((stage) => stage.title).join("\n")} /></label><span className="staff-form-hint">От 1 до 12 этапов. История старой версии сохранится.</span><ServiceDocumentFields initialDocuments={latestDocuments.map((document) => ({ title: document.title, instructions: document.instructions ?? "", required: document.required }))} /><SubmitButton>Опубликовать новую версию</SubmitButton></form></section>}
    <section className="staff-list-section"><div className="staff-section-heading"><h2>История версий</h2><span>{count ?? 0}</span></div>{versions?.length ? <div className="staff-work-list">{versions.map((version) => <article className="staff-work-card" key={version.id}><div className="staff-work-head"><h3>Версия {version.version_no}</h3><span className="staff-tag is-linked">{version.published_at ? "Опубликована" : "Черновик"}</span></div><p>Этапы: {(stages ?? []).filter((stage) => stage.version_id === version.id).map((stage) => stage.title).join(" → ") || "Нет"}</p><p>Документы: {(documents ?? []).filter((document) => document.version_id === version.id).map((document) => `${document.title}${document.required ? " (обязательный)" : " (по запросу)"}`).join(", ") || "Не заданы"}</p></article>)}</div> : <div className="staff-empty-box"><h3>На этой странице версий нет</h3></div>}{totalPages > 1 && <nav className="staff-pagination" aria-label="Страницы версий">{page > 1 && <Link href={`/staff/services/${id}?page=${page - 1}`}>Назад</Link>}<span>Страница {page} из {totalPages}</span>{page < totalPages && <Link href={`/staff/services/${id}?page=${page + 1}`}>Далее</Link>}</nav>}</section>
  </>;
}
