import type { SupabaseClient } from "@supabase/supabase-js";
import { readBoundedFormData, readBoundedJson, UploadInputError } from "./upload-request.ts";
import { uuidPattern } from "./uuid.ts";

export const stagingBucket = "modernsecure-staging";
const contextFields = ["caseId", "threadId", "sessionId", "fileId"] as const;
export function uploadContext(fields: Record<string, string>): Record<string, string> {
  return Object.fromEntries(contextFields.filter((key) => fields[key]).map((key) => [key, fields[key].toLowerCase()]));
}

export async function readUploadFormData(request: Request, maxBytes: number, userId: string, admin: SupabaseClient): Promise<FormData> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return readBoundedFormData(request, Math.min(maxBytes, 4 * 1024 * 1024));
  const payload = await readBoundedJson(request, 64 * 1024) as { fields?: unknown; files?: unknown };
  if (!payload || !Array.isArray(payload.fields) || !Array.isArray(payload.files) || payload.fields.length > 30 || payload.files.length > 10) throw new UploadInputError(400);
  const form = new FormData();
  for (const pair of payload.fields) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((part) => typeof part === "string") || pair[0].length > 60 || pair[1].length > 8000) throw new UploadInputError(400);
    if (form.has(pair[0])) throw new UploadInputError(400);
    form.append(pair[0], pair[1]);
  }
  const context = uploadContext(Object.fromEntries(form.entries()) as Record<string, string>);
  const tickets = [];
  let total = 0;
  const seen = new Set<string>();
  for (const entry of payload.files) {
    if (!entry || typeof entry !== "object" || !["file", "files"].includes(entry.field) || !uuidPattern.test(entry.ticket ?? "") || seen.has(entry.ticket)) throw new UploadInputError(400);
    seen.add(entry.ticket);
    const { data: ticket, error } = await admin.from("temporary_uploads").select("*").eq("id", entry.ticket).eq("user_id", userId).maybeSingle();
    if (error || !ticket || ticket.target_path !== new URL(request.url).pathname || Date.parse(ticket.expires_at) <= Date.now()
      || JSON.stringify(ticket.context, Object.keys(ticket.context).sort()) !== JSON.stringify(context, Object.keys(context).sort())) throw new UploadInputError(400);
    total += Number(ticket.size_bytes);
    if (total > maxBytes) throw new UploadInputError(413);
    tickets.push({ ...ticket, field: entry.field });
  }
  for (const ticket of tickets) {
    const { data: file, error } = await admin.storage.from(stagingBucket).download(`${userId}/${ticket.id}`);
    if (error || !file || file.size !== Number(ticket.size_bytes)) throw new UploadInputError(400);
    form.append(ticket.field, new File([file], ticket.original_name));
  }
  return form;
}
