import { deliverFile } from "../../../../lib/file-delivery";
import { checkDocumentFile, storageAdmin } from "../../../../lib/document-files";
import { canPreviewFile, fileContentDisposition } from "../../../../lib/file-preview";
import { recordFileAccess } from "../../../../lib/file-access-audit";
import { previewFile } from "../../../../lib/heic-preview";
import { createClient } from "../../../../lib/supabase/server";
import { uuidPattern } from "../../../../lib/uuid";

export const runtime = "nodejs";


export async function GET(request: Request, context: RouteContext<"/api/payment-receipts/[id]">) {
  const { id } = await context.params;
  if (!uuidPattern.test(id)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return new Response("Unauthorized", { status: 401 });
  const { data: receipt, error } = await supabase.from("payment_receipts")
    .select("storage_path, original_name, detected_mime_type, size_bytes, content_sha256")
    .eq("id", id).maybeSingle();
  if (error || !receipt) return new Response("Not found", { status: 404 });
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  if (preview && !canPreviewFile(receipt.detected_mime_type)) {
    return new Response("Preview not supported for this file type", { status: 415 });
  }
  const admin = storageAdmin();
  if (!admin) return new Response("Receipt storage is not configured", { status: 503 });
  const { data: blob, error: downloadError } = await admin.storage.from("modernsecure-files").download(receipt.storage_path);
  if (downloadError || !blob) return new Response("File unavailable", { status: 503 });
  let file;
  try { file = await checkDocumentFile(new File([blob], receipt.original_name)); }
  catch { return new Response("File integrity check failed", { status: 503 }); }
  if (file.mime !== receipt.detected_mime_type || file.sha256 !== receipt.content_sha256
    || file.size !== receipt.size_bytes) return new Response("File integrity check failed", { status: 503 });
  let served: { bytes: Buffer; mime: string } = { bytes: file.bytes, mime: file.mime };
  if (preview) {
    try { served = await previewFile(file.bytes, file.mime); }
    catch { return new Response("Preview unavailable", { status: 422 }); }
  }
  if (!await recordFileAccess(admin, auth.claims.sub, "payment_receipt", id, preview)) {
    return new Response("File access audit unavailable", { status: 503 });
  }
  return deliverFile(admin, receipt.storage_path, served.bytes, {
      "Content-Type": served.mime,
      "Content-Disposition": fileContentDisposition(receipt.original_name, receipt.detected_mime_type, preview, "receipt"),
      "Content-Length": String(served.bytes.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    }, { preview, name: receipt.original_name, transformed: served.mime !== receipt.detected_mime_type });
}
