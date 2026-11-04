import { safeAccountReturn, safeStaffReturn } from "./return-path";

type WorkspaceRole = { role: string; active: boolean; mfa_passed: boolean } | null;

export function notificationReturn(value: unknown): string | null {
  return typeof value === "string" && /^\/notifications\/open\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

// A role is supplied by the database, never by a form or URL parameter.
export function workspaceDestination(staff: WorkspaceRole, next?: unknown): string {
  // Own privacy requests are independent of business-role activation and MFA.
  if (next === "/delete-account") return "/delete-account";
  const notice = notificationReturn(next);
  if (!staff) return notice ?? safeAccountReturn(next);
  if (!staff.active || !["lawyer", "manager", "admin"].includes(staff.role)) return "/access-denied";
  return staff.mfa_passed ? notice ?? safeStaffReturn(next) : notice ? `/staff-security?next=${encodeURIComponent(notice)}` : "/staff-security";
}
