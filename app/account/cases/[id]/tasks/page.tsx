import { ListSearch } from "../../../../../components/ListControls";
import { queryText, searchPattern, listHref } from "../../../../../lib/list-query";
import { formatDeadline } from "../../../../../lib/deadlines";
import Link from "next/link";
import { formatKzDate, requireClientCase } from "../../../../../lib/client-case";
import { SubmitButton } from "../../../../../components/SubmitButton";
import { taskAcknowledgmentVersion } from "../../../../../lib/task-acknowledgment";
import { taskEventLabel } from "../../../../../lib/task-event-label";
import { acknowledgeTask, respondToTask } from "../actions";

const statusLabel: Record<string, string> = { new: "Ждёт ответа", response_sent: "На проверке", completed: "Выполнена", cancelled: "Отменена" };

export default async function ClientTasks({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string; acknowledged?: string; error?: string; q?: string; status?: string }> }) {
  const { id } = await params;
  const { supabase, item } = await requireClientCase(id);
  const query = await searchParams;
  const q = queryText(query.q);
  const status = ["new", "response_sent", "completed"].includes(queryText(query.status)) ? queryText(query.status) : "all";
  let taskQuery = supabase.from("tasks").select("id, title, description, kind, document_request_id, status, due_at, created_at").eq("case_id", id);
  if (q) taskQuery = taskQuery.ilike("title", searchPattern(q));
  if (status !== "all") taskQuery = taskQuery.eq("status", status);
  const { data: tasks, error } = await taskQuery.order("created_at", { ascending: false }).order("id");
  if (error) throw new Error("Не удалось загрузить задачи");
  const taskIds = (tasks ?? []).map((task) => task.id);
  const { data: events, error: eventError } = taskIds.length ? await supabase.from("task_events").select("*").in("task_id", taskIds).order("occurred_at", { ascending: false }) : { data: [], error: null };
  if (eventError) throw new Error("Не удалось загрузить историю задач");
  // eslint-disable-next-line react-hooks/purity -- This authenticated Server Component computes status for each request.
  const now = Date.now();
  return <section className="account-detail-section case-workspace"><h2>Задачи по делу</h2><p className="account-muted">Ответы и подтверждения сохраняются в деле и передаются ответственному сотруднику.</p>
    <nav className="client-document-filters" aria-label="Статус задач">{[["all", "Все задачи"], ["new", "Ждут ответа"], ["response_sent", "На проверке"], ["completed", "Выполнены"]].map(([value, label]) => <Link key={value} href={listHref(`/account/cases/${id}/tasks`, { status: value, q })} aria-current={status === value ? "page" : undefined}>{label}</Link>)}</nav>
    <ListSearch action={`/account/cases/${id}/tasks`} query={q} placeholder="Найти задачу по названию" hidden={{ status }} resetHref={q ? `/account/cases/${id}/tasks` : undefined} />
    {query.sent && <p className="case-feedback">Ответ отправлен и ожидает проверки.</p>}
    {query.acknowledged && <p className="case-feedback">Ознакомление подтверждено и ожидает проверки.</p>}
    {query.error && <p className="case-feedback is-error">{query.error === "stale" ? "Задача изменилась или уже обработана. Проверьте текущий текст и статус перед повторным подтверждением." : "Не удалось выполнить действие. Проверьте задачу и повторите."}</p>}
    {tasks?.length ? <div className="case-card-list">{tasks.map((task) => {
      const history = (events ?? []).filter((event) => event.task_id === task.id);
      const overdue = task.status === "new" && item.status === "open" && !item.is_suspended && task.due_at && Date.parse(task.due_at) < now;
      return <article className="case-work-card" id={`task-${task.id}`} key={task.id}><div className="case-work-head"><h3 style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{task.title}</h3><span>{overdue ? "Просрочено" : task.kind === "acknowledge" && task.status === "new" ? "Ждёт ознакомления" : statusLabel[task.status] ?? task.status}</span></div>{task.description && <p>{task.description}</p>}{task.due_at && <small>Срок: {formatDeadline(task.due_at)}</small>}
        {history.length > 0 && <ol className="case-mini-history">{history.map((event) => <li key={event.id}><small>{formatKzDate(event.occurred_at)} · {taskEventLabel(event.action, "client")}</small>{event.response_text && <p>{event.response_text}</p>}{event.acknowledged_version && <small>Версия подтверждённого текста: <code style={{ overflowWrap: "anywhere" }}>{event.acknowledged_version}</code></small>}{event.acknowledged_text != null && <p>Текст на момент подтверждения:{"\n"}{event.acknowledged_text}</p>}</li>)}</ol>}
        {task.status === "new" && item.status === "open" && !item.is_suspended && (task.kind === "upload_document"
          ? <Link href={`/account/cases/${id}/documents${task.document_request_id ? `#request-${task.document_request_id}` : ""}`} className="staff-text-link">Перейти к документам</Link>
          : task.kind === "acknowledge"
          ? <form action={acknowledgeTask} className="case-inline-form"><input type="hidden" name="caseId" value={id} /><input type="hidden" name="taskId" value={task.id} /><input type="hidden" name="expectedVersion" value={taskAcknowledgmentVersion(task)} /><label><span><input type="checkbox" name="confirmed" required /> Я ознакомился(ась) с названием и инструкцией задачи выше</span></label><small>Это подтверждение ознакомления, не электронная подпись.</small><SubmitButton>Подтвердить ознакомление</SubmitButton></form>
          : <form action={respondToTask} className="case-inline-form"><input type="hidden" name="caseId" value={id} /><input type="hidden" name="taskId" value={task.id} /><label>Ваш ответ<textarea name="response" required maxLength={2000} rows={3} placeholder="Ответ по задаче" /></label><SubmitButton>Отправить ответ</SubmitButton></form>)}
      </article>;
    })}</div> : <p className="account-muted">{q || status !== "all" ? "Задачи не найдены. Измените запрос или статус." : "Задач по делу пока нет."}</p>}
  </section>;
}
