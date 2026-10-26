import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "../../../../lib/staff";
import { worklistDate, worklistPage } from "../../../../lib/staff-worklist";

export const metadata: Metadata = { title: "Дела без обновлений | Современная защита" };

type StaleCase = {
  case_id: string; case_number: string; title: string; client_name: string;
  last_update_at: string; days_without_update: number; is_suspended: boolean;
  total_count: number;
};

export default async function StaleCasesPage({ searchParams }: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { supabase } = await requireStaff();
  let page = worklistPage((await searchParams).page);
  const [settings, firstPage] = await Promise.all([
    supabase.rpc("staff_stale_case_days"),
    supabase.rpc("staff_stale_case_page", { p_page: page }),
  ]);
  if (settings.error || firstPage.error) throw new Error("Не удалось загрузить дела без обновлений");
  let rows = (firstPage.data ?? []) as StaleCase[];
  let count = Number(rows[0]?.total_count ?? 0);
  if (!rows.length && page > 1) {
    const reset = await supabase.rpc("staff_stale_case_page", { p_page: 1 });
    if (reset.error) throw new Error("Не удалось загрузить дела без обновлений");
    count = Number(reset.data?.[0]?.total_count ?? 0);
    page = Math.max(1, Math.ceil(count / 25));
    if (page === 1) rows = (reset.data ?? []) as StaleCase[];
    else {
      const retry = await supabase.rpc("staff_stale_case_page", { p_page: page });
      if (retry.error) throw new Error("Не удалось загрузить дела без обновлений");
      rows = (retry.data ?? []) as StaleCase[];
    }
  }
  const pages = Math.ceil(count / 25);
  return <>
    <div className="staff-page-heading"><div><h1>Дела без обновлений</h1><p>Открытые дела, в которых клиенту давно не публиковали обновление этапа. Порог | {settings.data} дней; приостановленные дела тоже остаются под контролем.</p></div><span className="staff-role-pill">{count} дел</span></div>
    <p className="staff-case-audit-link"><Link href="/staff/cases">Все дела</Link></p>
    {rows.length ? <div className="staff-case-list">{rows.map((item) => <Link key={item.case_id} href={`/staff/cases/${item.case_id}`} className="staff-case-list-row"><span className="staff-case-list-main"><span className="staff-case-list-meta">№ {item.case_number} · {item.client_name}</span><strong>{item.title}</strong><small>{item.is_suspended ? "Приостановлено · " : ""}Последнее обновление для клиента: {worklistDate(item.last_update_at)}</small></span><span className="staff-case-list-side"><span className="staff-signal is-overdue">{item.days_without_update} дней без обновления</span></span><span className="staff-case-list-arrow" aria-hidden="true">›</span></Link>)}</div>
      : <div className="staff-empty-box"><h3>Нет дел без обновлений</h3><p>Все доступные вам дела обновлялись в пределах установленного срока.</p></div>}
    {pages > 1 && <nav className="staff-pagination" aria-label="Страницы дел без обновлений">{page > 1 && <Link href={`/staff/cases/stale?page=${page - 1}`}>Назад</Link>}<span>Страница {page} из {pages}</span>{page < pages && <Link href={`/staff/cases/stale?page=${page + 1}`}>Далее</Link>}</nav>}
  </>;
}
