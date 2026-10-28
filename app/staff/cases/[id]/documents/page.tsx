import { formatDeadline } from "../../../../../lib/deadlines";
import { DocumentUploadForm } from "../../../../../components/DocumentUploadForm";
import { SubmitButton } from "../../../../../components/SubmitButton";
import { documentRequestLabels, documentRequestState, latestDocumentVersion } from "../../../../../lib/document-request-state";
import { requireStaffCase } from "../../../../../lib/staff-case";
import { closeDocumentRequest, createDocumentRequest, reopenTemplateDocumentRequest, reviewDocumentFile } from "../../../actions";

const fileStatus: Record<string, string> = {
  quarantine: "Загрузка не завершена", under_review: "На рассмотрении",
  accepted: "Принят", returned: "Возвращён", retracted: "Отозван",
};
const previewMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif"]);

export default async function StaffDocuments({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ restored?: string; closed?: string; created?: string; uploaded?: string; uploadError?: string; reviewed?: string; error?: string }> }) {
  const { id } = await params;
  const { supabase, staff, item } = await requireStaffCase(id);
  const { data: requests, error } = await supabase.from("document_requests").select("id, template_id, title, instructions, required, due_at, status, closure_reason, created_at").eq("case_id", id).order("created_at", { ascending: false });
  if (error) throw new Error("Не удалось загрузить запросы документов");
  const requestIds = (requests ?? []).map((request) => request.id);
  const { data: files, error: fileError } = requestIds.length ? await supabase.from("document_files").select("id, request_id, version_no, file_position, original_name, detected_mime_type, status, return_reason, uploaded_at").in("request_id", requestIds).neq("status", "quarantine").order("version_no", { ascending: false }).order("file_position") : { data: [], error: null };
  if (fileError) throw new Error("Не удалось загрузить файлы");
  const query = await searchParams;
  const uploadsReady = Boolean(process.env.SUPABASE_SECRET_KEY);
  return <><div className="staff-page-heading"><div><h2>Документы</h2></div></div>
    {query.restored && <p className="staff-alert is-success" role="status">Запрос восстановлен. Клиент может отправить документы; если документ не нужен, закройте запрос с решением «Документ больше не требуется».</p>}
    {query.closed && <p className="staff-alert is-success" role="status">Запрос закрыт. Причина сохранена и видна клиенту.</p>}
    {query.created && <div className="staff-alert is-success">Запрос создан и виден клиенту.</div>}{query.uploaded && <div className="staff-alert is-success">Файлы отправлены на рассмотрение.</div>}{query.reviewed && <div className="staff-alert is-success">Решение по документу сохранено и записано в журнал.</div>}{query.uploadError && <div className="staff-alert is-error">Не удалось загрузить файлы. Проверьте тип и размер и попробуйте снова.</div>}{query.error && <div className="staff-alert is-error">Не удалось выполнить действие с документом.</div>}
    {!uploadsReady && <div className="staff-alert is-error" role="alert">Загрузка и просмотр файлов временно недоступны. Обратитесь к администратору.</div>}
    {staff.role !== "manager" && item.status === "open" && !item.is_suspended && <details className="form-disclosure"><summary>Запросить документ</summary><div className="staff-form-panel"><div><p>Клиент увидит название, инструкцию и срок в своём деле.</p></div><form action={createDocumentRequest} className="staff-form"><input type="hidden" name="caseId" value={id} /><label>Название документа<input name="title" required maxLength={180} /></label><label>Инструкция<textarea name="instructions" maxLength={2000} rows={3} /></label><label>Срок · Алматы (UTC+5)<input name="dueAt" type="datetime-local" /></label><label className="staff-check"><input name="required" type="checkbox" defaultChecked />Обязательный документ</label><SubmitButton>Создать запрос</SubmitButton></form></div></details>}
    <section className="staff-list-section"><div className="staff-section-heading"><h2>Запросы</h2><span>{requests?.length ?? 0}</span></div>{requests?.length ? <div className="staff-work-list">{requests.map((request) => {
      const requestFiles = (files ?? []).filter((file) => file.request_id === request.id);
      const state = documentRequestState(requestFiles);
      const currentVersion = latestDocumentVersion(requestFiles);
      return <article className="staff-work-card" id={`request-${request.id}`} key={request.id}>
        <div className="staff-work-head"><h3>{request.title}</h3><span className="staff-tag">{request.status === "active" ? documentRequestLabels[state] : request.status === "not_required" ? "Не требуется" : "Отменён"}</span></div>
        <p>{request.required ? "Обязательный документ" : "Дополнительный документ"}{currentVersion ? ` · текущая версия ${currentVersion}` : ""}</p>
        {request.closure_reason && <p className="case-feedback">Причина: {request.closure_reason}</p>}
        {request.instructions && <p>{request.instructions}</p>}{request.due_at && <small>Срок: {formatDeadline(request.due_at)}</small>}
        {state === "under_review" && request.status === "active" && <p>Проверьте все файлы текущей версии: запрос считается принятым только после принятия каждого файла.</p>}
        {requestFiles.map((file) => <div className="staff-event-inline" id={`file-${file.id}`} key={file.id}><strong>{file.original_name}</strong><p>Версия {file.version_no} · {fileStatus[file.status] ?? file.status}{file.return_reason ? ` · ${file.return_reason}` : ""}</p>{["under_review", "accepted", "returned"].includes(file.status) && <><a className="staff-text-link" href={`/api/document-files/${file.id}`}>Скачать файл</a>{previewMimeTypes.has(file.detected_mime_type ?? "") && <> · <a className="staff-text-link" href={`/api/document-files/${file.id}?preview=1`} target="_blank" rel="noopener noreferrer">Просмотреть</a></>}</>}{file.status === "under_review" && staff.role !== "manager" && request.status === "active" && item.status === "open" && !item.is_suspended && <form action={reviewDocumentFile} className="staff-form staff-review-form"><input type="hidden" name="caseId" value={id} /><input type="hidden" name="fileId" value={file.id} /><label>Причина возврата<textarea name="reason" maxLength={1000} rows={2} placeholder="Заполните, если возвращаете документ" /></label><div className="staff-review-actions"><button type="submit" name="decision" value="accept">Принять</button><button type="submit" name="decision" value="return">Вернуть</button></div></form>}</div>)}
        {uploadsReady && staff.role !== "manager" && request.status === "active" && item.status === "open" && !item.is_suspended && <DocumentUploadForm caseId={id} requestId={request.id} view="staff" />}
        {staff.role !== "manager" && item.status === "open" && !item.is_suspended && request.status === "cancelled" && request.template_id && request.required && <details className="close-request"><summary>Восстановить обязательный запрос</summary><p>Отмена запроса из шаблона не отменяет обязательный документ. Восстановите запрос для загрузки или затем выберите «Документ больше не требуется» с причиной.</p><form action={reopenTemplateDocumentRequest} className="staff-form"><input type="hidden" name="caseId" value={id} /><input type="hidden" name="requestId" value={request.id} /><label>Причина для клиента<textarea name="reason" required maxLength={1000} rows={2} /></label><SubmitButton>Восстановить запрос</SubmitButton></form></details>}
        {staff.role !== "manager" && item.status === "open" && request.status === "active" && <details className="close-request"><summary>Закрыть запрос</summary><form action={closeDocumentRequest} className="staff-form"><input type="hidden" name="caseId" value={id} /><input type="hidden" name="requestId" value={request.id} /><label>Решение<select name="status"><option value="not_required">Документ больше не требуется</option><option value="cancelled">Запрос создан ошибочно | отменить</option></select></label><label>Причина для клиента<textarea name="reason" required maxLength={1000} rows={2} /></label><SubmitButton>Подтвердить закрытие запроса</SubmitButton></form></details>}
      </article>;
    })}</div> : <div className="staff-empty-box"><h3>Запросов пока нет</h3></div>}</section>
    <p className="staff-form-hint">Файлы хранятся приватно; автоматическая антивирусная проверка не подключена. Не открывайте подозрительные вложения.</p>
  </>;
}
