import { checkDocumentFile, MAX_DOCUMENT_BYTES, storageAdmin } from "../../../lib/document-files";
import { toKztCents } from "../../../lib/money";
import { createClient } from "../../../lib/supabase/server";
import { readBoundedFormData, UploadInputError } from "../../../lib/upload-request";
import { uuidPattern } from "../../../lib/uuid";
import { staffWorkspaceEnabled } from "../../../lib/application-scope";

export const runtime = "nodejs";

const moneyPattern = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function returnTo(caseId: string, parameter: string) {
  return new URL(`/staff/cases/${caseId}/payments?${parameter}`, process.env.APP_ORIGIN!);
}

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  if (!staffWorkspaceEnabled) return new Response("Not found", { status: 404 });
  if (!process.env.APP_ORIGIN || request.headers.get("origin") !== process.env.APP_ORIGIN) {
    return new Response("Invalid origin", { status: 403 });
  }
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.redirect(new URL("/login", process.env.APP_ORIGIN), 303);
  const admin = storageAdmin();
  if (!admin) return new Response("Contract storage is not configured", { status: 503 });
  let form: FormData;
  try { form = await readBoundedFormData(request, MAX_DOCUMENT_BYTES + 1024 * 1024, { admin, userId: auth.claims.sub }); }
  catch (error) {
    return new Response("Invalid upload", { status: error instanceof UploadInputError ? error.status : 400 });
  }
  const submittedCaseId = field(form, "caseId");
  const submittedKey = field(form, "key");
  const contractNumber = field(form, "contractNumber");
  const signedOn = field(form, "signedOn");
  const price = field(form, "price");
  if (!uuidPattern.test(submittedCaseId) || !uuidPattern.test(submittedKey)) return new Response("Invalid target", { status: 400 });
  const caseId = submittedCaseId.toLowerCase();
  const key = submittedKey.toLowerCase();
  const files = form.getAll("file");
  if (!contractNumber || contractNumber.length > 120 || /[\u0000-\u001f\u007f]/u.test(contractNumber)
    || !moneyPattern.test(price) || (signedOn && !datePattern.test(signedOn))
    || files.length !== 1 || !(files[0] instanceof File)) {
    return Response.redirect(returnTo(caseId, "contractError=invalid"), 303);
  }
  const [{ data: staff, error: staffError }, { data: caseRecord, error: caseError }] = await Promise.all([
    supabase.from("staff_members").select("role, active, can_confirm_payments").eq("user_id", userId).maybeSingle(),
    supabase.from("cases").select("id, status, is_suspended").eq("id", caseId).maybeSingle(),
  ]);
  if (staffError || caseError) return Response.redirect(returnTo(caseId, "contractError=load"), 303);
  if (!staff?.active || !staff.can_confirm_payments || !caseRecord) {
    return Response.redirect(returnTo(caseId, "contractError=access"), 303);
  }
  if (staff.role !== "admin") {
    const { data: assignment, error } = await supabase.from("case_assignments").select("id")
      .eq("case_id", caseId).eq("staff_user_id", userId).is("revoked_at", null).maybeSingle();
    if (error || !assignment) return Response.redirect(returnTo(caseId, "contractError=access"), 303);
  }
  let checked;
  try {
    checked = await checkDocumentFile(files[0] as File);
    if (checked.mime !== "application/pdf") throw new Error("PDF required");
    toKztCents(price);
  } catch {
    return Response.redirect(returnTo(caseId, "contractError=invalid"), 303);
  }
  const path = `contracts/${caseId}/${key}.pdf`;
  const { data: existing, error: existingError } = await supabase.from("contracts")
    .select("id, contract_number, signed_on, price_kzt, content_sha256, size_bytes")
    .eq("storage_path", path).maybeSingle();
  if (existingError) return Response.redirect(returnTo(caseId, "contractError=load"), 303);
  if (existing) {
    if (existing.contract_number !== contractNumber || (existing.signed_on ?? "") !== signedOn
      || toKztCents(existing.price_kzt) !== toKztCents(price)
      || existing.content_sha256 !== checked.sha256 || existing.size_bytes !== checked.size) {
      return Response.redirect(returnTo(caseId, "contractError=conflict"), 303);
    }
    return Response.redirect(returnTo(caseId, "contractUploaded=1"), 303);
  }
  if (caseRecord.status !== "open" || caseRecord.is_suspended) {
    return Response.redirect(returnTo(caseId, "contractError=access"), 303);
  }
  const bucket = admin.storage.from("modernsecure-files");
  const { error: uploadError } = await bucket.upload(path, checked.bytes, {
    contentType: "application/pdf", upsert: false, cacheControl: "0",
    metadata: { sha256: checked.sha256 },
  });
  if (uploadError) {
    const { data: stored, error: downloadError } = await bucket.download(path);
    let matchingFile = false;
    if (!downloadError && stored) {
      try {
        const previous = await checkDocumentFile(new File([stored], "contract.pdf"));
        matchingFile = previous.sha256 === checked.sha256 && previous.size === checked.size;
      } catch { /* Existing object is not the expected PDF. */ }
    }
    if (!matchingFile) {
      return Response.redirect(returnTo(caseId, "contractError=storage"), 303);
    }
  }
  const { error: saveError } = await supabase.rpc("staff_register_contract", {
    p_case_id: caseId, p_contract_number: contractNumber, p_signed_on: signedOn || null,
    p_price_kzt: price, p_storage_path: path, p_content_sha256: checked.sha256, p_size_bytes: checked.size,
  });
  if (saveError) {
    return Response.redirect(returnTo(caseId, "contractError=save"), 303);
  }
  return Response.redirect(returnTo(caseId, "contractUploaded=1"), 303);
}
