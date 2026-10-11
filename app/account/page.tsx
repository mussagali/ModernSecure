import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { getStaffStatus } from "../../lib/staff";
import { UnreadNotificationsLink } from "../../components/UnreadNotificationsLink";
import { activateStaffInvitation, signOutAction } from "./actions";

export const metadata: Metadata = { title: "Мои дела — Современная защита" };

const statusNames: Record<string, string> = {
  open: "В работе",
  closed: "Завершено",
  cancelled: "Отменено",
};

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ inviteError?: string; invite?: string; staffAccess?: string; staffLookupError?: string }> }) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");

  const { staff, error: staffError } = await getStaffStatus(supabase);
  if (staff?.active) redirect(staff.mfa_passed ? "/staff" : "/staff-security");

  const [{ data: profile, error: profileError }, { data: client, error: clientError }, { count: unreadCount }] = await Promise.all([
    supabase.from("profiles").select("email, display_name").eq("user_id", userId).maybeSingle(),
    supabase.from("clients").select("id, full_name").eq("user_id", userId).maybeSingle(),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_user_id", userId).is("read_at", null),
  ]);
  const email = profile?.email ?? (typeof auth.claims.email === "string" ? auth.claims.email : "");
  const { data: cases, error: casesError } = client
    ? await supabase.from("cases").select("id, case_number, title, status, is_suspended, updated_at").eq("client_id", client.id).order("updated_at", { ascending: false })
    : { data: [], error: null };
  const hasError = Boolean(profileError || clientError || staffError || casesError);
  const query = await searchParams;

  return <main className="account-page">
    <header className="account-header"><Link href="/account" className="account-brand"><span className="auth-brand-mark" aria-hidden="true">сз</span><span>современная <strong>защита</strong></span></Link><div className="account-header-actions"><UnreadNotificationsLink href="/account/notifications" className="account-staff-link" label="События" initialCount={unreadCount ?? 0} /><Link href="/account/profile" className="account-staff-link">Профиль</Link><Link href="/account/help" className="account-staff-link">Помощь</Link><form action={signOutAction}><button type="submit" className="account-signout">Выйти</button></form></div></header>
    <div className="account-content"><span className="auth-eyebrow">ЛИЧНЫЙ КАБИНЕТ</span><h1>{profile?.display_name ? `Здравствуйте, ${profile.display_name}` : "Здравствуйте"}</h1><p className="account-email">{email}</p>
      {query.inviteError && <p className="case-feedback is-error">Не удалось проверить приглашение сотрудника. Повторите попытку; если ошибка сохранится, сообщите администратору.</p>}
      {(query.staffLookupError || staffError) && <p className="case-feedback is-error" role="alert">Не удалось проверить роль сотрудника. Это временная ошибка проверки доступа, а не отсутствие роли. Обновите страницу; если ошибка повторится, сообщите администратору.</p>}
      {query.invite === "none" && <p className="case-feedback">Активного приглашения для этого подтверждённого email нет. Проверьте адрес и попросите администратора отправить приглашение повторно.</p>}
      {query.staffAccess === "denied" && <p className="case-feedback is-error">У текущего аккаунта нет активной роли сотрудника. Панель администратора откроется только после входа под адресом, которому назначена эта роль.</p>}
      {hasError ? <section className="account-card" role="alert"><span className="account-card-index">ОШИБКА ЗАГРУЗКИ</span><h2>Не удалось получить данные</h2><p>Обновите страницу. Если ошибка повторится, обратитесь к сотруднику компании.</p></section>
        : !client ? <section className="account-card"><span className="account-card-index">ОЖИДАЕТ ПОДКЛЮЧЕНИЯ</span><h2>Аккаунт пока не подключён</h2><p>Сейчас вы вошли под адресом {email}. Если вы клиент, сотрудник проверит данные и привяжет вашу карточку. Если вы приглашены как сотрудник, роль появится после подтверждения email и принятия приглашения. Для доступа к админке нужно войти под аккаунтом главного администратора.</p><form action={activateStaffInvitation}><button type="submit" className="account-activate-button">Проверить приглашение сотрудника →</button></form><form action={signOutAction}><button type="submit" className="account-activate-button">Сменить аккаунт →</button></form></section>
        : <section className="account-cases" id="cases"><div className="account-section-heading"><div><span className="account-card-index">{client.full_name}</span><h2>Мои дела</h2></div><span className="account-count">{cases?.length ?? 0}</span></div>
          {cases?.length ? <ul className="account-case-list">{cases.map((item) => <li key={item.id}><Link href={`/account/cases/${item.id}`} className="account-case-link"><span className="account-case-number">Дело № {item.case_number}</span><strong>{item.title}</strong><span className="account-case-footer"><span>{item.is_suspended ? "Приостановлено" : statusNames[item.status] ?? item.status}</span><span aria-hidden="true">Открыть →</span></span></Link></li>)}</ul>
            : <div className="account-card account-empty"><h3>Пока нет дел</h3><p>Карточка клиента подключена, но дела ещё не созданы. Когда сотрудник добавит дело, оно появится здесь.</p></div>}
        </section>}
    </div>
  </main>;
}
