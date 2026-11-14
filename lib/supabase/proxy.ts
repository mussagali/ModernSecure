import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub && /^\/(?:account|account-security|staff|staff-security)(?:\/|$)/.test(request.nextUrl.pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    const loginResponse = NextResponse.redirect(loginUrl);
    response.cookies.getAll().forEach((cookie) => loginResponse.cookies.set(cookie));
    return loginResponse;
  }
  // Auth can list the caller's factors before the database MFA gate opens.
  // Redirect HTML workspace requests before their parallel server queries run.
  if (data?.claims?.sub && /^\/(?:account|consent)(?:\/|$)/.test(request.nextUrl.pathname) && data.claims.aal !== "aal2") {
    const { data: factors, error } = await supabase.auth.mfa.listFactors();
    if (error?.code === "user_not_found") {
      const recoveryUrl = request.nextUrl.clone();
      recoveryUrl.pathname = "/auth/session-ended";
      recoveryUrl.search = "";
      const recoveryResponse = NextResponse.redirect(recoveryUrl);
      response.cookies.getAll().forEach(cookie => recoveryResponse.cookies.set(cookie));
      return recoveryResponse;
    }
    if (error) return new NextResponse("Не удалось проверить защиту входа. Повторите попытку.", { status: 503 });
    if (factors.all.some(factor => factor.status === "verified")) {
      const securityUrl = request.nextUrl.clone();
      securityUrl.pathname = "/account-security";
      securityUrl.search = "";
      const securityResponse = NextResponse.redirect(securityUrl);
      response.cookies.getAll().forEach(cookie => securityResponse.cookies.set(cookie));
      return securityResponse;
    }
  }
  return response;
}
