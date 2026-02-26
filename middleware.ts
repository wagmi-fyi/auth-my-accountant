import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/c/")) {
    response.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' https://js.stripe.com; frame-src https://js.stripe.com;"
    );
  }

  return response;
}

export const config = {
  matcher: "/c/:path*",
};
