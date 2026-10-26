import Link from "next/link";
import { requireStaff } from "../../../../lib/staff";
import { SubmitButton } from "../../../../components/SubmitButton";
import { publishLegalDocument } from "./actions";

const types = { terms: "Пользовательское соглашение", privacy: "Обработка персональных данных", marketing: "Рекламные сообщения (необязательно)" };
export default async function LegalSettings({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { supabase } = await requireStaff(["admin"]);
  const { data, error } = await supabase.from("legal_documents").select("id, document_type, version, title, body").eq("is_current", true);
  if (error) throw new Error("Не удалось загрузить условия");
  const query = await searchParams;
  return <><Link href="/staff/settings" className="staff-back">Настройки</Link><div className="staff-page-heading"><div><h1>Условия и согласия</h1><p>Публикуйте только утверждённые тексты. Новая версия соглашения или обработки данных потребует повторного согласия клиента при открытии кабинета. Старые версии и принятые согласия сохраняются.</p></div></div>
    {query.saved && <p className="staff-alert is-success" role="status">Версия опубликована.</p>}{query.error && <p className="staff-alert is-error" role="alert">{query.error === "conflict" ? "Другой администратор уже опубликовал версию. Обновите страницу." : "Проверьте текст и подтверждение его утверждения."}</p>}
    {Object.entries(types).map(([type, label]) => { const doc = data?.find((item) => item.document_type === type); return <section className="staff-form-panel" key={type}><div><h2>{label}</h2><p>{doc ? `Опубликована версия ${doc.version}` : "Пока не опубликовано. Пустой текст не запрашивается у клиента."}</p></div><form action={publishLegalDocument} className="staff-form"><input type="hidden" name="type" value={type} /><input type="hidden" name="expectedId" value={doc?.id ?? ""} /><label>Название<input name="title" defaultValue={doc?.title ?? label} required maxLength={180} /></label><label>Утверждённый текст<textarea name="body" defaultValue={doc?.body ?? ""} rows={12} required maxLength={60000} /></label><label className="staff-check"><input type="checkbox" name="approved" required />Текст утверждён и готов к публикации для клиентов</label><SubmitButton>Опубликовать новую версию</SubmitButton></form></section>; })}
  </>;
}
