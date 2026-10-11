const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const idPattern = /^[1-9]\d{0,18}$/;

export function parseAuditCursor(input: unknown) {
  if (typeof input !== "string" || input.length > 90) return null;
  const pieces = input.split("|");
  if (pieces.length !== 2) return null;
  const [at, id] = pieces;
  if (!timestampPattern.test(at) || !Number.isFinite(Date.parse(at))
    || !idPattern.test(id) || BigInt(id) > BigInt("9223372036854775807")) return null;
  return { at, id };
}

export function auditHref(caseId: string | null, actorId: string | null, cursor?: {
  occurred_at: string; id: number | string;
}) {
  const params = new URLSearchParams();
  if (caseId) params.set("case", caseId);
  if (actorId) params.set("actor", actorId);
  if (cursor) params.set("before", `${cursor.occurred_at}|${cursor.id}`);
  const query = params.toString();
  return `/staff/audit${query ? `?${query}` : ""}`;
}
