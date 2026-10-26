import Link from "next/link";
import { NavIcon, type NavIconName } from "./NavIcon";
import { requireStaff } from "../lib/staff";
import { getStaffWorklist, worklistCount, worklistDate } from "../lib/staff-worklist";

export async function LawyerDashboard() {
  const { supabase } = await requireStaff(["lawyer", "admin"]);
  const [cases, unread, documents, tasks, taskCount] = await Promise.all([
    getStaffWorklist(supabase, { status: "open" }),
    supabase.rpc("staff_unread_case_count"),
    supabase.from("document_files").select("id", { count: "exact", head: true }).eq("status", "under_review"),
    supabase.from("tasks").select("id, case_id, title, status, due_at").in("status", ["new", "response_sent"]).order("due_at", { nullsFirst: false }).limit(5),
    supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["new", "response_sent"]),
  ]);
  if ([cases, unread, documents, tasks, taskCount].some(result => result.error)) throw new Error("Не удалось загрузить рабочий обзор");
  const ids = [...new Set((tasks.data ?? []).map(task => task.case_id))];
  const taskCases = ids.length ? await supabase.from("cases").select("id, case_number").in("id", ids) : { data: [], error: null };
  if (taskCases.error) throw new Error("Не удалось загрузить дела задач");
  const numbers = new Map((taskCases.data ?? []).map(item => [item.id, item.case_number]));
  const metrics: { label: string; count: number; detail: string; href: string; icon: NavIconName; tone: string }[] = [
    { label: "Мои дела", count: worklistCount(cases.items), detail: "В активной работе", href: "/staff/cases?status=open", icon: "cases", tone: "blue" },
    { label: "Задачи", count: taskCount.count ?? 0, detail: "Ожидают выполнения или проверки", href: "/staff/tasks", icon: "tasks", tone: "red" },
    { label: "Документы", count: documents.count ?? 0, detail: "На проверке", href: "/staff/review", icon: "documents", tone: "green" },
    { label: "Сообщения", count: Number(unread.data ?? 0), detail: "Диалоги с новыми сообщениями", href: "/staff/inbox?unread=1", icon: "messages", tone: "blue" },
  ];
  return <div className="lawyer-dashboard"><div className="staff-page-heading"><div><h1>Главная</h1><p>{new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Almaty" }).format(new Date())}</p></div><Link href="/staff/tasks#create" className="lawyer-primary"><NavIcon name="plus" size={17} />Добавить задачу</Link></div>
    <div className="lawyer-metrics">{metrics.map(metric => <Link key={metric.label} href={metric.href}><span className={`lawyer-metric-icon ${metric.tone}`}><NavIcon name={metric.icon} size={23} /></span><span><span>{metric.label}</span><strong>{metric.count}</strong><small>{metric.detail}</small></span></Link>)}</div>
    <div className="lawyer-dashboard-grid"><section className="staff-panel"><div className="staff-panel-head"><h2>Ближайшие задачи</h2><Link href="/staff/tasks">Все задачи <NavIcon name="arrow" size={15} /></Link></div>
      {tasks.data?.length ? <div className="lawyer-activity">{tasks.data.map(task => <Link key={task.id} href={`/staff/cases/${task.case_id}/tasks#task-${task.id}`}><span className="lawyer-metric-icon red"><NavIcon name="tasks" /></span><span><strong>{task.title}</strong><small>Дело № {numbers.get(task.case_id)}</small></span><time>{task.due_at ? worklistDate(task.due_at) : "Без срока"}</time></Link>)}</div> : <div className="lawyer-empty"><NavIcon name="tasks" size={30} /><h3>Новых задач пока нет</h3><p>Задачи по вашим делам появятся здесь вместе со сроками.</p></div>}
    </section><section className="staff-panel"><div className="staff-panel-head"><h2>Последние обновления</h2><Link href="/staff/cases">Все дела <NavIcon name="arrow" size={15} /></Link></div>
      {cases.items.length ? <div className="lawyer-activity">{cases.items.slice(0, 5).map(item => <Link key={item.case_id} href={`/staff/cases/${item.case_id}`}><span className="lawyer-metric-icon green"><NavIcon name="cases" /></span><span><strong>{item.title}</strong><small>{item.client_name} · {item.stage_name ?? "Этап не назначен"}</small></span><time>{worklistDate(item.updated_at)}</time></Link>)}</div> : <div className="lawyer-empty"><NavIcon name="cases" size={30} /><h3>Назначений пока нет</h3><p>Когда администратор назначит вас на дело, здесь появятся его обновления.</p><Link href="/staff/chat">Написать команде</Link></div>}
    </section></div>
  </div>;
}
