import Stripe from "stripe";
import type {
  Provider,
  ProviderSessionRequest,
  ProviderSessionResult,
  ProviderResultItem,
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

  async verifyAccount(
    credentials: Record<string, unknown>
  ): Promise<string> {
    const secretKey = credentials.secret_key as string;
    const stripe = new Stripe(secretKey);
    const account = await stripe.accounts.retrieve();
    return account.id;
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
