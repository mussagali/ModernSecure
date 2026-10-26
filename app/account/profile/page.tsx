import { AccountHeader } from "../../../components/AccountHeader";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { saveOwnProfile } from "./actions";

export const metadata: Metadata = { title: "Профиль | Современная защита" };

export default async function ProfilePage({ searchParams }: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) redirect("/login");
  const [profileResult, clientResult] = await Promise.all([
    supabase.from("profiles").select("email, display_name, phone, city").eq("user_id", auth.claims.sub).maybeSingle(),
    supabase.from("clients").select("full_name, iin").eq("user_id", auth.claims.sub).maybeSingle(),
  ]);
  if (profileResult.error || !profileResult.data || clientResult.error) throw new Error("Не удалось загрузить профиль");
  const profile = profileResult.data;
  const client = clientResult.data;
  const query = await searchParams;
  return <main className="account-page">
    <AccountHeader />
    <div className="account-content"><Link href="/account" className="account-back">Мои дела</Link><h1>Профиль</h1><p className="account-email">Контактные данные, которые видите вы. Email меняется отдельно через поддержку.</p>
      {query.saved && <p className="auth-feedback is-success" role="status">Профиль сохранён.</p>}
      {query.error && <p className="auth-feedback is-error" role="alert">{query.error === "invalid" ? "Проверьте телефон и длину полей." : "Не удалось сохранить профиль. Попробуйте ещё раз."}</p>}
      <section className="account-card account-identity-card"><h2>Карточка клиента</h2>
        {client ? <><dl className="account-identity-list"><div><dt>ФИО в карточке</dt><dd>{client.full_name}</dd></div>{client.iin && <div><dt>ИИН</dt><dd>•••• •••• {client.iin.slice(-4)}</dd></div>}</dl><p>Чтобы исправить ФИО или ИИН, <Link href="/account/help">свяжитесь с компанией</Link>. Эти данные меняет сотрудник после проверки личности.</p></>
          : <p>Карточка клиента пока не подключена. После проверки сотрудником здесь появятся ваши данные и дела.</p>}
      </section>
      <section className="account-card"><h2>Контакты</h2><form action={saveOwnProfile} className="auth-form">
        <div className="auth-field"><label htmlFor="profile-email">Email для входа</label><input id="profile-email" value={profile.email} readOnly autoComplete="email" /></div>
        <div className="auth-field"><label htmlFor="profile-name">Как к вам обращаться</label><input id="profile-name" name="displayName" defaultValue={profile.display_name ?? ""} maxLength={160} autoComplete="name" /></div>
        <div className="auth-field"><label htmlFor="profile-phone">Телефон</label><input id="profile-phone" name="phone" type="tel" defaultValue={profile.phone ?? ""} maxLength={30} autoComplete="tel" placeholder="+7 777 123 45 67" /></div>
        <div className="auth-field"><label htmlFor="profile-city">Город</label><input id="profile-city" name="city" defaultValue={profile.city ?? ""} maxLength={100} autoComplete="address-level2" /></div>
        <button type="submit" className="account-activate-button">Сохранить изменения</button>
      </form></section>
    </div>
  </main>;
}
