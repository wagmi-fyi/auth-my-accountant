import { NextResponse } from "next/server";
import { validateFirmApiKey, generateChannelToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { bundles, firms } from "@/lib/schema";
import { createBundleSchema } from "@/lib/validation";
import { getProvider } from "@/lib/providers";
import { checkRateLimit } from "@/lib/rate-limit";
import { eq } from "drizzle-orm";

interface SessionEntry {
  session_id: string;
  client_secret: string;
  status: "pending" | "completed";
  accounts: unknown[];
}

export async function POST(request: Request) {
  const start = Date.now();

  const firm = await validateFirmApiKey(request);
  if (!firm) {
    console.error(
      JSON.stringify({
        endpoint: "POST /api/bundles",
        status: 401,
        duration: Date.now() - start,
      })
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit: 10 requests per minute per firm
  const rateLimit = await checkRateLimit(firm.id, "POST /api/bundles", 10, 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfter) },
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = createBundleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const provider = getProvider(data.provider);
  if (!provider) {
    return NextResponse.json(
      { error: `Unknown provider: ${data.provider}` },
      { status: 400 }
    );
  }

  // Stripe account pinning: verify credentials match registered account
  const [firmRecord] = await db
    .select({ stripeAccountId: firms.stripeAccountId })
    .from(firms)
    .where(eq(firms.id, firm.id));

  if (firmRecord?.stripeAccountId) {
    try {
      const accountId = await provider.verifyAccount(data.credentials);
      if (accountId !== firmRecord.stripeAccountId) {
        return NextResponse.json(
          { error: "Stripe account does not match registered account" },
          { status: 403 }
        );
      }
    } catch {
      console.error(
        JSON.stringify({
          endpoint: "POST /api/bundles",
          firm_id: firm.id,
          error: "Account verification failed",
          status: 403,
          duration: Date.now() - start,
        })
      );
      return NextResponse.json(
        { error: "Failed to verify Stripe account ownership" },
        { status: 403 }
      );
    }
  }

  // Create session 0 first (creates Stripe customer if needed)
  let firstSessionResult;
  try {
    firstSessionResult = await provider.createSession(
      {
        provider_config: data.provider_config,
        consent: data.consent,
      },
      data.credentials
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        endpoint: "POST /api/bundles",
        firm_id: firm.id,
        error:
          err instanceof Error ? err.message : "Provider session failed",
        status: 502,
        duration: Date.now() - start,
      })
    );
    return NextResponse.json(
      { error: "Provider session creation failed" },
      { status: 502 }
    );
  }

  const customerId = (
    firstSessionResult.provider_data as { customer_id?: string } | undefined
  )?.customer_id;

  const sessions: SessionEntry[] = [
    {
      session_id: firstSessionResult.session_id,
      client_secret: firstSessionResult.client_secret,
      status: "pending",
      accounts: [],
    },
  ];

  // Create remaining sessions in parallel (reuse customer_id)
  if (data.max_sessions > 1) {
    const configWithCustomer = {
      ...data.provider_config,
      customer_id: customerId || data.provider_config.customer_id,
    };

    try {
      const remainingResults = await Promise.all(
        Array.from({ length: data.max_sessions - 1 }, () =>
          provider.createSession(
            {
              provider_config: configWithCustomer,
              consent: data.consent,
            },
            data.credentials
          )
        )
      );

      for (const result of remainingResults) {
        sessions.push({
          session_id: result.session_id,
          client_secret: result.client_secret,
          status: "pending",
          accounts: [],
        });
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          endpoint: "POST /api/bundles",
          firm_id: firm.id,
          error:
            err instanceof Error
              ? err.message
              : "Parallel session creation failed",
          sessions_created: sessions.length,
          sessions_requested: data.max_sessions,
          status: 502,
          duration: Date.now() - start,
        })
      );
      return NextResponse.json(
        { error: "Provider session creation failed" },
        { status: 502 }
      );
    }
  }

  const token = generateChannelToken();
  const expiresAt = new Date(
    Date.now() + data.expires_in_hours * 60 * 60 * 1000
  );
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  const [bundle] = await db
    .insert(bundles)
    .values({
      firmId: firm.id,
      token,
      provider: data.provider,
      providerPublishableKey: firstSessionResult.publishable_key ?? null,
      providerConfig: data.provider_config,
      consent: data.consent,
      clientRef: data.client_ref ?? null,
      maxSessions: data.max_sessions,
      sessions,
      expiresAt,
    })
    .returning({ id: bundles.id });

  console.log(
    JSON.stringify({
      endpoint: "POST /api/bundles",
      firm_id: firm.id,
      bundle_id: bundle.id,
      provider: data.provider,
      max_sessions: data.max_sessions,
      status: 201,
      duration: Date.now() - start,
    })
  );

  return NextResponse.json(
    {
      id: bundle.id,
      token,
      url: `${baseUrl}/b/${token}`,
      status: "pending",
      max_sessions: data.max_sessions,
      expires_at: expiresAt.toISOString(),
    },
    { status: 201 }
  );
}
