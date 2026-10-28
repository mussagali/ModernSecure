import { NextResponse, type NextRequest } from "next/server";
import { isStaffOnlyPath, staffWorkspaceEnabled } from "./lib/application-scope";
import { updateSession } from "./lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  if (!staffWorkspaceEnabled && isStaffOnlyPath(request.nextUrl.pathname)) {
    return new NextResponse("Not found", { status: 404 });
  }
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|downloads/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
