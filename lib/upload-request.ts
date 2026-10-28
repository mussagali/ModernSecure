export class UploadInputError extends Error {
  readonly status: 400 | 413;

  constructor(status: 400 | 413) {
    super(status === 413 ? "Upload is too large" : "Invalid upload");
    this.status = status;
  }
}

type UploadContext = { admin: import("@supabase/supabase-js").SupabaseClient; userId: string };

export async function readBoundedFormData(request: Request, maxBytes: number, context?: UploadContext): Promise<FormData> {
  const contentType = request.headers.get("content-type");
  if (contentType === "application/json" && context) {
    // Vercel receives only ticket IDs. Untrusted bytes travel straight to a
    // private staging bucket; existing routes still validate and authorize them.
    const bytes = await readBoundedBytes(request, 16384);
    let ids: unknown;
    try { ids = JSON.parse(new TextDecoder().decode(bytes)).tickets; } catch { throw new UploadInputError(400); }
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10 || new Set(ids).size !== ids.length
      || ids.some(id => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) throw new UploadInputError(400);
    const result = new FormData(); let fields: string | undefined; let total = 0;
    for (const id of ids) {
      const { data: ticket, error } = await context.admin.from("temporary_uploads").select("*")
        .eq("id", id).eq("user_id", context.userId).maybeSingle();
      if (error || !ticket || ticket.target_path !== new URL(request.url).pathname
        || new Date(ticket.expires_at).getTime() <= Date.now()) throw new UploadInputError(400);
      const fieldSet = JSON.stringify(ticket.context.fields);
      if (fields && fields !== fieldSet) throw new UploadInputError(400);
      if (!fields) {
        for (const [key, value] of ticket.context.fields) result.append(key, value);
        fields = fieldSet;
      }
      total += Number(ticket.size_bytes);
      if (total > maxBytes) throw new UploadInputError(413);
      const { data: blob, error: downloadError } = await context.admin.storage.from("modernsecure-staging")
        .download(`${context.userId}/${id}`);
      if (downloadError || !blob || blob.size !== Number(ticket.size_bytes)) throw new UploadInputError(400);
      result.append(ticket.context.field, new File([blob], ticket.original_name));
    }
    return result;
  }
  if (!contentType || !/^multipart\/form-data;\s*boundary=/i.test(contentType)) throw new UploadInputError(400);
  const bytes = await readBoundedBytes(request, maxBytes);
  try {
    return await new Response(bytes, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new UploadInputError(400);
  }
}

export async function readBoundedBytes(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) throw new UploadInputError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new UploadInputError(400);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new UploadInputError(413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
