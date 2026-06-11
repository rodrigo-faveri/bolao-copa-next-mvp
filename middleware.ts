import { NextRequest, NextResponse } from "next/server";

const sessionCookieNames = ["authjs.session-token", "__Secure-authjs.session-token"];
const protectedPathPrefixes = ["/bolao", "/ranking", "/admin"];

function shouldForceHttps(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") return false;
  if (process.env.ENFORCE_HTTPS === "false") return false;

  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) return forwardedProto === "http";
  return request.nextUrl.protocol === "http:";
}

export function middleware(request: NextRequest) {
  if (shouldForceHttps(request)) {
    const httpsUrl = request.nextUrl.clone();
    httpsUrl.protocol = "https:";
    return NextResponse.redirect(httpsUrl, 308);
  }

  const isProtectedPath = protectedPathPrefixes.some((path) => request.nextUrl.pathname === path || request.nextUrl.pathname.startsWith(`${path}/`));
  if (!isProtectedPath) return NextResponse.next();

  const hasSessionCookie = sessionCookieNames.some((name) => request.cookies.has(name));

  if (!hasSessionCookie) {
    const loginUrl = new URL("/", request.url);
    loginUrl.searchParams.set("login", "required");
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
