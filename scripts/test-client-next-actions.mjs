import assert from "node:assert/strict";
import { clientNextActions } from "../lib/client-next-actions.ts";

const input = {
  caseId: "case-a", caseActive: true,
  tasks: [{ id: "task-a", title: "Ответить", kind: "answer", status: "new", due_at: "2026-10-13T10:00:00Z" },
    { id: "task-b", title: "Уже отправлено", kind: "answer", status: "response_sent", due_at: null }],
  requests: [{ id: "request-a", title: "Паспорт", status: "active", due_at: "2026-10-12T10:00:00Z" },
    { id: "request-b", title: "Справка", status: "active", due_at: null },
    { id: "request-c", title: "Отменено", status: "not_required", due_at: null }],
  files: [{ request_id: "request-a", version_no: 1, status: "accepted" },
    { request_id: "request-a", version_no: 2, status: "returned" },
    { request_id: "request-b", version_no: 1, status: "under_review" }],
  unreadMessages: 2,
};
const actions = clientNextActions(input);
assert.deepEqual(actions.map((item) => item.kind), ["document", "task", "message"]);
assert.equal(actions[0].href, "/account/cases/case-a/documents#request-request-a");
assert.equal(actions[0].detail, "Исправить и отправить заново");
assert.equal(actions[1].href, "/account/cases/case-a/tasks#task-task-a");
assert.equal(clientNextActions({ ...input, tasks: [{ ...input.tasks[0], kind: "acknowledge" }] })[1].detail,
  "Подтвердить ознакомление");
assert.equal(clientNextActions({ ...input, tasks: [{ ...input.tasks[0], kind: "upload_document" }] })[1].detail,
  "Загрузить документ");
assert.equal(clientNextActions({ ...input, caseActive: false }).length, 1);
assert.equal(clientNextActions({ ...input, caseActive: false, unreadMessages: 0 }).length, 0);
console.log("OK client next actions: latest document version, due tasks, unread messages and suspended case");
