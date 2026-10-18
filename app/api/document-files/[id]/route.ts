import { fileStream } from "../../../../lib/file-stream";
import { createHash } from "node:crypto";
import { storageAdmin } from "../../../../lib/document-files";
import { recordFileAccess } from "../../../../lib/file-access-audit";
import { canPreviewFile, fileContentDisposition } from "../../../../lib/file-preview";
import { previewFile } from "../../../../lib/heic-preview";
import { createClient } from "../../../../lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, context: RouteContext<"/api/document-files/[id]">) {
  const { id } = await context.params;
  if (!uuidPattern.test(id)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return new Response("Unauthorized", { status: 401 });
  const admin = storageAdmin();
  if (!admin) return new Response("Document storage is not configured", { status: 503 });
  const { data: file, error } = await supabase.from("document_files")
    .select("storage_path, original_name, detected_mime_type, content_sha256, status").eq("id", id).maybeSingle();
  if (error || !file || !["under_review", "accepted", "returned"].includes(file.status)) {
    return new Response("Not found", { status: 404 });
  }
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  if (preview && !canPreviewFile(file.detected_mime_type)) {
    return new Response("Preview not supported for this file type", { status: 415 });
  }
  const { data: blob, error: downloadError } = await admin.storage.from("modernsecure-files").download(file.storage_path);
  if (downloadError || !blob) return new Response("File unavailable", { status: 503 });
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (file.content_sha256 && createHash("sha256").update(bytes).digest("hex") !== file.content_sha256) {
    return new Response("File integrity check failed", { status: 503 });
  }
  let served: { bytes: Buffer; mime: string } = { bytes, mime: file.detected_mime_type ?? "application/octet-stream" };
  if (preview) {
    try { served = await previewFile(bytes, served.mime); }
    catch { return new Response("Preview unavailable", { status: 422 }); }
  }
  if (!await recordFileAccess(admin, auth.claims.sub, "document_file", id, preview)) {
    return new Response("File access audit unavailable", { status: 503 });
  }
  return new Response(fileStream(served.bytes), {
    headers: {
      "Content-Type": served.mime,
      "Content-Disposition": fileContentDisposition(file.original_name, file.detected_mime_type, preview, "document"),

      "Cache-Control": "private, no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
