import { checkDocumentFile, storageAdmin } from "../../../../lib/document-files";
import { canPreviewFile, fileContentDisposition } from "../../../../lib/file-preview";
import { recordFileAccess } from "../../../../lib/file-access-audit";
import { previewFile } from "../../../../lib/heic-preview";
import { createClient } from "../../../../lib/supabase/server";
import { uuidPattern } from "../../../../lib/uuid";

export const runtime = "nodejs";

export async function GET(request: Request, context: RouteContext<"/api/message-attachments/[id]">) {
  const { id } = await context.params;
  if (!uuidPattern.test(id)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return new Response("Unauthorized", { status: 401 });
  // RLS follows attachment -> message -> case on every download.
  const { data: file, error } = await supabase.from("message_attachments")
    .select("storage_path, original_name, detected_mime_type, size_bytes, content_sha256")
    .eq("id", id).maybeSingle();
  if (error || !file) return new Response("Not found", { status: 404 });
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  if (preview && !canPreviewFile(file.detected_mime_type)) {
    return new Response("Preview not supported", { status: 415 });
  }
  const admin = storageAdmin();
  if (!admin) return new Response("File storage is not configured", { status: 503 });
  const { data: blob, error: downloadError } = await admin.storage.from("modernsecure-files")
    .download(file.storage_path);
  if (downloadError || !blob) return new Response("File unavailable", { status: 503 });
  let checked;
  try { checked = await checkDocumentFile(new File([blob], file.original_name)); }
  catch { return new Response("File integrity check failed", { status: 503 }); }
  if (checked.sha256 !== file.content_sha256 || checked.mime !== file.detected_mime_type
    || checked.size !== file.size_bytes) return new Response("File integrity check failed", { status: 503 });
  let served: { bytes: Buffer; mime: string } = { bytes: checked.bytes, mime: checked.mime };
  if (preview) {
    try { served = await previewFile(checked.bytes, checked.mime); }
    catch { return new Response("Preview unavailable", { status: 422 }); }
  }
  if (!await recordFileAccess(admin, auth.claims.sub, "message_attachment", id, preview)) {
    return new Response("File access audit unavailable", { status: 503 });
  }
  return new Response(served.bytes, { headers: {
    "Content-Type": served.mime,
    "Content-Disposition": fileContentDisposition(file.original_name, file.detected_mime_type, preview, "attachment"),
    "Content-Length": String(served.bytes.length),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
  } });
}
