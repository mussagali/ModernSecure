import { fileStream } from "../../../../lib/file-stream";
import { checkDocumentFile, storageAdmin } from "../../../../lib/document-files";
import { recordFileAccess } from "../../../../lib/file-access-audit";
import { createClient } from "../../../../lib/supabase/server";
import { uuidPattern } from "../../../../lib/uuid";

export const runtime = "nodejs";
export const maxDuration = 300;


export async function GET(request: Request, context: RouteContext<"/api/contracts/[id]">) {
  const { id } = await context.params;
  if (!uuidPattern.test(id)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return new Response("Unauthorized", { status: 401 });
  const { data: contract, error } = await supabase.from("contracts")
    .select("storage_path, content_sha256, size_bytes").eq("id", id).maybeSingle();
  if (error || !contract) return new Response("Not found", { status: 404 });
  const admin = storageAdmin();
  if (!admin) return new Response("Contract storage is not configured", { status: 503 });
  const { data: blob, error: downloadError } = await admin.storage.from("modernsecure-files").download(contract.storage_path);
  if (downloadError || !blob) return new Response("File unavailable", { status: 503 });
  let file;
  try { file = await checkDocumentFile(new File([blob], "contract.pdf")); }
  catch { return new Response("File integrity check failed", { status: 503 }); }
  if (file.mime !== "application/pdf" || (contract.content_sha256 && file.sha256 !== contract.content_sha256)
    || (contract.size_bytes && file.size !== contract.size_bytes)) {
    return new Response("File integrity check failed", { status: 503 });
  }
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  if (!await recordFileAccess(admin, auth.claims.sub, "contract", id, preview)) {
    return new Response("File access audit unavailable", { status: 503 });
  }
  return new Response(fileStream(file.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="contract-${id}.pdf"`,

      "Cache-Control": "private, no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
