import type { SupabaseClient } from "@supabase/supabase-js";

type FileEntity = "document_file" | "contract" | "payment_receipt"
  | "message_attachment" | "staff_message_attachment";

// Call only after authorization, storage download and integrity/preview checks.
// A failed audit must prevent the response body from leaving the server.
export async function recordFileAccess(
  admin: SupabaseClient,
  actorUserId: string,
  entityType: FileEntity,
  entityId: string,
  preview: boolean,
) {
  const { error } = await admin.rpc("server_record_file_access", {
    p_actor_user_id: actorUserId,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_action: preview ? "preview_issued" : "download_issued",
  });
  if (error) {
    console.error("File access audit failed", { entityType, code: error.code });
    return false;
  }
  return true;
}
