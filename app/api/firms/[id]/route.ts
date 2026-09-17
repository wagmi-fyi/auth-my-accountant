import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { validateAdminKey } from "@/lib/auth";
import { db } from "@/lib/db";
import { firms } from "@/lib/schema";
import { updateFirmSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";

const ENDPOINT = "PATCH /api/firms/:id";

// Suspends or reactivates a firm. Firm auth reads only active firms, so a
// suspended firm's key stops working at its next request.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const start = Date.now();

  if (!validateAdminKey(request)) {
    console.error(
      JSON.stringify({
        endpoint: ENDPOINT,
        status: 401,
        duration: Date.now() - start,
      })
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await checkRateLimit("admin", ENDPOINT, 10, 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } }
    );
  }

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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

  const parsed = updateFirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const [firm] = await db
    .update(firms)
    .set({ status: parsed.data.status })
    .where(eq(firms.id, id))
    .returning({ id: firms.id, name: firms.name, status: firms.status });

  if (!firm) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  console.log(
    JSON.stringify({
      endpoint: ENDPOINT,
      firm_id: firm.id,
      result: firm.status,
      status: 200,
      duration: Date.now() - start,
    })
  );

  return NextResponse.json(firm);
}
