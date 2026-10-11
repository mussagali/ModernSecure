import Link from "next/link";
import { formatKzDate, requireClientCase } from "../../../../../lib/client-case";
import { SubmitButton } from "../../../../../components/SubmitButton";
import { taskAcknowledgmentVersion } from "../../../../../lib/task-acknowledgment";
import { taskEventLabel } from "../../../../../lib/task-event-label";
import { acknowledgeTask, respondToTask } from "../actions";

const statusLabel: Record<string, string> = { new: "Ждёт ответа", response_sent: "На проверке", completed: "Выполнена", cancelled: "Отменена" };

export default async function ClientTasks({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string; acknowledged?: string; error?: string }> }) {
  const { id } = await params;
  const { supabase, item } = await requireClientCase(id);
  const { data: tasks, error } = await supabase.from("tasks").select("id, title, description, kind, status, due_at, created_at").eq("case_id", id).order("created_at", { ascending: false });
  if (error) throw new Error("Не удалось загрузить задачи");
  const taskIds = (tasks ?? []).map((task) => task.id);
  const { data: events, error: eventError } = taskIds.length ? await supabase.from("task_events").select("*").in("task_id", taskIds).order("occurred_at", { ascending: false }) : { data: [], error: null };
  if (eventError) throw new Error("Не удалось загрузить историю задач");
  const query = await searchParams;
  // eslint-disable-next-line react-hooks/purity -- This authenticated Server Component computes status for each request.
  const now = Date.now();
  return <section className="account-detail-section case-workspace"><h2>Задачи по делу</h2><p className="account-muted">Ответы и подтверждения сохраняются в деле и передаются ответственному сотруднику.</p>
    {query.sent && <p className="case-feedback">Ответ отправлен и ожидает проверки.</p>}
    {query.acknowledged && <p className="case-feedback">Ознакомление подтверждено и ожидает проверки.</p>}
    {query.error && <p className="case-feedback is-error">{query.error === "stale" ? "Задача изменилась или уже обработана. Проверьте текущий текст и статус перед повторным подтверждением." : "Не удалось выполнить действие. Проверьте задачу и повторите."}</p>}
    {tasks?.length ? <div className="case-card-list">{tasks.map((task) => {
      const history = (events ?? []).filter((event) => event.task_id === task.id);
      const overdue = task.status === "new" && item.status === "open" && !item.is_suspended && task.due_at && Date.parse(task.due_at) < now;
      return <article className="case-work-card" id={`task-${task.id}`} key={task.id}><div className="case-work-head"><h3 style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{task.title}</h3><span>{overdue ? "Просрочено" : task.kind === "acknowledge" && task.status === "new" ? "Ждёт ознакомления" : statusLabel[task.status] ?? task.status}</span></div>{task.description && <p>{task.description}</p>}{task.due_at && <small>Срок: {formatKzDate(task.due_at)}</small>}
        {history.length > 0 && <ol className="case-mini-history">{history.map((event) => <li key={event.id}><small>{formatKzDate(event.occurred_at)} · {taskEventLabel(event.action, "client")}</small>{event.response_text && <p>{event.response_text}</p>}{event.acknowledged_version && <small>Версия подтверждённого текста: <code style={{ overflowWrap: "anywhere" }}>{event.acknowledged_version}</code></small>}{event.acknowledged_text != null && <p>Текст на момент подтверждения:{"\n"}{event.acknowledged_text}</p>}</li>)}</ol>}
        {task.status === "new" && item.status === "open" && !item.is_suspended && (task.kind === "upload_document"
          ? <Link href={`/account/cases/${id}/documents`} className="staff-text-link">Перейти к документам →</Link>
          : task.kind === "acknowledge"
          ? <form action={acknowledgeTask} className="case-inline-form"><input type="hidden" name="caseId" value={id} /><input type="hidden" name="taskId" value={task.id} /><input type="hidden" name="expectedVersion" value={taskAcknowledgmentVersion(task)} /><label><span><input type="checkbox" name="confirmed" required /> Я ознакомился(ась) с названием и инструкцией задачи выше</span></label><small>Это подтверждение ознакомления, не электронная подпись.</small><SubmitButton>Подтвердить ознакомление →</SubmitButton></form>
          : <form action={respondToTask} className="case-inline-form"><input type="hidden" name="caseId" value={id} /><input type="hidden" name="taskId" value={task.id} /><label>Ваш ответ<textarea name="response" required maxLength={2000} rows={3} placeholder="Ответ по задаче" /></label><SubmitButton>Отправить ответ →</SubmitButton></form>)}
      </article>;
    })}</div> : <p className="account-muted">Задач по делу пока нет.</p>}
  </section>;
}
