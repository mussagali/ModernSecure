export type DocumentFileState = {
  version_no: number;
  status: string;
};

export type DocumentRequestState = "missing" | "under_review" | "returned" | "accepted" | "incomplete";

export function documentRequestState(files: readonly DocumentFileState[]): DocumentRequestState {
  const latestVersion = latestDocumentVersion(files);
  if (latestVersion === null) return "missing";
  const latest = files.filter((file) => file.version_no === latestVersion && file.status !== "quarantine");
  if (latest.some((file) => file.status === "returned")) return "returned";
  if (latest.some((file) => file.status === "under_review")) return "under_review";
  if (latest.every((file) => file.status === "accepted")) return "accepted";
  return "incomplete";
}

export const documentRequestLabels: Record<DocumentRequestState, string> = {
  missing: "Нужно загрузить",
  under_review: "На проверке у юриста",
  returned: "Нужно исправить",
  accepted: "Принят",
  incomplete: "Требует внимания",
};

export function latestDocumentVersion(files: readonly DocumentFileState[]): number | null {
  const submitted = files.filter((file) => file.status !== "quarantine" && file.status !== "retracted");
  return submitted.length ? Math.max(...submitted.map((file) => file.version_no)) : null;
}
