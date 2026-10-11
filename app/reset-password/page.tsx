import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "../../components/AuthForm";
import { AuthFrame } from "../../components/AuthFrame";
import { createClient } from "../../lib/supabase/server";

export const metadata: Metadata = { title: "Новый пароль — Современная защита" };

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login?error=reset-link");

  return <AuthFrame eyebrow="ВОССТАНОВЛЕНИЕ ДОСТУПА" title="Новый пароль" description="Задайте новый пароль для вашего аккаунта."><AuthForm mode="reset" /></AuthFrame>;
}
