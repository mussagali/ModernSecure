import type { Metadata } from "next";
import { AuthForm } from "../../components/AuthForm";
import { AuthFrame } from "../../components/AuthFrame";

export const metadata: Metadata = { title: "Восстановление пароля — Современная защита" };

export default function ForgotPasswordPage() {
  return <AuthFrame title="Забыли пароль?" description="Укажите почту аккаунта. Если он существует, мы отправим ссылку для смены пароля."><AuthForm mode="forgot" /></AuthFrame>;
}
