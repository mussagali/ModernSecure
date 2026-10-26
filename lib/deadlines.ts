// datetime-local is a wall-clock value, never a server-local Date.
// All deadline forms explicitly use Kazakhstan time (UTC+05:00).
export function parseAlmatyDeadline(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+05:00`);
  if (!Number.isFinite(date.getTime())) return null;
  const roundTrip = new Date(date.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 16);
  return roundTrip === value ? date.toISOString() : null;
}

export function formatDeadline(value: string): string {
  return `${new Intl.DateTimeFormat("ru-RU", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Almaty",
  }).format(new Date(value))} (Алматы)`;
}
