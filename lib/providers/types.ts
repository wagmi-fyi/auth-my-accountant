export interface ConsentConfig {
  title: string;
  body: string;
  firm_name: string;
}

export interface ProviderSessionRequest {
  provider_config: Record<string, unknown>;
  consent: ConsentConfig;
}

export interface ProviderSessionResult {
  session_id: string;
  client_secret: string;
  publishable_key?: string;
  provider_data?: Record<string, unknown>;
}

export interface ProviderResultItem {
  provider_account_id: string;
  account_metadata: Record<string, unknown>;
}

export interface ProviderAccountIdentity {
  // Stable reference to the provider account the credentials belong to.
  accountRef: string;
  // The account holder's name as the provider verified it, when it has one.
  verifiedName?: string;
}

export interface Provider {
  name: string;
  // The provider's name as a person reads it.
  displayName: string;
  // One sentence added to the refusal when identifyAccount fails.
  identifyHint?: string;
  createSession(
    config: ProviderSessionRequest,
    credentials: Record<string, unknown>
  ): Promise<ProviderSessionResult>;
  validateResults(raw: unknown): ProviderResultItem[];
  // Which account the credentials belong to. Null when the provider cannot
  // say, and then the firm is not bound to an account.
  identifyAccount(
    credentials: Record<string, unknown>
  ): Promise<ProviderAccountIdentity | null>;
}
