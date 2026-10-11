import type { Metadata } from "next";
import Link from "next/link";
import { authAuditActionLabel } from "../../../../lib/auth-audit-labels";
import { authAuditHref, parseAuthAuditCursor } from "../../../../lib/auth-audit-pagination";
import { uuidPattern } from "../../../../lib/client-case";
import { requireStaff } from "../../../../lib/staff";

export const metadata: Metadata = { title: "Входы и авторизация — Современная защита" };

const pageSize = 50;
type AuthAuditEvent = {
  id: string;
  occurred_at: string;
  action: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  provider: string | null;
};

export default async function AuthAuditPage({ searchParams }: {
  searchParams: Promise<{ actor?: string | string[]; before?: string | string[] }>;
}) {
  const { supabase } = await requireStaff(["admin"]);
  const query = await searchParams;
  const actorId = typeof query.actor === "string" && uuidPattern.test(query.actor) ? query.actor : null;
  const cursor = parseAuthAuditCursor(query.before);
  const invalidCursor = query.before !== undefined && !cursor;
  const { data, error } = await supabase.rpc("admin_auth_audit_page", {
    p_before_at: cursor?.at ?? null,
    p_before_id: cursor?.id ?? null,
    p_actor_user_id: actorId,
    p_limit: pageSize,
  });
  const events = ((data ?? []) as AuthAuditEvent[]).slice(0, pageSize);
  const hasOlder = (data?.length ?? 0) > pageSize;
  const olderHref = hasOlder && events.length ? authAuditHref(actorId, events.at(-1)!) : null;
  const newestHref = authAuditHref(actorId);

  return <>
    <div className="staff-page-heading"><div>
      <span className="staff-eyebrow">ГЛАВНЫЙ АДМИНИСТРАТОР · КОНТРОЛЬ</span>
      <h1>Входы и авторизация</h1>
      <p>События Supabase Auth: входы, выходы и действия MFA. IP-адреса и данные устройства здесь не показываются. Подтверждённые MFA-сессии сотрудников отмечаются во вкладке <Link href="/staff/audit">«Операции»</Link>.</p>
    </div></div>
    <nav className="staff-audit-switch" aria-label="Разделы журнала">
      <Link href="/staff/audit">Операции</Link>
      <span aria-current="page">Входы и авторизация</span>
    </nav>
    <div className="staff-audit-toolbar">
      {actorId && <div className="staff-audit-filters" aria-label="Активные фильтры">
        <span>Аккаунт: {events[0]?.actor_email ?? actorId}</span>
        <Link href="/staff/audit/auth">Сбросить фильтр</Link>
      </div>}
      {cursor && <Link href={newestHref}>← К последним событиям</Link>}
    </div>
    {invalidCursor && <p className="staff-alert" role="status">Ссылка на страницу устарела. Показаны последние события.</p>}
    <section className="staff-list-section" aria-label="События авторизации">
      {error ? <p className="staff-alert is-error" role="alert">Не удалось загрузить журнал авторизации. Обновите страницу.</p>
        : events.length ? <>
          <div className="staff-audit-list">{events.map((event) => <article key={event.id}>
            <time dateTime={event.occurred_at}>{new Intl.DateTimeFormat("ru-RU", {
              dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Almaty",
            }).format(new Date(event.occurred_at))}</time>
            <strong>{authAuditActionLabel(event.action)}</strong>
            <span>{event.provider === "email" ? "Почта и пароль" : event.provider || "Supabase Auth"}</span>
            <small>{event.actor_email ? `Аккаунт: ${event.actor_email}` : event.actor_user_id
              ? `Аккаунт: ${event.actor_user_id}` : "Аккаунт не определён"}</small>
          </article>)}</div>
          <nav className="staff-audit-pagination" aria-label="Страницы журнала авторизации">
            <span>Показано {events.length} событий{hasOlder ? "; есть более ранние" : "; это конец истории"}.</span>
            <div>{cursor && <Link href={newestHref}>К последним</Link>}
              {olderHref && <Link href={olderHref}>Более ранние →</Link>}</div>
          </nav>
        </> : <div className="staff-empty-box"><h3>Записей нет</h3>
          <p>По выбранным условиям событий авторизации не найдено.</p>
          {cursor && <Link href={newestHref}>Вернуться к последним событиям →</Link>}
        </div>}
    </section>
  </>;
}
