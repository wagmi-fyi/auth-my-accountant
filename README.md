# Auth My Accountant

Session broker for financial account authentication flows. Firm agents create auth channels via API, clients connect bank accounts through provider SDKs (Stripe Financial Connections), and firms retrieve linked account IDs.

## Architecture

- **Next.js 15+ (App Router)** on Vercel
- **Neon Postgres** via Drizzle ORM (neon-http driver)
- **Modular provider system** — Stripe FC first, extensible to Plaid etc.
- **Transient credential model** — provider API keys used once during session creation, never stored

## Setup

```bash
# Clone and install
git clone <repo-url>
cd authmyaccountant
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL, ADMIN_API_KEY, NEXT_PUBLIC_APP_URL

# Push schema to database (local dev)
npm run db:push

# Start dev server
npm run dev
```

### Environment Variables

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Neon Postgres connection string |
| `ADMIN_API_KEY` | Platform admin key for firm provisioning |
| `NEXT_PUBLIC_APP_URL` | Base URL for channel links (e.g., `https://authmyaccountant.com`) |

## API Reference

### POST /api/firms

Create a new firm. Requires admin API key.

```bash
curl -X POST http://localhost:3000/api/firms \
  -H "Authorization: Bearer {ADMIN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme Accounting"}'
```

**Response (201):**
```json
{
  "id": "uuid",
  "name": "Acme Accounting",
  "api_key": "acp_..."
}
```

> The `api_key` is returned only once. Store it securely.

### POST /api/channels

Create an auth channel. Requires firm API key.

```bash
curl -X POST http://localhost:3000/api/channels \
  -H "Authorization: Bearer {firm_api_key}" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "stripe_fc",
    "provider_config": {
      "permissions": ["transactions", "balances"]
    },
    "credentials": {
      "secret_key": "sk_test_...",
      "publishable_key": "pk_test_..."
    },
    "consent": {
      "title": "Connect Your Bank Account",
      "body": "We need access to verify your transactions.",
      "firm_name": "Acme Accounting"
    },
    "client_ref": "client-123",
    "expires_in_hours": 24
  }'
```

**Response (201):**
```json
{
  "id": "uuid",
  "token": "...",
  "url": "https://authmyaccountant.com/c/{token}",
  "status": "pending",
  "expires_at": "2026-02-27T..."
}
```

### GET /api/channels/:id

Retrieve channel status and results. Requires firm API key.

```bash
curl http://localhost:3000/api/channels/{id} \
  -H "Authorization: Bearer {firm_api_key}"
```

**Response (200):**
```json
{
  "id": "uuid",
  "token": "...",
  "provider": "stripe_fc",
  "status": "completed",
  "client_ref": "client-123",
  "consent": { "..." },
  "expires_at": "...",
  "created_at": "...",
  "accounts": [
    {
      "provider_account_id": "fca_...",
      "account_metadata": {
        "institution_name": "Chase",
        "last4": "1234",
        "category": "checking"
      }
    }
  ]
}
```

### POST /api/channels/:id/results

Submit auth results (called from client browser, not firm agents).

- Requires `X-Channel-Token` header
- Validates `Origin` header matches `NEXT_PUBLIC_APP_URL`

## Bundles (Multi-Institution)

Bundles allow a single link to connect multiple bank institutions. The firm agent creates a bundle with N pre-created Stripe FC sessions (default 5), sends one URL to the client, and the client connects institutions sequentially.

### POST /api/bundles

Create a bundle with multiple auth sessions. Requires firm API key.

```bash
curl -X POST http://localhost:3000/api/bundles \
  -H "Authorization: Bearer {firm_api_key}" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "stripe_fc",
    "provider_config": {
      "permissions": ["transactions", "balances"]
    },
    "credentials": {
      "secret_key": "sk_test_...",
      "publishable_key": "pk_test_..."
    },
    "consent": {
      "title": "Connect Your Bank Accounts",
      "body": "Please connect all bank accounts used for your business.",
      "firm_name": "Acme Accounting"
    },
    "client_ref": "client-123",
    "max_sessions": 5,
    "expires_in_hours": 72
  }'
```

**Response (201):**
```json
{
  "id": "uuid",
  "token": "...",
  "url": "https://authmyaccountant.com/b/{token}",
  "status": "pending",
  "max_sessions": 5,
  "expires_at": "2026-03-02T..."
}
```

Default expiry is **72 hours** (max 168). Default max_sessions is **5** (max 20). All sessions share one Stripe customer. Credentials are used during creation and never stored.

### GET /api/bundles/:id

Retrieve bundle status and all connected accounts. Requires firm API key.

```bash
curl http://localhost:3000/api/bundles/{id} \
  -H "Authorization: Bearer {firm_api_key}"
```

**Response (200):**
```json
{
  "id": "uuid",
  "token": "...",
  "provider": "stripe_fc",
  "status": "active",
  "client_ref": "client-123",
  "consent": { "..." },
  "max_sessions": 5,
  "sessions_completed": 2,
  "sessions_total": 5,
  "expires_at": "...",
  "created_at": "...",
  "accounts": [
    {
      "provider_account_id": "fca_...",
      "account_metadata": {
        "institution_name": "Chase",
        "last4": "1234",
        "category": "checking"
      },
      "session_index": 0
    }
  ]
}
```

Accounts are **always** returned, even for expired bundles that had completed sessions.

### Bundle Lifecycle

`pending` → `active` → `completed`

- **pending**: Bundle created, no sessions used yet
- **active**: Client has connected at least one institution, may still be connecting more
- **completed**: Client clicked "I'm Done", all sessions used, or server auto-completed
- **expired**: Computed at read time when `expires_at` has passed (accounts still accessible)

### POST /api/bundles/:id/results (client-facing)

Submit results for a specific session. Called from client browser.

- Requires `X-Bundle-Token` header (NOT `X-Channel-Token`)
- Validates `Origin` header
- Body includes `session_index` identifying which session was completed
- Server auto-completes the bundle when all sessions are done

### POST /api/bundles/:id/complete (client-facing)

Mark bundle as completed. Called when client clicks "I'm Done" with unused sessions.

- Requires `X-Bundle-Token` header
- Idempotent — safe to call multiple times
- Only valid when bundle status is `active`

## Adding a New Provider

1. Create `lib/providers/{name}.ts` implementing the `Provider` interface:
   - `createSession(config, credentials)` — create provider session with transient credentials
   - `validateResults(raw)` — normalize provider response into `ProviderResultItem[]`

2. Register in `lib/providers/index.ts`:
   ```typescript
   import { myProvider } from "./my-provider";
   // Add to providers map:
   my_provider: myProvider,
   ```

3. Add provider name to `createChannelSchema` enum in `lib/validation.ts`

4. Add provider-specific client component handling in `AuthFlow.tsx`

## Deployment

Deploy to Vercel with Neon Postgres integration:

1. Connect repo to Vercel
2. Add Neon Postgres via Vercel Marketplace (auto-injects `DATABASE_URL`)
3. Set `ADMIN_API_KEY` and `NEXT_PUBLIC_APP_URL` in Vercel env vars
4. Build command runs migrations automatically: `npx drizzle-kit migrate && next build`

## Database Migrations

```bash
# Generate migration from schema changes
npm run db:generate

# Apply to local dev (direct push, no migration files)
npm run db:push

# Apply migrations (production)
npm run db:migrate
```
