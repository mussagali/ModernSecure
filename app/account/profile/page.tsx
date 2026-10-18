import { AccountHeader } from "../../../components/AccountHeader";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { SubmitButton } from "../../../components/SubmitButton";
import { getStaffStatus } from "../../../lib/staff";
import { completeOwnIdentity, saveOwnProfile } from "./actions";

export const metadata: Metadata = { title: "Профиль — Современная защита" };

export default async function ProfilePage({ searchParams }: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) redirect("/login");
  const [profileResult, clientResult, staffResult] = await Promise.all([
    supabase.from("profiles").select("email, display_name, phone, city, full_name, iin, updated_at").eq("user_id", auth.claims.sub).maybeSingle(),
    supabase.from("clients").select("full_name, iin, phone, city").eq("user_id", auth.claims.sub).maybeSingle(),
    getStaffStatus(supabase),
  ]);
  if (profileResult.error || !profileResult.data || clientResult.error || staffResult.error) throw new Error("Не удалось загрузить профиль");
  const profile = profileResult.data;
  const client = clientResult.data;
  const query = await searchParams;
  return <main className="account-page">
    <AccountHeader />
    <div className="account-content"><Link href="/account" className="account-back">Мои дела</Link><h1>Профиль</h1><p className="account-email">Заполните данные для работы с компанией. Email для входа меняется через поддержку.</p>
      {query.saved && <p className="auth-feedback is-success" role="status">Профиль сохранён.</p>}
      {query.error && <p className="auth-feedback is-error" role="alert">{query.error === "conflict" ? "Профиль изменился в другой вкладке или сотрудником. Проверьте актуальные данные и сохраните снова." : query.error === "identity-invalid" ? "Укажите ФИО. ИИН можно оставить пустым или ввести 12 цифр без пробелов." : query.error === "identity-locked" ? "ИИН уже сохранён в карточке. Для исправления данных свяжитесь с компанией." : query.error === "invalid" ? "Проверьте телефон и длину полей." : "Не удалось сохранить профиль. Попробуйте ещё раз."}</p>}
      {!staffResult.staff && <section className="account-card account-identity-card"><h2>Карточка клиента</h2>
        <p role="status">{client ? "Карточка одобрена. Дела появятся в кабинете, когда сотрудник их добавит." : "Аккаунт уже виден администратору и ожидает одобрения. Вы можете заполнить профиль сейчас."}</p>
        {client?.iin ? <><dl className="account-identity-list"><div><dt>ФИО в карточке</dt><dd>{client.full_name}</dd></div><div><dt>ИИН</dt><dd>•••• •••• {client.iin.slice(-4)}</dd></div></dl><p>Чтобы исправить ФИО или ИИН, <Link href="/account/help">свяжитесь с компанией</Link>.</p></>
          : <form action={completeOwnIdentity} className="auth-form">
            <div className="auth-field"><label htmlFor="profile-full-name">ФИО</label><input id="profile-full-name" name="fullName" defaultValue={profile.full_name ?? (client?.full_name !== profile.email ? client?.full_name : "") ?? ""} required maxLength={160} autoComplete="name" placeholder="Фамилия Имя Отчество" /></div>
            <div className="auth-field"><label htmlFor="profile-iin">ИИН — необязательно сейчас</label><input id="profile-iin" name="iin" defaultValue={profile.iin ?? ""} inputMode="numeric" pattern="[0-9]{12}" minLength={12} maxLength={12} autoComplete="off" placeholder="12 цифр" aria-describedby="profile-iin-help" /><p id="profile-iin-help">ИИН можно добавить позже. После сохранения ИИН в одобренной карточке исправления вносит сотрудник компании.</p></div>
            <SubmitButton pendingText="Сохраняем…">Сохранить данные клиента</SubmitButton>
          </form>}
      </section>}
      <section className="account-card"><h2>Контакты</h2><form action={saveOwnProfile} className="auth-form"><input type="hidden" name="expectedUpdatedAt" value={profile.updated_at} />
        <div className="auth-field"><label htmlFor="profile-email">Email для входа</label><input id="profile-email" value={profile.email} readOnly autoComplete="email" /></div>
        <div className="auth-field"><label htmlFor="profile-name">Как к вам обращаться</label><input id="profile-name" name="displayName" defaultValue={profile.display_name ?? ""} maxLength={160} autoComplete="name" /></div>
        <div className="auth-field"><label htmlFor="profile-phone">Телефон</label><input id="profile-phone" name="phone" type="tel" defaultValue={profile.phone ?? client?.phone ?? ""} maxLength={30} autoComplete="tel" placeholder="+7 777 123 45 67" /></div>
        <div className="auth-field"><label htmlFor="profile-city">Город</label><input id="profile-city" name="city" defaultValue={profile.city ?? client?.city ?? ""} maxLength={100} autoComplete="address-level2" /></div>
        <SubmitButton pendingText="Сохраняем…">Сохранить изменения</SubmitButton>
      </form></section>
    </div>
  </main>;
}
