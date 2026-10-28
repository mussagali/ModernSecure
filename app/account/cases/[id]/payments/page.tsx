import { DirectUploadForm } from "../../../../../components/DirectUploadForm";
import { randomUUID } from "node:crypto";
import { formatKzDate, requireClientCase } from "../../../../../lib/client-case";
import { installmentPaidAmounts } from "../../../../../lib/payment-summary";
import { formatKzt, toKztCents } from "../../../../../lib/money";

const previewableReceiptTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif"]);

export default async function ClientPayments({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ receiptUploaded?: string; receiptError?: string }> }) {
  const { id } = await params;
  const { supabase, item } = await requireClientCase(id);
  const query = await searchParams;
  const uploadsReady = Boolean(process.env.SUPABASE_SECRET_KEY);
  const [scheduleResult, paymentsResult, contractsResult, receiptsResult, contactResult, allocationsResult] = await Promise.all([
    supabase.from("payment_schedule").select("id, contract_id, due_on, amount_kzt, description, cancelled_at, cancellation_reason").eq("case_id", id).order("due_on"),
    supabase.from("payments").select("id, schedule_id, amount_kzt, paid_on, client_note, status").eq("case_id", id).eq("status", "confirmed").order("paid_on", { ascending: false }),
    supabase.from("contracts").select("id, contract_number, signed_on, price_kzt, version_no").eq("case_id", id).order("version_no", { ascending: false }),
    supabase.from("payment_receipts").select("id, original_name, detected_mime_type, status, review_note, created_at").eq("case_id", id).order("created_at", { ascending: false }),
    supabase.from("contact_settings").select("payment_details").eq("id", true).maybeSingle(),
    supabase.from("payment_allocations").select("payment_id, schedule_id, amount_kzt").eq("case_id", id),
  ]);
  if ([scheduleResult, paymentsResult, contractsResult, receiptsResult, contactResult, allocationsResult].some((result) => result.error)) {
    throw new Error("Не удалось загрузить оплаты");
  }
  const schedule = scheduleResult.data ?? [];
  const payments = paymentsResult.data ?? [];
  const allocations = allocationsResult.data ?? [];
  const paidByInstallment = installmentPaidAmounts(payments, allocations);
  const contracts = contractsResult.data ?? [];
  const contractsById = new Map(contracts.map((contract) => [contract.id, contract]));
  const scheduleById = new Map(schedule.map((row) => [row.id, row]));
  const price = contractsResult.data?.[0] ? toKztCents(contractsResult.data[0].price_kzt) : null;
  const paidTotal = payments.reduce((sum, payment) => sum + toKztCents(payment.amount_kzt), BigInt(0));
  const difference = price === null ? null : price - paidTotal;
  const isArchived = item.status !== "open";
  const nextDue = isArchived ? undefined : schedule.find((row) => !row.cancelled_at
    && (paidByInstallment.get(row.id) ?? BigInt(0)) < toKztCents(row.amount_kzt));
  return <section className="account-detail-section case-workspace">
    <h2>Договор и оплаты</h2>
    {isArchived && <p className="case-safety-note">{item.status === "cancelled" ? "Дело отменено." : "Дело завершено."} Здесь сохранены договоры, график и история оплат. Новые оплаты через это дело не принимаются.</p>}
    {query.receiptUploaded && <p className="case-feedback" role="status">Чек отправлен на проверку. Он не считается оплатой до отдельного подтверждения поступления денег.</p>}
    {query.receiptError && <p className="case-feedback is-error" role="alert">{query.receiptError === "duplicate" ? "Этот файл уже есть в деле. Проверьте список чеков ниже." : query.receiptError === "storage" ? "Не удалось сохранить файл. Попробуйте ещё раз." : "Не удалось отправить чек. Проверьте файл и актуальный статус дела."}</p>}
    <div className="case-payment-summary"><div><small>Подтверждено по делу</small><strong>{formatKzt(paidTotal)}</strong></div><div><small>{isArchived ? "Разница цены и оплат" : difference !== null && difference < BigInt(0) ? "Сверх цены последней версии" : contracts.length > 1 ? "Разница с ценой последней версии" : "Остаток по договору"}</small><strong>{difference === null ? "Не рассчитан" : formatKzt(difference < BigInt(0) ? -difference : difference)}</strong></div><div><small>{isArchived ? "График" : "Следующий срок"}</small><strong>{isArchived ? "Архив" : nextDue ? formatKzDate(nextDue.due_on) : "Нет"}</strong></div></div>
    {contracts.length > 1 && <p className="case-safety-note">В сводке цена последней версии договора сопоставлена со всеми подтверждёнными оплатами по делу. Сроки и оплаты прошлых версий показаны ниже отдельно; если условия менялись, уточните итоговый расчёт у сотрудника.</p>}
    {contracts.length ? <div className="case-card-list">{contracts.map((contract, index) => <article className="case-work-card" key={contract.id}><h3>Договор № {contract.contract_number} · версия {contract.version_no}{index === 0 ? " · последняя" : ""}</h3><p>Сумма: {formatKzt(toKztCents(contract.price_kzt))}{contract.signed_on ? ` · подписан ${formatKzDate(contract.signed_on)}` : " · дата подписания не указана"}</p><a href={`/api/contracts/${contract.id}`}>Скачать PDF договора</a> <a href={`/api/contracts/${contract.id}?preview=1`} target="_blank" rel="noopener noreferrer">Просмотреть</a></article>)}</div> : <p className="account-muted">Договор ещё не добавлен; остаток по договору пока не рассчитывается.</p>}
    {!isArchived && !item.is_suspended && contactResult.data?.payment_details && <section className="case-work-card payment-details"><h3>Как оплатить</h3><p>{contactResult.data.payment_details}</p><p className="account-muted">После оплаты прикрепите чек ниже. Сотрудник проверит поступление денег.</p></section>}
    <h3 className="case-subheading">График платежей</h3>
    {schedule.length ? <div className="case-card-list">{schedule.map((row) => {
      const paid = paidByInstallment.get(row.id) ?? BigInt(0);
      const amount = toKztCents(row.amount_kzt);
      const contract = row.contract_id ? contractsById.get(row.contract_id) : null;
      return <article className="case-work-card" key={row.id}><div className="case-work-head"><h3>{formatKzDate(row.due_on)}</h3><span>{row.cancelled_at ? "Остаток отменён" : paid >= amount ? "Оплачено" : paid > BigInt(0) ? "Частично оплачено" : isArchived ? "Непогашено в архивном графике" : "Ожидается"}</span></div><p>{row.description ?? "Платёж по договору"}</p><p>{contract ? `Договор № ${contract.contract_number} · версия ${contract.version_no}` : row.contract_id ? "Версия договора недоступна" : "Ранее созданный срок · версия договора не указана"}</p><small>{formatKzt(paid)} из {formatKzt(amount)} подтверждено</small>{row.cancelled_at && <p>Причина отмены: {row.cancellation_reason}</p>}</article>;
    })}</div> : <p className="account-muted">График платежей не добавлен.</p>}
    {!!payments.length && <><h3 className="case-subheading">Подтверждённые оплаты</h3><div className="case-card-list">{payments.map((payment) => <article className="case-work-card" key={payment.id}><strong>{formatKzt(toKztCents(payment.amount_kzt))}</strong><p>{formatKzDate(payment.paid_on)}{payment.client_note ? ` · ${payment.client_note}` : ""}</p>{allocations.filter((allocation) => allocation.payment_id === payment.id).map((allocation) => {
      const term = scheduleById.get(allocation.schedule_id);
      const contract = term?.contract_id ? contractsById.get(term.contract_id) : null;
      return <p key={allocation.schedule_id}>{formatKzt(toKztCents(allocation.amount_kzt))}{term ? ` · срок ${formatKzDate(term.due_on)}` : ""} · {contract ? `договор № ${contract.contract_number}, версия ${contract.version_no}` : "версия договора не указана"}</p>;
    })}</article>)}</div></>}

    {uploadsReady && item.status === "open" && !item.is_suspended && <DirectUploadForm action="/api/payment-receipts" className="staff-form"><input type="hidden" name="caseId" value={id} /><input type="hidden" name="key" value={randomUUID()} /><label>Добавить чек об оплате<input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif" required /></label><small>Один PDF или файл изображения до 20 МБ. Проверка чека не означает подтверждение оплаты.</small><button type="submit">Отправить чек на проверку</button></DirectUploadForm>}
    {!isArchived && !uploadsReady && <p className="account-muted">Отправка чеков появится после настройки закрытого файлового хранилища.</p>}
    {!!receiptsResult.data?.length && <><h3 className="case-subheading">Чеки</h3><div className="case-card-list">{receiptsResult.data.map((receipt) => <article className="case-work-card" key={receipt.id}><strong>{receipt.original_name}</strong><p>{receipt.status === "under_review" ? "На проверке | не подтверждение оплаты" : receipt.status === "accepted" ? "Чек проверен | оплата отдельно" : "Отклонён"}{receipt.review_note ? ` · ${receipt.review_note}` : ""}</p><a href={`/api/payment-receipts/${receipt.id}`}>Скачать чек</a>{previewableReceiptTypes.has(receipt.detected_mime_type) && <> <a href={`/api/payment-receipts/${receipt.id}?preview=1`} target="_blank" rel="noopener noreferrer">Просмотреть</a></>}</article>)}</div></>}
    <p className="case-safety-note">Загруженный чек сам по себе не подтверждает поступление денег. В расчёте учитываются только платежи, подтверждённые уполномоченным сотрудником.</p>
  </section>;
}
