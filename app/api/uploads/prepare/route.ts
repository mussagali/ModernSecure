import { createClient } from "../../../../lib/supabase/server";
import { storageAdmin, MAX_DOCUMENT_BYTES } from "../../../../lib/document-files";
import { readBoundedBytes, UploadInputError } from "../../../../lib/upload-request";

const targets = new Set(["/api/contracts", "/api/payment-receipts", "/api/document-uploads/file", "/api/message-attachments", "/api/staff-message-attachments"]);
export async function POST(request: Request) {
  if (!process.env.APP_ORIGIN || request.headers.get("origin") !== process.env.APP_ORIGIN) return new Response(null, { status: 403 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return new Response(null, { status: 401 });
  const { data: access, error: accessError } = await supabase.rpc("account_access_status");
  const { data: staff, error: staffError } = await supabase.rpc("staff_mfa_status");
  if (accessError || staffError || access !== "approved" || (staff && !staff.mfa_passed)) return new Response(null, { status: 403 });
  const admin = storageAdmin();
  if (!admin) return new Response(null, { status: 503 });
  try {
    const input = JSON.parse(new TextDecoder().decode(await readBoundedBytes(request, 32768)));
    if (!targets.has(input.target) || !["file", "files"].includes(input.field)
      || typeof input.name !== "string" || input.name.length < 1 || input.name.length > 180
      || /[\x00-\x1f/\\]/.test(input.name) || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > MAX_DOCUMENT_BYTES
      || !Array.isArray(input.fields) || input.fields.length > 20
      || input.fields.some((pair: unknown) => !Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string"
        || pair[0].length > 60 || pair[1].length > 20000 || ["file", "files"].includes(pair[0]))) return new Response(null, { status: 400 });
    const { data: id, error } = await admin.rpc("server_prepare_temporary_upload", { p_user_id: auth.claims.sub, p_target_path: input.target,
      p_context: { field: input.field, fields: input.fields }, p_name: input.name, p_size: input.size });
    if (error || !id) return new Response(null, { status: 429 });
    const path = `${auth.claims.sub}/${id}`;
    const { data, error: signError } = await admin.storage.from("modernsecure-staging").createSignedUploadUrl(path, { upsert: false });
    if (signError || !data) return new Response(null, { status: 503 });
    return Response.json({ id, signedUrl: data.signedUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return new Response(null, { status: error instanceof UploadInputError ? error.status : 400 }); }
}
