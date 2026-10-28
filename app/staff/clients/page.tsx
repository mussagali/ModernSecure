import { ListSearch, ListPagination } from "../../../components/ListControls";
import { NavIcon } from "../../../components/NavIcon";
import { LawyerClients } from "../../../components/LawyerClients";
import type { Metadata } from "next";
import Link from "next/link";
import { SubmitButton } from "../../../components/SubmitButton";
import { requireStaff } from "../../../lib/staff";
import { createClientCard, linkClientAccount } from "../actions";

export const metadata: Metadata = { title: "Клиенты | Современная защита" };

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

export default async function StaffClientsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[]; q?: string | string[]; created?: string; linked?: string; error?: string }> }) {
  const { supabase, staff } = await requireStaff();
  const query = await searchParams;
  const search = typeof query.q === "string" ? query.q.trim().slice(0, 120) : "";
  let page = typeof query.page === "string" && /^\d+$/.test(query.page) ? Math.max(1, Math.min(10000, Number(query.page))) : 1;
  if (staff.role === "lawyer") return <LawyerClients query={search} page={page} />;
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


  return <><div className="staff-page-heading"><div><h1>Клиенты</h1><p>Контакты, доступ к кабинету и дела каждого клиента.</p></div><span className="staff-role-pill">{count} {search ? "найдено" : "записей"}</span></div>
    {query.created === "1" && <div className="staff-alert is-success" role="status">Карточка клиента создана.</div>}
    {query.linked === "1" && <div className="staff-alert is-success" role="status">Аккаунт привязан к карточке. Действие записано в аудит.</div>}
    {query.error && <div className="staff-alert is-error" role="alert">{query.error === "staff" ? "Этот аккаунт уже принадлежит сотруднику. Для клиента нужен отдельный аккаунт; совмещать роли нельзя." : query.error === "email-mismatch" ? "Email аккаунта должен совпадать с контактным email карточки. Если в карточке нет email или он неверен, обратитесь к администратору." : query.error === "link" ? "Не удалось привязать аккаунт. Проверьте email и подтверждение почты; карточка и аккаунт должны быть свободны." : "Не удалось сохранить данные. Проверьте поля и попробуйте ещё раз."}</div>}
    <details className="form-disclosure"><summary>Добавить клиента</summary><div className="staff-form-panel"><div><p>Укажите только необходимые контактные данные. Доступ к делу появится после отдельной привязки аккаунта.</p></div><form action={createClientCard} className="staff-form"><div className="staff-form-grid"><label>ФИО клиента <input name="fullName" required maxLength={160} placeholder="Фамилия Имя Отчество" /></label><label>Контактный email <input name="email" type="email" maxLength={254} placeholder="name@example.com" /></label><label>Телефон <input name="phone" type="tel" maxLength={40} placeholder="+7 …" /></label><label>Город <input name="city" maxLength={120} placeholder="Город" /></label></div><SubmitButton>Создать карточку</SubmitButton></form></div></details>
    <ListSearch action="/staff/clients" query={search} label="Поиск клиентов" placeholder="Имя, email или телефон клиента" resetHref={search ? "/staff/clients" : undefined} />
    <section className="staff-list-section"><div className="staff-section-heading"><h2>Карточки клиентов</h2><span>{count} {search ? "найдено" : "всего"}</span></div>{error ? <p className="staff-alert is-error" role="alert">Не удалось загрузить список клиентов.</p> : clients?.length ? <div className="staff-client-list">{clients.map((client) => <article key={client.id} className="staff-client-row"><div className="directory-person"><span className="directory-avatar" aria-hidden="true">{client.full_name.trim().slice(0, 1)}</span><div className="staff-client-main"><strong>{client.full_name}</strong><span>{[client.email, client.phone, client.city].filter(Boolean).join(" · ") || "Контакты не указаны"}</span></div></div><div className="staff-client-side"><span className={client.user_id ? "staff-tag is-linked" : "staff-tag"}>{client.user_id ? "Аккаунт привязан" : "Без аккаунта"}</span><Link href={`/staff/cases?client=${client.id}`}>Дела <NavIcon name="chevron" size={16} /></Link></div>{staff.is_primary_admin && !client.user_id && <details className="client-link-disclosure"><summary>Подключить аккаунт</summary><form action={linkClientAccount} className="staff-inline-form"><input type="hidden" name="clientId" value={client.id} /><label htmlFor={`link-${client.id}`}>Привязать подтверждённый аккаунт</label><div><input id={`link-${client.id}`} name="email" type="email" required maxLength={254} defaultValue={client.email ?? ""} placeholder="Email аккаунта" autoComplete="off" /><SubmitButton pendingText="Привязываем…">Привязать</SubmitButton></div></form></details>}</article>)}</div> : <div className="staff-empty-box"><h3>{search ? "Клиенты не найдены" : "Клиентов пока нет"}</h3><p>{search ? "Попробуйте другой запрос или сбросьте поиск." : "Заполните форму выше, чтобы создать первую карточку."}</p></div>}
      {!error && <ListPagination path="/staff/clients" page={page} count={count} params={{ q: search }} />}
    </section>
  </>;
}
