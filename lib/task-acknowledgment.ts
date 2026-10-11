import { createHash } from "node:crypto";

type TaskText = { title: string; description: string | null };

export function taskAcknowledgmentSnapshot(task: TaskText) {
  return `${task.title}\n${task.description ?? ""}`;
}

export function taskAcknowledgmentVersion(task: TaskText) {
  return createHash("sha256").update(taskAcknowledgmentSnapshot(task), "utf8").digest("hex");
}
