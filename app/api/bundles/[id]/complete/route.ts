import crypto from "crypto";
import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { validateOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
import { bundles } from "@/lib/schema";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const start = Date.now();
  const { id } = await params;

  // Origin validation
  if (!validateOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Rate limit: 5 requests per minute per bundle
  const rateLimit = await checkRateLimit(
    id,
    "POST /api/bundles/:id/complete",
    5,
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

  // Already completed — idempotent
  if (bundle.status === "completed") {
    return NextResponse.json({ success: true });
  }

  // Must be active (at least one session completed)
  if (bundle.status === "pending") {
    return NextResponse.json(
      { error: "No accounts connected yet" },
      { status: 400 }
    );
  }

  // CAS: only transition active → completed
  const [updated] = await db
    .update(bundles)
    .set({ status: "completed" })
    .where(and(eq(bundles.id, id), eq(bundles.status, "active")))
    .returning({ id: bundles.id });

  if (!updated) {
    // Race condition — another request completed it first
    return NextResponse.json({ success: true });
  }

  console.log(
    JSON.stringify({
      endpoint: "POST /api/bundles/:id/complete",
      bundle_id: id,
      firm_id: bundle.firmId,
      status: 200,
      duration: Date.now() - start,
    })
  );

  return NextResponse.json({ success: true });
}
