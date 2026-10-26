import Link from "next/link";
import { requireStaff } from "../../../lib/staff";
import { worklistDate, worklistPage, getStaffWorklist } from "../../../lib/staff-worklist";
import { NavIcon } from "../../../components/NavIcon";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const { supabase } = await requireStaff(["lawyer", "admin"]);
  const query = await searchParams;
  const q = (query.q ?? "").trim().slice(0, 120);
  const status = ["completed", "overdue", "all"].includes(query.status ?? "") ? query.status! : "active";
  const page = worklistPage(query.page);
  let request = supabase.from("tasks").select("id, case_id, title, status, due_at", { count: "exact" });
  if (status === "active") request = request.in("status", ["new", "response_sent"]);
  if (status === "completed") request = request.eq("status", "completed");
  if (status === "overdue") request = request.eq("status", "new").lt("due_at", new Date().toISOString());
  if (q) request = request.ilike("title", `%${q.replace(/[%_]/g, "")}%`);
  const [{ data: tasks, count, error }, worklist] = await Promise.all([
    request.order("due_at", { nullsFirst: false }).order("id").range((page - 1) * 25, page * 25 - 1),
    getStaffWorklist(supabase, { status: "open" }),
  ]);
  if (error || worklist.error) throw new Error("Не удалось загрузить задачи");
  const ids = [...new Set((tasks ?? []).map(task => task.case_id))];
  const cases = ids.length ? await supabase.from("cases").select("id, case_number").in("id", ids) : { data: [], error: null };
  if (cases.error) throw new Error("Не удалось загрузить дела задач");
  const numbers = new Map((cases.data ?? []).map(item => [item.id, item.case_number]));
  const href = (value: string, nextPage = 1) => `?${new URLSearchParams({ status: value, q, page: String(nextPage) })}`;
  return <><div className="staff-page-heading"><div><h1>Задачи</h1><p>Задачи клиентов по доступным вам делам.</p></div><a href="#create" className="lawyer-primary"><NavIcon name="plus" size={17} />Создать задачу</a></div>
    <nav className="staff-filter-tabs" aria-label="Статус задач">{[["active", "Открытые"], ["overdue", "Просроченные"], ["completed", "Выполненные"], ["all", "Все"]].map(([key, label]) => <Link key={key} href={href(key)} className={key === status ? "is-active" : ""} aria-current={key === status ? "page" : undefined}>{label}</Link>)}</nav>
    <form className="lawyer-search-row"><input type="hidden" name="status" value={status} /><input name="q" type="search" placeholder="Поиск по названию задачи…" aria-label="Поиск задач" defaultValue={q} /><button>Найти</button></form>
    <div className="lawyer-table-wrap"><table className="lawyer-table"><thead><tr><th>Задача</th><th>Дело</th><th>Срок · Алматы</th><th>Статус</th><th>Действие</th></tr></thead><tbody>{tasks?.map(task => <tr key={task.id}><td><strong>{task.title}</strong></td><td>№ {numbers.get(task.case_id)}</td><td>{task.due_at ? worklistDate(task.due_at) : "Без срока"}</td><td><span className={`lawyer-status ${task.status === "completed" ? "green" : ""}`}>{({ new: "Открыта", response_sent: "На проверке", completed: "Выполнена", cancelled: "Отменена" } as Record<string, string>)[task.status]}</span></td><td><Link href={`/staff/cases/${task.case_id}/tasks#task-${task.id}`}>Открыть</Link></td></tr>)}</tbody></table>{!tasks?.length && <div className="lawyer-empty"><NavIcon name="tasks" size={30} /><h3>Задач не найдено</h3><p>Измените фильтр или добавьте задачу в дело.</p></div>}</div>
    <nav className="staff-pagination" aria-label="Страницы задач">{page > 1 && <Link href={href(status, page - 1)}>Назад</Link>}<span>{count ?? 0} задач</span>{(count ?? 0) > page * 25 && <Link href={href(status, page + 1)}>Далее</Link>}</nav>
    <section id="create" className="staff-list-section"><div className="staff-section-heading"><h2>Создать задачу</h2></div><p className="staff-panel-copy">Выберите дело. Задача будет видна его клиенту.</p>{worklist.items.length ? <div className="lawyer-case-picker">{worklist.items.filter(item => !item.is_suspended).map(item => <Link key={item.case_id} href={`/staff/cases/${item.case_id}/tasks`}><NavIcon name="cases" />№ {item.case_number} · {item.client_name}<NavIcon name="chevron" size={16} /></Link>)}<Link href="/staff/cases?status=open">Найти другое дело</Link></div> : <div className="staff-empty-box"><p>Нет активных назначенных дел. После назначения вы сможете добавлять задачи.</p></div>}</section>
  </>;
}
