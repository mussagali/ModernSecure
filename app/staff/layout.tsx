import Link from "next/link";
import { Brand } from "../../components/Brand";
import { StaffMobileNav, StaffNav } from "../../components/StaffNav";
import { StaffUnreadCaseProvider } from "../../components/StaffUnreadCaseProvider";
import { requireStaff } from "../../lib/staff";
import { signOutAction } from "../account/actions";
import "./staff.css";

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
  return <StaffUnreadCaseProvider initialCount={unreadCaseCount}><div className="staff-shell"><a className="skip-link" href="#main-content">К содержимому</a>
    <aside className="staff-sidebar"><Brand href="/staff" /><StaffNav role={staff.role} unreadCount={unreadCount ?? 0} /><div className="staff-sidebar-foot"><span>{staff.display_name}</span><small>{staff.role === "admin" ? (staff.is_primary_admin ? "Главный администратор" : "Администратор") : staff.role === "manager" ? "Менеджер" : "Юрист"}</small>{email && <small className="staff-current-email">{email}</small>}</div></aside>
    <div className="staff-workspace"><header className="staff-topbar"><div className="staff-topbar-mobile-brand"><Brand href="/staff" /></div><div className="staff-topbar-identity"><strong>Рабочее пространство</strong><span>{staff.role === "admin" ? (staff.is_primary_admin ? "Главный администратор" : "Администратор") : staff.role === "manager" ? "Менеджер" : "Юрист"}</span></div><div className="staff-topbar-actions"><Link href="/staff-security">Безопасность аккаунта</Link><form action={signOutAction}><button type="submit">Выйти</button></form></div></header><div className="staff-mobile-nav"><StaffMobileNav role={staff.role} unreadCount={unreadCount ?? 0} /></div><main id="main-content" className="staff-page">{children}</main></div>
  </div></StaffUnreadCaseProvider>;
}
