import type { Metadata } from "next";
import { Brand } from "../../components/Brand";
import { redirect } from "next/navigation";
import { signOutAction } from "../account/actions";
import { StaffMfaPanel } from "../../components/StaffMfaPanel";
import { getStaffStatus } from "../../lib/staff";
import { createClient } from "../../lib/supabase/server";
import "./security.css";

export const metadata: Metadata = { title: "Защита входа сотрудника — Современная защита" };

export default async function StaffSecurityPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) redirect("/login");
  const { staff, error } = await getStaffStatus(supabase);
  if (error) throw new Error("Не удалось проверить защиту входа");
  if (!staff?.active) redirect("/account?staffAccess=denied");

  return <main className="staff-security-page">
    <header className="staff-security-top"><Brand href={staff.mfa_passed ? "/staff" : "/staff-security"} /><form action={signOutAction}><button type="submit">Выйти</button></form></header>
    <section className="staff-security-content"><h1>Безопасность аккаунта</h1><p className="staff-security-intro">Код из приложения-аутентификатора защищает клиентские дела, документы и переписку даже если пароль стал известен другому человеку.</p>
      <StaffMfaPanel required={staff.mfa_required} passed={staff.mfa_passed} />
      <p className="staff-security-help">Потеряли устройство с кодами? Обратитесь к главному администратору или владельцу проекта. Пароль и доступ к почте сами по себе не отключают второй фактор.</p>
    </section>
  </main>;
}
