import Link from "next/link";
import type { Metadata } from "next";
import { requirePrimaryAdmin } from "../../../lib/staff";
import { ListPagination, ListSearch } from "../../../components/ListControls";
import { queryPage, queryText, type ListParams } from "../../../lib/list-query";
import { accountRoleNames, type ManagedAccount } from "./types";

export const metadata: Metadata = { title: "Аккаунты | Современная защита" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<ListParams> }) {
  const { supabase } = await requirePrimaryAdmin();
  const query = await searchParams;
  const q = queryText(query.q);
  const { data, error } = await supabase.rpc("primary_account_directory", { p_query: q, p_page: queryPage(query.page) });
  if (error) throw new Error("Не удалось загрузить аккаунты");
  const result = data as { items: ManagedAccount[]; total_count: number; page: number };
  return <>
    <div className="staff-page-heading"><div><h1>Аккаунты пользователей</h1><p>Клиенты, сотрудники и новые регистрации. Удалять аккаунты может только главный администратор.</p></div><Link className="staff-secondary-link" href="/staff/team">Команда и доступ</Link></div>
    {query.deleted === "1" && <p className="staff-alert is-success" role="status">Аккаунт и его сеансы удалены. Документы, дела и история компании сохранены.</p>}
    {query.error && <p className="staff-alert is-error" role="alert">Не удалось выбрать аккаунт. Найдите его в списке.</p>}
    <ListSearch action="/staff/accounts" query={q} label="Поиск аккаунта" placeholder="Имя или email" resetHref={q ? "/staff/accounts" : undefined} />
    <section className="staff-list-section"><div className="staff-section-heading"><h2>Зарегистрированные аккаунты</h2><span>{result.total_count}</span></div>
      {result.items.length ? <div className="staff-work-list">{result.items.map(account => <article key={account.user_id} className="staff-work-card">
        <div className="staff-work-head"><h3>{account.display_name}</h3><span className="staff-tag">{account.is_primary_admin ? "Главный администратор" : accountRoleNames[account.role] ?? account.role}</span></div>
        <p>{account.email || "Email не указан"}</p>
        <Link className="staff-secondary-link" href={`/staff/accounts/${account.user_id}`}>Открыть аккаунт</Link>
      </article>)}</div> : <p className="staff-empty-text">Аккаунты не найдены. Измените имя или email.</p>}
      <ListPagination path="/staff/accounts" page={result.page} count={result.total_count} params={{ q }} />
    </section>
  </>;
}
