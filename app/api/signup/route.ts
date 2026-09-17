import { NextResponse } from "next/server";
import { generateApiKey, hashApiKey } from "@/lib/auth";
import { db } from "@/lib/db";
import { firms } from "@/lib/schema";
import { signupSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { messages } from "@/lib/messages";
import {
  SIGNUP_ENDPOINT,
  DAILY_CAP_IDENTIFIER,
  DAILY_CAP_ENDPOINT,
  DAY_SECONDS,
  HOUR_SECONDS,
  callerId,
  signupDailyCap,
  signupPerAddressHourly,
} from "@/lib/signup";

const NO_STORE = { "Cache-Control": "no-store" };

function log(fields: Record<string, unknown>, start: number) {
  const line = JSON.stringify({
    endpoint: SIGNUP_ENDPOINT,
    ...fields,
    duration: Date.now() - start,
  });
  if ((fields.status as number) >= 400) console.error(line);
  else console.log(line);
}

// Public. Makes an active firm from a name and returns its key, once.
export async function POST(request: Request) {
  const start = Date.now();

  const perAddress = await checkRateLimit(
    callerId(request),
    SIGNUP_ENDPOINT,
    signupPerAddressHourly(),
    HOUR_SECONDS
  );
  if (!perAddress.allowed) {
    const retryAfter = perAddress.retryAfter ?? HOUR_SECONDS;
    log({ result: "rate_limited", status: 429 }, start);
    return NextResponse.json(
      {
        error: messages.signupRateLimited(Math.ceil(retryAfter / 60)),
        code: "rate_limited",
      },
      {
        status: 429,
        headers: { ...NO_STORE, "Retry-After": String(retryAfter) },
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: NO_STORE }
    );
  }

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400, headers: NO_STORE }
    );
  }

  const cap = signupDailyCap();
  const daily = await checkRateLimit(
    DAILY_CAP_IDENTIFIER,
    DAILY_CAP_ENDPOINT,
    cap,
    DAY_SECONDS
  );
  if (!daily.allowed) {
    // The first refusal of the day carries the alert. The digest reports it.
    log(
      {
        result: "daily_cap_reached",
        ...(daily.count === cap + 1
          ? { alert: "signup_daily_cap_reached", daily_cap: cap }
          : {}),
        status: 429,
      },
      start
    );
    return NextResponse.json(
      { error: messages.signupDailyCap, code: "daily_cap_reached" },
      {
        status: 429,
        headers: { ...NO_STORE, "Retry-After": String(daily.retryAfter) },
      }
    );
  }

  const apiKey = generateApiKey();
  const [firm] = await db
    .insert(firms)
    .values({ name: parsed.data.name, apiKeyHash: hashApiKey(apiKey) })
    .returning({ id: firms.id, name: firms.name });

  log({ result: "created", firm_id: firm.id, status: 201 }, start);

  return NextResponse.json(
    { id: firm.id, name: firm.name, api_key: apiKey },
    { status: 201, headers: NO_STORE }
  );
}
