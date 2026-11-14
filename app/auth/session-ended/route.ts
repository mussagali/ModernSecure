import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

// Server Components cannot clear cookies. Confirm revocation here before
// clearing a local session; visiting this URL must not log out an active user.
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return NextResponse.redirect(new URL("/login", origin));
  const { error } = await supabase.rpc("account_access_status");
  if (error?.code === "ACCOUNT_REMOVED") {
    await supabase.auth.signOut({ scope: "local" });
    return NextResponse.redirect(new URL("/login?notice=session-ended", origin));
  }
  if (error) return new NextResponse("Не удалось проверить сеанс. Обновите страницу позже.", { status: 503 });
  return NextResponse.redirect(new URL("/login", origin));
}
