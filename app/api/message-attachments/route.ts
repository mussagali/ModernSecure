import { readUploadFormData } from "../../../lib/staged-uploads";
import { randomUUID } from "node:crypto";
import { checkDocumentFile, storageAdmin } from "../../../lib/document-files";
import { UploadInputError } from "../../../lib/upload-request";
import { createClient } from "../../../lib/supabase/server";
import { uuidPattern } from "../../../lib/uuid";

export const runtime = "nodejs";
export const maxDuration = 300;

const maxFiles = 5;
const maxTotalBytes = 40 * 1024 * 1024;
const bucketName = "modernsecure-files";
const errorText: Record<string, string> = {
  invalid: "Напишите сообщение или прикрепите файл.",
  files: "Можно приложить до 5 PDF или изображений: 20 МБ на файл, 40 МБ вместе.",
  upload: "Не удалось загрузить файл. Повторите отправку.",
  rate: "Слишком много сообщений. Подождите и попробуйте позже.",
  send: "Не удалось отправить сообщение. Повторите попытку.",
};

function destination(caseId: string, view: string, result: string) {
  const base = view === "staff" ? "staff" : "account";
  const path = base === "staff" ? `/staff/cases/${caseId}/messages` : `/account/cases/${caseId}/messages`;
  return new URL(`${path}?${result}`, process.env.APP_ORIGIN!);
}

export async function POST(request: Request) {
  const wantsJson = request.headers.get("accept")?.includes("application/json") ?? false;
  function failure(message: string, status: number) {
    return wantsJson ? Response.json({ ok: false, error: message }, { status }) : new Response(message, { status });
  }
  function result(caseId: string, view: string, code: string, status = 400) {
    if (wantsJson) return Response.json(code === "sent=1" ? { ok: true } : { ok: false, error: errorText[code.replace("error=", "")] ?? errorText.send }, { status: code === "sent=1" ? 200 : status });
    return Response.redirect(destination(caseId, view, code), 303);
  }
  if (!process.env.APP_ORIGIN || request.headers.get("origin") !== process.env.APP_ORIGIN) {
    return failure("Недопустимый адрес страницы. Откройте сайт через основной адрес.", 403);
  }
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return wantsJson ? failure("Сессия закончилась. Войдите снова.", 401) : Response.redirect(new URL("/login", process.env.APP_ORIGIN), 303);
  const admin = storageAdmin();
  if (!admin) return failure("Хранилище файлов сейчас недоступно.", 503);
  const storage = admin;

  let form: FormData;
  try { form = await readUploadFormData(request, maxTotalBytes + 2 * 1024 * 1024, userId, admin); }
  catch (error) { return failure("Не удалось прочитать файлы. Проверьте их размер и повторите попытку.", error instanceof UploadInputError ? error.status : 400); }
  const rawCaseId = form.get("caseId");
  const rawKey = form.get("key");
  const rawBody = form.get("body");
  const view = form.get("view") === "staff" ? "staff" : "client";
  if (typeof rawCaseId !== "string" || !uuidPattern.test(rawCaseId)
    || typeof rawKey !== "string" || !uuidPattern.test(rawKey)
    || typeof rawBody !== "string") return failure("Не удалось подготовить сообщение.", 400);
  const caseId = rawCaseId.toLowerCase();
  const key = rawKey.toLowerCase();
  // Browsers send an empty File part when the optional picker is left blank.
  const files = form.getAll("files").filter((file) => !(file instanceof File && !file.name && file.size === 0));
  // An attachment can be sent without a caption; the existing message RPC stores a clear file label.
  const body = rawBody.trim() || (files.length > 0 ? "Вложение" : "");
  if (!body || body.length > 4000) return result(caseId, view, "error=invalid");
  if (files.length > maxFiles || files.some((file) => !(file instanceof File))) {
    return result(caseId, view, "error=files");
  }
  // Case RLS checks both client ownership and current staff assignment.
  const { data: visibleCase, error: caseError } = await supabase.from("cases")
    .select("id").eq("id", caseId).maybeSingle();
  if (caseError || !visibleCase) return failure("Дело недоступно. Обновите страницу.", 404);

  let checked;
  try { checked = await Promise.all((files as File[]).map(checkDocumentFile)); }
  catch { return result(caseId, view, "error=files"); }
  if (checked.reduce((sum, file) => sum + file.size, 0) > maxTotalBytes) {
    return result(caseId, view, "error=files");
  }

  const attempt = randomUUID();
  const metadata = checked.map((file) => {
    const id = randomUUID();
    return { id, path: `messages/${caseId}/${userId}/${attempt}/${id}`,
      name: file.name, mime: file.mime, size: file.size, sha256: file.sha256 };
  });
  const bucket = storage.storage.from(bucketName);

  for (const [index, file] of checked.entries()) {
    const { data: stillVisible, error: accessError } = await supabase.from("cases")
      .select("id").eq("id", caseId).maybeSingle();
    if (accessError || !stillVisible) {
      return failure("Доступ к делу изменился. Обновите страницу.", 404);
    }
    const target = metadata[index];
    const { error: uploadError } = await bucket.upload(target.path, file.bytes, {
      contentType: file.mime, upsert: false, cacheControl: "0",
    });
    if (uploadError) {
      return result(caseId, view, "error=upload", 503);
    }
    const { data: stored, error: readError } = await bucket.download(target.path);
    let verified = false;
    if (!readError && stored) {
      try {
        const copy = await checkDocumentFile(new File([stored], file.name));
        verified = copy.sha256 === file.sha256 && copy.size === file.size && copy.mime === file.mime;
      } catch { /* A damaged object is never registered. */ }
    }
    if (!verified) {
      return result(caseId, view, "error=upload", 503);
    }
  }

  const { data, error } = await supabase.rpc("post_case_message_with_attachments", {
    p_case_id: caseId, p_body: body, p_idempotency_key: key, p_files: metadata,
  });
  if (error || !data || data.created !== true) {
    // A timed-out RPC may still commit. Only the aged orphan sweeper, which
    // shares the insert guard's path lock, may remove unreferenced objects.
    return result(caseId, view, error?.message === "Message rate limit exceeded" ? "error=rate" :
      data?.created === false ? "sent=1" : "error=send");
  }
  return result(caseId, view, "sent=1");
}
