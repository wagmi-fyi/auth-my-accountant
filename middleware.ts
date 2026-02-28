import { NextResponse } from "next/server";

export function middleware() {
  const response = NextResponse.next();
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com; style-src 'self' 'unsafe-inline'; frame-src https://js.stripe.com; img-src 'self' data:; font-src 'self' data:;"
  );
  return response;
}

export const config = {
  matcher: ["/c/:path*", "/b/:path*"],
};
