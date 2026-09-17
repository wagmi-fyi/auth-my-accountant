import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { firmProviderBindings } from "./schema";
import { getProvider } from "./providers";
import type { Provider } from "./providers/types";
import { messages } from "./messages";

// Provider error text can quote a masked key. Nothing key-shaped is logged.
function scrub(text: string): string {
  return text.replace(/\b[a-z]{2,4}_(live|test)_\S*/gi, "<key>");
}

export type BindingOutcome =
  | { refusal: NextResponse }
  // The name to show on this link's page: set only when the link's own
  // credentials named the bound account and the provider verified a name.
  | { refusal: null; verifiedName: string | null };

// Checks the credentials on a link request against the account the firm is
// bound to for this provider, and binds the firm on its first link.
//
// Credentials that cannot name their account leave any binding alone and
// the link goes through, bound firm or not, so a key without the permission
// to look never stops a working firm. Such a link shows no verified name,
// because nothing ties it to the bound account.
export async function checkProviderBinding(
  firmId: string,
  provider: Provider,
  credentials: Record<string, unknown>,
  endpoint: string,
  start: number
): Promise<BindingOutcome> {
  let identity;
  try {
    identity = await provider.identifyAccount(credentials);
  } catch (err) {
    console.error(
      JSON.stringify({
        endpoint,
        firm_id: firmId,
        result: "provider_identify_failed",
        error: scrub(err instanceof Error ? err.message : String(err)),
        status: 502,
        duration: Date.now() - start,
      })
    );
    return {
      refusal: NextResponse.json(
        {
          error: messages.providerIdentifyFailed(provider.displayName),
          code: "provider_identify_failed",
        },
        { status: 502 }
      ),
    };
  }

  if (!identity) return { refusal: null, verifiedName: null };

  // One statement: insert the binding, or read the one that exists. A
  // matching account refreshes the verified name.
  const matches = sql`${firmProviderBindings.accountRef} = excluded.account_ref`;
  const [bound] = await db
    .insert(firmProviderBindings)
    .values({
      firmId,
      provider: provider.name,
      accountRef: identity.accountRef,
      verifiedName: identity.verifiedName ?? null,
    })
    .onConflictDoUpdate({
      target: [firmProviderBindings.firmId, firmProviderBindings.provider],
      set: {
        verifiedName: sql`CASE WHEN ${matches} THEN COALESCE(excluded.verified_name, ${firmProviderBindings.verifiedName}) ELSE ${firmProviderBindings.verifiedName} END`,
        updatedAt: sql`CASE WHEN ${matches} THEN now() ELSE ${firmProviderBindings.updatedAt} END`,
      },
    })
    .returning({
      accountRef: firmProviderBindings.accountRef,
      verifiedName: firmProviderBindings.verifiedName,
    });

  if (bound.accountRef !== identity.accountRef) {
    console.error(
      JSON.stringify({
        endpoint,
        firm_id: firmId,
        result: "provider_account_mismatch",
        status: 403,
        duration: Date.now() - start,
      })
    );
    return {
      refusal: NextResponse.json(
        {
          error: messages.providerAccountMismatch(provider.displayName),
          code: "provider_account_mismatch",
        },
        { status: 403 }
      ),
    };
  }

  return { refusal: null, verifiedName: bound.verifiedName };
}

// The line a client's link page shows under the firm's name, or null.
export function verifiedLineFor(
  providerName: string,
  verifiedName: string | null
): string | null {
  const provider = getProvider(providerName);
  if (!provider || !verifiedName) return null;
  return messages.verifiedLine(provider.displayName, verifiedName);
}
