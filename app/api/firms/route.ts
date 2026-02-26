import { NextResponse } from "next/server";
import { validateAdminKey, generateApiKey, hashApiKey } from "@/lib/auth";
import { db } from "@/lib/db";
import { firms } from "@/lib/schema";
import { createFirmSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const start = Date.now();

  if (!validateAdminKey(request)) {
    console.error(
      JSON.stringify({
        endpoint: "POST /api/firms",
        status: 401,
        duration: Date.now() - start,
      })
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const parsed = createFirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);

  const [firm] = await db
    .insert(firms)
    .values({
      name: parsed.data.name,
      apiKeyHash,
    })
    .returning({ id: firms.id, name: firms.name });

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
