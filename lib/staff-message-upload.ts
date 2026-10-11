import { createHash } from "node:crypto";

// A retry of the same send key must address the same Storage objects. Changing
// the message or files requires a new key (the composer does this on edits).
export function staffMessageFileId(threadId: string, senderId: string, key: string, position: number) {
  const hash = createHash("sha256")
    .update(`staff-message-file\0${threadId}\0${senderId}\0${key}\0${position}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
