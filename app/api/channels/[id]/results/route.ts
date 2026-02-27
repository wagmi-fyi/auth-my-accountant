import crypto from "crypto";
import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { validateOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
import { channels, channelResults } from "@/lib/schema";
import { submitResultsSchema } from "@/lib/validation";
import { getProvider } from "@/lib/providers";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const start = Date.now();
  const { id } = await params;

  // Origin validation
  if (!validateOrigin(request)) {
    console.error(
      JSON.stringify({
        endpoint: "POST /api/channels/:id/results",
        channel_id: id,
        error: "Origin validation failed",
        status: 403,
        duration: Date.now() - start,
      })
    );
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Rate limit: 5 requests per minute per channel
  const rateLimit = await checkRateLimit(id, "POST /api/channels/:id/results", 5, 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } }
    );
  }

  // Channel token auth
  const channelToken = request.headers.get("x-channel-token");
  if (!channelToken) {
    return NextResponse.json(
      { error: "Missing X-Channel-Token header" },
      { status: 401 }
    );
  }

  // Look up channel and verify token
  const [channel] = await db
    .select()
    .from(channels)
    .where(eq(channels.id, id));

  const tokenBuffer = Buffer.from(channelToken);
  const storedBuffer = Buffer.from(channel?.token ?? "");
  const tokenMatch =
    channel &&
    tokenBuffer.length === storedBuffer.length &&
    crypto.timingSafeEqual(tokenBuffer, storedBuffer);

  if (!channel || !tokenMatch) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Check status and expiry
  if (channel.status === "completed") {
    return NextResponse.json(
      { error: "Channel already completed" },
      { status: 409 }
    );
  }

  if (new Date(channel.expiresAt) < new Date()) {
    return NextResponse.json(
      { error: "Channel expired" },
      { status: 410 }
    );
  }

  if (channel.status !== "pending") {
    return NextResponse.json(
      { error: `Invalid channel status: ${channel.status}` },
      { status: 400 }
    );
  }

  // Parse and validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = submitResultsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  // Validate results through provider
  const provider = getProvider(channel.provider);
  if (!provider) {
    return NextResponse.json(
      { error: "Unknown provider" },
      { status: 500 }
    );
  }

  const resultItems = provider.validateResults(parsed.data.accounts);

  // Atomic status transition — use .returning() to confirm the CAS succeeded
  const [updatedRow] = await db
    .update(channels)
    .set({ status: "completed" })
    .where(and(eq(channels.id, id), eq(channels.status, "pending")))
    .returning({ id: channels.id });

  if (!updatedRow) {
    return NextResponse.json(
      { error: "Channel already completed" },
      { status: 409 }
    );
  }

  // Batch insert results with conflict handling
  if (resultItems.length > 0) {
    await db
      .insert(channelResults)
      .values(
        resultItems.map((item) => ({
          channelId: channel.id,
          providerAccountId: item.provider_account_id,
          accountMetadata: item.account_metadata,
        }))
      )
      .onConflictDoNothing({
        target: [channelResults.channelId, channelResults.providerAccountId],
      });
  }

  console.log(
    JSON.stringify({
      endpoint: "POST /api/channels/:id/results",
      channel_id: id,
      firm_id: channel.firmId,
      accounts_count: resultItems.length,
      status: 200,
      duration: Date.now() - start,
    })
  );

  return NextResponse.json({ success: true });
}
