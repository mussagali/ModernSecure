import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { getStaffStatus } from "../../../lib/staff";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login?error=invalid-link", url.origin));

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=invalid-link", url.origin));
  const { error: inviteError } = await supabase.rpc("claim_staff_invite");
  if (inviteError) return NextResponse.redirect(new URL("/account?inviteError=1", url.origin));
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (userId) {
    const { staff, error: staffError } = await getStaffStatus(supabase);
    if (staffError) return NextResponse.redirect(new URL("/account?staffLookupError=1", url.origin));
    if (staff?.active) return NextResponse.redirect(new URL(staff.mfa_passed ? "/staff" : "/staff-security", url.origin));
  }
  return NextResponse.redirect(new URL("/account", url.origin));
}
