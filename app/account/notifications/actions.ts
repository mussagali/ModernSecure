"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "../../../lib/supabase/server";
import { uuidPattern } from "../../../lib/uuid";
import { notificationDestination } from "../../../lib/notification-links";

export async function openClientNotification(formData: FormData) {
  const id = formData.get("notificationId");
  if (typeof id !== "string" || !uuidPattern.test(id)) redirect("/account/notifications?error=open");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) redirect("/login");
  const { data: target, error } = await supabase.rpc("open_own_notification", { p_notification_id: id });
  if (error) redirect("/account/notifications?error=open");
  const { data: notice } = await supabase.from("notifications").select("kind, dedupe_key").eq("id", id).maybeSingle();
  revalidatePath("/account");
  revalidatePath("/account/cases/[id]", "layout");
  redirect(notificationDestination({ target_path: target as string | null,
    kind: notice?.kind ?? null, dedupe_key: notice?.dedupe_key ?? null }, "client"));
}

export async function markClientInboxRead() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  const { error } = await supabase.rpc("mark_own_notifications_read");
  if (error) redirect("/account/notifications?error=read");
  revalidatePath("/account");
  revalidatePath("/account/cases/[id]", "layout");
  redirect("/account/notifications?read=1");
}
