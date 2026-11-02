const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const clientCasePath = new RegExp(`^/account/cases/(${uuid})(?:/(tasks|documents|messages|payments))?$`, "i");
const staffCasePath = new RegExp(`^/staff/cases/(${uuid})(?:/(tasks|documents|messages|payments))?$`, "i");
const staffChatPath = new RegExp(`^/staff/chat\\?to=(${uuid})$`, "i");
const singleId = (prefix: string) => new RegExp(`^${prefix}:(${uuid})$`, "i");
const taskReviewKey = new RegExp(`^task-review:(${uuid}):${uuid}$`, "i");
const taskDeadlineKey = new RegExp(`^task-deadline:(${uuid}):\\d{4}-\\d{2}-\\d{2}:(?:today|tomorrow)$`, "i");
const uuidOnly = new RegExp(`^${uuid}$`, "i");
const anchoredCasePath = new RegExp(`^/(account|staff)/cases/${uuid}/(?:tasks#task-${uuid}|documents#(?:request|file)-${uuid})$`, "i");

export function notificationHref(raw: string | null, audience: "client" | "staff") {
  const fallback = audience === "client" ? "/account" : "/staff/cases";
  if (!raw) return fallback;
  if (audience === "staff" && (raw === "/staff/team?tab=pending" || raw === "/staff")) return raw;
  if (audience === "client" && raw === "/account") return raw;
  if (raw.startsWith(audience === "client" ? "/account/" : "/staff/") && anchoredCasePath.test(raw)) return raw;
  if (audience === "staff" && staffChatPath.test(raw)) return raw;
  return (audience === "client" ? clientCasePath : staffCasePath).test(raw) ? raw : fallback;
}

export function notificationActionLabel(raw: string | null, audience: "client" | "staff") {
  const target = notificationHref(raw, audience).split("#", 1)[0];
  if (target === "/staff/team?tab=pending") return "Открыть заявки →";
  if (target === "/staff" || target === "/account") return "Открыть кабинет →";
  if (audience === "staff" && staffChatPath.test(target)) return "Открыть диалог →";
  if (target.endsWith("/documents")) return "Открыть документы →";
  if (target.endsWith("/tasks")) return "Открыть задачи →";
  if (target.endsWith("/messages")) return "Открыть переписку →";
  if (target.endsWith("/payments")) return "Открыть платежи →";
  return "Открыть дело →";
}

export function notificationDestination(
  notice: { target_path: string | null; kind: string | null; dedupe_key: string | null },
  audience: "client" | "staff",
  relatedId: string | null = null,
) {
  const base = notificationHref(notice.target_path, audience);
  if (!notice.dedupe_key) return base;
  if (audience === "staff") {
    if (!relatedId || !uuidOnly.test(relatedId)) return base;
    if (base.endsWith("/documents") && notice.kind === "document_submission"
      && singleId("document-submitted").test(notice.dedupe_key)) {
      return `${base}#request-${relatedId.toLowerCase()}`;
    }
    if (base.endsWith("/tasks") && notice.kind === "task_response"
      && (singleId("task-response").test(notice.dedupe_key)
        || singleId("task-acknowledged").test(notice.dedupe_key))) {
      return `${base}#task-${relatedId.toLowerCase()}`;
    }
    return base;
  }
  if (base.endsWith("/documents")) {
    const request = notice.kind === "document_request" && notice.dedupe_key.match(singleId("document-request"));
    if (request) return `${base}#request-${request[1].toLowerCase()}`;
    const file = notice.kind === "document_review" && notice.dedupe_key.match(singleId("document-review"));
    if (file) return `${base}#file-${file[1].toLowerCase()}`;
  }
  if (base.endsWith("/tasks")) {
    const task = notice.kind === "task" ? notice.dedupe_key.match(singleId("task"))
      : notice.kind === "task_review" ? notice.dedupe_key.match(taskReviewKey)
      : notice.kind === "task_deadline" ? notice.dedupe_key.match(taskDeadlineKey) : null;
    if (task) return `${base}#task-${task[1].toLowerCase()}`;
  }
  return base;
}
