import { checkDocumentFile, MAX_UPLOAD_BYTES, storageAdmin, type DocumentBatch } from "../../../lib/document-files";
import { createClient } from "../../../lib/supabase/server";

export const runtime = "nodejs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxMultipartBytes = MAX_UPLOAD_BYTES + 2 * 1024 * 1024;

async function boundedFormData(request: Request) {
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data; boundary=")) throw new Error("invalid_upload");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_upload");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxMultipartBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("upload_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, { headers: { "content-type": contentType } }).formData();
}

function returnTo(caseId: string, view: string, parameter: string) {
  const route = view === "staff" ? `/staff/cases/${caseId}/documents` : `/account/cases/${caseId}/documents`;
  return new URL(`${route}?${parameter}`, process.env.APP_ORIGIN!);
}

export async function POST(request: Request) {
  if (!process.env.APP_ORIGIN || request.headers.get("origin") !== process.env.APP_ORIGIN) {
    return new Response("Invalid origin", { status: 403 });
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxMultipartBytes)) {
    return new Response("Upload is too large", { status: 413 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.redirect(new URL("/login", process.env.APP_ORIGIN), 303);
  const admin = storageAdmin();
  if (!admin) return new Response("Document storage is not configured", { status: 503 });

  let form: FormData;
  try { form = await boundedFormData(request); }
  catch (error) { return new Response("Invalid upload", { status: error instanceof Error && error.message === "upload_too_large" ? 413 : 400 }); }
  const caseId = form.get("caseId");
  const requestId = form.get("requestId");
  const key = form.get("key");
  const view = form.get("view") === "staff" ? "staff" : "client";
  if (typeof caseId !== "string" || !uuidPattern.test(caseId)
    || typeof requestId !== "string" || !uuidPattern.test(requestId)
    || typeof key !== "string" || !uuidPattern.test(key)) {
    return new Response("Invalid upload target", { status: 400 });
  }
  const { data: documentRequest, error: requestError } = await supabase.from("document_requests")
    .select("case_id").eq("id", requestId).maybeSingle();
  if (requestError || documentRequest?.case_id !== caseId) {
    return new Response("Document request not found", { status: 404 });
  }
  const files = form.getAll("files");
  if (files.length < 1 || files.length > 10 || files.some((file) => !(file instanceof File))) {
    return Response.redirect(returnTo(caseId, view, "uploadError=invalid"), 303);
  }
  const incoming = files as File[];
  if (incoming.reduce((size, file) => size + file.size, 0) > MAX_UPLOAD_BYTES) {
    return Response.redirect(returnTo(caseId, view, "uploadError=size"), 303);
  }
  let checked;
  try { checked = await Promise.all(incoming.map(checkDocumentFile)); }
  catch { return Response.redirect(returnTo(caseId, view, "uploadError=type"), 303); }

  const metadata = checked.map(({ name, mime, size, sha256 }) => ({ name, mime, size, sha256 }));
  const { data, error } = await supabase.rpc("resume_or_begin_document_upload", {
    p_request_id: requestId, p_idempotency_key: key, p_files: metadata,
  });
  if (error || !data) return Response.redirect(returnTo(caseId, view, "uploadError=prepare"), 303);
  const batch = data as DocumentBatch;
  if (!uuidPattern.test(batch.session_id) || !Array.isArray(batch.files) || batch.files.length !== checked.length) {
    return Response.redirect(returnTo(caseId, view, "uploadError=prepare"), 303);
  }
  if (batch.status === "completed") return Response.redirect(returnTo(caseId, view, "uploaded=1"), 303);
  for (const [index, file] of checked.entries()) {
    const destination = batch.files[index];
    if (destination.sha256 !== file.sha256 || destination.size !== file.size || destination.mime !== file.mime
      || destination.name !== file.name || !uuidPattern.test(destination.id)
      || destination.path !== `${caseId}/${requestId}/${batch.session_id}/${destination.id}`) {
      return Response.redirect(returnTo(caseId, view, "uploadError=prepare"), 303);
    }
    const { data: allowed, error: allowError } = await supabase.rpc("authorize_document_file_upload", {
      p_session_id: batch.session_id, p_file_id: destination.id,
    });
    if (allowError || !allowed || allowed.path !== destination.path) {
      return Response.redirect(returnTo(caseId, view, "uploadError=access"), 303);
    }
    const { error: uploadError } = await admin.storage.from("modernsecure-files")
      .upload(destination.path, file.bytes, { contentType: file.mime, upsert: true, cacheControl: "0" });
    if (uploadError) return Response.redirect(returnTo(caseId, view, "uploadError=storage"), 303);
    const { data: stillAllowed, error: stillAllowedError } = await supabase.rpc("authorize_document_file_upload", {
      p_session_id: batch.session_id, p_file_id: destination.id,
    });
    if (stillAllowedError || !stillAllowed || stillAllowed.path !== destination.path) {
      return Response.redirect(returnTo(caseId, view, "uploadError=access"), 303);
    }
    const { error: verifyError } = await admin.rpc("server_verify_document_file", {
      p_session_id: batch.session_id, p_file_id: destination.id, p_sha256: file.sha256,
    });
    if (verifyError) return Response.redirect(returnTo(caseId, view, "uploadError=finish"), 303);
  }
  const { error: completeError } = await supabase.rpc("complete_document_upload", { p_session_id: batch.session_id });
  if (completeError) return Response.redirect(returnTo(caseId, view, "uploadError=finish"), 303);
  return Response.redirect(returnTo(caseId, view, "uploaded=1"), 303);
}
