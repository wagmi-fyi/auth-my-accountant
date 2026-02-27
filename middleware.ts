import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware() {
  const response = NextResponse.next();
  return response;
}

export const config = {
  matcher: "/c/:path*",
};
