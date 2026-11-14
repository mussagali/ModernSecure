import { ReferenceCaseView } from "../../../../components/ReferenceCaseView";
import { NavIcon } from "../../../../components/NavIcon";
import Link from "next/link";
import { formatKzDate, requireClientCase } from "../../../../lib/client-case";
import { clientNextActions } from "../../../../lib/client-next-actions";
import { documentRequestState } from "../../../../lib/document-request-state";
import { installmentPaidAmounts } from "../../../../lib/payment-summary";
import { formatKzt, toKztCents } from "../../../../lib/money";
import { markClientNotificationsRead } from "./actions";
import { openClientNotification } from "../../notifications/actions";

export default async function ClientCaseOverview({ params, summary = false }: { params: Promise<{ id: string }>; summary?: boolean }) {
  const { id } = await params;
  const { supabase, userId, item } = await requireClientCase(id);
  const [stagesResult, eventsResult, suspensionsResult, tasksResult, docsResult, unreadResult, assignmentsResult, scheduleResult, paymentsResult, contractsResult, noticesResult, versionResult, allocationsResult] = await Promise.all([
    supabase.from("stage_templates").select("id, position, title, client_description").eq("version_id", item.service_version_id).order("position"),
    supabase.from("case_stage_events").select("id, to_stage_id, client_note, occurred_at").eq("case_id", id).order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(summary ? 1 : 10),
    supabase.from("case_suspensions").select("id, reason_for_client, control_at, started_at, ended_at").eq("case_id", id).order("started_at", { ascending: false }).limit(20),
    supabase.from("tasks").select("id, title, kind, document_request_id, status, due_at").eq("case_id", id).in("status", ["new", "response_sent"]).order("due_at", { ascending: true, nullsFirst: false }).limit(100),
    supabase.from("document_requests").select("id, title, status, due_at, required").eq("case_id", id).eq("status", "active"),
    supabase.rpc("case_unread_message_count", { p_case_id: id }),
    supabase.from("case_assignments").select("staff_user_id").eq("case_id", id).is("revoked_at", null),
    supabase.from("payment_schedule").select("id, contract_id, due_on, amount_kzt, cancelled_at").eq("case_id", id).order("due_on"),
    supabase.from("payments").select("id, status").eq("case_id", id).eq("status", "confirmed"),
    supabase.from("contracts").select("id, contract_number, version_no").eq("case_id", id),
    supabase.from("notifications").select("id, title, target_path, created_at").eq("case_id", id).eq("recipient_user_id", userId).is("read_at", null).order("created_at", { ascending: false }).limit(5),
    supabase.from("service_template_versions").select("service_id").eq("id", item.service_version_id).maybeSingle(),
    supabase.from("payment_allocations").select("payment_id, schedule_id, amount_kzt").eq("case_id", id),
  ]);
  if ([stagesResult, eventsResult, suspensionsResult, tasksResult, docsResult, unreadResult, assignmentsResult, scheduleResult, paymentsResult, contractsResult, noticesResult, versionResult, allocationsResult].some((result) => result.error) || !versionResult.data) throw new Error("Не удалось загрузить данные дела");
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
  const paidByInstallment = installmentPaidAmounts(paymentsResult.data ?? [], allocationsResult.data ?? []);
  const isArchived = item.status !== "open";
  const nextPayment = isArchived ? undefined : (scheduleResult.data ?? []).filter((row) => !row.cancelled_at).map((row) => ({
    due_on: row.due_on,
    contract: row.contract_id ? contractsById.get(row.contract_id) : null,
    remaining: toKztCents(row.amount_kzt) - (paidByInstallment.get(row.id) ?? BigInt(0)),
  })).find((row) => row.remaining > BigInt(0));
  return <div className="case-overview">
    <ReferenceCaseView caseId={id} caseNumber={item.case_number} caseTitle={item.title} serviceName={service.name} updatedAt={formatKzDate(lastUpdateAt)} lawyers={lawyers.map(person => person.display_name)} currentStage={currentStage} stages={stages} suspended={item.is_suspended} status={item.status} />
    {item.is_suspended && activeSuspension && <p className="sovz-feedback">Причина приостановки: {activeSuspension.reason_for_client}</p>}
    {item.next_review_at && <p className="sovz-feedback">Следующая проверка: {formatKzDate(item.next_review_at)}</p>}
    {isArchived && item.result_summary && <p className="sovz-feedback">{item.status === "cancelled" ? "Причина отмены" : "Результат"}: {item.result_summary}</p>}
    {nextActions.length > 0 && <section className="case-next-actions" aria-labelledby="case-next-actions-title"><div className="case-next-actions-heading"><h2 id="case-next-actions-title">Что нужно сделать</h2><span>{nextActions.length}</span></div><ul>{nextActions.slice(0, 5).map(action => <li key={action.href}><Link href={action.href}><span className="case-next-action-kind">{action.kind === "task" ? "Задача" : action.kind === "document" ? "Документ" : "Переписка"}</span><strong>{action.title}</strong><small>{action.detail}{action.dueAt ? ` · срок ${formatKzDate(action.dueAt)}` : ""}</small><span className="case-next-action-arrow"><NavIcon name="arrow" size={18} /></span></Link></li>)}</ul></section>}
    <details className="sovz-panel sovz-case-tools"><summary>Задачи, документы и оплаты</summary><div className="sovz-case-tools-links"><Link href={`/account/cases/${id}/tasks`}>Задачи · {tasksResult.data?.filter(task => task.status === "new").length ?? 0}</Link><Link href={`/account/cases/${id}/documents`}>Документы · {acceptedRequired}/{requiredRequests.length}</Link><Link href={`/account/cases/${id}/payments`}>{nextPayment ? `Ближайшая оплата: ${formatKzt(nextPayment.remaining)} · ${formatKzDate(nextPayment.due_on)}` : isArchived ? "Открыть договор и историю оплат" : "Нет платежей к оплате · Договор и оплаты"}</Link><Link href="/account/select-case">Все мои дела</Link></div><p className="sovz-muted">{service.name} · Обновлено {formatKzDate(lastUpdateAt)}</p></details>
    {!!noticesResult.data?.length && <section className="sovz-panel"><h2>Новые события</h2><ul className="case-simple-list">{noticesResult.data.map(notice => <li key={notice.id}><form action={openClientNotification} className="notification-open-form"><input type="hidden" name="notificationId" value={notice.id} /><button type="submit">{notice.title}</button></form><small>{formatKzDate(notice.created_at)}</small></li>)}</ul><form action={markClientNotificationsRead} className="case-quiet-form"><input type="hidden" name="caseId" value={id} /><button type="submit">Отметить события прочитанными</button></form></section>}
    <section id="case-history" className="sovz-panel"><h2>История статусов</h2>{events.length ? <><ol className="account-events">{events.map(event => <li key={event.id}><time dateTime={event.occurred_at}>{formatKzDate(event.occurred_at)}</time><strong>{stageNames.get(event.to_stage_id) ?? "Изменение этапа"}</strong><p>{event.client_note}</p></li>)}</ol><Link className="staff-text-link" href={`/account/cases/${id}/history`}>Вся история этапов</Link></> : <p className="sovz-muted">Обновлений пока нет.</p>}</section>
  </div>;
}
