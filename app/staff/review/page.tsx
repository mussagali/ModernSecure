import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "../../../lib/staff";

export const metadata: Metadata = { title: "Проверка документов — Современная защита" };

export default async function DocumentReviewQueue({ searchParams }: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { supabase } = await requireStaff(["admin", "lawyer"]);
  const query = await searchParams;
  const page = Math.max(1, Math.min(200, Number.parseInt(query.page ?? "1", 10) || 1));
  const size = 25;
  const files = await supabase.from("document_files")
    .select("id, request_id, original_name, uploaded_at", { count: "exact" })
    .eq("status", "under_review")
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

  return <><div className="staff-page-heading"><div><span className="staff-eyebrow">РАБОЧАЯ ОЧЕРЕДЬ</span><h1>Проверка документов</h1><p>Файлы, которые клиенты или сотрудники загрузили и ещё не рассмотрели. Откройте дело, чтобы принять документ или вернуть его с причиной.</p></div><span className="staff-role-pill">{files.count ?? 0} на проверке</span></div>
    {(files.data ?? []).length ? <div className="staff-work-list">{files.data?.map((file) => {
      const request = requestById.get(file.request_id);
      const item = request ? caseById.get(request.case_id) : null;
      if (!request || !item) return null;
      return <article className="staff-work-card" key={file.id}><div className="staff-work-head"><h2>{file.original_name}</h2><span className="staff-tag">На проверке</span></div><p>№ {item.case_number} · {item.title}</p><small>{request.title} · {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Almaty" }).format(new Date(file.uploaded_at))}</small><p>{item.status !== "open" || item.is_suspended ? "Рассмотрение недоступно, пока дело не вернётся в активную работу." : <Link href={`/staff/cases/${item.id}/documents#file-${file.id}`}>Рассмотреть документ →</Link>}</p></article>;
    })}</div> : <div className="staff-empty-box"><h3>Очередь пуста</h3><p>Новые файлы появятся здесь сразу после завершения загрузки.</p></div>}
    {pages > 1 && <nav className="staff-pagination" aria-label="Страницы документов">{page > 1 && <Link href={`/staff/review?page=${page - 1}`}>← Назад</Link>}<span>Страница {page} из {pages}</span>{page < pages && <Link href={`/staff/review?page=${page + 1}`}>Далее →</Link>}</nav>}
  </>;
}
