const caseSections = new Set(["tasks", "documents", "messages", "payments"]);

export function isClientNavigationActive(path: string, section: string | null, href: string) {
  const [destination, query = ""] = href.split("?");
  if (path === "/account/select-case") {
    const selected = section && caseSections.has(section) ? section : "";
    if (!selected) return href === "/account/select-case";
    return new URLSearchParams(query).get("section") === selected
      || new RegExp(`^/account/cases/[^/]+/${selected}$`).test(destination);
  }
  if (/^\/account\/cases\/[^/]+(?:\/history)?$/.test(path)) return href === "/account/select-case";
  return path === destination;
}
