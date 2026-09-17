import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { rateLimits } from "./schema";
import { windowStartFor } from "./rate-limit";

export const SIGNUP_ENDPOINT = "POST /api/signup";
// The daily cap is counted in rate_limits under this identifier and endpoint.
export const DAILY_CAP_IDENTIFIER = "all";
export const DAILY_CAP_ENDPOINT = "POST /api/signup daily";
export const DAY_SECONDS = 86400;
export const HOUR_SECONDS = 3600;

function intSetting(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function signupPerAddressHourly(): number {
  return intSetting("SIGNUP_PER_ADDRESS_HOURLY", 3);
}

export function signupDailyCap(): number {
  return intSetting("SIGNUP_DAILY_CAP", 20);
}

// The caller's address, keyed with the admin key so the stored value cannot
// be reversed by trying every address. Vercel sets x-real-ip itself.
export function callerId(request: Request): string {
  const address =
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const key = process.env.ADMIN_API_KEY?.trim() || "no-admin-key";
  return crypto.createHmac("sha256", key).update(address).digest("hex");
}

// Sign-ups counted on the UTC day that holds `day`.
export async function signupsCountedOn(day: Date): Promise<number> {
  const [row] = await db
    .select({ count: rateLimits.requestCount })
    .from(rateLimits)
    .where(
      and(
        eq(rateLimits.identifier, DAILY_CAP_IDENTIFIER),
        eq(rateLimits.endpoint, DAILY_CAP_ENDPOINT),
        eq(rateLimits.windowStart, windowStartFor(day, DAY_SECONDS))
      )
    );
  return row?.count ?? 0;
}
