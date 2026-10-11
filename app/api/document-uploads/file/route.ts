import { checkDocumentFile, MAX_DOCUMENT_BYTES, storageAdmin } from "../../../../lib/document-files";
import { readBoundedFormData, UploadInputError } from "../../../../lib/upload-request";
import { createClient } from "../../../../lib/supabase/server";
import { uuidPattern } from "../../../../lib/uuid";

export const runtime = "nodejs";

const maxMultipartBytes = MAX_DOCUMENT_BYTES + 2 * 1024 * 1024;

type AuthorizedFile = {
  path: string; name: string; mime: string; size: number; sha256: string;
  case_id: string; request_id: string;
};

export async function POST(request: Request) {
  if (!process.env.APP_ORIGIN || request.headers.get("origin") !== process.env.APP_ORIGIN) {
    return new Response("Invalid origin", { status: 403 });
  }
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return new Response("Unauthorized", { status: 401 });
  const admin = storageAdmin();
  if (!admin) return new Response("Document storage is not configured", { status: 503 });

  let form: FormData;
  try { form = await readBoundedFormData(request, maxMultipartBytes); }
  catch (error) {
    return new Response("Invalid upload", { status: error instanceof UploadInputError ? error.status : 400 });
  }
  const sessionId = form.get("sessionId");
  const fileId = form.get("fileId");
  const input = form.get("file");
  if (typeof sessionId !== "string" || !uuidPattern.test(sessionId)
    || typeof fileId !== "string" || !uuidPattern.test(fileId)
    || !(input instanceof File) || form.getAll("file").length !== 1) {
    return new Response("Invalid upload target", { status: 400 });
  }

  const { data, error } = await supabase.rpc("authorize_document_file_upload", {
    p_session_id: sessionId, p_file_id: fileId,
  });
  if (error || !data) return new Response("Upload is no longer authorized", { status: 403 });
  const target = data as AuthorizedFile;
  if (!uuidPattern.test(target.case_id) || !uuidPattern.test(target.request_id)
    || target.path !== `${target.case_id}/${target.request_id}/${sessionId}/${fileId}`) {
    return new Response("Invalid storage target", { status: 503 });
  }
  let checked;
  try { checked = await checkDocumentFile(input); }
  catch { return new Response("Invalid file type or size", { status: 400 }); }
  if (checked.name !== target.name || checked.mime !== target.mime || checked.size !== target.size
    || checked.sha256 !== target.sha256) {
    return new Response("File differs from prepared batch", { status: 409 });
  }
  const { data: beforeWrite, error: beforeWriteError } = await supabase.rpc("authorize_document_file_upload", {
    p_session_id: sessionId, p_file_id: fileId,
  });
  if (beforeWriteError || !beforeWrite || (beforeWrite as AuthorizedFile).path !== target.path) {
    return new Response("Upload is no longer authorized", { status: 403 });
  }
  const { error: uploadError } = await admin.storage.from("modernsecure-files")
    .upload(target.path, checked.bytes, { contentType: checked.mime, upsert: true, cacheControl: "0" });
  if (uploadError) return new Response("File storage failed", { status: 503 });
  const { data: afterWrite, error: afterWriteError } = await supabase.rpc("authorize_document_file_upload", {
    p_session_id: sessionId, p_file_id: fileId,
  });
  if (afterWriteError || !afterWrite || (afterWrite as AuthorizedFile).path !== target.path) {
    return new Response("Upload is no longer authorized", { status: 403 });
  }
  const { error: verifyError } = await admin.rpc("server_verify_document_file", {
    p_session_id: sessionId, p_file_id: fileId, p_sha256: checked.sha256,
  });
  if (verifyError) return new Response("File verification failed", { status: 503 });
  return Response.json({ ok: true, fileId }, { headers: { "Cache-Control": "no-store" } });
}
