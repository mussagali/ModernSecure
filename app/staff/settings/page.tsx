import Link from "next/link";
import type { Metadata } from "next";
import { SubmitButton } from "../../../components/SubmitButton";
import { requireStaff } from "../../../lib/staff";
import { saveContactSettings, saveFaqEntry, saveStaleCaseDays } from "./actions";

export const metadata: Metadata = { title: "Настройки | Современная защита" };

export default async function StaffSettingsPage({ searchParams }: {
  searchParams: Promise<{ contactSaved?: string; faqSaved?: string; staleSaved?: string; error?: string }>;
}) {
  const { supabase } = await requireStaff(["admin"]);
  const [contactResult, faqResult, staleResult] = await Promise.all([
    supabase.from("contact_settings").select("phone, email, whatsapp_url, business_hours, response_expectation, payment_details, updated_at").eq("id", true).maybeSingle(),
    supabase.from("faq_entries").select("id, question, answer, position, published, updated_at").order("position").limit(100),
    supabase.rpc("staff_stale_case_days"),
  ]);
  if (contactResult.error || faqResult.error || staleResult.error) throw new Error("Не удалось загрузить настройки");
  const contact = contactResult.data;
  const query = await searchParams;
  return <><div className="staff-page-heading"><div><h1>Настройки и ответы</h1><p>Реальные контакты появятся в разделе «Помощь», а время работы и срок ответа | также над перепиской по делу. Пустые поля не показываются.</p></div></div>
    {(query.contactSaved || query.faqSaved || query.staleSaved) && <div className="staff-alert is-success" role="status">Изменения сохранены и записаны в журнал.</div>}
    {query.error && <div className="staff-alert is-error" role="alert">{query.error === "conflict" ? "Настройки уже изменились в другой вкладке. Обновите страницу и внесите изменения заново." : query.error === "invalid" ? "Проверьте заполнение и длину полей." : "Не удалось сохранить изменения. Обновите страницу и попробуйте снова."}</div>}
    <p><Link className="staff-text-link" href="/staff/settings/legal">Условия и согласия клиентов</Link></p>
    <section className="staff-form-panel"><div><h2>Контакты</h2><p>Укажите только действующие каналы связи. Эти данные доступны всем вошедшим клиентам.</p></div><form action={saveContactSettings} className="staff-form">
      <input type="hidden" name="expectedUpdatedAt" value={contact?.updated_at ?? ""} />
      <label>Телефон<input name="phone" type="tel" defaultValue={contact?.phone ?? ""} maxLength={40} /></label>
      <label>Рабочий email<input name="email" type="email" defaultValue={contact?.email ?? ""} maxLength={254} /></label>
      <label>Ссылка WhatsApp<input name="whatsapp" type="url" defaultValue={contact?.whatsapp_url ?? ""} maxLength={300} placeholder="https://wa.me/…" /></label>
      <label>Время работы<input name="businessHours" defaultValue={contact?.business_hours ?? ""} maxLength={300} /></label>
      <label>Ожидаемый срок ответа<input name="responseExpectation" defaultValue={contact?.response_expectation ?? ""} maxLength={500} /></label>
      <label>Реквизиты и назначение платежа<textarea name="paymentDetails" rows={6} maxLength={4000} defaultValue={contact?.payment_details ?? ""} placeholder="Получатель, БИН, банк, IBAN, БИК и назначение платежа" /></label>
      <SubmitButton>Сохранить контакты</SubmitButton>
    </form></section>
    <section className="staff-form-panel"><div><h2>Дела без обновлений</h2><p>Если клиенту не публиковали обновление этапа дольше указанного срока, дело появится в отдельной очереди сотрудников. Приостановленные дела тоже учитываются.</p></div><form action={saveStaleCaseDays} className="staff-form"><label>Порог в днях<input name="days" type="number" min={1} max={365} required defaultValue={Number(staleResult.data ?? 14)} /></label><SubmitButton>Сохранить срок</SubmitButton></form></section>
    <section className="staff-form-panel"><div><h2>Добавить вопрос</h2><p>Сначала можно сохранить черновик; клиент увидит запись только после публикации.</p></div><form action={saveFaqEntry} className="staff-form">
      <label>Вопрос<input name="question" required maxLength={180} /></label>
      <label>Ответ<textarea name="answer" required maxLength={4000} rows={5} /></label>
      <label>Порядок<input name="position" type="number" min={1} max={1000} defaultValue={1} required /></label>
      <label className="staff-check"><input name="published" type="checkbox" />Опубликовать для клиентов</label>
      <SubmitButton>Сохранить вопрос</SubmitButton>
    </form></section>
    <section className="staff-list-section"><div className="staff-section-heading"><h2>Вопросы и ответы</h2><span>{faqResult.data?.length ?? 0}</span></div>
      {faqResult.data?.length ? <div className="staff-work-list">{faqResult.data.map((faq) => <article className="staff-work-card" key={faq.id}><div className="staff-work-head"><h3>{faq.question}</h3><span className="staff-tag">{faq.published ? "Опубликован" : "Черновик"}</span></div><form action={saveFaqEntry} className="staff-form"><input type="hidden" name="id" value={faq.id} /><input type="hidden" name="expectedUpdatedAt" value={faq.updated_at} />
        <label>Вопрос<input name="question" defaultValue={faq.question} required maxLength={180} /></label>
        <label>Ответ<textarea name="answer" defaultValue={faq.answer} required maxLength={4000} rows={4} /></label>
        <label>Порядок<input name="position" type="number" min={1} max={1000} defaultValue={faq.position} required /></label>
        <label className="staff-check"><input name="published" type="checkbox" defaultChecked={faq.published} />Показывать клиентам</label>
        <SubmitButton>Сохранить изменения</SubmitButton>
      </form></article>)}</div> : <div className="staff-empty-box"><h3>Вопросов пока нет</h3><p>Добавьте первый ответ, когда будет согласован текст для клиентов.</p></div>}
    </section>
  </>;
}
