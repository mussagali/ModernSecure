import { DocumentUploadForm } from "../../../../../components/DocumentUploadForm";
import { formatKzDate, requireClientCase } from "../../../../../lib/client-case";
import { canPreviewFile } from "../../../../../lib/file-preview";
import { documentRequestLabels, documentRequestState, latestDocumentVersion } from "../../../../../lib/document-request-state";
import { retractDocumentFile } from "./actions";

const fileStatus: Record<string, string> = {
  quarantine: "Загрузка не завершена", under_review: "На проверке", accepted: "Принят",
  returned: "Возвращён", retracted: "Отозван",
};

export default async function ClientDocuments({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ uploaded?: string; uploadError?: string; retracted?: string; error?: string }> }) {
  const { id } = await params;
  const { supabase, item } = await requireClientCase(id);
  const { data: requests, error } = await supabase.from("document_requests").select("id, title, instructions, required, due_at, status, created_at").eq("case_id", id).order("created_at", { ascending: false });
  if (error) throw new Error("Не удалось загрузить документы");
  const requestIds = (requests ?? []).map((request) => request.id);
  const { data: files, error: fileError } = requestIds.length ? await supabase.from("document_files").select("id, request_id, version_no, file_position, original_name, detected_mime_type, status, return_reason, uploaded_at").in("request_id", requestIds).neq("status", "quarantine").order("version_no", { ascending: false }).order("file_position") : { data: [], error: null };
  if (fileError) throw new Error("Не удалось загрузить файлы");
  const query = await searchParams;
  const uploadsReady = Boolean(process.env.SUPABASE_SECRET_KEY);
  return <section className="account-detail-section case-workspace"><h2>Документы по делу</h2><p className="account-muted">Запросы сотрудника и история файлов по этому делу.</p>
    {query.uploaded && <p className="case-feedback">Файлы получены и переданы сотруднику на рассмотрение. Это ещё не означает, что документ принят.</p>}
    {query.retracted && <p className="case-feedback">Файл отозван. Его можно отправить заново.</p>}
    {query.uploadError && <p className="case-feedback is-error">Не удалось отправить файл. Проверьте PDF/JPG/PNG/HEIC/HEIF, размер до 20 МБ на файл и повторите попытку. Если ошибка сохраняется, обратитесь к сотруднику.</p>}
    {query.error && <p className="case-feedback is-error">Не удалось отозвать файл. Возможно, он уже рассмотрен.</p>}
    {requests?.length ? <div className="case-card-list">{requests.map((request) => {
      const requestFiles = (files ?? []).filter((file) => file.request_id === request.id);
      const state = documentRequestState(requestFiles);
      const currentVersion = latestDocumentVersion(requestFiles);
      const canSubmit = uploadsReady && request.status === "active" && item.status === "open"
        && !item.is_suspended && ["missing", "returned", "incomplete"].includes(state);
      return <article className="case-work-card" id={`request-${request.id}`} key={request.id}>
        <div className="case-work-head"><h3>{request.title}</h3><span>{request.status === "active" ? documentRequestLabels[state] : request.status === "not_required" ? "Не требуется" : "Отменён"}</span></div>
        <p>{request.required ? "Обязательный документ" : "Дополнительный документ"}{currentVersion ? ` · текущая версия ${currentVersion}` : ""}</p>
        {request.instructions && <p>{request.instructions}</p>}{request.due_at && <small>Срок: {formatKzDate(request.due_at)}</small>}
        {state === "under_review" && request.status === "active" && <p className="account-muted">Файлы уже получены. Дождитесь решения юриста; если отправили не то, отзовите файлы текущей версии до проверки.</p>}
        {state === "returned" && request.status === "active" && <p className="account-muted">Исправьте замечания ниже и отправьте полный набор файлов новой версией.</p>}
        {state === "accepted" && request.status === "active" && <p className="account-muted">Все файлы текущей версии приняты. Повторная отправка не требуется.</p>}
        {requestFiles.map((file) => <div className="case-file-row" id={`file-${file.id}`} key={file.id}><strong>{file.original_name}</strong><span>Версия {file.version_no} · {fileStatus[file.status] ?? file.status}</span>{file.return_reason && <p>Комментарий: {file.return_reason}</p>}{["under_review", "accepted", "returned"].includes(file.status) && <><a className="case-file-download" href={`/api/document-files/${file.id}`}>Скачать файл</a>{canPreviewFile(file.detected_mime_type) && <> · <a className="case-file-download" href={`/api/document-files/${file.id}?preview=1`} target="_blank" rel="noopener noreferrer">Просмотреть</a></>}</>}{file.status === "under_review" && file.version_no === currentVersion && request.status === "active" && item.status === "open" && !item.is_suspended && <form action={retractDocumentFile} className="case-retract-form"><input type="hidden" name="caseId" value={id} /><input type="hidden" name="fileId" value={file.id} /><button type="submit">Отозвать до рассмотрения</button></form>}</div>)}
        {canSubmit && <DocumentUploadForm caseId={id} requestId={request.id} view="client" />}
      </article>;
    })}</div> : <p className="account-muted">Запросов документов пока нет.</p>}
    {!uploadsReady && <p className="case-safety-note">Загрузка файлов пока не включена: серверное хранилище ещё не настроено. Сейчас система не принимает файлы.</p>}
    {uploadsReady && <p className="case-safety-note">Файлы хранятся в закрытом хранилище. Автоматическая антивирусная проверка не подключена; не открывайте подозрительные файлы.</p>}
  </section>;
}
