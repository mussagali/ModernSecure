export function toKztCents(value: string | number): bigint {
  const raw = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error("Некорректная сумма в тенге");
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}

export function formatKzt(cents: bigint): string {
  const negative = cents < BigInt(0);
  const value = negative ? -cents : cents;
  const whole = value / BigInt(100);
  const fraction = value % BigInt(100);
  return `${negative ? "−" : ""}${whole.toLocaleString("ru-RU")}${fraction ? `,${fraction.toString().padStart(2, "0")}` : ""} ₸`;
}
