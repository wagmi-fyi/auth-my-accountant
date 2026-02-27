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

export interface Provider {
  name: string;
  createSession(
    config: ProviderSessionRequest,
    credentials: Record<string, unknown>
  ): Promise<ProviderSessionResult>;
  validateResults(raw: unknown): ProviderResultItem[];
  verifyAccount(
    credentials: Record<string, unknown>
  ): Promise<string>;
}
