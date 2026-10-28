import { notFound, redirect } from "next/navigation";
import { staffWorkspaceEnabled } from "./application-scope";
import { createClient } from "./supabase/server";

export type StaffStatus = {
  role: "lawyer" | "manager" | "admin";
  active: boolean;
  is_primary_admin: boolean;
  display_name: string;
  mfa_required: boolean;
  mfa_passed: boolean;
};

export async function getStaffStatus(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase.rpc("staff_mfa_status");
  return { staff: data as StaffStatus | null, error };
}

export async function requireStaff(allowedRoles: Array<"lawyer" | "manager" | "admin"> = ["lawyer", "manager", "admin"]) {
  if (!staffWorkspaceEnabled) notFound();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");
  const { staff, error } = await getStaffStatus(supabase);
  if (error) throw new Error("Не удалось проверить роль сотрудника");
  if (!staff?.active) redirect("/account?staffAccess=denied");
  if (!staff.mfa_passed) redirect("/staff-security");
  if (!allowedRoles.includes(staff.role)) redirect("/staff?error=forbidden");
  const email = typeof auth.claims.email === "string" ? auth.claims.email : "";
  const aal = auth.claims.aal;
  return { supabase, userId, staff, email, aal };
}

export async function requirePrimaryAdmin() {
  const context = await requireStaff(["admin"]);
  if (!context.staff.is_primary_admin) redirect("/staff?error=forbidden");
  return context;
}
