import Link from "next/link";
import { ListPagination } from "../../../../../components/ListControls";
import { formatKzDate, requireClientCase } from "../../../../../lib/client-case";
import { queryPage } from "../../../../../lib/list-query";

const pageSize = 25;

export default async function ClientCaseHistory({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { id } = await params;
  const { supabase, item } = await requireClientCase(id);
  let page = queryPage((await searchParams).page);
  const loadPage = (number: number) => supabase.from("case_stage_events")
    .select("id, to_stage_id, client_note, occurred_at", { count: "exact" })
    .eq("case_id", id).order("occurred_at", { ascending: false }).order("id", { ascending: false })
    .range((number - 1) * pageSize, number * pageSize - 1);
  let result = await loadPage(page);
  if (result.error) throw new Error("Не удалось загрузить историю дела");
  const count = result.count ?? 0;
  const lastPage = Math.max(1, Math.ceil(count / pageSize));
  if (page > lastPage) {
    page = lastPage;
    result = await loadPage(page);
    if (result.error) throw new Error("Не удалось загрузить историю дела");
  }
  const { data: stages, error } = await supabase.from("stage_templates")
    .select("id, title").eq("version_id", item.service_version_id);
  if (error) throw new Error("Не удалось загрузить названия этапов");
  const names = new Map((stages ?? []).map(stage => [stage.id, stage.title]));
  return <section className="account-detail-section case-workspace">
    <h2>История этапов</h2>
    <p><Link className="staff-text-link" href={`/account/cases/${id}`}>Вернуться к делу</Link></p>
    {result.data?.length ? <ol className="account-events">{result.data.map(event => <li key={event.id}>
      <time dateTime={event.occurred_at}>{formatKzDate(event.occurred_at)}</time>
      <strong>{names.get(event.to_stage_id) ?? "Изменение этапа"}</strong>
      <p>{event.client_note}</p>
    </li>)}</ol> : <p className="sovz-muted">Обновлений пока нет.</p>}
    <ListPagination path={`/account/cases/${id}/history`} page={page} count={count} pageSize={pageSize} label="Страницы истории этапов" />
  </section>;
}
