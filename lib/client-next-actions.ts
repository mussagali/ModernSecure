import { documentRequestState, type DocumentFileState } from "./document-request-state.ts";

type Task = { id: string; title: string; kind: string; status: string; due_at: string | null; document_request_id?: string | null };
type Request = { id: string; title: string; status: string; due_at: string | null };
type File = DocumentFileState & { request_id: string };

export type ClientNextAction = {
  kind: "task" | "document" | "message";
  title: string;
  detail: string;
  href: string;
  dueAt: string | null;
};

export function clientNextActions(input: {
  caseId: string;
  caseActive: boolean;
  tasks: readonly Task[];
  requests: readonly Request[];
  files: readonly File[];
  unreadMessages: number;
}): ClientNextAction[] {
  const base = `/account/cases/${input.caseId}`;
  const items: ClientNextAction[] = [];
  if (input.caseActive) {
    for (const task of input.tasks.filter((row) => row.status === "new")) {
      if (task.kind === "upload_document" && task.document_request_id) continue;
      items.push({ kind: "task", title: task.title,
        detail: task.kind === "upload_document" ? "Загрузить документ" : task.kind === "acknowledge"
          ? "Подтвердить ознакомление" : "Ответить по задаче",
        href: `${base}/tasks#task-${task.id}`, dueAt: task.due_at });
    }
    for (const request of input.requests.filter((row) => row.status === "active")) {
      const state = documentRequestState(input.files.filter((file) => file.request_id === request.id));
      if (!["missing", "returned", "incomplete"].includes(state)) continue;
      items.push({ kind: "document", title: request.title,
        detail: state === "returned" ? "Исправить и отправить заново" : state === "incomplete"
          ? "Отправить полный набор файлов" : "Загрузить документ",
        href: `${base}/documents#request-${request.id}`, dueAt: request.due_at });
    }
  }
  items.sort((a, b) => {
    if (a.dueAt && b.dueAt) return Date.parse(a.dueAt) - Date.parse(b.dueAt);
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return a.kind === b.kind ? a.title.localeCompare(b.title, "ru") : a.kind === "task" ? -1 : 1;
  });
  if (input.unreadMessages > 0) {
    items.push({ kind: "message", title: input.unreadMessages === 1 ? "Новое сообщение" : "Новые сообщения",
      detail: `${input.unreadMessages} непрочитанных`, href: `${base}/messages`, dueAt: null });
  }
  return items;
}
