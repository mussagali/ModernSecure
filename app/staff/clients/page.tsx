import type { Metadata } from "next";
import Link from "next/link";
import { SubmitButton } from "../../../components/SubmitButton";
import { ClientRegistrationQueue } from "../../../components/ClientRegistrationQueue";
import { requireStaff } from "../../../lib/staff";
import { createClientCard, linkClientAccount } from "../actions";

export const metadata: Metadata = { title: "Клиенты — Современная защита" };

type ClientSearchRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  user_id: string | null;
  created_at: string;
  total_count: number | string;
};

export default async function StaffClientsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[]; registrationsPage?: string | string[]; q?: string | string[]; created?: string; linked?: string; approved?: string; error?: string }> }) {
  const { supabase, staff } = await requireStaff(["manager", "admin"]);
  const query = await searchParams;
  const search = typeof query.q === "string" ? query.q.trim().slice(0, 120) : "";
  let page = typeof query.page === "string" && /^\d+$/.test(query.page) ? Math.max(1, Math.min(10000, Number(query.page))) : 1;
  const pageSize = 25;
  const result = await supabase.rpc("staff_search_clients", { p_query: search, p_page: page });
  let clients = result.data as ClientSearchRow[] | null;
  let error = result.error;
  let count = Number(clients?.[0]?.total_count ?? 0);

  // An empty page has no row carrying total_count. Recover the count and show the last valid page.
  if (!error && !clients?.length && page > 1) {
    const first = await supabase.rpc("staff_search_clients", { p_query: search, p_page: 1 });
    if (first.error) {
      error = first.error;
    } else {
      count = Number(first.data?.[0]?.total_count ?? 0);
      page = Math.max(1, Math.ceil(count / pageSize));
      if (page === 1) {
        clients = first.data as ClientSearchRow[] | null;
      } else {
        const last = await supabase.rpc("staff_search_clients", { p_query: search, p_page: page });
        clients = last.data as ClientSearchRow[] | null;
        error = last.error;
      }
    }
  }

  const pages = Math.ceil(count / pageSize);
  const pageHref = (number: number) => `/staff/clients?${new URLSearchParams({ ...(search ? { q: search } : {}), page: String(number) })}`;

  return <><div className="staff-page-heading"><div><h1>Клиенты</h1><p>{staff.role === "admin" ? "Одобряйте новые регистрации и работайте с карточками клиентов." : "Работайте с карточками клиентов. Новые регистрации одобряет администратор."}</p></div><span className="staff-role-pill">{count} {search ? "найдено" : "карточек"}</span></div>
    {query.approved === "1" && <div className="staff-alert is-success" role="status">Регистрация одобрена. Карточка создана и связана с аккаунтом — теперь можно добавить дело. ФИО и ИИН клиент может дополнить в профиле.</div>}
    {query.created === "1" && <div className="staff-alert is-success" role="status">Карточка клиента создана.</div>}
    {query.linked === "1" && <div className="staff-alert is-success" role="status">Аккаунт привязан к карточке. Действие записано в аудит.</div>}
    {query.error && <div className="staff-alert is-error" role="alert">{query.error === "existing-card" ? "Карточка с таким email уже есть. Найдите её ниже и привяжите подтверждённый аккаунт." : query.error === "approve" ? "Не удалось одобрить регистрацию. Обновите список и попробуйте снова." : query.error === "staff" ? "У аккаунта есть роль или приглашение сотрудника. Для клиента нужен отдельный аккаунт." : query.error === "email-mismatch" ? "Email аккаунта должен совпадать с контактным email карточки. Если в карточке нет email или он неверен, обратитесь к администратору." : query.error === "link" ? "Не удалось привязать аккаунт. Проверьте email и подтверждение почты; карточка и аккаунт должны быть свободны." : "Не удалось сохранить данные. Проверьте поля и попробуйте ещё раз."}</div>}
    <details className="form-disclosure"><summary>Добавить клиента</summary><div className="staff-form-panel"><div><p>Укажите только необходимые контактные данные. Доступ к делу появится после отдельной привязки аккаунта.</p></div><form action={createClientCard} className="staff-form"><div className="staff-form-grid"><label>ФИО клиента <input name="fullName" required maxLength={160} placeholder="Фамилия Имя Отчество" /></label><label>Контактный email <input name="email" type="email" maxLength={254} placeholder="name@example.com" /></label><label>Телефон <input name="phone" type="tel" maxLength={40} placeholder="+7 …" /></label><label>Город <input name="city" maxLength={120} placeholder="Город" /></label></div><SubmitButton>Создать карточку</SubmitButton></form></div></details>
    <section className="staff-form-panel" aria-label="Поиск клиентов"><div><h2>Найти клиента</h2><p>Поиск по имени, email или телефону.</p></div><form action="/staff/clients" method="get" className="staff-form"><label htmlFor="client-search">Имя, email или телефон<input id="client-search" name="q" type="search" maxLength={120} defaultValue={search} placeholder="Введите запрос" /></label><div className="staff-client-side"><button type="submit">Найти</button>{search && <Link href="/staff/clients" className="staff-text-link">Сбросить поиск</Link>}</div></form></section>
    {staff.role === "admin" && <ClientRegistrationQueue supabase={supabase} search={search} requestedPage={query.registrationsPage} />}
    <section className="staff-list-section"><div className="staff-section-heading"><h2>Карточки клиентов</h2><span>{count} {search ? "найдено" : "всего"}</span></div>{error ? <p className="staff-alert is-error" role="alert">Не удалось загрузить список клиентов.</p> : clients?.length ? <div className="staff-client-list">{clients.map((client) => <article key={client.id} className="staff-client-row"><div className="staff-client-main"><strong>{client.full_name}</strong><span>{[client.email, client.phone, client.city].filter(Boolean).join(" · ") || "Контакты не указаны"}</span></div><div className="staff-client-side"><span className={client.user_id ? "staff-tag is-linked" : "staff-tag"}>{client.user_id ? "Аккаунт привязан" : "Без аккаунта"}</span><Link href={`/staff/clients/${client.id}`}>Карточка и исправление данных</Link><Link href={`/staff/cases?client=${client.id}`}>Дела клиента</Link></div>{!client.user_id && <form action={linkClientAccount} className="staff-inline-form"><input type="hidden" name="clientId" value={client.id} /><label htmlFor={`link-${client.id}`}>Привязать подтверждённый аккаунт</label><div><input id={`link-${client.id}`} name="email" type="email" required maxLength={254} defaultValue={client.email ?? ""} placeholder="Email аккаунта" autoComplete="off" /><SubmitButton pendingText="Привязываем…">Привязать</SubmitButton></div></form>}</article>)}</div> : <div className="staff-empty-box"><h3>{search ? "Клиенты не найдены" : "Клиентов пока нет"}</h3><p>{search ? "Попробуйте другой запрос или сбросьте поиск." : "Заполните форму выше, чтобы создать первую карточку."}</p></div>}
      {!error && pages > 1 && <nav className="staff-pagination" aria-label="Страницы клиентов">{page > 1 && <Link href={pageHref(page - 1)}>Назад</Link>}<span>Страница {page} из {pages}</span>{page < pages && <Link href={pageHref(page + 1)}>Далее</Link>}</nav>}
    </section>
  </>;
}
