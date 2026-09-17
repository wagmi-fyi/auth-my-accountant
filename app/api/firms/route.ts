import crypto from "crypto";
import { NextResponse } from "next/server";
import { asc, gte, inArray } from "drizzle-orm";
import { validateAdminKey, generateApiKey, hashApiKey } from "@/lib/auth";
import { db } from "@/lib/db";
import { firms, firmProviderBindings } from "@/lib/schema";
import { createFirmSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { signupDailyCap, signupsCountedOn } from "@/lib/signup";

function unauthorized(endpoint: string, start: number) {
  console.error(
    JSON.stringify({ endpoint, status: 401, duration: Date.now() - start })
  );
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function tooMany(retryAfter?: number) {
  return NextResponse.json(
    { error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}

export async function POST(request: Request) {
  const start = Date.now();

  if (!validateAdminKey(request)) {
    return unauthorized("POST /api/firms", start);
  }

  // Rate limit: 10 requests per minute for admin endpoint
  const rateLimit = await checkRateLimit("admin", "POST /api/firms", 10, 60);
  if (!rateLimit.allowed) return tooMany(rateLimit.retryAfter);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = createFirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const apiKey = generateApiKey();
  const firmId = crypto.randomUUID();
  const { name, bind } = parsed.data;

  const insertFirm = db
    .insert(firms)
    .values({ id: firmId, name, apiKeyHash: hashApiKey(apiKey) })
    .returning({ id: firms.id, name: firms.name });

  let firm;
  if (bind) {
    [[firm]] = await db.batch([
      insertFirm,
      db.insert(firmProviderBindings).values({
        firmId,
        provider: bind.provider,
        accountRef: bind.account_ref,
      }),
    ]);
  } else {
    [firm] = await insertFirm;
  }

  console.log(
    JSON.stringify({
      endpoint: "POST /api/firms",
      firm_id: firm.id,
      status: 201,
      duration: Date.now() - start,
    })
  );

  return NextResponse.json(
    { id: firm.id, name: firm.name, api_key: apiKey },
    { status: 201 }
  );
}

// The daily digest: firms made since a time, and the sign-up cap for a day.
//   since  ISO time, default 24 hours ago
//   day    YYYY-MM-DD (UTC) for the cap figures, default today
export async function GET(request: Request) {
  const start = Date.now();

  if (!validateAdminKey(request)) {
    return unauthorized("GET /api/firms", start);
  }

  const rateLimit = await checkRateLimit("admin", "GET /api/firms", 30, 60);
  if (!rateLimit.allowed) return tooMany(rateLimit.retryAfter);

  const params = new URL(request.url).searchParams;
  const until = new Date();
  const since = params.has("since")
    ? new Date(params.get("since")!)
    : new Date(until.getTime() - 24 * 60 * 60 * 1000);
  const dayParam = params.get("day");
  const day = dayParam ? new Date(`${dayParam}T00:00:00Z`) : until;
  if (
    Number.isNaN(since.getTime()) ||
    Number.isNaN(day.getTime()) ||
    (dayParam !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dayParam))
  ) {
    return NextResponse.json(
      { error: "since must be a time and day must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const made = await db
    .select({
      id: firms.id,
      name: firms.name,
      status: firms.status,
      createdAt: firms.createdAt,
    })
    .from(firms)
    .where(gte(firms.createdAt, since))
    .orderBy(asc(firms.createdAt));

  const bindings = made.length
    ? await db
        .select({
          firmId: firmProviderBindings.firmId,
          provider: firmProviderBindings.provider,
          accountRef: firmProviderBindings.accountRef,
          verifiedName: firmProviderBindings.verifiedName,
        })
        .from(firmProviderBindings)
        .where(
          inArray(
            firmProviderBindings.firmId,
            made.map((f) => f.id)
          )
        )
    : [];

  const cap = signupDailyCap();
  const counted = await signupsCountedOn(day);

  console.log(
    JSON.stringify({
      endpoint: "GET /api/firms",
      firms: made.length,
      status: 200,
      duration: Date.now() - start,
    })
  );

  return NextResponse.json({
    since: since.toISOString(),
    until: until.toISOString(),
    firms: made.map((f) => ({
      id: f.id,
      name: f.name,
      status: f.status,
      created_at: f.createdAt.toISOString(),
      bindings: bindings
        .filter((b) => b.firmId === f.id)
        .map((b) => ({
          provider: b.provider,
          account_ref: b.accountRef,
          verified_name: b.verifiedName,
        })),
    })),
    signup_cap: {
      day: day.toISOString().slice(0, 10),
      daily_cap: cap,
      signups: Math.min(counted, cap),
      cap_reached: counted > cap,
      refused_over_cap: Math.max(0, counted - cap),
    },
  });
}
