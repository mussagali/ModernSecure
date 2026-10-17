// Only account pages are valid post-login destinations. Reject ambiguous URL syntax.
export function safeAccountReturn(value: unknown): string {
  if (typeof value !== "string" || value.length > 1000 || /[\\\s\x00-\x1f%]/.test(value)) return "/account";
  if (!/^\/account(?:\/|\?|#|$)/.test(value)) return "/account";
  const parsed = new URL(value, "https://local.invalid");
  return parsed.origin === "https://local.invalid" && /^\/account(?:\/|$)/.test(parsed.pathname)
    ? `${parsed.pathname}${parsed.search}${parsed.hash}` : "/account";
}
