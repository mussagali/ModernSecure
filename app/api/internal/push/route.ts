import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPush, type PushJob } from "../../../../lib/push";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET && Buffer.from(`Bearer ${process.env.CRON_SECRET}`);
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  if (!expected || expected.length !== provided.length || !timingSafeEqual(expected, provided)) return new NextResponse(null, { status: 401 });
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return NextResponse.json({ error: "Push is not configured" }, { status: 503 });
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc("claim_push_batch", { p_limit: 20 });
  if (error) return new NextResponse(null, { status: 503 });
  const jobs = (data ?? []) as PushJob[];
  const results = await Promise.all(jobs.map(async job => {
    const result = await sendPush(job);
    const { error: finishError } = await admin.rpc("finish_push_delivery", { p_id: job.id, p_lease: job.lease_id, p_result: result });
    return finishError ? "unacknowledged" : result;
  }));
  return NextResponse.json({ processed: jobs.length, sent: results.filter(r => r === "sent").length }, { headers: { "Cache-Control": "no-store" } });
}
