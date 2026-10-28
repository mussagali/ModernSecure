import { LawyerDashboard } from "../../../components/LawyerDashboard";
import type { Metadata } from "next";
import Link from "next/link";
import { auditActionLabel, auditEntityLabel } from "../../../lib/audit-labels";
import { requireStaff } from "../../../lib/staff";
import { getStaffWorklist, worklistCount } from "../../../lib/staff-worklist";

export const metadata: Metadata = { title: "Панель управления | Современная защита" };

function casesLabel(count: number) {
  const form = new Intl.PluralRules("ru-RU").select(count);
  return `${count} ${form === "one" ? "дело" : form === "few" ? "дела" : "дел"}`;
}

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { supabase, staff } = await requireStaff();
  const query = await searchParams;
  const deniedAlert = query.error === "forbidden" ? <div className="staff-alert is-error" role="alert">У вашей роли нет доступа к запрошенному разделу. Для изменения прав обратитесь к главному администратору.</div> : null;
  if (staff.role === "lawyer") return <>{deniedAlert}<LawyerDashboard /></>;
  const [clients, cases, services, unlinked, recentCases, recentClients] = await Promise.all([
    supabase.from("clients").select("id", { count: "exact", head: true }),
    supabase.from("cases").select("id", { count: "exact", head: true }),
    supabase.from("service_templates").select("id", { count: "exact", head: true }),
    supabase.from("clients").select("id", { count: "exact", head: true }).is("user_id", null),
    supabase.from("cases").select("id, case_number, title, status, created_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("clients").select("id, full_name, user_id, created_at").order("created_at", { ascending: false }).limit(5),
  ]);
  const failed = [clients, cases, services, unlinked, recentCases, recentClients].some((result) => result.error);
  const adminData = staff.role === "admin" ? await Promise.all([
    supabase.from("staff_members").select("user_id", { count: "exact", head: true }).eq("active", true),
    supabase.from("case_assignments").select("id", { count: "exact", head: true }).is("revoked_at", null),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "response_sent"),
    supabase.from("document_files").select("id", { count: "exact", head: true }).eq("status", "under_review"),
    supabase.from("messages").select("id", { count: "exact", head: true }),
    supabase.from("audit_events").select("id, action, entity_type, case_id, occurred_at").order("occurred_at", { ascending: false }).limit(5),
  ]) : null;
  const handoffData = staff.role === "admin" ? await supabase.rpc("admin_unassigned_cases") : null;
  const unassignedItems = (handoffData?.data ?? []) as Array<{
    case_id: string; case_number: string; title: string; total_count: number;
  }>;
  const [unreadWork, reviewWork, overdueWork, staleQueue] = await Promise.all([
    getStaffWorklist(supabase, { attention: "unread" }),
    getStaffWorklist(supabase, { attention: "documents" }),
    getStaffWorklist(supabase, { attention: "overdue" }),
    supabase.rpc("staff_stale_case_page", { p_page: 1 }),
  ]);

  return <>{deniedAlert}<div className="staff-page-heading"><div><h1>{staff.role === "admin" ? "Панель администратора" : "Панель менеджера"}</h1><p>{staff.role === "admin" ? "Клиенты, команда, назначения, рабочие события и журнал изменений в одном месте." : "Клиенты, дела и услуги."}</p></div><span className="staff-role-pill">{staff.role === "admin" ? (staff.is_primary_admin ? "Главный администратор" : "Администратор") : "Менеджер"}</span></div>
    {[unreadWork, reviewWork, overdueWork, staleQueue].some((result) => result.error) ? <div className="staff-alert is-error">Не удалось загрузить рабочие очереди.</div> : <section className="staff-attention-strip" aria-label="Требует внимания"><Link href="/staff/inbox?unread=1"><span>Новые диалоги</span><strong>{worklistCount(unreadWork.items)}</strong><small>Открыть переписку</small></Link><Link href="/staff/cases?attention=documents"><span>Дела с документами на проверке</span><strong>{worklistCount(reviewWork.items)}</strong><small>Проверить файлы</small></Link><Link href="/staff/cases?attention=overdue"><span>Дела с просроченными задачами</span><strong>{worklistCount(overdueWork.items)}</strong><small>Посмотреть сроки</small></Link><Link href="/staff/cases/stale"><span>Дела без обновлений для клиента</span><strong>{Number(staleQueue.data?.[0]?.total_count ?? 0)}</strong><small>Открыть очередь</small></Link></section>}
    {failed ? <div className="staff-alert is-error" role="alert">Не удалось загрузить часть данных. Обновите страницу.</div> : <>
      <div className="staff-stats"><Link href="/staff/clients"><span>Клиенты</span><strong>{clients.count ?? 0}</strong><small>Открыть список</small></Link><Link href="/staff/cases"><span>Дела</span><strong>{cases.count ?? 0}</strong><small>Открыть список</small></Link><Link href="/staff/clients"><span>Без привязки</span><strong>{unlinked.count ?? 0}</strong><small>Подключить аккаунты</small></Link>{staff.role === "admin" && <Link href="/staff/services"><span>Услуги</span><strong>{services.count ?? 0}</strong><small>Настроить шаблоны</small></Link>}</div>
      <div className="staff-overview-grid"><section className="staff-panel"><div className="staff-panel-head"><div><h2>Дела</h2></div><Link href="/staff/cases">Все дела</Link></div>{recentCases.data?.length ? <ul className="staff-simple-list">{recentCases.data.map((item) => <li key={item.id}><Link href={`/staff/cases/${item.id}`}><span>№ {item.case_number}</span><strong>{item.title}</strong><small>{item.status === "open" ? "В работе" : item.status === "closed" ? "Завершено" : "Отменено"}</small></Link></li>)}</ul> : <p className="staff-empty-text">Дел ещё нет. Создайте услугу, клиента и первое дело.</p>}</section>
        <section className="staff-panel"><div className="staff-panel-head"><div><h2>Клиенты</h2></div><Link href="/staff/clients">Все клиенты</Link></div>{recentClients.data?.length ? <ul className="staff-simple-list">{recentClients.data.map((item) => <li key={item.id}><Link href="/staff/clients"><strong>{item.full_name}</strong><small>{item.user_id ? "Аккаунт привязан" : "Ожидает привязки"}</small></Link></li>)}</ul> : <p className="staff-empty-text">Карточек пока нет. Добавьте клиента, чтобы начать работу.</p>}</section></div>
      {adminData && (adminData.some((result) => result.error) ? <div className="staff-alert is-error">Не удалось загрузить часть системного обзора.</div> : <><section className="staff-list-section"><div className="staff-section-heading"><h2>Связи и рабочие очереди</h2><Link href="/staff/team">Команда и назначения</Link></div><div className="staff-admin-metrics"><Link href="/staff/team"><strong>{adminData[0].count ?? 0}</strong><span>активных сотрудников</span></Link><Link href="/staff/team"><strong>{adminData[1].count ?? 0}</strong><span>назначений на дела</span></Link><Link href="/staff/cases"><strong>{adminData[2].count ?? 0}</strong><span>ответов на проверке</span></Link><Link href="/staff/review"><strong>{adminData[3].count ?? 0}</strong><span>документов на проверке</span></Link><Link href="/staff/inbox"><strong>{adminData[4].count ?? 0}</strong><span>сообщений по делам · открыть диалоги</span></Link></div></section><section className="staff-list-section"><div className="staff-section-heading"><h2>Последние действия</h2><Link href="/staff/audit">Весь журнал</Link></div>{adminData[5].data?.length ? <div className="staff-admin-activity">{adminData[5].data.map((event) => <Link key={event.id} href={event.case_id ? `/staff/audit?case=${event.case_id}` : "/staff/audit"}><span>{auditActionLabel(event.action, event.entity_type)} · {auditEntityLabel(event.entity_type)}</span><small>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Almaty" }).format(new Date(event.occurred_at))}</small></Link>)}</div> : <div className="staff-empty-box"><h3>Действий пока нет</h3></div>}</section></>)}
      {handoffData && (handoffData.error ? <div className="staff-alert is-error">Не удалось загрузить дела без ответственного.</div> : unassignedItems.length > 0 && <section className="staff-list-section"><div className="staff-section-heading"><h2>Ожидают назначения</h2><span>{casesLabel(Number(unassignedItems[0].total_count))}</span></div><div className="staff-work-list">{unassignedItems.map((item) => <Link className="staff-work-card" href={`/staff/cases/${item.case_id}`} key={item.case_id}><small>№ {item.case_number}</small><h3>{item.title}</h3><p>Назначить ответственного</p></Link>)}</div></section>)}
      {(cases.count ?? 0) === 0 && <section className="staff-next-step"><div><h2>Создайте основу первого дела</h2><p>Сначала добавьте услугу с этапами, затем карточку клиента и дело. Аккаунт клиента привязывается отдельно после проверки почты.</p></div><div><Link href="/staff/clients" className="staff-primary-link">Добавить клиента</Link>{staff.role === "admin" && <Link href="/staff/services" className="staff-secondary-link">Настроить услуги</Link>}</div></section>}
    </>}
  </>;
}
