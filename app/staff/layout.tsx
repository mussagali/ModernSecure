import { WorkspaceSearch } from "../../components/WorkspaceSearch";
import { MobilePush } from "../../components/MobilePush";
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
  const roleLabel = staff.role === "admin" ? (staff.is_primary_admin ? "Главный администратор" : "Администратор") : staff.role === "manager" ? "Менеджер" : "Юрист";
  return <StaffUnreadCaseProvider initialCount={unreadCaseCount}><div className={`staff-shell${staff.role === "lawyer" ? " lawyer-shell" : ""}`}><a className="skip-link" href="#main-content">К содержимому</a>
    <aside className="staff-sidebar">
      <Brand href="/staff" />
      <StaffNav role={staff.role} unreadCount={unreadCount} />
      <div className="staff-sidebar-foot"><div className="workspace-identity-mark" aria-hidden="true">{staff.display_name.trim().slice(0, 1)}</div><span>{staff.display_name}</span><small>{roleLabel}</small>{email && <small className="staff-current-email">{email}</small>}<Link href="/staff-security"><NavIcon name="settings" size={17} />Безопасность аккаунта</Link></div>
    </aside>
    <div className="staff-workspace">
      <header className="staff-topbar">
        <div className="staff-topbar-mobile-brand"><Brand href="/staff" /></div>
        <WorkspaceSearch />
        <div className="staff-topbar-actions">
          <UnreadNotificationsLink href="/staff/notifications" className="staff-topbar-notifications" label="Уведомления" icon={<NavIcon name="notifications" size={21} />} initialCount={unreadCount} />
          <form action={signOutAction}><button type="submit">Выйти</button></form>
        </div>
      </header>
      <div className="staff-mobile-nav"><StaffMobileNav role={staff.role} unreadCount={unreadCount} /></div>
      <main id="main-content" className="staff-page">{children}<MobilePush /></main>
    </div>
  </div></StaffUnreadCaseProvider>;
}
