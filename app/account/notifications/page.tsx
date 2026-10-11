import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { notificationActionLabel } from "../../../lib/notification-links";
import { signOutAction } from "../actions";
import { markClientInboxRead, openClientNotification } from "./actions";

export const metadata: Metadata = { title: "Уведомления — Современная защита" };

export default async function ClientNotificationsPage({ searchParams }: {
  searchParams: Promise<{ page?: string; read?: string; error?: string }>;
}) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) redirect("/login");
  const query = await searchParams;
  const page = Math.max(1, Math.min(1000, Number.parseInt(query.page ?? "1", 10) || 1));
  const size = 30;
  const [list, unread] = await Promise.all([
    supabase.from("notifications")
      .select("id, title, body, target_path, created_at, read_at", { count: "exact" })
      .eq("recipient_user_id", auth.claims.sub).order("created_at", { ascending: false })
      .range((page - 1) * size, page * size - 1),
    supabase.from("notifications").select("id", { count: "exact", head: true })
      .eq("recipient_user_id", auth.claims.sub).is("read_at", null),
  ]);
  const { data: notifications, count, error } = list;
  if (error || unread.error) throw new Error("Не удалось загрузить уведомления");
  const pages = Math.ceil((count ?? 0) / size);
  return <main className="account-page"><header className="account-header"><Link href="/account" className="account-brand"><span className="auth-brand-mark" aria-hidden="true">сз</span><span>современная <strong>защита</strong></span></Link><div className="account-header-actions"><Link href="/account/profile" className="account-staff-link">Профиль</Link><Link href="/account/help" className="account-staff-link">Помощь</Link><form action={signOutAction}><button type="submit" className="account-signout">Выйти</button></form></div></header>
    <div className="account-content account-detail"><Link href="/account" className="account-back">← Мои дела</Link><span className="auth-eyebrow">СОБЫТИЯ ПО ДЕЛАМ</span><h1>Уведомления</h1><p className="account-email">Здесь собраны события по всем вашим делам.</p>
      {query.read && <p className="case-feedback">Уведомления отмечены прочитанными.</p>}{query.error && <p className="case-feedback is-error">{query.error === "open" ? "Не удалось открыть уведомление. Повторите попытку." : "Не удалось обновить уведомления."}</p>}
      {(unread.count ?? 0) > 0 && <form action={markClientInboxRead} className="case-quiet-form"><button type="submit">Отметить уведомления прочитанными</button></form>}
      {notifications?.length ? <div className="case-card-list">{notifications.map((notice) => <article className="case-work-card" key={notice.id}><div className="case-work-head"><h2>{notice.title}</h2><span>{notice.read_at ? "Прочитано" : "Новое"}</span></div>{notice.body && <p>{notice.body}</p>}<small>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Almaty" }).format(new Date(notice.created_at))}</small><form action={openClientNotification} className="notification-open-form"><input type="hidden" name="notificationId" value={notice.id} /><button type="submit">{notificationActionLabel(notice.target_path, "client")}</button></form></article>)}</div> : <p className="account-muted">Уведомлений пока нет.</p>}
      {pages > 1 && <nav className="account-pagination" aria-label="Страницы уведомлений">{page > 1 && <Link href={`/account/notifications?page=${page - 1}`}>← Назад</Link>}<span>Страница {page} из {pages}</span>{page < pages && <Link href={`/account/notifications?page=${page + 1}`}>Далее →</Link>}</nav>}
    </div>
  </main>;
}
