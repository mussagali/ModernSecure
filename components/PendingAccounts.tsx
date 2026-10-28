import Link from "next/link";
import { SubmitButton } from "./SubmitButton";
import { NavIcon } from "./NavIcon";
import { approveAccount } from "../app/staff/actions";
import type { createClient } from "../lib/supabase/server";

type PendingAccount = { user_id: string; email: string; display_name: string | null; email_verified: boolean; total_count: number };

export async function PendingAccounts({ supabase, page }: { supabase: Awaited<ReturnType<typeof createClient>>; page: number }) {
  const { data, error } = await supabase.rpc("admin_pending_accounts", { p_offset: (page - 1) * 25 });
  const accounts = (data ?? []) as PendingAccount[];
  const { data: cards, error: cardsError } = accounts.length ? await supabase.from("clients").select("id, full_name, email")
    .is("user_id", null).in("email", accounts.map(account => account.email.toLowerCase())).order("full_name") : { data: [], error: null };
  return <section className="staff-list-section staff-pending-accounts" aria-labelledby="pending-accounts-heading">
    <div className="staff-section-heading"><h2 id="pending-accounts-heading">Заявки на доступ</h2></div>
    <p>Выберите роль после проверки пользователя. Для клиента можно привязать существующую карточку или создать новую.</p>
    {error || cardsError ? <p className="staff-alert is-error" role="alert">Не удалось загрузить заявки. Обновите страницу.</p>
      : accounts.length ? <div className="staff-work-list">{accounts.map(account => <details className="staff-work-card" key={account.user_id}>
        <summary className="staff-pending-summary"><span><strong>{account.email}</strong><small>{account.email_verified ? "Настроить доступ" : "Ожидает подтверждения email"}</small></span><span className="staff-tag">{account.email_verified ? "Новая заявка" : "Не подтверждён"}</span><NavIcon name="chevron" size={18} /></summary>
        {account.email_verified ? <form action={approveAccount} className="staff-form">
          <input type="hidden" name="userId" value={account.user_id} />
          <label>Имя пользователя<input name="displayName" required maxLength={160} defaultValue={account.display_name ?? ""} autoComplete="off" /></label>
          <label>Роль<select name="role" defaultValue="client"><option value="client">Клиент</option><option value="lawyer">Юрист</option><option value="manager">Менеджер</option><option value="admin">Администратор</option></select></label>
          <label>Карточка с тем же email (для роли «Клиент»)<select name="clientId" defaultValue=""><option value="">Создать новую при активации клиента</option>{cards?.filter(card => card.email?.toLowerCase() === account.email.toLowerCase()).map(card => <option key={card.id} value={card.id}>{card.full_name}{card.email ? ` · ${card.email}` : ""}</option>)}</select></label>
          <SubmitButton pendingText="Активируем…">Назначить роль и активировать</SubmitButton>
        </form> : <p>Пользователь должен подтвердить адрес по ссылке из письма. После этого можно выдать доступ.</p>}
      </details>)}</div> : <p className="staff-empty-box">На этой странице нет заявок.</p>}
    <nav className="staff-pagination" aria-label="Страницы заявок">{page > 1 && <Link href={`/staff/team?tab=pending&accountPage=${page - 1}`}>Назад</Link>}{accounts.length > 0 && accounts[0].total_count > page * 25 && <Link href={`/staff/team?tab=pending&accountPage=${page + 1}`}>Далее</Link>}</nav>
  </section>;
}
