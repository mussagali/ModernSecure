const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseAuthAuditCursor(input: unknown) {
  if (typeof input !== "string" || input.length > 90) return null;
  const pieces = input.split("|");
  if (pieces.length !== 2) return null;
  const [at, id] = pieces;
  if (!timestampPattern.test(at) || !Number.isFinite(Date.parse(at)) || !uuidPattern.test(id)) return null;
  return { at, id };
}

export function authAuditHref(actorId: string | null, cursor?: { occurred_at: string; id: string }) {
  const params = new URLSearchParams();
  if (actorId) params.set("actor", actorId);
  if (cursor) params.set("before", `${cursor.occurred_at}|${cursor.id}`);
  const query = params.toString();
  return `/staff/audit/auth${query ? `?${query}` : ""}`;
}
