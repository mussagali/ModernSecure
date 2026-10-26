// Web supports every role; the native application remains client-only.
export const staffWorkspaceEnabled = true;

export function isStaffOnlyPath(pathname: string): boolean {
  return /^\/(?:staff|staff-security|api\/staff-message-attachments)(?:\/|$)/.test(pathname)
    || pathname === "/api/contracts";
}
