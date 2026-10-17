import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "../../../lib/staff";
import { notificationActionLabel } from "../../../lib/notification-links";
import { markStaffInboxRead, openStaffNotification } from "./actions";

export const metadata: Metadata = { title: "Уведомления — Современная защита" };

export default async function StaffNotificationsPage({ searchParams }: {
  searchParams: Promise<{ page?: string; read?: string; error?: string }>;
}) {
  const { supabase, userId } = await requireStaff();
  const query = await searchParams;
  const page = Math.max(1, Math.min(1000, Number.parseInt(query.page ?? "1", 10) || 1));
  const size = 30;
  const [list, unread] = await Promise.all([
    supabase.from("notifications")
      .select("id, title, body, target_path, created_at, read_at", { count: "exact" })
      .eq("recipient_user_id", userId).order("created_at", { ascending: false })
      .range((page - 1) * size, page * size - 1),
    supabase.from("notifications").select("id", { count: "exact", head: true })
      .eq("recipient_user_id", userId).is("read_at", null),
  ]);
  const { data: notifications, count, error } = list;
  if (error || unread.error) throw new Error("Не удалось загрузить уведомления сотрудника");
  const pages = Math.ceil((count ?? 0) / size);
  return <><div className="staff-page-heading"><div><h1>Уведомления</h1><p>Назначения, сообщения клиентов и другие события по доступным вам делам.</p></div><span className="staff-role-pill">{count ?? 0} всего</span></div>
    {query.read && <div className="staff-alert is-success">Уведомления отмечены прочитанными.</div>}{query.error && <div className="staff-alert is-error">{query.error === "open" ? "Не удалось открыть уведомление. Повторите попытку." : "Не удалось обновить уведомления."}</div>}
    {(unread.count ?? 0) > 0 && <form action={markStaffInboxRead} className="case-quiet-form"><button type="submit">Отметить уведомления прочитанными</button></form>}
    {notifications?.length ? <div className="staff-work-list">{notifications.map((notice) => <article className="staff-work-card" key={notice.id}><div className="staff-work-head"><h2>{notice.title}</h2><span className="staff-tag">{notice.read_at ? "Прочитано" : "Новое"}</span></div>{notice.body && <p>{notice.body}</p>}<small>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Almaty" }).format(new Date(notice.created_at))}</small><form action={openStaffNotification} className="notification-open-form"><input type="hidden" name="notificationId" value={notice.id} /><button type="submit">{notificationActionLabel(notice.target_path, "staff")}</button></form></article>)}</div> : <div className="staff-empty-box"><h3>Уведомлений пока нет</h3></div>}
    {pages > 1 && <nav className="staff-pagination" aria-label="Страницы уведомлений">{page > 1 && <Link href={`/staff/notifications?page=${page - 1}`}>Назад</Link>}<span>Страница {page} из {pages}</span>{page < pages && <Link href={`/staff/notifications?page=${page + 1}`}>Далее</Link>}</nav>}
  </>;
}
