import { NavIcon } from "../../../../components/NavIcon";
import type { Metadata } from "next";
import Link from "next/link";
import { formatKzDate, requireClientCase } from "../../../../lib/client-case";
import { clientNextActions } from "../../../../lib/client-next-actions";
import { documentRequestState } from "../../../../lib/document-request-state";
import { formatKzt, toKztCents } from "../../../../lib/money";
import { markClientNotificationsRead } from "./actions";
import { openClientNotification } from "../../notifications/actions";

export const metadata: Metadata = { title: "Дело — Современная защита" };

export default async function ClientCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, userId, item } = await requireClientCase(id);
  const [stagesResult, eventsResult, suspensionsResult, tasksResult, docsResult, unreadResult, assignmentsResult, scheduleResult, paymentsResult, contractsResult, noticesResult, versionResult] = await Promise.all([
    supabase.from("stage_templates").select("id, position, title, client_description").eq("version_id", item.service_version_id).order("position"),
    supabase.from("case_stage_events").select("id, to_stage_id, client_note, occurred_at").eq("case_id", id).order("occurred_at", { ascending: false }).limit(10),
    supabase.from("case_suspensions").select("id, reason_for_client, control_at, started_at, ended_at").eq("case_id", id).order("started_at", { ascending: false }).limit(20),
    supabase.from("tasks").select("id, title, kind, document_request_id, status, due_at").eq("case_id", id).in("status", ["new", "response_sent"]).order("due_at", { ascending: true, nullsFirst: false }).limit(100),
    supabase.from("document_requests").select("id, title, status, due_at, required").eq("case_id", id).eq("status", "active"),
    supabase.rpc("case_unread_message_count", { p_case_id: id }),
    supabase.from("case_assignments").select("staff_user_id").eq("case_id", id).is("revoked_at", null),
    supabase.from("payment_schedule").select("id, contract_id, due_on, amount_kzt").eq("case_id", id).order("due_on"),
    supabase.from("payments").select("schedule_id, amount_kzt").eq("case_id", id).eq("status", "confirmed"),
    supabase.from("contracts").select("id, contract_number, version_no").eq("case_id", id),
    supabase.from("notifications").select("id, title, target_path, created_at").eq("case_id", id).eq("recipient_user_id", userId).is("read_at", null).order("created_at", { ascending: false }).limit(5),
    supabase.from("service_template_versions").select("service_id").eq("id", item.service_version_id).maybeSingle(),
  ]);
  if ([stagesResult, eventsResult, suspensionsResult, tasksResult, docsResult, unreadResult, assignmentsResult, scheduleResult, paymentsResult, contractsResult, noticesResult, versionResult].some((result) => result.error) || !versionResult.data) throw new Error("Не удалось загрузить данные дела");
  const stages = stagesResult.data ?? [];
  const events = eventsResult.data ?? [];
  const currentStage = stages.find((stage) => stage.id === item.current_stage_id);
  const stageNames = new Map(stages.map((stage) => [stage.id, stage.title]));
  const activeSuspension = suspensionsResult.data?.find((entry) => !entry.ended_at);
  const unreadMessages = Number(unreadResult.data ?? 0);
  const requestIds = (docsResult.data ?? []).map((request) => request.id);
  const filesResult = requestIds.length
    ? await supabase.from("document_files").select("request_id, version_no, status")
      .in("request_id", requestIds).neq("status", "quarantine")
    : { data: [], error: null };
  if (filesResult.error) throw new Error("Не удалось загрузить состояние документов");
  const requiredRequests = (docsResult.data ?? []).filter((request) => request.required);
  const acceptedRequired = requiredRequests.filter((request) =>
    documentRequestState((filesResult.data ?? []).filter((file) => file.request_id === request.id)) === "accepted").length;
  const nextActions = clientNextActions({
    caseId: id, caseActive: item.status === "open" && !item.is_suspended,
    tasks: tasksResult.data ?? [], requests: docsResult.data ?? [], files: filesResult.data ?? [],
    unreadMessages,
  });
  const staffIds = (assignmentsResult.data ?? []).map((assignment) => assignment.staff_user_id);
  const { data: staff, error: staffError } = staffIds.length
    ? await supabase.from("staff_members").select("user_id, display_name, role").in("user_id", staffIds)
    : { data: [], error: null };
  if (staffError) throw new Error("Не удалось загрузить ответственного сотрудника");
  const { data: service, error: serviceError } = await supabase.from("service_templates")
    .select("name").eq("id", versionResult.data.service_id).maybeSingle();
  if (serviceError || !service) throw new Error("Не удалось загрузить услугу дела");
  const lawyers = (staff ?? []).filter((person) => person.role === "lawyer");
  const lastUpdateAt = events[0]?.occurred_at ?? item.updated_at;
  const contractsById = new Map((contractsResult.data ?? []).map((contract) => [contract.id, contract]));
  const nextPayment = (scheduleResult.data ?? []).map((row) => ({
    due_on: row.due_on,
    contract: row.contract_id ? contractsById.get(row.contract_id) : null,
    remaining: toKztCents(row.amount_kzt) - (paymentsResult.data ?? [])
      .filter((payment) => payment.schedule_id === row.id)
      .reduce((sum, payment) => sum + toKztCents(payment.amount_kzt), BigInt(0)),
  })).find((row) => row.remaining > BigInt(0));
  return <div className="case-overview">

    <section className="account-detail-card"><h2>{currentStage?.title ?? "Этап ещё не назначен"}</h2><p>{currentStage?.client_description ?? "Информация о ходе дела появится после обновления сотрудником."}</p>{item.is_suspended && activeSuspension && <p className="account-detail-note">Причина приостановки: {activeSuspension.reason_for_client}</p>}{item.next_review_at && <p className="account-detail-note">Следующая проверка: {formatKzDate(item.next_review_at)}</p>}{item.status === "closed" && item.result_summary && <p className="account-detail-note">Результат: {item.result_summary}</p>}
      <div className="account-case-facts"><div><span>УСЛУГА</span><strong>{service.name}</strong></div><div><span>ОТВЕТСТВЕННЫЙ ЮРИСТ</span><strong>{lawyers.length ? lawyers.map((person) => person.display_name).join(", ") : "Юрист пока не назначен"}</strong></div><div><span>ПОСЛЕДНЕЕ ОБНОВЛЕНИЕ ДЕЛА</span><strong>{formatKzDate(lastUpdateAt)}</strong></div></div>
    </section>
    <div className="case-overview-grid">
      <Link href={`/account/cases/${id}/tasks`}><span>Задачи</span><strong>{tasksResult.data?.filter((task) => task.status === "new").length ?? 0}</strong><small>Ожидают вашего ответа</small></Link>
      <Link href={`/account/cases/${id}/documents`}><span>Документы</span><strong>{requiredRequests.length ? `${acceptedRequired}/${requiredRequests.length}` : "—"}</strong><small>{requiredRequests.length ? "Обязательных документов принято" : "Нет обязательных запросов"}</small></Link>
      <Link href={`/account/cases/${id}/messages`}><span>Сообщения</span><strong>{unreadMessages}</strong><small>Непрочитанные</small></Link>
      <Link href={`/account/cases/${id}/payments`}><span>Ближайшая оплата</span><strong>{nextPayment ? formatKzt(nextPayment.remaining) : "—"}</strong><small>{nextPayment ? `${formatKzDate(nextPayment.due_on)}${nextPayment.contract ? ` · договор № ${nextPayment.contract.contract_number}, версия ${nextPayment.contract.version_no}` : " · версия договора не указана"}` : "Нет платежей к оплате"}</small></Link>
    </div>
    <section className="case-next-actions" aria-labelledby="case-next-actions-title"><div className="case-next-actions-heading"><div><h2 id="case-next-actions-title">Что нужно сделать</h2></div>{nextActions.length > 0 && <span>{nextActions.length}</span>}</div>
      {nextActions.length ? <ul>{nextActions.slice(0, 5).map((action) => <li key={action.href}><Link href={action.href}><span className="case-next-action-kind">{action.kind === "task" ? "Задача" : action.kind === "document" ? "Документ" : "Переписка"}</span><strong>{action.title}</strong><small>{action.detail}{action.dueAt ? ` · срок ${formatKzDate(action.dueAt)}` : ""}</small><span className="case-next-action-arrow"><NavIcon name="arrow" size={18} /></span></Link></li>)}</ul>
        : <p>{item.is_suspended ? "Дело приостановлено. Новых действий пока нет." : "Сейчас от вас ничего не требуется."}</p>}
      {nextActions.length > 5 && <p className="case-next-actions-more">Ещё {nextActions.length - 5} действий — откройте разделы дела ниже.</p>}
    </section>
    <section className="account-detail-section case-contact-card"><div><h2>Есть вопрос по делу?</h2><p>{staff?.length ? staff.map((person) => `${person.display_name} (${person.role === "lawyer" ? "юрист" : person.role === "manager" ? "менеджер" : "администратор"})`).join(", ") : "Сотрудник ответит в переписке по делу"}</p></div><Link className="primary-action" href={`/account/cases/${id}/messages`}>Написать сотруднику</Link></section>
    {!!noticesResult.data?.length && <section className="account-detail-section"><h2>Новые события</h2><ul className="case-simple-list">{noticesResult.data.map((notice) => <li key={notice.id}><form action={openClientNotification} className="notification-open-form"><input type="hidden" name="notificationId" value={notice.id} /><button type="submit">{notice.title}</button></form><small>{formatKzDate(notice.created_at)}</small></li>)}</ul><form action={markClientNotificationsRead} className="case-quiet-form"><input type="hidden" name="caseId" value={id} /><button type="submit">Отметить события прочитанными</button></form></section>}
    {!!stages.length && <section className="account-detail-section"><h2>Этапы дела</h2><ol className="account-stages">{stages.map((stage) => <li key={stage.id} className={stage.id === currentStage?.id ? "is-current" : stage.position < (currentStage?.position ?? 0) ? "is-complete" : ""}><span className="account-stage-index">{stage.position}</span><div><strong>{stage.title}</strong>{stage.client_description && <p>{stage.client_description}</p>}</div></li>)}</ol></section>}
    {!!suspensionsResult.data?.length && <section className="account-detail-section"><h2>Приостановки дела</h2><ol className="account-events">{suspensionsResult.data.map((entry) => <li key={entry.id}><time dateTime={entry.started_at}>{formatKzDate(entry.started_at)}</time><strong>{entry.ended_at ? "Работа возобновлена" : "Дело приостановлено"}</strong><p>{entry.reason_for_client}</p>{entry.control_at && <small>Контрольная дата: {formatKzDate(entry.control_at)}</small>}</li>)}</ol></section>}
    <section className="account-detail-section"><h2>История обновлений</h2>{events.length ? <ol className="account-events">{events.map((event) => <li key={event.id}><time dateTime={event.occurred_at}>{formatKzDate(event.occurred_at)}</time><strong>{stageNames.get(event.to_stage_id) ?? "Изменение этапа"}</strong><p>{event.client_note}</p></li>)}</ol> : <p className="account-muted">Обновлений пока нет.</p>}</section>
  </div>;
}
