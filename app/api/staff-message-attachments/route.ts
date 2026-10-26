import { checkDocumentFile, storageAdmin } from "../../../lib/document-files";
import { staffMessageFileId } from "../../../lib/staff-message-upload";
import { createClient } from "../../../lib/supabase/server";
import { readBoundedFormData, UploadInputError } from "../../../lib/upload-request";
import { uuidPattern } from "../../../lib/uuid";
import { staffWorkspaceEnabled } from "../../../lib/application-scope";

export const runtime = "nodejs";

const maxFiles = 5;
const maxTotalBytes = 40 * 1024 * 1024;
const bucketName = "modernsecure-files";

function failure(error: string, status: number) {
  return Response.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  if (!staffWorkspaceEnabled) return new Response("Not found", { status: 404 });
  if (!process.env.APP_ORIGIN || request.headers.get("origin") !== process.env.APP_ORIGIN) {
    return failure("Недопустимый адрес страницы. Откройте основной адрес сайта.", 403);
  }
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return failure("Сессия закончилась. Войдите снова.", 401);
  const admin = storageAdmin();
  if (!admin) return failure("Хранилище файлов сейчас недоступно.", 503);

  let form: FormData;
  try { form = await readBoundedFormData(request, maxTotalBytes + 2 * 1024 * 1024); }
  catch (error) {
    return failure("Не удалось прочитать файлы. Проверьте размер и повторите попытку.",
      error instanceof UploadInputError ? error.status : 400);
  }
  const rawThreadId = form.get("threadId");
  const rawKey = form.get("key");
  const rawBody = form.get("body");
  const rawCaseId = form.get("caseId");
  if (typeof rawThreadId !== "string" || !uuidPattern.test(rawThreadId)
    || typeof rawKey !== "string" || !uuidPattern.test(rawKey)
    || typeof rawBody !== "string"
    || (rawCaseId !== null && (typeof rawCaseId !== "string" || !uuidPattern.test(rawCaseId))))
    return failure("Не удалось подготовить сообщение.", 400);
  const threadId = rawThreadId.toLowerCase();
  const key = rawKey.toLowerCase();
  const caseId = typeof rawCaseId === "string" ? rawCaseId.toLowerCase() : null;
  const files = form.getAll("files").filter((file) => !(file instanceof File && !file.name && file.size === 0));
  if (files.length < 1 || files.length > maxFiles || files.some((file) => !(file instanceof File))) {
    return failure("Можно приложить от 1 до 5 PDF или изображений.", 400);
  }
  const body = rawBody.trim() || "Вложение";
  if (body.length > 4000) return failure("Сообщение слишком длинное.", 400);

  async function activeThread() {
    const { data, error } = await supabase.rpc("staff_chat_sidebar");
    return !error && (data ?? []).some((row: { thread_id: string | null; active: boolean }) =>
      row.thread_id === threadId && row.active);
  }
  if (!await activeThread()) return failure("Диалог недоступен. Обновите страницу.", 404);
  if (caseId) {
    const permission = await supabase.rpc("staff_can_reference_case", {
      p_thread_id: threadId, p_case_id: caseId,
    });
    if (permission.error || !permission.data) return failure("Доступ к делу изменился. Обновите страницу.", 403);
  }

  let checked;
  try { checked = await Promise.all((files as File[]).map(checkDocumentFile)); }
  catch { return failure("Подойдут PDF, JPG, PNG, HEIC и HEIF до 20 МБ на файл.", 400); }
  if (checked.reduce((sum, file) => sum + file.size, 0) > maxTotalBytes) {
    return failure("Общий размер вложений не должен превышать 40 МБ.", 413);
  }
  const metadata = checked.map((file, index) => {
    const id = staffMessageFileId(threadId, userId, key, index);
    return { id, path: `staff-messages/${threadId}/${userId}/${key}/${id}`,
      name: file.name, mime: file.mime, size: file.size, sha256: file.sha256 };
  });
  const bucket = admin.storage.from(bucketName);
  for (const [index, file] of checked.entries()) {
    if (!await activeThread()) return failure("Доступ к диалогу изменился. Обновите страницу.", 404);
    const target = metadata[index];
    try {
      // A conflict is expected after an ambiguous successful first attempt.
      // Verify the existing bytes instead of creating another object.
      await bucket.upload(target.path, file.bytes, {
        contentType: file.mime, upsert: false, cacheControl: "0",
      });
    } catch { /* Download below determines whether the object is usable. */ }
    let stored: Blob | null = null;
    try {
      const result = await bucket.download(target.path);
      if (!result.error) stored = result.data;
    } catch { /* A failed read is not a successful upload. */ }
    let verified = false;
    if (stored) {
      try {
        const copy = await checkDocumentFile(new File([stored], file.name));
        verified = copy.sha256 === file.sha256 && copy.size === file.size && copy.mime === file.mime;
      } catch { /* Damaged objects are never registered as attachments. */ }
    }
    if (!verified) return failure("Не удалось проверить сохранённый файл. Повторите отправку.", 503);
  }
  const dataResult = caseId
    ? await supabase.rpc("staff_send_case_message_with_attachments", {
      p_thread_id: threadId, p_body: body, p_idempotency_key: key, p_files: metadata, p_case_id: caseId,
    })
    : await supabase.rpc("staff_send_message_with_attachments", {
      p_thread_id: threadId, p_body: body, p_idempotency_key: key, p_files: metadata,
    });
  const { data, error } = dataResult;
  if (error || !data) {
    return failure(error?.message === "Message rate limit exceeded"
      ? "Слишком много сообщений. Подождите минуту." : "Сообщение не отправлено. Повторите попытку.", 400);
  }
  return Response.json({ ok: true, id: data.id, created: data.created });
}
