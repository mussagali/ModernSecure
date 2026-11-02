import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "../../components/AuthFrame";

export const metadata: Metadata = { title: "Поддержка | Современная защита" };
export const dynamic = "force-dynamic";

export default function SupportPage() {
  // Only contacts explicitly approved for public display; never publish private
  // account email or the staff-only contact settings as an implicit fallback.
  const email = process.env.PUBLIC_SUPPORT_EMAIL?.trim() ?? "";
  const phone = process.env.PUBLIC_SUPPORT_PHONE?.trim() ?? "";
  const hours = process.env.PUBLIC_SUPPORT_HOURS?.trim();
  const emailLink = /^[^\s@/?#]+@[^\s@/?#]+\.[^\s@/?#]+$/.test(email) ? `mailto:${email}` : null;
  const normalizedPhone = phone.replace(/[\s().-]/g, "");
  const phoneLink = /^\+?\d{6,20}$/.test(normalizedPhone) ? `tel:${normalizedPhone}` : null;

  return <AuthFrame title="Поддержка" description="Помощь со входом, документами и работой приложения. Для просмотра контактов вход не нужен.">
    <section className="auth-support" aria-labelledby="support-contacts">
      <h2 id="support-contacts">Связаться с компанией</h2>
      {emailLink && <p><a href={emailLink}>{email}</a></p>}
      {phoneLink && <p><a href={phoneLink}>{phone}</a></p>}
      {emailLink || phoneLink
        ? <>{hours && <p>Время работы: {hours}</p>}<p>При обращении опишите проблему и укажите версию приложения. Не отправляйте пароль, код входа или документы по делу в первое сообщение.</p></>
        : <p role="status">Контакты поддержки пока не опубликованы компанией. Попробуйте открыть страницу позже.</p>}
    </section>
    <p><Link href="/forgot-password">Восстановить пароль</Link></p>
    <p><Link href="/login">Перейти ко входу</Link></p>
  </AuthFrame>;
}
