import Link from "next/link";
import { Brand } from "../../components/Brand";
import { StaffMobileNav, StaffNav } from "../../components/StaffNav";
import { StaffUnreadCaseProvider } from "../../components/StaffUnreadCaseProvider";
import { requireStaff } from "../../lib/staff";
import { signOutAction } from "../account/actions";
import "./staff.css";
import "./lawyer.css";
import { NavIcon } from "../../components/NavIcon";
import { UnreadNotificationsLink } from "../../components/UnreadNotificationsLink";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { supabase, userId, staff, email, aal } = await requireStaff();
  if (aal === "aal2") {
    const { error } = await supabase.rpc("record_staff_mfa_entry");
    if (error) throw new Error("Не удалось записать подтверждённый вход сотрудника");
  }
  const [notifications, unreadCases] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true })
      .eq("recipient_user_id", userId).is("read_at", null),
    supabase.rpc("staff_unread_case_count"),
  ]);
  const unreadCount = notifications.count ?? 0;
  const unreadCaseCount = unreadCases.error ? null : Number(unreadCases.data ?? 0);
  return <StaffUnreadCaseProvider initialCount={unreadCaseCount}><div className={`staff-shell${staff.role === "lawyer" ? " lawyer-shell" : ""}`}><a className="skip-link" href="#main-content">К содержимому</a>
    <aside className="staff-sidebar"><Brand href="/staff" /><StaffNav role={staff.role} unreadCount={unreadCount ?? 0} /><div className="staff-sidebar-foot"><span>{staff.display_name}</span><small>{staff.role === "admin" ? (staff.is_primary_admin ? "Главный администратор" : "Администратор") : staff.role === "manager" ? "Менеджер" : "Юрист"}</small>{email && <small className="staff-current-email">{email}</small>}</div></aside>
    <div className="staff-workspace"><header className="staff-topbar"><div className="staff-topbar-mobile-brand"><Brand href="/staff" /></div>{staff.role === "lawyer" ? <><form action="/staff/cases" className="lawyer-global-search" role="search"><NavIcon name="search" size={17} /><input type="search" name="q" aria-label="Поиск по делам и клиентам" placeholder="Поиск по делам, клиентам…" maxLength={120} /><button type="submit">Найти</button></form><div className="lawyer-topbar-profile"><UnreadNotificationsLink href="/staff/notifications" label="Уведомления" icon={<NavIcon name="notifications" />} initialCount={unreadCount} /><span className="lawyer-avatar">{staff.display_name.slice(0, 1)}</span><span><strong>{staff.display_name}</strong><small>Юрист</small></span></div></> : <div className="staff-topbar-identity"><strong>Рабочее пространство</strong><span>{staff.role === "admin" ? (staff.is_primary_admin ? "Главный администратор" : "Администратор") : staff.role === "manager" ? "Менеджер" : "Юрист"}</span></div>}<div className="staff-topbar-actions"><Link href="/staff-security">Безопасность аккаунта</Link><form action={signOutAction}><button type="submit">Выйти</button></form></div></header><div className="staff-mobile-nav"><StaffMobileNav role={staff.role} unreadCount={unreadCount ?? 0} /></div><main id="main-content" className="staff-page">{children}</main></div>
  </div></StaffUnreadCaseProvider>;
}
