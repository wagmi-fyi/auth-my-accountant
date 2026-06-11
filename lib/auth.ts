import crypto from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "./db";
import { firms } from "./schema";

const API_KEY_PREFIX = "acp_";
const API_KEY_BYTES = 32;
const CHANNEL_TOKEN_BYTES = 18; // 24 base64url chars

export function generateApiKey(): string {
  return API_KEY_PREFIX + crypto.randomBytes(API_KEY_BYTES).toString("hex");
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export async function validateFirmApiKey(
  request: Request
): Promise<{ id: string; name: string; status: string } | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const key = authHeader.slice(7);
  const keyHash = hashApiKey(key);

  const [firm] = await db
    .select()
    .from(firms)
    .where(and(eq(firms.apiKeyHash, keyHash), eq(firms.status, "active")));

  if (!firm) return null;

  return { id: firm.id, name: firm.name, status: firm.status };
}

export function validateAdminKey(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;

  const key = authHeader.slice(7);
  // trim(): env values set via dashboard/CLI have shipped with trailing newlines,
  // which make header-based comparison unsatisfiable (2026-06-10 incident)
  const adminKey = process.env.ADMIN_API_KEY?.trim();
  if (!adminKey) return false;

  const keyBuffer = Buffer.from(key);
  const adminBuffer = Buffer.from(adminKey);
  if (keyBuffer.length !== adminBuffer.length) return false;

  return crypto.timingSafeEqual(keyBuffer, adminBuffer);
}

export function generateChannelToken(): string {
  return crypto.randomBytes(CHANNEL_TOKEN_BYTES).toString("base64url");
}

export function validateOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!origin || !appUrl) return false;
  return origin === appUrl;
}
