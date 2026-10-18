import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "../../components/AuthForm";
import { AuthFrame } from "../../components/AuthFrame";
import { createClient } from "../../lib/supabase/server";

export const metadata: Metadata = { title: "Регистрация — Современная защита" };

export default async function RegisterPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) redirect("/account");

  return <AuthFrame title="Регистрация" description="Создайте аккаунт — администратор сразу увидит вашу заявку. Подтвердите почту для входа. ФИО и ИИН можно заполнить позже в профиле."><AuthForm mode="register" /></AuthFrame>;
}
