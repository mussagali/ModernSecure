import { checkDocumentFile, MAX_DOCUMENT_BYTES, storageAdmin } from "../../../lib/document-files";
import { createClient } from "../../../lib/supabase/server";
import { readBoundedFormData, UploadInputError } from "../../../lib/upload-request";
import { uuidPattern } from "../../../lib/uuid";

export const runtime = "nodejs";

const extensions: Record<string, string> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png",
  "image/heic": "heic", "image/heif": "heif",
};

function returnTo(caseId: string, parameter: string) {
  return new URL(`/account/cases/${caseId}/payments?${parameter}`, process.env.APP_ORIGIN!);
}

export async function POST(request: Request) {
  if (!process.env.APP_ORIGIN || request.headers.get("origin") !== process.env.APP_ORIGIN) {
    return new Response("Invalid origin", { status: 403 });
  }
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.redirect(new URL("/login", process.env.APP_ORIGIN), 303);
  const admin = storageAdmin();
  if (!admin) return new Response("Receipt storage is not configured", { status: 503 });
  let form: FormData;
  try { form = await readBoundedFormData(request, MAX_DOCUMENT_BYTES + 1024 * 1024, { admin, userId: auth.claims.sub }); }
  catch (error) { return new Response("Invalid upload", { status: error instanceof UploadInputError ? error.status : 400 }); }
  const submittedCaseId = form.get("caseId");
  const submittedKey = form.get("key");
  if (typeof submittedCaseId !== "string" || !uuidPattern.test(submittedCaseId)
    || typeof submittedKey !== "string" || !uuidPattern.test(submittedKey)) return new Response("Invalid target", { status: 400 });
  const caseId = submittedCaseId.toLowerCase();
  const key = submittedKey.toLowerCase();
  const [{ data: client, error: clientError }, { data: item, error: caseError }] = await Promise.all([
    supabase.from("clients").select("id").eq("user_id", userId).maybeSingle(),
    supabase.from("cases").select("id, client_id, status, is_suspended").eq("id", caseId).maybeSingle(),
  ]);
  if (clientError || caseError) return Response.redirect(returnTo(caseId, "receiptError=load"), 303);
  if (!client || !item || item.client_id !== client.id) {
    return Response.redirect(returnTo(caseId, "receiptError=access"), 303);
  }
  const files = form.getAll("file");
  if (files.length !== 1 || !(files[0] instanceof File)) {
    return Response.redirect(returnTo(caseId, "receiptError=invalid"), 303);
  }
  let checked;
  try { checked = await checkDocumentFile(files[0] as File); }
  catch { return Response.redirect(returnTo(caseId, "receiptError=invalid"), 303); }
  const path = `receipts/${caseId}/${userId}/${key}.${extensions[checked.mime]}`;
  const { data: existing, error: existingError } = await supabase.from("payment_receipts")
    .select("id, storage_path, original_name, detected_mime_type, size_bytes, content_sha256")
    .eq("case_id", caseId).eq("uploaded_by", userId).eq("idempotency_key", key).maybeSingle();
  if (existingError) return Response.redirect(returnTo(caseId, "receiptError=load"), 303);
  if (existing) {
    if (existing.storage_path !== path || existing.original_name !== checked.name
      || existing.detected_mime_type !== checked.mime || existing.size_bytes !== checked.size
      || existing.content_sha256 !== checked.sha256) {
      return Response.redirect(returnTo(caseId, "receiptError=conflict"), 303);
    }
    return Response.redirect(returnTo(caseId, "receiptUploaded=1"), 303);
  }
  if (item.status !== "open" || item.is_suspended) {
    return Response.redirect(returnTo(caseId, "receiptError=access"), 303);
  }
  const bucket = admin.storage.from("modernsecure-files");
  const { error: uploadError } = await bucket.upload(path, checked.bytes, {
    contentType: checked.mime, upsert: false, cacheControl: "0",
    metadata: { sha256: checked.sha256 },
  });
  if (uploadError) {
    const { data: stored, error: downloadError } = await bucket.download(path);
    let matchingFile = false;
    if (!downloadError && stored) {
      try {
        const prior = await checkDocumentFile(new File([stored], checked.name));
        matchingFile = prior.sha256 === checked.sha256 && prior.size === checked.size && prior.mime === checked.mime;
      } catch { /* Reject a mismatched existing object. */ }
    }
    if (!matchingFile) return Response.redirect(returnTo(caseId, "receiptError=storage"), 303);
  }
  const { error: saveError } = await supabase.rpc("client_register_payment_receipt", {
    p_case_id: caseId, p_storage_path: path, p_original_name: checked.name,
    p_mime_type: checked.mime, p_size_bytes: checked.size,
    p_content_sha256: checked.sha256, p_idempotency_key: key,
  });
  if (saveError) {
    return Response.redirect(returnTo(caseId, saveError.code === "23505" ? "receiptError=duplicate" : "receiptError=save"), 303);
  }
  return Response.redirect(returnTo(caseId, "receiptUploaded=1"), 303);
}
