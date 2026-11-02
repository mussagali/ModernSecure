import { loadListPage } from "../../../lib/list-page";
import { ListSearch, ListPagination } from "../../../components/ListControls";
import { queryPage, queryText, searchPattern, listHref } from "../../../lib/list-query";
import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "../../../lib/staff";

export const metadata: Metadata = { title: "Проверка документов | Современная защита" };

export default async function DocumentReviewQueue({ searchParams }: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const { supabase } = await requireStaff(["admin", "lawyer"]);
  const query = await searchParams;
  let page = queryPage(query.page);
  const q = queryText(query.q);
  const size = 25;
  const status = ["all", "accepted", "returned"].includes(query.status ?? "") ? query.status! : "under_review";
  let fileQuery = supabase.from("document_files")
    .select("id, request_id, original_name, uploaded_at, status, document_requests!inner(status, cases!inner(status, is_suspended))", { count: "exact" });
  fileQuery = status === "all" ? fileQuery.in("status", ["under_review", "accepted", "returned"]) : fileQuery.eq("status", status);
  if (status === "under_review") fileQuery = fileQuery.eq("document_requests.status", "active")
    .eq("document_requests.cases.status", "open").eq("document_requests.cases.is_suspended", false);
  if (q) fileQuery = fileQuery.ilike("original_name", searchPattern(q));
  fileQuery = fileQuery.order("uploaded_at", { ascending: false }).order("id");
  const files = await loadListPage(target => fileQuery.range((target - 1) * size, target * size - 1), page, size);
  page = files.page;
  if (files.error) throw new Error("Не удалось загрузить очередь проверки документов");

  const requestIds = [...new Set((files.data ?? []).map((file) => file.request_id))];
  const requests = requestIds.length
    ? await supabase.from("document_requests").select("id, case_id, title, status").in("id", requestIds)
    : { data: [], error: null };
  if (requests.error) throw new Error("Не удалось загрузить дела для проверки документов");
  const caseIds = [...new Set((requests.data ?? []).map((request) => request.case_id))];
  const cases = caseIds.length
    ? await supabase.from("cases").select("id, case_number, title, status, is_suspended").in("id", caseIds)
    : { data: [], error: null };
  if (cases.error) throw new Error("Не удалось загрузить номера дел для проверки документов");

  const requestById = new Map((requests.data ?? []).map((request) => [request.id, request]));
  const caseById = new Map((cases.data ?? []).map((item) => [item.id, item]));

  return <><div className="staff-page-heading"><div><h1>Документы</h1><p>Документы по доступным вам делам. Откройте файл, чтобы посмотреть его и принять решение.</p></div><span className="staff-role-pill">{files.count ?? 0} документов</span></div>
    <nav className="staff-filter-tabs" aria-label="Статус документов">{[["all", "Все"], ["under_review", "Нужно проверить"], ["accepted", "Приняты"], ["returned", "Нужны исправления"]].map(([value, label]) => <Link key={value} href={listHref("/staff/review", { status: value, q })} className={status === value ? "is-active" : ""} aria-current={status === value ? "page" : undefined}>{label}</Link>)}</nav>
    <ListSearch action="/staff/review" query={q} placeholder="Найти файл по названию" hidden={{ status }} resetHref={q ? listHref("/staff/review", { status }) : undefined} />
    <div className="lawyer-table-wrap"><table className="lawyer-table"><thead><tr><th>Название</th><th>Дело</th><th>Статус</th><th>Дата</th><th>Действие</th></tr></thead><tbody>{files.data?.map(file => {
      const request = requestById.get(file.request_id);
      const item = request ? caseById.get(request.case_id) : null;
      if (!item) return null;
      const canReview = file.status === "under_review" && request?.status === "active" && item.status === "open" && !item.is_suspended;
      return <tr key={file.id}><td data-label="Название"><strong>{file.original_name}</strong><small>{request?.title}</small></td><td data-label="Дело"><Link href={`/staff/cases/${item.id}`}>№ {item.case_number}</Link></td><td data-label="Статус"><span className={`lawyer-status ${file.status === "accepted" ? "green" : ""}`}>{file.status === "accepted" ? "Принят" : file.status === "returned" ? "Нужны исправления" : "На проверке"}</span></td><td data-label="Дата">{new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeZone: "Asia/Almaty" }).format(new Date(file.uploaded_at))}</td><td data-label="Действие"><Link href={`/staff/review/${file.id}`}>{canReview ? "Проверить" : "Открыть"}</Link></td></tr>;
    })}</tbody></table>{!files.data?.length && <div className="lawyer-empty"><h3>{q ? "Документы не найдены" : "Нет документов в этом списке"}</h3><p>{q ? "Попробуйте другую часть названия файла." : "Выберите другой статус или дождитесь загрузки документов."}</p></div>}</div>
    <ListPagination path="/staff/review" page={page} count={files.count ?? 0} params={{ status, q }} />
  </>;
}
