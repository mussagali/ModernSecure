import Link from "next/link";
import { requireStaff } from "../../../lib/staff";
import { NavIcon } from "../../../components/NavIcon";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { supabase } = await requireStaff(["lawyer", "admin"]);
  const query = await searchParams;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(query.date ?? "") && !Number.isNaN(Date.parse(`${query.date}T00:00:00+05:00`));
  const selected = new Date(`${valid ? query.date : today}T00:00:00+05:00`);
  const weekday = new Date(selected.getTime() + 5 * 3600000).getUTCDay();
  const start = new Date(selected.getTime() - ((weekday + 6) % 7) * 86400000);
  const end = new Date(start.getTime() + 7 * 86400000);
  const result = await supabase.from("tasks").select("id, case_id, title, due_at, status", { count: "exact" }).gte("due_at", start.toISOString()).lt("due_at", end.toISOString()).in("status", ["new", "response_sent"]).order("due_at").limit(500);
  if (result.error) throw new Error("Не удалось загрузить календарь");
  const dateKey = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return <><div className="staff-page-heading"><div><h1>Календарь</h1><p>Сроки открытых задач по делам · время Алматы</p></div><Link className="lawyer-primary" href="/staff/tasks#create"><NavIcon name="plus" size={17} />Добавить задачу</Link></div>
    <div className="lawyer-calendar-toolbar"><div><Link href="/staff/calendar">Сегодня</Link><Link aria-label="Предыдущая неделя" href={`?date=${dateKey(new Date(start.getTime() - 7 * 86400000))}`}><NavIcon name="back" size={17} /></Link><Link aria-label="Следующая неделя" href={`?date=${dateKey(end)}`}><NavIcon name="arrow" size={17} /></Link></div><strong>{new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "Asia/Almaty" }).format(start)}</strong><form className="calendar-date-search" action="/staff/calendar"><label><span className="sr-only">Перейти к дате</span><input type="date" name="date" defaultValue={dateKey(selected)} /></label><button type="submit">Показать</button></form></div>
    <div className="lawyer-calendar">{Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start.getTime() + index * 86400000);
      const key = dateKey(day);
      const tasks = (result.data ?? []).filter(task => task.due_at && dateKey(new Date(task.due_at)) === key);
      return <section key={key} className={key === today ? "is-today" : ""}><header><span>{new Intl.DateTimeFormat("ru-RU", { weekday: "short", timeZone: "Asia/Almaty" }).format(day)}</span><strong>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", timeZone: "Asia/Almaty" }).format(day)}</strong></header><div>{tasks.map(task => <Link key={task.id} href={`/staff/cases/${task.case_id}/tasks#task-${task.id}`}><time>{new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" }).format(new Date(task.due_at!))}</time><strong>{task.title}</strong><small>{task.status === "response_sent" ? "На проверке" : "Открыта"}</small></Link>)}{!tasks.length && <p>Нет сроков</p>}</div></section>;
    })}</div>{(result.count ?? 0) > 500 && <p className="staff-alert">Показаны первые 500 задач за неделю. Полный список доступен в разделе «Задачи».</p>}
  </>;
}
