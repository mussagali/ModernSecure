import Link from "next/link";
import { SubmitButton } from "../../../../../components/SubmitButton";
import { formatKzDate } from "../../../../../lib/client-case";
import { requireStaffCase } from "../../../../../lib/staff-case";
import { taskEventLabel } from "../../../../../lib/task-event-label";
import { createTask, reviewTask } from "../../../actions";

const statuses: Record<string, string> = { new: "Ждёт ответа", response_sent: "Ответ получен", completed: "Выполнена", cancelled: "Отменена" };

export default async function StaffTasks({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; reviewed?: string; error?: string }> }) {
  const { id } = await params;
  const { supabase, staff, item } = await requireStaffCase(id);
  const { data: tasks, error } = await supabase.from("tasks").select("id, title, description, kind, status, due_at, created_at").eq("case_id", id).order("created_at", { ascending: false });
  if (error) throw new Error("Не удалось загрузить задачи");
  const taskIds = (tasks ?? []).map((task) => task.id);
  const { data: events, error: eventError } = taskIds.length ? await supabase.from("task_events").select("*").in("task_id", taskIds).order("occurred_at", { ascending: false }) : { data: [], error: null };
  if (eventError) throw new Error("Не удалось загрузить ответы");
  const query = await searchParams;
  // eslint-disable-next-line react-hooks/purity -- This authenticated Server Component computes status for each request.
  const now = Date.now();
  return <><Link href={`/staff/cases/${id}`} className="staff-back">← Дело № {item.case_number}</Link><div className="staff-page-heading"><div><span className="staff-eyebrow">ЗАДАЧИ ПО ДЕЛУ</span><h1>{item.title}</h1></div></div>
    {(query.created || query.reviewed) && <div className="staff-alert is-success">{query.created ? "Задача создана и видна клиенту." : "Решение по ответу сохранено."}</div>}{query.error && <div className="staff-alert is-error">Действие не выполнено. Проверьте данные и статус задачи.</div>}
    {staff.role !== "manager" && item.status === "open" && !item.is_suspended && <section className="staff-form-panel"><div><span className="staff-eyebrow">НОВАЯ ЗАДАЧА</span><h2>Что должен сделать клиент?</h2><p>Ответ или подтверждение появится здесь и в истории задачи.</p></div><form action={createTask} className="staff-form"><input type="hidden" name="caseId" value={id} /><label>Тип задачи<select name="kind" defaultValue="answer"><option value="answer">Ответить на вопрос</option><option value="acknowledge">Ознакомиться</option><option value="contact">Связаться с сотрудником</option></select></label><label>Название<input name="title" required maxLength={180} /></label><label>Инструкция<textarea name="description" maxLength={2000} rows={3} /></label><label>Срок<input name="dueAt" type="datetime-local" /></label><SubmitButton>Создать задачу →</SubmitButton></form></section>}
    <section className="staff-list-section"><div className="staff-section-heading"><h2>Задачи</h2><span>{tasks?.length ?? 0}</span></div>{tasks?.length ? <div className="staff-work-list">{tasks.map((task) => <article className="staff-work-card" id={`task-${task.id}`} key={task.id}><div className="staff-work-head"><h3 style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{task.title}</h3><span className="staff-tag">{task.status === "new" && item.status === "open" && !item.is_suspended && task.due_at && Date.parse(task.due_at) < now ? "Просрочено" : task.kind === "acknowledge" && task.status === "new" ? "Ждёт ознакомления" : task.kind === "acknowledge" && task.status === "response_sent" ? "Подтверждение получено" : statuses[task.status] ?? task.status}</span></div>{task.description && <p>{task.description}</p>}{task.due_at && <small>Срок: {formatKzDate(task.due_at)}</small>}
      {(events ?? []).filter((event) => event.task_id === task.id).map((event) => <div className="staff-event-inline" key={event.id}><small>{formatKzDate(event.occurred_at)} · {taskEventLabel(event.action, "staff")}</small>{event.response_text && <p>{event.response_text}</p>}{event.acknowledged_version && <small>Версия подтверждённого текста: <code style={{ overflowWrap: "anywhere" }}>{event.acknowledged_version}</code></small>}{event.acknowledged_text != null && <p>Текст на момент подтверждения:{"\n"}{event.acknowledged_text}</p>}</div>)}
      {staff.role !== "manager" && item.status === "open" && !item.is_suspended && task.status === "response_sent" && <form action={reviewTask} className="staff-form staff-review-form"><input type="hidden" name="caseId" value={id} /><input type="hidden" name="taskId" value={task.id} /><label>Комментарий при возврате<textarea name="note" maxLength={2000} rows={2} /></label><div className="staff-review-actions"><button type="submit" name="decision" value="accept">{task.kind === "acknowledge" ? "Принять подтверждение" : "Принять ответ"}</button><button type="submit" name="decision" value="return">{task.kind === "acknowledge" ? "Вернуть на повторное ознакомление" : "Вернуть на доработку"}</button></div></form>}
    </article>)}</div> : <div className="staff-empty-box"><h3>Задач пока нет</h3></div>}</section>
  </>;
}
