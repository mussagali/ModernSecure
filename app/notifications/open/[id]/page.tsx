import { redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { getStaffStatus } from "../../../../lib/staff";
import { requireAccountApproval } from "../../../../lib/account-access";
import { notificationDestination } from "../../../../lib/notification-links";
import { uuidPattern } from "../../../../lib/uuid";

export default async function OpenNotification({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidPattern.test(id)) redirect("/account");
  const next = `/notifications/open/${id}`;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) redirect(`/login?next=${encodeURIComponent(next)}`);
  const { staff, error } = await getStaffStatus(supabase);
  if (error) throw new Error("Не удалось проверить доступ");
  if (staff && !staff.active) redirect("/access-denied");
  if (staff && !staff.mfa_passed) redirect(`/staff-security?next=${encodeURIComponent(next)}`);
  await requireAccountApproval(supabase);
  const audience = staff ? "staff" : "client";
  const fallback = staff ? "/staff/notifications" : "/account/notifications";
  const { data: notice, error: noticeError } = await supabase.from("notifications")
    .select("target_path, kind, dedupe_key, case_id").eq("id", id).eq("recipient_user_id", auth.claims.sub).maybeSingle();
  if (noticeError || !notice) redirect(fallback);
  // A historical notification must not restore a revoked case assignment.
  if (notice.case_id) {
    const { data: caseRow, error: caseError } = await supabase.from("cases").select("id").eq("id", notice.case_id).maybeSingle();
    if (caseError || !caseRow) redirect(fallback);
  }
  let relatedId: string | null = null;
  const key = notice.dedupe_key ?? "";
  if (staff && notice.kind === "document_submission" && key.startsWith("document-submitted:")) {
    const sessionId = key.slice("document-submitted:".length);
    if (uuidPattern.test(sessionId)) {
      const { data } = await supabase.from("upload_sessions").select("request_id").eq("id", sessionId).maybeSingle();
      relatedId = data?.request_id ?? null;
    }
  } else if (staff && notice.kind === "task_response") {
    const eventId = key.slice(key.indexOf(":") + 1);
    if (uuidPattern.test(eventId)) {
      const { data } = await supabase.from("task_events").select("task_id").eq("id", eventId).maybeSingle();
      relatedId = data?.task_id ?? null;
    }
  }
  // Opening via GET does not mark it read; the inbox retains the existing
  // explicit POST action, so browser prefetch cannot consume a notification.
  redirect(notificationDestination(notice, audience, relatedId));
}
