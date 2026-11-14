import { signOutAction } from "../account/actions";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { getStaffStatus } from "../../lib/staff";
import { StaffMfaPanel } from "../../components/StaffMfaPanel";
import "../staff-security/security.css";

export const metadata = { title: "Безопасность аккаунта | Современная защита" };
export default async function AccountSecurityPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) redirect("/login");
  const { staff, error } = await getStaffStatus(supabase);
  if (error) throw new Error("Не удалось проверить аккаунт");
  if (staff?.active) redirect("/staff-security");
  const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
  if (factorsError) throw new Error("Не удалось проверить защиту входа");
  if (!factors.all.some(factor => factor.status === "verified") || auth.claims.aal === "aal2") redirect("/account/profile");
  return <main className="staff-security-page sovz"><div className="staff-security-content"><Link className="sovz-button sovz-button-outline" href="/account/profile">В кабинет</Link><h1>Безопасность аккаунта</h1><p className="staff-security-intro">Двухфакторная аутентификация</p><StaffMfaPanel required={false} passed={auth.claims.aal === "aal2"} next="/account/profile" /><p><Link href="/delete-account">Удаление аккаунта</Link></p><form action={signOutAction}><button className="sovz-button sovz-button-outline">Выйти из аккаунта</button></form></div></main>;
}
