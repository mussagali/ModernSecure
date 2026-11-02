import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Authorization, byte integrity and the access audit must succeed before this
// helper is called. A short-lived URL avoids Vercel's 4.5 MB response limit.
export async function deliverFile(admin: SupabaseClient, path: string, bytes: Buffer, headers: Record<string, string>,
  { preview, name, transformed = false }: { preview: boolean; name: string; transformed?: boolean }) {
  if (bytes.length <= 4 * 1024 * 1024) return new Response(bytes, { headers });
  const bucket = admin.storage.from(transformed ? "modernsecure-previews" : "modernsecure-files");
  if (transformed) {
    path = `generated/${createHash("sha256").update(bytes).digest("hex")}.jpg`;
    const { error } = await bucket.upload(path, bytes, { contentType: headers["Content-Type"], upsert: false, cacheControl: "0" });
    if (error && !["409", "400"].includes(String(error.statusCode))) return new Response("Preview storage unavailable", { status: 503 });
  }
  const { data, error } = await bucket.createSignedUrl(path, 90, preview ? {} : { download: name });
  if (error || !data?.signedUrl) return new Response("File delivery unavailable", { status: 503 });
  return new Response(null, { status: 302, headers: { Location: data.signedUrl, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}
