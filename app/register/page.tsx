import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "../../components/AuthForm";
import { AuthFrame } from "../../components/AuthFrame";
import { createClient } from "../../lib/supabase/server";

export const metadata: Metadata = { title: "Регистрация | Современная защита" };

export default async function RegisterPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) redirect("/account");

  return <AuthFrame title="Регистрация" description="Создайте аккаунт и подтвердите адрес электронной почты. Доступ к делу появится после его привязки сотрудником."><AuthForm mode="register" /></AuthFrame>;
}
