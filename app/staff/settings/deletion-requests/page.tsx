import Link from "next/link";
import { requirePrimaryAdmin } from "../../../../lib/staff";
import { SubmitButton } from "../../../../components/SubmitButton";
import { updateDeletionRequest } from "./actions";

export default async function DeletionRequestsPage({ searchParams }: { searchParams: Promise<{ page?: string; error?: string; saved?: string }> }) {
  const { supabase } = await requirePrimaryAdmin();
  const query = await searchParams;
  const candidate = Number(query.page ?? 1);
  const page = Number.isSafeInteger(candidate) && candidate > 0 && candidate <= 100000 ? candidate : 1;
  const { data, error } = await supabase.rpc("admin_account_deletion_requests", { p_page: page });
  if (error) throw new Error("Не удалось загрузить запросы на удаление");
  const labels: Record<string, string> = { requested: "Новый", in_progress: "В обработке", completed: "Завершён" };
  return <><Link href="/staff/settings" className="staff-back">Настройки</Link><h1>Запросы на удаление аккаунтов</h1><p>Отправка запроса не удаляет данные автоматически. Проверьте личность, основания и сроки хранения, выполните удаление и направьте подтверждение пользователю. Отмечайте завершение только после фактической обработки.</p>
    {query.error && <p className="staff-alert is-error" role="alert">Не удалось сохранить. Для завершения нужны подробный ответ и подтверждение фактической обработки.</p>}{query.saved && <p className="staff-alert is-success" role="status">Статус сохранён.</p>}
    {data?.length ? data.map((item: { id: string; requester_email: string; status: string; due_at: string; response: string | null }) => <section className="staff-form-panel" key={item.id}><div><h2>{item.requester_email}</h2><p>{labels[item.status]} · срок до {new Date(item.due_at).toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty" })}</p><p>{item.id}</p></div>{item.status === "completed" ? <p>{item.response}</p> : <form action={updateDeletionRequest} className="staff-form"><input type="hidden" name="id" value={item.id} /><input type="hidden" name="page" value={page} /><label>Статус<select name="status" defaultValue="in_progress"><option value="in_progress">В обработке</option><option value="completed">Завершено вручную</option></select></label><label>Ответ пользователю: что удалено, что сохранено, основание и срок<textarea name="response" rows={5} maxLength={2000} defaultValue={item.response ?? ""} /></label><label className="staff-check"><input type="checkbox" name="completed" />При завершении: аккаунт и данные фактически обработаны, подтверждение отправлено пользователю; это не только блокировка доступа.</label><SubmitButton>Сохранить статус</SubmitButton></form>}</section>) : <p>Запросов на этой странице нет.</p>}
    <nav aria-label="Страницы запросов">{page > 1 && <Link href={`?page=${page - 1}`}>Предыдущая</Link>} {data?.length === 25 && <Link href={`?page=${page + 1}`}>Следующая</Link>}</nav>
  </>;
}
