import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "../../../lib/staff";

export const metadata: Metadata = { title: "Проверка документов | Современная защита" };

export default async function DocumentReviewQueue({ searchParams }: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const { supabase } = await requireStaff(["admin", "lawyer"]);
  const query = await searchParams;
  const page = Math.max(1, Math.min(200, Number.parseInt(query.page ?? "1", 10) || 1));
  const size = 25;
  const status = ["all", "accepted", "returned"].includes(query.status ?? "") ? query.status! : "under_review";
  let fileQuery = supabase.from("document_files")
    .select("id, request_id, original_name, uploaded_at, status", { count: "exact" });
  fileQuery = status === "all" ? fileQuery.in("status", ["under_review", "accepted", "returned"]) : fileQuery.eq("status", status);
  const files = await fileQuery
    .order("uploaded_at", { ascending: false })
    .range((page - 1) * size, page * size - 1);
  if (files.error) throw new Error("Не удалось загрузить очередь проверки документов");

  const requestIds = [...new Set((files.data ?? []).map((file) => file.request_id))];
  const requests = requestIds.length
    ? await supabase.from("document_requests").select("id, case_id, title").in("id", requestIds)
    : { data: [], error: null };
  if (requests.error) throw new Error("Не удалось загрузить дела для проверки документов");
  const caseIds = [...new Set((requests.data ?? []).map((request) => request.case_id))];
  const cases = caseIds.length
    ? await supabase.from("cases").select("id, case_number, title, status, is_suspended").in("id", caseIds)
    : { data: [], error: null };
  if (cases.error) throw new Error("Не удалось загрузить номера дел для проверки документов");

  const requestById = new Map((requests.data ?? []).map((request) => [request.id, request]));
  const caseById = new Map((cases.data ?? []).map((item) => [item.id, item]));
  const pages = Math.ceil((files.count ?? 0) / size);

  return <><div className="staff-page-heading"><div><h1>Документы</h1><p>Документы по доступным вам делам. Откройте файл, чтобы посмотреть его и принять решение.</p></div><span className="staff-role-pill">{files.count ?? 0} документов</span></div>
    <nav className="staff-filter-tabs" aria-label="Статус документов">{[["all", "Все"], ["under_review", "Нужно проверить"], ["accepted", "Приняты"], ["returned", "Нужны исправления"]].map(([value, label]) => <Link key={value} href={`?status=${value}`} className={status === value ? "is-active" : ""} aria-current={status === value ? "page" : undefined}>{label}</Link>)}</nav>
    <div className="lawyer-table-wrap"><table className="lawyer-table"><thead><tr><th>Название</th><th>Дело</th><th>Статус</th><th>Дата</th><th>Действие</th></tr></thead><tbody>{files.data?.map(file => {
      const request = requestById.get(file.request_id);
      const item = request ? caseById.get(request.case_id) : null;
      if (!item) return null;
      return <tr key={file.id}><td><strong>{file.original_name}</strong><small>{request?.title}</small></td><td><Link href={`/staff/cases/${item.id}`}>№ {item.case_number}</Link></td><td><span className={`lawyer-status ${file.status === "accepted" ? "green" : ""}`}>{file.status === "accepted" ? "Принят" : file.status === "returned" ? "Нужны исправления" : "На проверке"}</span></td><td>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeZone: "Asia/Almaty" }).format(new Date(file.uploaded_at))}</td><td><Link href={`/staff/review/${file.id}`}>{file.status === "under_review" ? "Проверить" : "Открыть"}</Link></td></tr>;
    })}</tbody></table>{!files.data?.length && <div className="lawyer-empty"><h3>Документов пока нет</h3><p>Загруженные файлы появятся здесь после завершения загрузки.</p></div>}</div>
    {pages > 1 && <nav className="staff-pagination" aria-label="Страницы документов">{page > 1 && <Link href={`/staff/review?status=${status}&page=${page - 1}`}>Назад</Link>}<span>Страница {page} из {pages}</span>{page < pages && <Link href={`/staff/review?status=${status}&page=${page + 1}`}>Далее</Link>}</nav>}
  </>;
}
