import { workspaceDestination } from "../../lib/workspace-destination";
import { getStaffStatus } from "../../lib/staff";
import type { Metadata } from "next";
import { headers } from "next/headers";
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
  const localAlias = process.env.APP_ORIGIN?.startsWith("http://localhost:")
    && (await headers()).get("host")?.startsWith("127.0.0.1:");

  return <AuthFrame title="Добро пожаловать" description="Войдите в аккаунт, чтобы продолжить работу.">{localAlias && <p className="auth-feedback" role="status">Вы открыли приложение через 127.0.0.1 | вход через localhost здесь не виден. <a href={`${process.env.APP_ORIGIN}/login`}>Откройте основной адрес</a>.</p>}{notice === "email-confirmed" && <p className="auth-feedback" role="status">Email подтверждён. Войдите с паролем, указанным при регистрации.</p>}{error && <p className="auth-feedback is-error" role="alert">Ссылка недействительна или срок её действия истёк.</p>}<AuthForm mode="login" next={next} /></AuthFrame>;
}
