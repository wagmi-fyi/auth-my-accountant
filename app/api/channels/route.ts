import { NextResponse } from "next/server";
import { validateFirmApiKey, generateChannelToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { channels, firms } from "@/lib/schema";
import { createChannelSchema } from "@/lib/validation";
import { getProvider } from "@/lib/providers";
import { checkRateLimit } from "@/lib/rate-limit";
import { eq } from "drizzle-orm";

export async function POST(request: Request) {
  const start = Date.now();

  const firm = await validateFirmApiKey(request);
  if (!firm) {
    console.error(
      JSON.stringify({
        endpoint: "POST /api/channels",
        status: 401,
        duration: Date.now() - start,
      })
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit: 30 requests per minute per firm
  const rateLimit = await checkRateLimit(firm.id, "POST /api/channels", 30, 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } }
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

  const parsed = createChannelSchema.safeParse(body);
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
          endpoint: "POST /api/channels",
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

  let sessionResult;
  try {
    sessionResult = await provider.createSession(
      {
        provider_config: data.provider_config,
        consent: data.consent,
      },
      data.credentials
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        endpoint: "POST /api/channels",
        firm_id: firm.id,
        error: err instanceof Error ? err.message : "Provider session failed",
        status: 502,
        duration: Date.now() - start,
      })
    );
    return NextResponse.json(
      { error: "Provider session creation failed" },
      { status: 502 }
    );
  }

  const token = generateChannelToken();
  const expiresAt = new Date(
    Date.now() + data.expires_in_hours * 60 * 60 * 1000
  );
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  const [channel] = await db
    .insert(channels)
    .values({
      firmId: firm.id,
      token,
      provider: data.provider,
      providerSessionId: sessionResult.session_id,
      providerClientSecret: sessionResult.client_secret,
      providerPublishableKey: sessionResult.publishable_key ?? null,
      providerConfig: data.provider_config,
      consent: data.consent,
      clientRef: data.client_ref ?? null,
      expiresAt,
    })
    .returning({ id: channels.id });

  console.log(
    JSON.stringify({
      endpoint: "POST /api/channels",
      firm_id: firm.id,
      channel_id: channel.id,
      provider: data.provider,
      status: 201,
      duration: Date.now() - start,
    })
  );

  return NextResponse.json(
    {
      id: channel.id,
      token,
      url: `${baseUrl}/c/${token}`,
      status: "pending",
      expires_at: expiresAt.toISOString(),
    },
    { status: 201 }
  );
}
