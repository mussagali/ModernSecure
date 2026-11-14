import { StaffReferenceShell } from "../../components/StaffReferenceShell";
import { MobilePush } from "../../components/MobilePush";
import { StaffUnreadCaseProvider } from "../../components/StaffUnreadCaseProvider";
import { requireStaff } from "../../lib/staff";
import "./staff.css";
import "./lawyer.css";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { supabase, userId, staff, aal } = await requireStaff();
  if (aal === "aal2") {
    const { error } = await supabase.rpc("record_staff_mfa_entry");
    if (error) throw new Error("Не удалось записать подтверждённый вход сотрудника");
  }
  const [notifications, unreadCases, pendingAccounts] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true })
      .eq("recipient_user_id", userId).is("read_at", null),
    supabase.rpc("staff_unread_case_count"),
    staff.role === "admin" ? supabase.rpc("admin_pending_account_summary") : Promise.resolve(null),
  ]);
  const unreadCount = notifications.count ?? 0;
  const unreadCaseCount = unreadCases.error ? null : Number(unreadCases.data ?? 0);
  const pendingCount = pendingAccounts?.error ? 0 : Number(pendingAccounts?.data?.total_count ?? 0);
  const roleLabel = staff.role === "admin" ? (staff.is_primary_admin ? "Главный администратор" : "Администратор") : staff.role === "manager" ? "Менеджер" : "Юрист";
  return <StaffUnreadCaseProvider initialCount={unreadCaseCount}><StaffReferenceShell role={staff.role} name={staff.display_name} roleLabel={roleLabel} unreadCount={unreadCount} pendingCount={pendingCount}>{children}<MobilePush /></StaffReferenceShell></StaffUnreadCaseProvider>;
}
