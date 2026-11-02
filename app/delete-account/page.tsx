import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "../../components/AuthFrame";
import { SubmitButton } from "../../components/SubmitButton";
import { createClient } from "../../lib/supabase/server";
import { requestAccountDeletion } from "./actions";

export const metadata: Metadata = { title: "Удаление аккаунта | Современная защита" };

export default async function DeleteAccountPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const query = await searchParams;
  const result = auth?.claims?.sub ? await supabase.rpc("own_account_deletion_request") : null;
  const request = result?.data;
  const active = request && request.status !== "completed";
  const statusNames: Record<string, string> = { requested: "Зарегистрирован", in_progress: "В обработке", completed: "Обработка завершена" };
  const date = (value: string) => new Date(value).toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty" });
  return <AuthFrame title="Удаление аккаунта" description="Отправьте запрос на удаление аккаунта и связанных персональных данных. Отдельное письмо или звонок для отправки запроса не нужны.">
    <p>Запрос обрабатывается вручную в срок до 30 календарных дней; если закон требует более короткого срока, применяется он. После завершения компания направит подтверждение на email аккаунта. Договоры, обязательные учётные документы и материалы, для которых есть законное основание хранения, могут сохраняться; основания и сроки сообщат в ответе.</p>
    <p><Link href="/deletion-policy">Что удаляется и что может сохраняться</Link></p>
    {query.error && <p className="auth-feedback is-error" role="alert">{query.error === "confirm" ? "Подтвердите намерение удалить аккаунт." : "Не удалось отправить запрос. Повторите позже или обратитесь в поддержку."}</p>}
    {result?.error ? <p className="auth-feedback is-error" role="alert">Не удалось проверить статус запроса. Обновите страницу позже или <Link href="/support">обратитесь в поддержку</Link>.</p>
      : request && <section className="auth-support" aria-labelledby="deletion-status"><h2 id="deletion-status">{statusNames[request.status] ?? "Статус запроса"}</h2><p>Номер: {request.id}</p><p>Получен {date(request.requested_at)}. Плановый срок: {date(request.due_at)}.</p>{request.response && <p>{request.response}</p>}{active && <p role="status">Запрос получен. Аккаунт ещё не удалён; повторно отправлять запрос не нужно.</p>}</section>}
    {!auth?.claims?.sub ? <><p>Войдите в аккаунт, который хотите удалить. Запрос доступен клиентам, сотрудникам и аккаунтам, ожидающим активации.</p><p><Link href="/login?next=%2Fdelete-account">Войти для удаления аккаунта</Link></p><p><Link href="/forgot-password">Восстановить доступ</Link></p></>
      : !active && !result?.error && <form action={requestAccountDeletion} className="auth-form"><p>Запрос относится только к вашему текущему аккаунту: {auth.claims.email as string}.</p><label className="consent-check"><input type="checkbox" name="confirm" required /><span>Прошу удалить мой аккаунт и связанные данные с учётом обязательных оснований хранения.</span></label><SubmitButton>Отправить запрос на удаление</SubmitButton></form>}
    <p><Link href="/support">Поддержка</Link> · <Link href="/account">В кабинет</Link></p>
  </AuthFrame>;
}
