import ClientCasePage from "./cases/[id]/page";
import { NavIcon } from "../../components/NavIcon";
import { AccountHeader } from "../../components/AccountHeader";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { signOutAction } from "./actions";

export const metadata: Metadata = { title: "Мои дела | Современная защита" };

const statusNames: Record<string, string> = {
  open: "В работе",
  closed: "Завершено",
  cancelled: "Отменено",
};

export default async function AccountPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");

  const [{ data: profile, error: profileError }, { data: client, error: clientError }, { count: unreadCount }] = await Promise.all([
    supabase.from("profiles").select("email, display_name").eq("user_id", userId).maybeSingle(),
    supabase.from("clients").select("id, full_name").eq("user_id", userId).maybeSingle(),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_user_id", userId).is("read_at", null),
  ]);
  const email = profile?.email ?? (typeof auth.claims.email === "string" ? auth.claims.email : "");
  const { data: cases, error: casesError } = client
    ? await supabase.from("cases").select("id, case_number, title, status, is_suspended, updated_at").eq("client_id", client.id).order("updated_at", { ascending: false })
    : { data: [], error: null };
  const hasError = Boolean(profileError || clientError || casesError);

  return <main className="account-page client-home">
    <AccountHeader unreadCount={unreadCount ?? 0} />
    <div className="account-content"><div className="client-greeting"><div><p>Добрый день,</p><h1>{(profile?.display_name || client?.full_name || "Личный кабинет").split(" ")[0]}</h1></div>{cases?.[0] && <Link className="client-message-link" href={`/account/cases/${cases[0].id}/messages`} aria-label="Сообщения юристу"><NavIcon name="messages" /></Link>}</div>
      {hasError ? <section className="account-card" role="alert"><h2>Не удалось получить данные</h2><p>Обновите страницу. Если ошибка повторится, обратитесь к сотруднику компании.</p></section>
        : !client ? <section className="account-card"><h2>Аккаунт пока не подключён</h2><p>Вы вошли как {email}. Сотрудник компании свяжет этот аккаунт с вашей карточкой, и здесь появятся дела.</p><form action={signOutAction}><button type="submit" className="account-activate-button">Сменить аккаунт</button></form></section>
        : <section className="account-cases" id="cases"><div className="account-section-heading"><div><h2>Ваши дела</h2></div><span className="account-count">{cases?.length ?? 0}</span></div>
          {cases?.length ? <ul className="account-case-list">{cases.map((item) => <li key={item.id}><Link href={`/account/cases/${item.id}`} className="account-case-link"><span className="account-case-number">Дело № {item.case_number}</span><strong>{item.title}</strong><span className="account-case-footer"><span>{item.is_suspended ? "Приостановлено" : statusNames[item.status] ?? item.status}</span><span aria-hidden="true">Открыть</span></span></Link></li>)}</ul>
            : <div className="account-card account-empty"><h3>Пока нет дел</h3><p>Карточка клиента подключена, но дела ещё не созданы. Когда сотрудник добавит дело, оно появится здесь.</p></div>}
        </section>}
      {!hasError && cases?.[0] && <ClientCasePage params={Promise.resolve({ id: cases[0].id })} />}
    </div>
  </main>;
}
