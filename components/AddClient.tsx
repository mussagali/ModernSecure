import Form from "next/form";
import Link from "next/link";
import { createClientCard } from "../app/staff/actions";
import { addRegisteredClient } from "../app/staff/clients/actions";
import type { ClientAccountLookup } from "../lib/client-account-lookup";
import { SubmitButton } from "./SubmitButton";

function ManualClientForm({ email }: { email: string }) {
  return <form action={createClientCard} className="staff-form">
    <div className="staff-form-grid">
      <label>ФИО клиента<input name="fullName" required maxLength={160} placeholder="Фамилия Имя Отчество" /></label>
      <label>Контактный email<input name="email" type="email" maxLength={254} defaultValue={email} placeholder="name@example.com" /></label>
      <label>Телефон<input name="phone" type="tel" maxLength={40} placeholder="+7 …" /></label>
      <label>Город<input name="city" maxLength={120} placeholder="Город" /></label>
    </div><SubmitButton>Создать карточку</SubmitButton>
  </form>;
}

export function AddClient({ admin, open, email, result, error }: {
  admin: boolean; open: boolean; email: string; result: ClientAccountLookup | null; error: string | null;
}) {
  const availableCards = result?.cards.filter(card => card.available) ?? [];
  return <details id="add-client" className="form-disclosure" open={open}>
    <summary>Добавить клиента</summary>
    <div className="disclosure-body client-add-body">
      {admin ? <>
        <p>Найдите зарегистрированного пользователя по точному email, чтобы открыть ему клиентский кабинет.</p>
        <Form action="/staff/clients" className="staff-form client-email-search" aria-label="Поиск аккаунта по email">
          <input type="hidden" name="new" value="1" />
          <label>Email пользователя<input name="email" type="email" required maxLength={254} defaultValue={email} autoComplete="off" placeholder="name@example.com" /></label>
          <SubmitButton pendingText="Ищем…">Найти по почте</SubmitButton>
        </Form>
        {error && <p className="staff-alert is-error" role="alert">{error}</p>}
        {result && <section className="client-account-result" aria-label="Результат поиска аккаунта">
          <h3>{result.display_name || result.email}</h3>
          {result.display_name && <p>{result.email}</p>}
          {result.status === "staff" ? <p role="status">Этот email принадлежит сотруднику. Для клиента нужен отдельный аккаунт.</p>
            : result.status === "linked" ? <><p role="status">Клиент уже добавлен, доступ к кабинету открыт.</p><Link href={`/staff/cases?client=${result.client_id}`}>Открыть дела клиента</Link></>
              : result.status === "missing" ? <p role="status">Аккаунт с таким email не найден. Проверьте адрес или предложите человеку <Link href="/register">зарегистрироваться</Link>. Карточку без доступа можно создать вручную ниже.</p>
                : result.invited_role ? <p role="status">На этот email есть приглашение сотрудника. Проверьте его в <Link href="/staff/team?tab=pending">заявках на доступ</Link> перед назначением роли.</p>
                  : !result.email_verified ? <p role="status">Аккаунт найден, но почта ещё не подтверждена. Попросите пользователя перейти по ссылке из письма, затем повторите поиск.</p>
                    : <>
                      <p role="status">Почта подтверждена. Можно добавить пользователя как клиента.</p>
                      {result.cards.length > 0 && !availableCards.length ? <p>Карточка с этим email уже связана с другим аккаунтом. Проверьте <Link href={`/staff/clients?q=${encodeURIComponent(result.email)}`}>существующие карточки</Link>.</p>
                        : <form action={addRegisteredClient} className="staff-form" aria-label="Добавить найденного клиента">
                          <input type="hidden" name="email" value={result.email} />
                          <label>ФИО клиента<input name="displayName" required maxLength={160} defaultValue={result.display_name ?? availableCards[0]?.full_name ?? ""} placeholder="Фамилия Имя Отчество" /></label>
                          {availableCards.length > 0 ? <label>Связать с карточкой<select name="clientId" required defaultValue={availableCards.length === 1 ? availableCards[0].id : ""}>
                            {availableCards.length > 1 && <option value="" disabled>Выберите карточку клиента</option>}
                            {availableCards.map(card => <option key={card.id} value={card.id}>{card.full_name}</option>)}
                          </select></label> : <input type="hidden" name="clientId" value="" />}
                          <p className="staff-form-hint">{availableCards.length ? "Пользователь получит доступ к делам выбранной карточки." : "Будет создана карточка клиента и открыт доступ к кабинету."}</p>
                          <SubmitButton pendingText="Добавляем…">Добавить клиента и открыть доступ</SubmitButton>
                        </form>}
                    </>}
          {result.status === "missing" && result.cards.length > 0 && <p>Карточки с этим email уже есть. <Link href={`/staff/clients?q=${encodeURIComponent(result.email)}`}>Посмотреть карточки</Link></p>}
        </section>}
        <details className="client-manual-create"><summary>Создать карточку вручную</summary><p>Для человека, который ещё не зарегистрировался. Доступ подключается отдельно после подтверждения почты.</p><ManualClientForm email={email} /></details>
      </> : <><p>Укажите контактные данные. Администратор подключит аккаунт после подтверждения почты.</p><ManualClientForm email="" /></>}
    </div>
  </details>;
}
