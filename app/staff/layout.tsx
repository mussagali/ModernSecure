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
  const [notifications, unreadCases, contactSettings] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true })
      .eq("recipient_user_id", userId).is("read_at", null),
    supabase.rpc("staff_unread_case_count"),
    staff.role === "admin" ? supabase.from("contact_settings").select("phone, email, whatsapp_url, payment_details").eq("id", true).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  const unreadCount = notifications.count ?? 0;
  const unreadCaseCount = unreadCases.error ? null : Number(unreadCases.data ?? 0);
  const contact = contactSettings.data;
  const missingSettings = staff.role === "admin" && !contactSettings.error && (!contact?.payment_details?.trim() || !(contact?.phone?.trim() || contact?.email?.trim() || contact?.whatsapp_url?.trim()));
  return <StaffUnreadCaseProvider initialCount={unreadCaseCount}><div className="staff-shell"><a className="skip-link" href="#main-content">К содержимому</a>
    <aside className="staff-sidebar"><Brand href="/staff" /><StaffNav role={staff.role} unreadCount={unreadCount ?? 0} /><div className="staff-sidebar-foot"><span>{staff.display_name}</span><small>{staff.role === "admin" ? (staff.is_primary_admin ? "Главный администратор" : "Администратор") : staff.role === "manager" ? "Менеджер" : "Юрист"}</small>{email && <small className="staff-current-email">{email}</small>}</div></aside>
    <div className="staff-workspace"><header className="staff-topbar"><div className="staff-topbar-mobile-brand"><Brand href="/staff" /></div><div className="staff-topbar-identity"><strong>Рабочее пространство</strong><span>{staff.role === "admin" ? (staff.is_primary_admin ? "Главный администратор" : "Администратор") : staff.role === "manager" ? "Менеджер" : "Юрист"}</span></div><div className="staff-topbar-actions"><Link href="/staff-security">Безопасность аккаунта</Link><form action={signOutAction}><button type="submit">Выйти</button></form></div></header><div className="staff-mobile-nav"><StaffMobileNav role={staff.role} unreadCount={unreadCount ?? 0} /></div><main id="main-content" className="staff-page">{missingSettings && <p className="staff-alert" role="status">Не заполнены {!contact?.payment_details?.trim() ? "реквизиты для оплаты" : ""}{!contact?.payment_details?.trim() && !(contact?.phone?.trim() || contact?.email?.trim() || contact?.whatsapp_url?.trim()) ? " и " : ""}{!(contact?.phone?.trim() || contact?.email?.trim() || contact?.whatsapp_url?.trim()) ? "контакты поддержки" : ""}. <Link href="/staff/settings#contacts">Заполнить в настройках</Link></p>}{children}</main></div>
  </div></StaffUnreadCaseProvider>;
}
