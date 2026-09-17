import { sql } from "drizzle-orm";
import { db } from "./db";
import { rateLimits } from "./schema";

interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
  // Requests counted in this window, this one included.
  count: number;
}

export async function checkRateLimit(
  identifier: string,
  endpoint: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = new Date();
  // Truncate to window boundary
  const windowMs = windowSeconds * 1000;
  const windowStart = windowStartFor(now, windowSeconds);

  // Atomic upsert: insert with count=1, or increment on conflict
  const [result] = await db
    .insert(rateLimits)
    .values({
      identifier,
      endpoint,
      windowStart,
      requestCount: 1,
    })
    .onConflictDoUpdate({
      target: [rateLimits.identifier, rateLimits.endpoint, rateLimits.windowStart],
      set: {
        requestCount: sql`${rateLimits.requestCount} + 1`,
      },
    })
    .returning({ requestCount: rateLimits.requestCount });

  if (result.requestCount > limit) {
    const windowEnd = new Date(windowStart.getTime() + windowMs);
    const retryAfter = Math.ceil((windowEnd.getTime() - now.getTime()) / 1000);
    return {
      allowed: false,
      retryAfter: Math.max(retryAfter, 1),
      count: result.requestCount,
    };
  }

  return { allowed: true, count: result.requestCount };
}

// The start of the window `windowSeconds` long that holds `at`.
export function windowStartFor(at: Date, windowSeconds: number): Date {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(at.getTime() / windowMs) * windowMs);
}
