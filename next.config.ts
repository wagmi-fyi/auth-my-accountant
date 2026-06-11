import type { NextConfig } from "next";

// Global security headers applied to every route (pages + API). The richer,
// Stripe-aware Content-Security-Policy for the account-connection pages lives
// in middleware.ts (scoped to /c and /b); these are the static headers that
// belong everywhere.
const securityHeaders = [
  // Clickjacking: nobody should frame our pages (CSP frame-ancestors is the
  // modern equivalent and is set in middleware for /c, /b).
  { key: "X-Frame-Options", value: "DENY" },
  // The client-side token rides in the URL path — never leak it via Referer
  // (e.g. to js.stripe.com or any external fetch the page makes).
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
