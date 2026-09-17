import Stripe from "stripe";
import type {
  Provider,
  ProviderSessionRequest,
  ProviderSessionResult,
  ProviderResultItem,
  ProviderAccountIdentity,
} from "./types";

interface StripeAccount {
  id: string;
  institution_name?: string;
  last4?: string;
  category?: string;
  subcategory?: string;
  display_name?: string | null;
  status?: string;
}

export const stripeFcProvider: Provider = {
  name: "stripe_fc",
  displayName: "Stripe",

  async createSession(
    config: ProviderSessionRequest,
    credentials: Record<string, unknown>
  ): Promise<ProviderSessionResult> {
    const secretKey = credentials.secret_key as string;
    const publishableKey = credentials.publishable_key as string;

    const stripe = new Stripe(secretKey);

    const providerConfig = config.provider_config as {
      permissions: string[];
      prefetch?: string[];
      customer_id?: string;
    };

    let customerId = providerConfig.customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        name: `${config.consent.firm_name} client`,
      });
      customerId = customer.id;
    }

    const sessionParams: Stripe.FinancialConnections.SessionCreateParams = {
      account_holder: {
        type: "customer",
        customer: customerId,
      },
      permissions:
        providerConfig.permissions as Stripe.FinancialConnections.SessionCreateParams.Permission[],
    };

    if (providerConfig.prefetch) {
      sessionParams.prefetch =
        providerConfig.prefetch as Stripe.FinancialConnections.SessionCreateParams.Prefetch[];
    }

    const session =
      await stripe.financialConnections.sessions.create(sessionParams);

    return {
      session_id: session.id,
      client_secret: session.client_secret!,
      publishable_key: publishableKey,
      provider_data: { customer_id: customerId },
    };
  },

  async identifyAccount(
    credentials: Record<string, unknown>
  ): Promise<ProviderAccountIdentity | null> {
    const secretKey = credentials.secret_key as string;
    const stripe = new Stripe(secretKey);
    let account;
    try {
      account = await stripe.accounts.retrieve();
    } catch (err) {
      // A restricted key without Accounts: Read cannot see its own account.
      // Links still work for it; the firm is just not bound.
      if ((err as { code?: string }).code === "more_permissions_required") {
        return null;
      }
      throw err;
    }
    // A test account's name is whatever was typed in, so only a live key
    // reports a verified name.
    const live = /^(sk|rk)_live_/.test(secretKey);
    const companyName = account.company?.name?.trim();
    return {
      accountRef: account.id,
      verifiedName: live && companyName ? companyName : undefined,
    };
  },

  validateResults(raw: unknown): ProviderResultItem[] {
    if (!Array.isArray(raw)) {
      throw new Error("Expected array of account objects");
    }

    return raw.map((account: unknown, idx: number) => {
      if (
        typeof account !== "object" ||
        account === null ||
        typeof (account as Record<string, unknown>).id !== "string" ||
        !(account as Record<string, unknown>).id
      ) {
        throw new Error(
          `Invalid account at index ${idx}: missing or invalid 'id'`
        );
      }

      const a = account as StripeAccount;

      return {
        provider_account_id: a.id,
        account_metadata: {
          institution_name: a.institution_name,
          last4: a.last4,
          category: a.category,
          subcategory: a.subcategory,
          display_name: a.display_name,
          status: a.status,
        },
      };
    });
  },
};
