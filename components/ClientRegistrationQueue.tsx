import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { approveClientRegistration } from "../app/staff/clients/actions";
import { linkClientAccount } from "../app/staff/actions";
import { ClientRegistrationsLive } from "./ClientRegistrationsLive";
import { SubmitButton } from "./SubmitButton";

type Registration = {
  user_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
  created_at: string;
  email_confirmed: boolean;
  has_iin: boolean;
  matching_client_count: number;
  matching_client_id: string | null;
};

export async function ClientRegistrationQueue({ supabase, search, requestedPage }: {
  supabase: SupabaseClient;
  search: string;
  requestedPage?: string | string[];
}) {
  const page = typeof requestedPage === "string" && /^\d+$/.test(requestedPage)
    ? Math.max(1, Math.min(10000, Number(requestedPage))) : 1;
  const { data, error } = await supabase.rpc("admin_client_registrations", { p_query: search, p_page: page });
  const result = data as { items: Registration[]; total_count: number; page: number } | null;
  const pages = Math.ceil((result?.total_count ?? 0) / 25);
  const pageHref = (number: number) => `/staff/clients?${new URLSearchParams({ ...(search ? { q: search } : {}), registrationsPage: String(number) })}#registrations`;
  const date = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Almaty" });

  return <section className="staff-list-section" id="registrations" aria-labelledby="registrations-heading">
    <ClientRegistrationsLive />
    <div className="staff-section-heading"><h2 id="registrations-heading">Новые регистрации</h2><span>{error ? "—" : `${result?.total_count ?? 0} ожидают одобрения`}</span></div>
    <p className="staff-form-hint">Аккаунты появляются здесь сразу после регистрации. Одобрите карточку; ФИО и ИИН клиент может заполнить позже в профиле. Список обновляется автоматически.</p>
    {error || !result ? <p className="staff-alert is-error" role="alert">Не удалось загрузить регистрации. Обновите страницу и попробуйте снова.</p>
      : result.items.length ? <div className="staff-client-list">{result.items.map((registration) => <article className="staff-client-row" key={registration.user_id}>
        <div className="staff-client-main">
          <strong>{registration.full_name || registration.email}</strong>
          {registration.full_name && <span>{registration.email}</span>}
          {(registration.phone || registration.city) && <span>{[registration.phone, registration.city].filter(Boolean).join(" · ")}</span>}
          <span>Регистрация: {date.format(new Date(registration.created_at))} · Алматы</span>
          <span>{registration.has_iin ? "ИИН заполнен" : "ИИН можно добавить позже"}</span>
        </div>
        <div className="staff-client-side">
          <span className={registration.email_confirmed ? "staff-tag is-linked" : "staff-tag"}>{registration.email_confirmed ? "Почта подтверждена" : "Почта не подтверждена"}</span>
          {registration.matching_client_count === 0 && <form action={approveClientRegistration}>
            <input type="hidden" name="userId" value={registration.user_id} />
            <SubmitButton pendingText="Одобряем…">Одобрить карточку</SubmitButton>
          </form>}
        </div>
        {registration.matching_client_count > 0 && <div className="staff-registration-match">
          <p>Карточка с таким email уже есть. Привяжите аккаунт к ней, чтобы сохранить дела и историю клиента.</p>
          {registration.matching_client_id && registration.email_confirmed ? <form action={linkClientAccount}>
            <input type="hidden" name="clientId" value={registration.matching_client_id} />
            <input type="hidden" name="email" value={registration.email} />
            <SubmitButton pendingText="Привязываем…">Привязать к существующей карточке</SubmitButton>
          </form> : <p>{!registration.email_confirmed ? "Привязка станет доступна после подтверждения почты клиентом." : "Проверьте совпадения в карточках клиентов ниже: привязать можно только свободную карточку."}</p>}
        </div>}
      </article>)}</div>
        : <div className="staff-empty-box"><h3>{search ? "Регистрации не найдены" : "Нет регистраций на проверке"}</h3><p>{search ? "Попробуйте другой запрос или сбросьте поиск." : "Когда человек создаст аккаунт, здесь появится заявка на одобрение."}</p></div>}
    {!error && result && pages > 1 && <nav className="staff-pagination" aria-label="Страницы регистраций">
      {result.page > 1 && <Link href={pageHref(result.page - 1)}>Назад</Link>}
      <span>Страница {result.page} из {pages}</span>
      {result.page < pages && <Link href={pageHref(result.page + 1)}>Далее</Link>}
    </nav>}
  </section>;
}
