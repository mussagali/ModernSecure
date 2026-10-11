import { randomUUID } from "node:crypto";
import Link from "next/link";
import { formatKzDate } from "../../../../../lib/client-case";
import { formatKzt, toKztCents } from "../../../../../lib/money";
import { requireStaffCase } from "../../../../../lib/staff-case";
import { addInstallment, confirmPayment, reviewReceipt, updateInstallment, voidPayment } from "./actions";

const previewableReceiptTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif"]);

type PaymentQuery = {
  created?: string; updated?: string; confirmed?: string; voided?: string; contractUploaded?: string; contractError?: string; receiptReviewed?: string; receiptError?: string; error?: string;
};

export default async function StaffPayments({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<PaymentQuery>;
}) {
  const { id } = await params;
  const { supabase, userId, item } = await requireStaffCase(id);
  const [permissionResult, scheduleResult, paymentsResult, receiptsResult, contractsResult] = await Promise.all([
    supabase.from("staff_members").select("can_confirm_payments").eq("user_id", userId).maybeSingle(),
    supabase.from("payment_schedule").select("id, contract_id, due_on, amount_kzt, description, updated_at").eq("case_id", id).order("due_on"),
    supabase.from("payments").select("id, schedule_id, receipt_id, amount_kzt, paid_on, status, payment_reference, client_note, created_at").eq("case_id", id).order("created_at", { ascending: false }),
    supabase.from("payment_receipts").select("id, original_name, detected_mime_type, status, review_note, created_at").eq("case_id", id).order("created_at", { ascending: false }),
    supabase.from("contracts").select("id, contract_number, signed_on, price_kzt, version_no").eq("case_id", id).order("version_no", { ascending: false }),
  ]);
  if ([permissionResult, scheduleResult, paymentsResult, receiptsResult, contractsResult].some((result) => result.error)) {
    throw new Error("Не удалось загрузить оплаты");
  }
  const query = await searchParams;
  const canManage = Boolean(permissionResult.data?.can_confirm_payments);
  const canChange = canManage && item.status === "open" && !item.is_suspended;
  const uploadsReady = Boolean(process.env.SUPABASE_SECRET_KEY);
  const schedule = scheduleResult.data ?? [];
  const contracts = contractsResult.data ?? [];
  const latestContract = contracts[0];
  const contractsById = new Map(contracts.map((contract) => [contract.id, contract]));
  const scheduleById = new Map(schedule.map((row) => [row.id, row]));
  const payments = paymentsResult.data ?? [];
  const confirmed = payments.filter((payment) => payment.status === "confirmed");
  const linkedReceiptIds = new Set(confirmed.map((payment) => payment.receipt_id).filter(Boolean));
  const availableReceipts = (receiptsResult.data ?? []).filter((receipt) => receipt.status === "accepted" && !linkedReceiptIds.has(receipt.id));
  const totalPaid = confirmed.reduce((sum, payment) => sum + toKztCents(payment.amount_kzt), BigInt(0));
  const price = latestContract ? toKztCents(latestContract.price_kzt) : null;
  const difference = price === null ? null : price - totalPaid;
  const nextDue = schedule.find((row) => {
    const paid = confirmed.filter((payment) => payment.schedule_id === row.id)
      .reduce((sum, payment) => sum + toKztCents(payment.amount_kzt), BigInt(0));
    return paid < toKztCents(row.amount_kzt);
  });
  const errorText: Record<string, string> = {
    invalid: "Проверьте заполненные поля.", schedule: "Не удалось сохранить график. Проверьте право и сумму.",
    conflict: "График уже изменил другой сотрудник. Обновите страницу и внесите изменение заново.",
    exceeds: "Платёж превышает остаток по этому пункту графика.",
    duplicate: "Этот номер операции уже учтён в деле. Проверьте банковскую выписку и историю оплат.",
    payment: "Не удалось подтвердить оплату. Проверьте право, дату и банковский референс.",
    void: "Не удалось отменить запись об оплате.",
  };

  return <>
    <Link href={`/staff/cases/${id}`} className="staff-back">← Дело № {item.case_number}</Link>
    <div className="staff-page-heading"><div><span className="staff-eyebrow">ДОГОВОР И ОПЛАТЫ</span><h1>{item.title}</h1><p>Только подтверждённые уполномоченным сотрудником платежи входят в расчёт.</p></div></div>
    {(query.created || query.updated || query.confirmed || query.voided || query.contractUploaded || query.receiptReviewed) && <div className="staff-alert is-success">Изменение сохранено и записано в журнал.</div>}
    {query.error && <div className="staff-alert is-error">{errorText[query.error] ?? "Не удалось выполнить действие."}</div>}
    {query.contractError && <div className="staff-alert is-error" role="alert">{query.contractError === "access" ? "Нет права добавить договор или дело сейчас недоступно." : query.contractError === "storage" ? "Не удалось сохранить PDF в закрытом хранилище. Повторите попытку." : query.contractError === "conflict" ? "Форма уже использована для другого файла. Обновите страницу и повторите." : "Не удалось добавить договор. Проверьте номер, цену, дату и PDF-файл."}</div>}
    {query.receiptError && <div className="staff-alert is-error" role="alert">Не удалось рассмотреть чек. Проверьте решение, комментарий и актуальный статус дела.</div>}
    <section className="staff-admin-metrics staff-payment-summary" aria-label="Сводка оплат">
      <article><span>Цена последней версии</span><strong>{price === null ? "Не указана" : formatKzt(price)}</strong></article>
      <article><span>Подтверждено по делу</span><strong>{formatKzt(totalPaid)}</strong></article>
      <article><span>{difference !== null && difference < BigInt(0) ? "Сверх цены последней версии" : contracts.length > 1 ? "Разница с ценой последней версии" : "Остаток по договору"}</span><strong>{difference === null ? "Не рассчитан" : formatKzt(difference < BigInt(0) ? -difference : difference)}</strong></article>
      <article><span>Следующий срок</span><strong>{nextDue ? formatKzDate(nextDue.due_on) : "Нет"}</strong></article>
    </section>
    {contracts.length > 1 && <p className="staff-form-hint">Сводка сопоставляет цену последней версии со всеми подтверждёнными оплатами по делу. Сроки старых версий сохраняются; перед подтверждением новой оплаты проверьте, как изменение договора влияет на прежние обязательства.</p>}
    <section className="staff-list-section"><div className="staff-section-heading"><h2>Договоры</h2></div>
      {contracts.length ? <div className="staff-work-list">{contracts.map((contract) => <article className="staff-work-card" key={contract.id}><h3>№ {contract.contract_number} · версия {contract.version_no}</h3><p>{formatKzt(toKztCents(contract.price_kzt))}{contract.signed_on ? ` · ${formatKzDate(contract.signed_on)}` : " · дата подписания не указана"}</p><a className="staff-text-link" href={`/api/contracts/${contract.id}`}>Скачать PDF →</a> <a className="staff-text-link" href={`/api/contracts/${contract.id}?preview=1`} target="_blank" rel="noopener noreferrer">Просмотреть</a></article>)}</div>
        : <div className="staff-empty-box"><h3>Договор ещё не добавлен</h3><p>Уполномоченный сотрудник добавит PDF-договор после согласования.</p></div>}
    </section>
    {canChange && uploadsReady && <section className="staff-form-panel"><div><span className="staff-eyebrow">НОВАЯ ВЕРСИЯ</span><h2>Добавить договор</h2><p>Новая версия не заменяет старый PDF. Цена в сводке берётся из последней версии; уже подтверждённые платежи не меняются.</p></div><form action="/api/contracts" method="post" encType="multipart/form-data" className="staff-form"><input type="hidden" name="caseId" value={id} /><input type="hidden" name="key" value={randomUUID()} /><label>Номер договора<input name="contractNumber" required maxLength={120} /></label><label>Дата подписания, если есть<input name="signedOn" type="date" /></label><label>Цена, ₸<input name="price" type="number" min="0" max="999999999999.99" step="0.01" required /></label><label>Подписанный PDF<input name="file" type="file" accept=".pdf,application/pdf" required /></label><small>Один PDF до 20 МБ. Подпись и юридическое содержание файла сотрудник проверяет отдельно.</small><button type="submit">Добавить версию договора →</button></form></section>}
    {canChange && !uploadsReady && <p className="staff-form-hint">Загрузка договора появится после настройки серверного ключа закрытого хранилища.</p>}
    {canChange && !latestContract && <p className="staff-form-hint">Добавить срок оплаты можно после регистрации договора по этому делу.</p>}
    {canChange && latestContract && <section className="staff-form-panel"><div><span className="staff-eyebrow">ГРАФИК</span><h2>Добавить срок оплаты</h2><p>Новый срок будет связан с договором № {latestContract.contract_number}, версия {latestContract.version_no}. Сумма появится у клиента как ожидаемый платёж, но не как подтверждённая оплата.</p></div>
      <form action={addInstallment} className="staff-form"><input type="hidden" name="caseId" value={id} /><label>Дата оплаты<input name="dueOn" type="date" required /></label><label>Сумма, ₸<input name="amount" type="number" min="0.01" max="999999999999.99" step="0.01" required /></label><label>Описание<input name="description" maxLength={500} /></label><button type="submit">Добавить в график →</button></form>
    </section>}
    <section className="staff-list-section"><div className="staff-section-heading"><h2>График</h2><span>{schedule.length}</span></div>
      {schedule.length ? <div className="staff-work-list">{schedule.map((row) => {
        const amount = toKztCents(row.amount_kzt);
        const paid = confirmed.filter((payment) => payment.schedule_id === row.id)
          .reduce((sum, payment) => sum + toKztCents(payment.amount_kzt), BigInt(0));
        const contract = row.contract_id ? contractsById.get(row.contract_id) : null;
        return <article className="staff-work-card" key={row.id}>
          <div className="staff-work-head"><h3>{formatKzDate(row.due_on)}</h3><span className="staff-tag">{paid >= amount ? "Оплачено" : paid > BigInt(0) ? "Частично" : "Ожидается"}</span></div>
          <p>{row.description ?? "Платёж по договору"}</p><p>{contract ? `Договор № ${contract.contract_number} · версия ${contract.version_no}` : row.contract_id ? "Версия договора недоступна" : "Ранее созданный срок · версия договора не установлена"}</p><small>{formatKzt(paid)} из {formatKzt(amount)} подтверждено</small>
          {canChange && <details className="staff-payment-details"><summary>Изменить график</summary><form action={updateInstallment} className="staff-form"><input type="hidden" name="caseId" value={id} /><input type="hidden" name="scheduleId" value={row.id} /><input type="hidden" name="expectedUpdatedAt" value={row.updated_at} /><label>Дата<input name="dueOn" type="date" defaultValue={row.due_on} required /></label><label>Сумма, ₸<input name="amount" type="number" min="0.01" max="999999999999.99" step="0.01" defaultValue={String(row.amount_kzt)} required /></label><label>Описание<input name="description" defaultValue={row.description ?? ""} maxLength={500} /></label><label>Причина изменения<input name="reason" maxLength={500} required /></label><button type="submit">Сохранить изменение →</button></form></details>}
          {canChange && paid < amount && <details className="staff-payment-details"><summary>Подтвердить оплату</summary><form action={confirmPayment} className="staff-form"><input type="hidden" name="caseId" value={id} /><input type="hidden" name="scheduleId" value={row.id} /><input type="hidden" name="key" value={randomUUID()} /><label>Сумма, ₸<input name="amount" type="number" min="0.01" max="999999999999.99" step="0.01" required /></label><label>Дата поступления<input name="paidOn" type="date" required /></label><label>Уникальный номер банковской операции или кассового ордера<input name="reference" minLength={4} maxLength={120} required /></label><label>Чек, если клиент его отправил<select name="receiptId" defaultValue=""><option value="">Без чека</option>{availableReceipts.map((receipt) => <option key={receipt.id} value={receipt.id}>{receipt.original_name}</option>)}</select></label><label>Комментарий клиенту<input name="clientNote" maxLength={500} /></label><p>Проверьте поступление по банковским данным перед подтверждением. Один номер операции учитывается только один раз в деле. Загруженный чек сам по себе оплатой не считается.</p><button type="submit">Подтвердить фактическую оплату →</button></form></details>}
        </article>;
      })}</div> : <div className="staff-empty-box"><h3>График не добавлен</h3></div>}
    </section>
    <section className="staff-list-section"><div className="staff-section-heading"><h2>История оплат</h2></div>
      {payments.length ? <div className="staff-work-list">{payments.map((payment) => {
        const term = scheduleById.get(payment.schedule_id);
        const contract = term?.contract_id ? contractsById.get(term.contract_id) : null;
        return <article className="staff-work-card" key={payment.id}>
        <div className="staff-work-head"><h3>{formatKzt(toKztCents(payment.amount_kzt))}</h3><span className="staff-tag">{payment.status === "confirmed" ? "Подтверждено" : "Отменено"}</span></div>
        <p>{formatKzDate(payment.paid_on)} · {payment.payment_reference ?? "Основание не указано"}{payment.client_note ? ` · ${payment.client_note}` : ""}{payment.receipt_id ? ` · чек: ${receiptsResult.data?.find((receipt) => receipt.id === payment.receipt_id)?.original_name ?? "приложен"}` : ""}</p>
        <p>{contract ? `Договор № ${contract.contract_number} · версия ${contract.version_no}` : "Версия договора для этой оплаты не указана"}</p>
        {canManage && payment.status === "confirmed" && <form action={voidPayment} className="staff-form staff-payment-void"><input type="hidden" name="caseId" value={id} /><input type="hidden" name="paymentId" value={payment.id} /><label>Причина исправления<input name="reason" maxLength={500} required /></label><button type="submit">Отменить запись об оплате →</button></form>}
      </article>;
      })}</div> : <div className="staff-empty-box"><h3>Подтверждённых оплат пока нет</h3></div>}
    </section>
    {!!receiptsResult.data?.length && <section className="staff-list-section"><div className="staff-section-heading"><h2>Чеки</h2></div><div className="staff-work-list">{receiptsResult.data.map((receipt) => <article className="staff-work-card" key={receipt.id}><h3>{receipt.original_name}</h3><p>{receipt.status === "under_review" ? "На проверке — не оплата" : receipt.status === "accepted" ? "Чек проверен — оплата отдельно" : "Отклонён"}{receipt.review_note ? ` · ${receipt.review_note}` : ""}</p><a className="staff-text-link" href={`/api/payment-receipts/${receipt.id}`}>Скачать чек →</a>{previewableReceiptTypes.has(receipt.detected_mime_type) && <> <a className="staff-text-link" href={`/api/payment-receipts/${receipt.id}?preview=1`} target="_blank" rel="noopener noreferrer">Просмотреть</a></>}{canChange && receipt.status === "under_review" && <form action={reviewReceipt} className="staff-form staff-review-form"><input type="hidden" name="caseId" value={id} /><input type="hidden" name="receiptId" value={receipt.id} /><label>Комментарий к проверке<textarea name="note" required maxLength={1000} rows={2} /></label><div className="staff-review-actions"><button type="submit" name="decision" value="accept">Чек соответствует</button><button type="submit" name="decision" value="reject">Отклонить чек</button></div><small>Принятие чека не подтверждает поступление денег. Оплату внесите отдельно по банковским данным.</small></form>}</article>)}</div></section>}
    {!canManage && <p className="staff-form-hint">Для изменения графика и подтверждения оплаты главный администратор должен отдельно выдать финансовое право в разделе «Команда».</p>}
  </>;
}
