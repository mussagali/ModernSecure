import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { uuidPattern } from "../../../lib/uuid";

export async function POST(request: NextRequest) {
  if (!process.env.APP_ORIGIN || request.headers.get("origin") !== process.env.APP_ORIGIN) return new NextResponse(null, { status: 403 });
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return new NextResponse(null, { status: 503 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return new NextResponse(null, { status: 415 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return new NextResponse(null, { status: 401 });
  // Stream limit applies even when Content-Length is absent or dishonest.
  const reader = request.body?.getReader();
  if (!reader) return new NextResponse(null, { status: 400 });
  let body = ""; let bytes = 0; const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.length; if (bytes > 8192) { await reader.cancel(); return new NextResponse(null, { status: 413 }); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    const value = JSON.parse(body);
    if (typeof value.installationId !== "string" || !uuidPattern.test(value.installationId)
      || typeof value.secret !== "string" || !uuidPattern.test(value.secret)
      || typeof value.token !== "string" || value.token.length < 20 || value.token.length > 4096
      || !["android", "ios"].includes(value.platform)) return new NextResponse(null, { status: 400 });
    const { error } = await supabase.rpc("register_push_device", { p_id: value.installationId, p_secret: value.secret, p_token: value.token, p_platform: value.platform });
    return error ? new NextResponse(null, { status: 403 }) : NextResponse.json({ registered: true }, { headers: { "Cache-Control": "no-store" } });
  } catch { return new NextResponse(null, { status: 400 }); }
}
