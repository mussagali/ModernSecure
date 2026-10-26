import { safeAccountReturn, safeStaffReturn } from "./return-path";

type WorkspaceRole = { role: string; active: boolean; mfa_passed: boolean } | null;

// A role is supplied by the database, never by a form or URL parameter.
export function workspaceDestination(staff: WorkspaceRole, next?: unknown): string {
  if (!staff) return safeAccountReturn(next);
  if (!staff.active || !["lawyer", "manager", "admin"].includes(staff.role)) return "/access-denied";
  return staff.mfa_passed ? safeStaffReturn(next) : "/staff-security";
}
