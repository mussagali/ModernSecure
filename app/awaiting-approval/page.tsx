import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthFrame } from "../../components/AuthFrame";
import { createClient } from "../../lib/supabase/server";
import { signOutAction } from "../account/actions";

export const metadata: Metadata = { title: "Ожидание активации | Современная защита" };

export default async function AwaitingApprovalPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) redirect("/login");
  const { data: status, error } = await supabase.rpc("account_access_status");
  if (error) throw new Error("Не удалось проверить активацию аккаунта");
  if (status === "approved") redirect("/account");
  if (status === "disabled") redirect("/access-denied");
  const { data: contacts, error: contactError } = await supabase.from("contact_settings")
    .select("email, phone, business_hours").eq("id", true).maybeSingle();
  const email = contacts?.email?.trim();
  const phone = contacts?.phone?.replace(/[^\d+]/g, "");
  return <AuthFrame title="Ожидаем активацию" description="Аккаунт создан. Главный администратор проверит регистрацию, назначит роль и откроет доступ к кабинету.">
    <div className="auth-identity"><span>Ваш аккаунт</span><strong>{auth.claims.email as string}</strong></div>
    <Link href="/account" className="primary-action auth-status-action">Проверить статус</Link>
    <section className="auth-support" aria-labelledby="approval-support"><h2 id="approval-support">Нужна помощь?</h2>
      {contactError ? <p>Не удалось загрузить контакты. Обновите страницу позже.</p> : <>
        {email && /^[^\s@/?#]+@[^\s@/?#]+\.[^\s@/?#]+$/.test(email) && <p><a href={`mailto:${email}`}>{email}</a></p>}
        {phone && /^\+?\d{6,20}$/.test(phone) && <p><a href={`tel:${phone}`}>{contacts?.phone}</a></p>}
        {!email && !phone && <p>Контакты поддержки пока не опубликованы. Свяжитесь с сотрудником компании, который пригласил вас.</p>}
        {contacts?.business_hours && <p>{contacts.business_hours}</p>}
      </>}
    </section>
    <form action={signOutAction} className="auth-signout"><button type="submit">Выйти из аккаунта</button></form>
  </AuthFrame>;
}
