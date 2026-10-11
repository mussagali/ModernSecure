"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "../../../lib/staff";
import { uuidPattern } from "../../../lib/uuid";
import { notificationDestination } from "../../../lib/notification-links";

export async function openStaffNotification(formData: FormData) {
  const id = formData.get("notificationId");
  if (typeof id !== "string" || !uuidPattern.test(id)) redirect("/staff/notifications?error=open");
  const { supabase } = await requireStaff();
  const { data: target, error } = await supabase.rpc("open_own_notification", { p_notification_id: id });
  if (error) redirect("/staff/notifications?error=open");
  const { data: notice } = await supabase.from("notifications")
    .select("kind, dedupe_key").eq("id", id).maybeSingle();
  let relatedId: string | null = null;
  const key = notice?.dedupe_key ?? "";
  if (notice?.kind === "document_submission" && key.startsWith("document-submitted:")) {
    const sessionId = key.slice("document-submitted:".length);
    if (uuidPattern.test(sessionId)) {
      const { data: session } = await supabase.from("upload_sessions")
        .select("request_id").eq("id", sessionId).maybeSingle();
      relatedId = session?.request_id ?? null;
    }
  } else if (notice?.kind === "task_response"
    && (key.startsWith("task-response:") || key.startsWith("task-acknowledged:"))) {
    const eventId = key.slice(key.indexOf(":") + 1);
    if (uuidPattern.test(eventId)) {
      const { data: event } = await supabase.from("task_events")
        .select("task_id").eq("id", eventId).maybeSingle();
      relatedId = event?.task_id ?? null;
    }
  }
  revalidatePath("/staff", "layout");
  redirect(notificationDestination({ target_path: target as string | null,
    kind: notice?.kind ?? null, dedupe_key: notice?.dedupe_key ?? null }, "staff", relatedId));
}

export async function markStaffInboxRead() {
  const { supabase } = await requireStaff();
  const { error } = await supabase.rpc("mark_own_notifications_read");
  if (error) redirect("/staff/notifications?error=read");
  revalidatePath("/staff", "layout");
  redirect("/staff/notifications?read=1");
}
