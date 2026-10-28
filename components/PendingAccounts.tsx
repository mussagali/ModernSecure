import Link from "next/link";
import { SubmitButton } from "./SubmitButton";
import { NavIcon } from "./NavIcon";
import { approveAccount } from "../app/staff/actions";
import type { createClient } from "../lib/supabase/server";
import type { PendingAccountPage } from "../lib/pending-accounts";
import { AccountAccessRefresh } from "./AccountAccessRefresh";

export async function PendingAccounts({ supabase, page, isPrimaryAdmin = false }: { supabase: Awaited<ReturnType<typeof createClient>>; page: number; isPrimaryAdmin?: boolean }) {
  const { data, error } = await supabase.rpc("admin_pending_account_page", { p_page: page });
  const result = data as PendingAccountPage | null;
  const accounts = result?.items ?? [];
  const currentPage = result?.page ?? 1;
  const pages = Math.max(1, Math.ceil((result?.total_count ?? 0) / 25));
  const { data: cards, error: cardsError } = accounts.length ? await supabase.from("clients").select("id, full_name, email")
    .is("user_id", null).in("email", accounts.map(account => account.email.toLowerCase())).order("full_name") : { data: [], error: null };
  return <section className="staff-list-section staff-pending-accounts" aria-labelledby="pending-accounts-heading">
    <div className="staff-section-heading"><h2 id="pending-accounts-heading">Заявки на доступ</h2><span>{error ? "" : `${result?.total_count ?? 0} всего`}</span></div>
    <p>Проверьте пользователя и назначьте роль. Для клиента можно выбрать существующую карточку. {isPrimaryAdmin ? "Вы можете назначать все роли." : "Вы можете активировать клиентов, юристов и менеджеров. Администраторов назначает главный администратор."}</p>
    <AccountAccessRefresh protectForms showButton />
    {error || cardsError ? <p className="staff-alert is-error" role="alert">Не удалось загрузить заявки. Обновите страницу.</p>
      : accounts.length ? <div className="staff-work-list">{accounts.map(account => <details className="staff-work-card" key={account.user_id}>
        <summary className="staff-pending-summary"><span><strong>{account.email}</strong><small>{account.email_verified ? "Настроить доступ" : "Ожидает подтверждения email"}</small></span><span className="staff-tag">{account.email_verified ? "Новая заявка" : "Не подтверждён"}</span><NavIcon name="chevron" size={18} /></summary>
        {account.suggested_role && <p>В приглашении: {({ client: "Клиент", lawyer: "Юрист", manager: "Менеджер", admin: "Администратор" })[account.suggested_role]}{account.invited_name ? ` · ${account.invited_name}` : ""}.</p>}
        {account.email_verified && account.can_approve ? <form action={approveAccount} className="staff-form">
          <input type="hidden" name="userId" value={account.user_id} />
          <input type="hidden" name="accountPage" value={currentPage} />
          <label>Имя пользователя<input name="displayName" required maxLength={160} defaultValue={account.display_name ?? ""} autoComplete="off" /></label>
          <label>Роль<select name="role" defaultValue={account.suggested_role ?? "client"}><option value="client">Клиент</option><option value="lawyer">Юрист</option><option value="manager">Менеджер</option>{isPrimaryAdmin && <option value="admin">Администратор</option>}</select></label>
          <label>Карточка с тем же email (для роли «Клиент»)<select name="clientId" defaultValue=""><option value="">Создать новую при активации клиента</option>{cards?.filter(card => card.email?.toLowerCase() === account.email.toLowerCase()).map(card => <option key={card.id} value={card.id}>{card.full_name}{card.email ? ` · ${card.email}` : ""}</option>)}</select></label>
          <SubmitButton pendingText="Активируем…">Назначить роль и активировать</SubmitButton>
        </form> : <p>{!account.email_verified ? "Пользователь должен подтвердить адрес по ссылке из письма. После этого можно выдать доступ." : "Это приглашение администратора. Его активирует главный администратор."}</p>}
      </details>)}</div> : <div className="staff-empty-box"><h3>Новых заявок пока нет</h3><p>Зарегистрированные пользователи появятся здесь. Для активации им нужно подтвердить email.</p><Link href="/staff/team?tab=invites&new=1">Пригласить сотрудника</Link></div>}
    {!error && !cardsError && pages > 1 && <nav className="staff-pagination" aria-label="Страницы заявок">{currentPage > 1 && <Link href={`/staff/team?tab=pending&accountPage=${currentPage - 1}`}>Назад</Link>}<span>Страница {currentPage} из {pages}</span>{currentPage < pages && <Link href={`/staff/team?tab=pending&accountPage=${currentPage + 1}`}>Далее</Link>}</nav>}
  </section>;
}
