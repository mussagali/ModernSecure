import type { Metadata } from "next";
import Link from "next/link";
import { auditActionLabel, auditEntityLabel } from "../../../lib/audit-labels";
import { auditHref, parseAuditCursor } from "../../../lib/audit-pagination";
import { uuidPattern } from "../../../lib/client-case";
import { requireStaff } from "../../../lib/staff";

export const metadata: Metadata = { title: "Журнал действий — Современная защита" };

const pageSize = 50;
type AuditEvent = {
  id: number | string;
  case_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  reason: string | null;
  occurred_at: string;
  actor_user_id: string | null;
};

export default async function AuditPage({ searchParams }: {
  searchParams: Promise<{ case?: string | string[]; actor?: string | string[]; before?: string | string[] }>;
}) {
  const { supabase } = await requireStaff(["admin"]);
  const query = await searchParams;
  const caseId = typeof query.case === "string" && uuidPattern.test(query.case) ? query.case : null;
  const actorId = typeof query.actor === "string" && uuidPattern.test(query.actor) ? query.actor : null;
  const cursor = parseAuditCursor(query.before);
  const invalidCursor = query.before !== undefined && !cursor;
  const { data, error } = await supabase.rpc("admin_audit_page", {
    p_before_at: cursor?.at ?? null,
    p_before_id: cursor?.id ?? null,
    p_case_id: caseId,
    p_actor_user_id: actorId,
    p_limit: pageSize,
  });
  const events = ((data ?? []) as AuditEvent[]).slice(0, pageSize);
  const hasOlder = (data?.length ?? 0) > pageSize;
  const actorIds = [...new Set([...events.map((event) => event.actor_user_id), actorId]
    .filter((id): id is string => Boolean(id)))];
  const [staffResult, clientResult, caseResult] = await Promise.all([
    actorIds.length ? supabase.from("staff_members").select("user_id, display_name")
      .in("user_id", actorIds) : Promise.resolve({ data: [], error: null }),
    actorIds.length ? supabase.from("clients").select("user_id, full_name")
      .in("user_id", actorIds) : Promise.resolve({ data: [], error: null }),
    caseId ? supabase.from("cases").select("case_number").eq("id", caseId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const names = new Map<string, string>();
  for (const client of clientResult.data ?? []) {
    if (client.user_id) names.set(client.user_id, client.full_name);
  }
  for (const staff of staffResult.data ?? []) names.set(staff.user_id, staff.display_name);
  const actorName = actorId ? names.get(actorId) ?? actorId : null;
  const olderHref = hasOlder && events.length
    ? auditHref(caseId, actorId, events.at(-1)!) : null;
  const newestHref = auditHref(caseId, actorId);
  const loadError = error || staffResult.error || clientResult.error || caseResult.error;

  return <>
    <div className="staff-page-heading"><div>
      <span className="staff-eyebrow">ГЛАВНЫЙ АДМИНИСТРАТОР · КОНТРОЛЬ</span>
      <h1>Журнал действий</h1>
      <p>История операций по всей системе. Записи нельзя изменить задним числом.</p>
    </div></div>
    <nav className="staff-audit-switch" aria-label="Разделы журнала">
      <span aria-current="page">Операции</span>
      <Link href="/staff/audit/auth">Входы и авторизация</Link>
    </nav>
    <div className="staff-audit-toolbar">
      {(caseId || actorId) && <div className="staff-audit-filters" aria-label="Активные фильтры">
        {caseId && <span>Дело: {caseResult.data?.case_number ?? caseId}</span>}
        {actorId && <span>Инициатор: {actorName}</span>}
        <Link href="/staff/audit">Сбросить фильтры</Link>
      </div>}
      {cursor && <Link href={newestHref}>← К последним событиям</Link>}
    </div>
    {invalidCursor && <p className="staff-alert" role="status">Ссылка на страницу устарела. Показаны последние события.</p>}
    <section className="staff-list-section" aria-label="События журнала">
      {loadError ? <p className="staff-alert is-error" role="alert">Не удалось загрузить журнал. Обновите страницу.</p>
        : events.length ? <>
          <div className="staff-audit-list">{events.map((event) => <article key={event.id}>
            <time dateTime={event.occurred_at}>{new Intl.DateTimeFormat("ru-RU", {
              dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Almaty",
            }).format(new Date(event.occurred_at))}</time>
            <strong>{auditActionLabel(event.action, event.entity_type)}</strong>
            <span>{auditEntityLabel(event.entity_type)}</span>
            <small>{event.actor_user_id
              ? `Инициатор: ${names.get(event.actor_user_id) ?? event.actor_user_id}`
              : "Системное действие"}</small>
            {event.case_id && <Link className="staff-audit-case" href={`/staff/cases/${event.case_id}`}>
              Открыть дело →
            </Link>}
            {event.reason && <p>{event.reason}</p>}
          </article>)}</div>
          <nav className="staff-audit-pagination" aria-label="Страницы журнала">
            <span>Показано {events.length} событий{hasOlder ? "; есть более ранние" : "; это конец истории"}.</span>
            <div>{cursor && <Link href={newestHref}>К последним</Link>}
              {olderHref && <Link href={olderHref}>Более ранние →</Link>}</div>
          </nav>
        </> : <div className="staff-empty-box"><h3>Записей нет</h3>
          <p>По выбранным условиям событий не найдено.</p>
          {cursor && <Link href={newestHref}>Вернуться к последним событиям →</Link>}
        </div>}
    </section>
  </>;
}
