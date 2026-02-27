import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { validateFirmApiKey } from "@/lib/auth";
import { db } from "@/lib/db";
import { channels, channelResults } from "@/lib/schema";
import { checkRateLimit } from "@/lib/rate-limit";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const start = Date.now();
  const { id } = await params;

  const firm = await validateFirmApiKey(request);
  if (!firm) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit: 120 requests per minute per firm
  const rateLimit = await checkRateLimit(firm.id, "GET /api/channels/:id", 120, 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } }
    );
  }

  const [channel] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.id, id), eq(channels.firmId, firm.id)));

  if (!channel) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Compute effective status at read time
  let effectiveStatus = channel.status;
  if (effectiveStatus === "pending" && new Date(channel.expiresAt) < new Date()) {
    effectiveStatus = "expired";
  }

  let accounts = null;
  if (effectiveStatus === "completed") {
    const results = await db
      .select()
      .from(channelResults)
      .where(eq(channelResults.channelId, channel.id));

    accounts = results.map((r) => ({
      provider_account_id: r.providerAccountId,
      account_metadata: r.accountMetadata,
    }));
  }

  console.log(
    JSON.stringify({
      endpoint: "GET /api/channels/:id",
      firm_id: firm.id,
      channel_id: id,
      status: 200,
      duration: Date.now() - start,
    })
  );

  return NextResponse.json({
    id: channel.id,
    token: channel.token,
    provider: channel.provider,
    status: effectiveStatus,
    client_ref: channel.clientRef,
    consent: channel.consent,
    expires_at: channel.expiresAt,
    created_at: channel.createdAt,
    accounts,
  });
}
