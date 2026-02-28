import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { validateFirmApiKey } from "@/lib/auth";
import { db } from "@/lib/db";
import { bundles } from "@/lib/schema";
import { checkRateLimit } from "@/lib/rate-limit";

interface SessionEntry {
  session_id: string;
  client_secret: string;
  status: string;
  accounts: {
    provider_account_id: string;
    account_metadata: Record<string, unknown>;
  }[];
}

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
  const rateLimit = await checkRateLimit(
    firm.id,
    "GET /api/bundles/:id",
    120,
    60
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfter) },
      }
    );
  }

  const [bundle] = await db
    .select()
    .from(bundles)
    .where(and(eq(bundles.id, id), eq(bundles.firmId, firm.id)));

  if (!bundle) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sessions = bundle.sessions as SessionEntry[];

  // Compute effective status at read time
  let effectiveStatus = bundle.status;
  if (
    (effectiveStatus === "pending" || effectiveStatus === "active") &&
    new Date(bundle.expiresAt) < new Date()
  ) {
    effectiveStatus = "expired";
  }

  // Always aggregate accounts from completed sessions — never null
  const sessionsCompleted = sessions.filter(
    (s) => s.status === "completed"
  ).length;

  const accounts = sessions.flatMap((s, index) =>
    s.status === "completed"
      ? s.accounts.map((a) => ({
          provider_account_id: a.provider_account_id,
          account_metadata: a.account_metadata,
          session_index: index,
        }))
      : []
  );

  console.log(
    JSON.stringify({
      endpoint: "GET /api/bundles/:id",
      firm_id: firm.id,
      bundle_id: id,
      status: 200,
      duration: Date.now() - start,
    })
  );

  return NextResponse.json({
    id: bundle.id,
    token: bundle.token,
    provider: bundle.provider,
    status: effectiveStatus,
    client_ref: bundle.clientRef,
    consent: bundle.consent,
    max_sessions: bundle.maxSessions,
    sessions_completed: sessionsCompleted,
    sessions_total: sessions.length,
    expires_at: bundle.expiresAt,
    created_at: bundle.createdAt,
    accounts,
  });
}
