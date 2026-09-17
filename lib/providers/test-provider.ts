import crypto from "crypto";
import type {
  Provider,
  ProviderSessionRequest,
  ProviderSessionResult,
  ProviderResultItem,
  ProviderAccountIdentity,
} from "./types";

// A provider for local tests. It calls nothing. The credentials steer it:
//   secret_key       the account reference; "unknown" makes identifyAccount
//                    answer null, as a key without permission does; "fail"
//                    makes it throw
//   publishable_key  the verified name; "none" means no name
// It is registered only outside production builds, and only when
// AMA_ENABLE_TEST_PROVIDER=1.
export const testProvider: Provider = {
  name: "test",
  displayName: "Test",

  async createSession(
    _config: ProviderSessionRequest,
    credentials: Record<string, unknown>
  ): Promise<ProviderSessionResult> {
    return {
      session_id: `test_sess_${crypto.randomBytes(6).toString("hex")}`,
      client_secret: `test_secret_${crypto.randomBytes(6).toString("hex")}`,
      publishable_key: credentials.publishable_key as string,
    };
  },

  async identifyAccount(
    credentials: Record<string, unknown>
  ): Promise<ProviderAccountIdentity | null> {
    const ref = credentials.secret_key as string;
    if (ref === "unknown") return null;
    if (ref === "fail") throw new Error("test provider refused");
    const name = credentials.publishable_key as string;
    return {
      accountRef: ref,
      verifiedName: name && name !== "none" ? name : undefined,
    };
  },

  validateResults(raw: unknown): ProviderResultItem[] {
    if (!Array.isArray(raw)) {
      throw new Error("Expected array of account objects");
    }
    return raw.map((a: { id: string }) => ({
      provider_account_id: a.id,
      account_metadata: {},
    }));
  },
};
