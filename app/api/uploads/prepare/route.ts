import { createClient } from "../../../../lib/supabase/server";
import { MAX_DOCUMENT_BYTES, storageAdmin } from "../../../../lib/document-files";
import { readBoundedJson } from "../../../../lib/upload-request";
import { stagingBucket, uploadContext } from "../../../../lib/staged-uploads";
import { uuidPattern } from "../../../../lib/uuid";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const failure = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
  if (!process.env.APP_ORIGIN || request.headers.get("origin") !== process.env.APP_ORIGIN) return failure("Недопустимый адрес страницы.", 403);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return failure("Сессия закончилась. Войдите снова.", 401);
  const admin = storageAdmin();
  if (!admin) return failure("Хранилище временно недоступно.", 503);
  let input: { target?: string; fields?: Record<string, string>; name?: string; size?: number };
  try { input = await readBoundedJson(request, 32 * 1024) as typeof input; }
  catch { return failure("Не удалось подготовить файл."); }
  if (!input || !input.fields || typeof input.fields !== "object" || Array.isArray(input.fields)
    || Object.values(input.fields).some((value) => typeof value !== "string")
    || typeof input.name !== "string" || !input.name.trim() || input.name.length > 180
    || /[\u0000-\u001f\u007f/\\]/u.test(input.name) || !/\.(pdf|jpe?g|png|heic|heif)$/i.test(input.name)
    || !Number.isInteger(input.size) || input.size! < 1 || input.size! > MAX_DOCUMENT_BYTES) return failure("Выберите PDF или изображение до 20 МБ.");
  const context = uploadContext(input.fields);
  if (Object.values(context).some((value) => !uuidPattern.test(value))) return failure("Некорректный адрес загрузки.");
  let allowed = false;
  if (input.target === "/api/document-uploads/file" && context.sessionId && context.fileId) {
    const { data, error } = await supabase.rpc("authorize_document_file_upload", { p_session_id: context.sessionId, p_file_id: context.fileId });
    allowed = !error && data?.name === input.name.normalize("NFC").trim() && Number(data?.size) === input.size;
  } else if (input.target === "/api/staff-message-attachments" && context.threadId) {
    const { data, error } = await supabase.rpc("staff_chat_sidebar");
    allowed = !error && (data ?? []).some((row: { thread_id: string | null; active: boolean }) => row.thread_id === context.threadId && row.active);
    if (allowed && context.caseId) {
      const result = await supabase.rpc("staff_can_reference_case", { p_thread_id: context.threadId, p_case_id: context.caseId });
      allowed = !result.error && result.data === true;
    }
  } else if (context.caseId && ["/api/contracts", "/api/payment-receipts", "/api/message-attachments"].includes(input.target ?? "")) {
    const { data: item, error } = await supabase.from("cases").select("id, client_id").eq("id", context.caseId).maybeSingle();
    if (!error && item) {
      if (input.target === "/api/payment-receipts") {
        const { data: client } = await supabase.from("clients").select("id").eq("id", item.client_id).eq("user_id", userId).maybeSingle();
        allowed = Boolean(client);
      } else if (input.target === "/api/contracts") {
        const { data: staff } = await supabase.from("staff_members").select("active, role, can_confirm_payments").eq("user_id", userId).maybeSingle();
        allowed = Boolean(staff?.active && staff.can_confirm_payments && /\.pdf$/i.test(input.name));
        if (allowed && staff?.role !== "admin") {
          const { data: assignment } = await supabase.from("case_assignments").select("id").eq("case_id", item.id).eq("staff_user_id", userId).is("revoked_at", null).maybeSingle();
          allowed = Boolean(assignment);
        }
      } else allowed = true;
    }
  }
  if (!allowed) return failure("Доступ к загрузке изменился. Обновите страницу.", 403);
  const { data: ticket, error } = await admin.rpc("server_prepare_temporary_upload", {
    p_user_id: userId, p_target_path: input.target, p_context: context, p_name: input.name.normalize("NFC").trim(), p_size: input.size,
  });
  if (error || !ticket) return failure(error?.message === "Upload rate limit exceeded" ? "Лимит загрузок за сутки исчерпан. Повторите позже." : "Не удалось подготовить загрузку.", error?.message === "Upload rate limit exceeded" ? 429 : 503);
  const { data: signed, error: signingError } = await admin.storage.from(stagingBucket).createSignedUploadUrl(`${userId}/${ticket}`, { upsert: false });
  if (signingError || !signed) return failure("Не удалось открыть хранилище. Повторите попытку.", 503);
  return Response.json({ ticket, signedUrl: signed.signedUrl }, { headers: { "Cache-Control": "no-store" } });
}
