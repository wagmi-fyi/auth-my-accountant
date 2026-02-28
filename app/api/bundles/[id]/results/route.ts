import crypto from "crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { validateOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
import { bundles } from "@/lib/schema";
import { submitBundleResultsSchema } from "@/lib/validation";
import { getProvider } from "@/lib/providers";
import { checkRateLimit } from "@/lib/rate-limit";

interface SessionEntry {
  session_id: string;
  client_secret: string;
  status: string;
  accounts: unknown[];
}

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
        endpoint: "POST /api/bundles/:id/results",
        bundle_id: id,
        error: "Origin validation failed",
        status: 403,
        duration: Date.now() - start,
      })
    );
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Rate limit: 10 requests per minute per bundle
  const rateLimit = await checkRateLimit(
    id,
    "POST /api/bundles/:id/results",
    10,
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

  // Bundle token auth via X-Bundle-Token header
  const bundleToken = request.headers.get("x-bundle-token");
  if (!bundleToken) {
    return NextResponse.json(
      { error: "Missing X-Bundle-Token header" },
      { status: 401 }
    );
  }

  // Look up bundle and verify token
  const [bundle] = await db
    .select()
    .from(bundles)
    .where(eq(bundles.id, id));

  const tokenBuffer = Buffer.from(bundleToken);
  const storedBuffer = Buffer.from(bundle?.token ?? "");
  const tokenMatch =
    bundle &&
    tokenBuffer.length === storedBuffer.length &&
    crypto.timingSafeEqual(tokenBuffer, storedBuffer);

  if (!bundle || !tokenMatch) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Check expiry
  if (new Date(bundle.expiresAt) < new Date()) {
    return NextResponse.json(
      { error: "Bundle expired" },
      { status: 410 }
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

  const parsed = submitBundleResultsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { session_index: sessionIndex, accounts } = parsed.data;
  const sessions = bundle.sessions as SessionEntry[];

  // Validate session_index is within bounds
  if (sessionIndex < 0 || sessionIndex >= sessions.length) {
    return NextResponse.json(
      { error: `Invalid session_index: ${sessionIndex}. Must be 0-${sessions.length - 1}` },
      { status: 400 }
    );
  }

  // Check session status
  if (sessions[sessionIndex].status === "completed") {
    return NextResponse.json(
      { error: "Session already completed" },
      { status: 409 }
    );
  }

  // Validate results through provider
  const provider = getProvider(bundle.provider);
  if (!provider) {
    return NextResponse.json(
      { error: "Unknown provider" },
      { status: 500 }
    );
  }

  const resultItems = provider.validateResults(accounts);

  // Atomic JSONB update with CAS and server-side auto-complete
  // JSONB path interpolation: paths must be string literals, not parameterized
  const statusPath = `{${sessionIndex},status}`;
  const accountsPath = `{${sessionIndex},accounts}`;
  const accountsJson = JSON.stringify(resultItems);

  const result = await db.execute(sql`
    UPDATE bundles
    SET
      sessions = jsonb_set(
        jsonb_set(sessions, ${statusPath}::text[], '"completed"'::jsonb),
        ${accountsPath}::text[], ${accountsJson}::jsonb
      ),
      status = CASE
        WHEN (
          SELECT bool_and(s->>'status' = 'completed')
          FROM jsonb_array_elements(
            jsonb_set(sessions, ${statusPath}::text[], '"completed"'::jsonb)
          ) AS s
        ) THEN 'completed'
        WHEN status = 'pending' THEN 'active'
        ELSE status
      END
    WHERE id = ${id}
      AND sessions->${sql.raw(String(sessionIndex))}->>'status' = 'pending'
    RETURNING id, status
  `);

  if (result.rows.length === 0) {
    return NextResponse.json(
      { error: "Session already completed" },
      { status: 409 }
    );
  }

  const updatedStatus = (result.rows[0] as { status: string }).status;

  // Compute sessions remaining
  const sessionsRemaining =
    updatedStatus === "completed"
      ? 0
      : sessions.filter(
          (s, i) => i !== sessionIndex && s.status === "pending"
        ).length;

  console.log(
    JSON.stringify({
      endpoint: "POST /api/bundles/:id/results",
      bundle_id: id,
      firm_id: bundle.firmId,
      session_index: sessionIndex,
      accounts_count: resultItems.length,
      sessions_remaining: sessionsRemaining,
      bundle_status: updatedStatus,
      status: 200,
      duration: Date.now() - start,
    })
  );

  return NextResponse.json({
    success: true,
    sessions_remaining: sessionsRemaining,
  });
}
