import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, validateSessionToken } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  if (!process.env.SITE_PASSWORD) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (token && (await validateSessionToken(token))) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  const from = request.nextUrl.pathname;
  if (from && from !== "/") {
    loginUrl.searchParams.set("from", from);
  }

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!login|api/auth|api/webhooks|_next|favicon\\.ico|icon|apple-icon).*)",
  ],
};
