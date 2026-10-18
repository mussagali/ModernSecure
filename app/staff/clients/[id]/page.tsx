import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "../../../../lib/staff";
import { uuidPattern } from "../../../../lib/uuid";
import { SubmitButton } from "../../../../components/SubmitButton";
import { correctClientIdentity } from "./actions";

export default async function ClientCard({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { supabase } = await requireStaff(["admin", "manager"]);
  const { id } = await params;
  if (!uuidPattern.test(id)) notFound();
  const { data: client, error } = await supabase.from("clients")
    .select("id, full_name, iin, email, phone, city, updated_at").eq("id", id).maybeSingle();
  if (error) throw new Error("Не удалось загрузить карточку");
  if (!client) notFound();
  const query = await searchParams;
  return <>
    <Link href="/staff/clients" className="staff-text-link">К списку клиентов</Link>
    <div className="staff-page-heading"><div><h1>{client.full_name}</h1><p>{[client.email, client.phone, client.city].filter(Boolean).join(" · ") || "Контакты не указаны"}</p></div></div>
    {query.saved && <p className="staff-alert is-success" role="status">Данные исправлены в карточке и профиле клиента. Причина сохранена в журнале.</p>}
    {query.error && <p className="staff-alert is-error" role="alert">{query.error === "conflict" ? "Карточка уже изменилась. Проверьте актуальные данные и повторите исправление." : "Проверьте ФИО, 12 цифр ИИН и причину исправления. Затем попробуйте снова."}</p>}
    <section className="staff-form-panel"><div><h2>Исправить ФИО или ИИН</h2><p>Сверьте данные с клиентом. Для исправления нужна причина; сам ИИН в журнал не копируется.</p></div>
      <form action={correctClientIdentity} className="staff-form">
        <input type="hidden" name="clientId" value={id} /><input type="hidden" name="expectedUpdatedAt" value={client.updated_at} />
        <label>ФИО<input name="fullName" defaultValue={client.full_name} required maxLength={160} autoComplete="off" /></label>
        <label>ИИН<input name="iin" defaultValue={client.iin ?? ""} inputMode="numeric" pattern="[0-9]{12}" minLength={12} maxLength={12} autoComplete="off" /></label>
        <small>Пустое поле удалит ошибочный ИИН. Клиент сможет заполнить его заново в профиле.</small>
        <label>Причина исправления<textarea name="reason" required maxLength={500} rows={3} placeholder="Например, исправление опечатки после сверки с клиентом" /></label>
        <SubmitButton pendingText="Сохраняем…">Сохранить исправление</SubmitButton>
      </form>
    </section>
    <Link href={`/staff/cases?client=${id}`} className="staff-text-link">Дела клиента</Link>
  </>;
}
