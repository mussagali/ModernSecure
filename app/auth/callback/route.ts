import { workspaceDestination } from "../../../lib/workspace-destination";
import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { getStaffStatus } from "../../../lib/staff";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login?error=invalid-link", url.origin));

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  // Email confirmation happens in Supabase before the user returns here. When
  // the link is opened in another browser (for example, Gmail's in-app
  // browser), that browser does not have the PKCE verifier cookie created at
  // registration. In that case only automatic sign-in fails; the email is
  // already confirmed, so do not tell the user that the link is invalid.
  if (error) return NextResponse.redirect(new URL("/login?notice=email-confirmed", url.origin));
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (userId) {
    const { error: inviteError } = await supabase.rpc("claim_staff_invite");
    if (inviteError) throw new Error("Не удалось принять приглашение");
    const { staff, error: staffError } = await getStaffStatus(supabase);
    if (staffError) throw new Error("Не удалось проверить доступ к личному кабинету");
    return NextResponse.redirect(new URL(workspaceDestination(staff), url.origin));
  }
  return NextResponse.redirect(new URL("/account", url.origin));
}
