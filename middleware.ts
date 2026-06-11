import { NextRequest, NextResponse } from "next/server";

const sessionCookieNames = ["authjs.session-token", "__Secure-authjs.session-token"];

export function middleware(request: NextRequest) {
  const hasSessionCookie = sessionCookieNames.some((name) => request.cookies.has(name));

  if (!hasSessionCookie) {
    const loginUrl = new URL("/", request.url);
    loginUrl.searchParams.set("login", "required");
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/bolao/:path*", "/ranking/:path*", "/admin/:path*"],
};
