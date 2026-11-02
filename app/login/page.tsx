import { workspaceDestination } from "../../lib/workspace-destination";
import { getStaffStatus } from "../../lib/staff";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "../../components/AuthForm";
import { AuthFrame } from "../../components/AuthFrame";
import { createClient } from "../../lib/supabase/server";

export const metadata: Metadata = { title: "Вход | Современная защита" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; next?: string }> }) {
  const next = (await searchParams).next;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) {
    const { staff, error } = await getStaffStatus(supabase);
    if (error) throw new Error("Не удалось проверить роль аккаунта");
    redirect(workspaceDestination(staff, next));
  }

  const { error, notice } = await searchParams;


  return <AuthFrame title="Вход в аккаунт" description="Для клиентов и сотрудников компании.">{notice === "email-confirmed" && <p className="auth-feedback" role="status">Email подтверждён. Войдите с паролем, указанным при регистрации.</p>}{error && <p className="auth-feedback is-error" role="alert">Ссылка недействительна или срок её действия истёк.</p>}<AuthForm mode="login" next={next} /></AuthFrame>;
}
