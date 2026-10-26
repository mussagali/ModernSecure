import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "../../../../lib/staff";
import { uuidPattern } from "../../../../lib/client-case";
import { worklistDate } from "../../../../lib/staff-worklist";
import { canPreviewFile } from "../../../../lib/file-preview";
import { DocumentPreview } from "../../../../components/DocumentPreview";
import { reviewDocumentFile } from "../../actions";

export default async function ReviewFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidPattern.test(id)) notFound();
  const { supabase } = await requireStaff(["lawyer", "admin"]);
  const { data: file, error } = await supabase.from("document_files").select("id, request_id, original_name, detected_mime_type, status, uploaded_at, return_reason").eq("id", id).maybeSingle();
  if (error) throw new Error("Не удалось загрузить документ");
  if (!file || !["under_review", "accepted", "returned"].includes(file.status)) notFound();
  const { data: request, error: requestError } = await supabase.from("document_requests").select("id, title, case_id, status, instructions").eq("id", file.request_id).maybeSingle();
  if (requestError) throw new Error("Не удалось загрузить запрос");
  if (!request) notFound();
  const { data: item, error: caseError } = await supabase.from("cases").select("id, case_number, client_id, status, is_suspended").eq("id", request.case_id).maybeSingle();
  if (caseError) throw new Error("Не удалось загрузить дело");
  if (!item) notFound();
  const { data: client, error: clientError } = await supabase.from("clients").select("full_name").eq("id", item.client_id).maybeSingle();
  if (clientError) throw new Error("Не удалось загрузить клиента");
  const canReview = file.status === "under_review" && request.status === "active" && item.status === "open" && !item.is_suspended;
  return <><Link className="staff-back" href="/staff/review">Документы</Link><div className="staff-page-heading"><div><h1>{request.title}</h1><p><Link href={`/staff/cases/${item.id}`}>№ {item.case_number}</Link> · {client?.full_name}</p></div><a className="lawyer-primary" href={`/api/document-files/${id}`}>Скачать</a></div>
    <div className="lawyer-document-layout"><div className="lawyer-preview">{canPreviewFile(file.detected_mime_type) ? <DocumentPreview key={id} fileId={id} /> : <div className="lawyer-empty"><p>Предпросмотр этого формата не поддерживается. Скачайте документ для просмотра.</p></div>}</div><aside className="staff-panel"><h2>Информация</h2><dl className="lawyer-file-info"><dt>Название файла</dt><dd>{file.original_name}</dd><dt>Загружен</dt><dd>{worklistDate(file.uploaded_at)}</dd><dt>Клиент</dt><dd>{client?.full_name}</dd><dt>Статус</dt><dd>{file.status === "accepted" ? "Принят" : file.status === "returned" ? "Возвращён" : "На проверке"}</dd></dl>{request.instructions && <p className="staff-panel-copy">{request.instructions}</p>}{file.return_reason && <p className="staff-alert">{file.return_reason}</p>}
      {canReview && <form action={reviewDocumentFile} className="staff-form"><h2>Решение</h2><input type="hidden" name="caseId" value={item.id} /><input type="hidden" name="fileId" value={id} /><label>Причина возврата<textarea name="reason" maxLength={1000} rows={4} placeholder="Обязательно при возврате документа" /></label><small>Причину увидит клиент.</small><button type="submit" name="decision" value="accept">Принять документ</button><button type="submit" name="decision" value="return">Запросить исправления</button></form>}
    </aside></div></>;
}
