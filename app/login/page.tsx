import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthForm } from "../../components/AuthForm";
import { AuthFrame } from "../../components/AuthFrame";
import { createClient } from "../../lib/supabase/server";
import { getStaffStatus } from "../../lib/staff";

export const metadata: Metadata = { title: "Вход — Современная защита" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) {
    const { staff, error: staffError } = await getStaffStatus(supabase);
    if (staffError) redirect("/account?staffLookupError=1");
    redirect(staff?.active ? (staff.mfa_passed ? "/staff" : "/staff-security") : "/account");
  }

  const { error } = await searchParams;
  const localAlias = process.env.APP_ORIGIN?.startsWith("http://localhost:")
    && (await headers()).get("host")?.startsWith("127.0.0.1:");

  return <AuthFrame eyebrow="ДОБРО ПОЖАЛОВАТЬ" title="Вход в кабинет" description="Введите почту и пароль, которые вы указали при регистрации.">{localAlias && <p className="auth-feedback" role="status">Вы открыли приложение через 127.0.0.1 — вход через localhost здесь не виден. <a href={`${process.env.APP_ORIGIN}/login`}>Откройте основной адрес</a>.</p>}{error && <p className="auth-feedback is-error" role="alert">Ссылка недействительна или срок её действия истёк.</p>}<AuthForm mode="login" /></AuthFrame>;
}
