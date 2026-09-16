import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const REFRESH_COOKIE = "gmov_refresh";

export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has(REFRESH_COOKIE);
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/me/:path*", "/admin/:path*"],
};
