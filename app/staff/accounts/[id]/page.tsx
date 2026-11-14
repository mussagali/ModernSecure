import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePrimaryAdmin } from "../../../../lib/staff";
import { uuidPattern } from "../../../../lib/uuid";
import { SubmitButton } from "../../../../components/SubmitButton";
import { deleteAccount } from "../actions";
import { accountRoleNames, type ManagedAccount } from "../types";

export const metadata: Metadata = { title: "Удаление аккаунта | Современная защита" };
const errors: Record<string, string> = {
  confirmation: "Email не совпадает. Введите адрес выбранного аккаунта полностью.",
  assignments: "У сотрудника остались назначения на открытые дела. Сначала назначьте замену и отзовите его назначения, затем повторите удаление.",
  protected: "Свой аккаунт и аккаунт главного администратора удалять нельзя.",
  invalid: "Введите email и причину удаления длиной до 500 символов.",
  delete: "Удаление не выполнено. Все изменения отменены. Обновите страницу и повторите попытку.",
};

export default async function AccountDeletionPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const { supabase, userId } = await requirePrimaryAdmin();
  const { id } = await params;
  if (!uuidPattern.test(id)) notFound();
  const query = await searchParams;
  const { data, error } = await supabase.rpc("primary_account_directory", { p_user_id: id });
  if (error) throw new Error("Не удалось загрузить аккаунт");
  const account = (data as { items: ManagedAccount[] }).items[0];
  if (!account) return <><h1>Аккаунт не найден</h1><p>Возможно, он уже удалён другим администратором.</p><Link href="/staff/accounts">Вернуться к аккаунтам</Link></>;
  const protectedAccount = account.is_primary_admin || account.user_id === userId;
  return <>
    <div className="staff-page-heading"><div><h1>{account.display_name}</h1><p>{account.email} · {account.is_primary_admin ? "Главный администратор" : accountRoleNames[account.role]}</p></div><Link className="staff-secondary-link" href="/staff/accounts">Все аккаунты</Link></div>
    {query.error && <p className="staff-alert is-error" role="alert">{errors[query.error] ?? errors.delete}</p>}
    <section className="staff-panel"><h2>Удаление аккаунта</h2><p>Удаление необратимо: вход с этим аккаунтом и обновление его сеансов станут недоступны. Профиль и учётная запись будут удалены.</p><p>Карточка клиента, дела, документы, договоры, оплаты, переписка и история действий компании сохранятся. Авторство прошлых действий останется в истории. Повторная регистрация потребует новой активации.</p>
      {account.client_case_count > 0 && <p>Дел в карточке клиента: {account.client_case_count}. Они сохранятся у компании, связь с удалённым аккаунтом будет снята.</p>}
      {protectedAccount ? <p className="staff-alert">Свой аккаунт и аккаунт главного администратора защищены от удаления.</p>
        : account.active_case_count > 0 ? <div className="staff-alert"><p>Сначала переназначьте открытые дела: {account.active_case_count}. После назначения замены отзовите текущие назначения этого сотрудника.</p><Link href={`/staff/cases?staff=${id}`}>Открыть назначенные дела</Link></div>
        : !account.email ? <p className="staff-alert">У аккаунта нет email для подтверждения. Удаление через этот экран недоступно.</p>
        : <form action={deleteAccount} className="staff-form">
          <input type="hidden" name="userId" value={account.user_id} />
          <label>Для подтверждения введите {account.email}<input name="confirmationEmail" type="email" required maxLength={254} autoComplete="off" spellCheck={false} /></label>
          <label>Причина удаления<textarea name="reason" required maxLength={500} rows={3} /></label>
          <SubmitButton pendingText="Удаляем аккаунт…">Удалить аккаунт навсегда</SubmitButton>
        </form>}
    </section>
  </>;
}
