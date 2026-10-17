import type { Metadata } from "next";
import Link from "next/link";
import { StaffInboxLive } from "../../../components/StaffInboxLive";
import { requireStaff } from "../../../lib/staff";
import { countLabel, getStaffWorklist, worklistCount, worklistDate, worklistPage } from "../../../lib/staff-worklist";

export const metadata: Metadata = { title: "Сообщения — Современная защита" };

export default async function StaffInboxPage({ searchParams }: {
  searchParams: Promise<{ page?: string; q?: string; unread?: string }>;
}) {
  const { supabase } = await requireStaff();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const unreadOnly = params.unread === "1";
  let page = worklistPage(params.page);
  const filters = { query, attention: unreadOnly ? "unread" as const : "messages" as const, sort: "message" as const };
  let result = await getStaffWorklist(supabase, { ...filters, page });
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
  const pages = Math.ceil(count / 25);
  const href = (nextPage: number) => `/staff/inbox?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(unreadOnly ? { unread: "1" } : {}), page: String(nextPage) })}`;

  return <div className="staff-inbox-screen"><StaffInboxLive />
    <div className="staff-page-heading"><div><h1>Сообщения клиентов</h1><p>Все доступные вам разговоры по делам. Для внутреннего обсуждения без доступа клиента откройте <Link href="/staff/chat">чат команды</Link></p></div><span className="staff-role-pill">{unreadOnly ? `${count} с новыми сообщениями` : countLabel(count, "диалог", "диалога", "диалогов")}</span></div>
    <div className="staff-inbox-toolbar">
      <form action="/staff/inbox" method="get" role="search" className="staff-search-form"><label htmlFor="inbox-search">Найти переписку</label><div><input id="inbox-search" type="search" name="q" maxLength={120} defaultValue={query} placeholder="Номер дела, название или клиент" />{unreadOnly && <input type="hidden" name="unread" value="1" />}<button type="submit">Найти</button></div></form>
      <nav className="staff-filter-tabs" aria-label="Фильтр сообщений"><Link href={`/staff/inbox${query ? `?q=${encodeURIComponent(query)}` : ""}`} className={!unreadOnly ? "is-active" : ""} aria-current={!unreadOnly ? "page" : undefined}>Все диалоги</Link><Link href={`/staff/inbox?${new URLSearchParams({ ...(query ? { q: query } : {}), unread: "1" })}`} className={unreadOnly ? "is-active" : ""} aria-current={unreadOnly ? "page" : undefined}>Непрочитанные</Link></nav>
    </div>
    {result.error ? <div className="staff-alert is-error" role="alert">Не удалось загрузить переписки. Обновите страницу.</div> : result.items.length ? <div className="staff-inbox-list">{result.items.map((item) => <Link key={item.case_id} href={`/staff/cases/${item.case_id}/messages`} className={`staff-inbox-row${Number(item.unread_count) > 0 ? " has-unread" : ""}`}><span className="staff-inbox-avatar" aria-hidden="true">{item.client_name.trim().slice(0, 1).toLocaleUpperCase("ru-RU")}</span><span className="staff-inbox-copy"><span className="staff-inbox-top"><strong>{item.client_name}</strong><time dateTime={item.last_message_at ?? undefined}>{worklistDate(item.last_message_at)}</time></span><span className="staff-inbox-case">№ {item.case_number} · {item.title}</span><span className="staff-inbox-preview">{item.last_message_body ?? "Начните переписку по делу"}</span></span><span className="staff-inbox-trailing">{Number(item.unread_count) > 0 && <span className="staff-unread-badge" aria-label={`${item.unread_count} непрочитанных сообщений`}>{item.unread_count}</span>}</span></Link>)}</div> : <div className="staff-empty-box"><h3>{query ? "Ничего не найдено" : unreadOnly ? "Все сообщения прочитаны" : "Переписок пока нет"}</h3><p>{query ? "Попробуйте другое имя или номер дела." : unreadOnly ? "Новые сообщения появятся здесь автоматически после обновления страницы." : "Откройте дело и напишите клиенту — диалог появится в этом списке."}</p>{!query && !unreadOnly && <Link href="/staff/cases" className="staff-text-link">Перейти к делам</Link>}</div>}
    {!result.error && pages > 1 && <nav className="staff-pagination" aria-label="Страницы переписок">{page > 1 && <Link href={href(page - 1)}>Назад</Link>}<span>Страница {page} из {pages}</span>{page < pages && <Link href={href(page + 1)}>Далее</Link>}</nav>}
  </div>;
}
