export type ListParams = Record<string, string | string[] | undefined>;

export function queryText(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

export function queryPage(value: string | string[] | undefined): number {
  return typeof value === "string" && /^\d+$/.test(value)
    ? Math.max(1, Math.min(10000, Number(value))) : 1;
}

// Literal matching, including punctuation, without allowing PostgREST filter syntax.
export function searchPattern(query: string): string {
  return `%${query.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&")}%`;
}

export function textSearch(columns: string[], query: string): string {
  const pattern = searchPattern(query).replace(/"/g, '\\"');
  return columns.map(column => `${column}.ilike."${pattern}"`).join(",");
}

export function listHref(path: string, params: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  return `${path}${query.size ? `?${query}` : ""}`;
}
