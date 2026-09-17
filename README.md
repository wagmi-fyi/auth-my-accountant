# Auth My Accountant

Session broker for financial account authentication flows. Firm agents create auth channels via API, clients connect bank accounts through provider SDKs (Stripe Financial Connections), and firms retrieve linked account IDs.

**Docs:** [`docs/security.md`](docs/security.md) — security posture (client- and firm-facing).

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
| `SIGNUP_PER_ADDRESS_HOURLY` | Optional. Sign-ups allowed from one caller address per hour. Default 3. |
| `SIGNUP_DAILY_CAP` | Optional. New firms allowed by sign-up per UTC day. Default 20. Set it to 0 to close sign-up. |

## API Reference

### POST /api/signup

Signs a firm up. It needs no key, and it answers with the firm's key once.

WAGMI's hosted copy at `auth-my-accountant.vercel.app` is open for sign-up.
Call this route with your firm's name, or run the bookkeeping skill's `signup`
command, which saves the key for you.

```bash
curl -X POST http://localhost:3000/api/signup \
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

> The `api_key` is returned only once, and the service keeps only its hash. A lost key cannot be recovered. Sign up again.

A refusal carries two fields: `error`, which holds words for a person, and `code`:

| Status | `code` | Meaning |
| --- | --- | --- |
| 429 | `rate_limited` | Too many sign-ups from one address this hour. `Retry-After` says when to try again. |
| 429 | `daily_cap_reached` | The day's sign-ups are used up. Sign-up opens again at midnight UTC. |

The first refusal of a day writes a log line with `"alert": "signup_daily_cap_reached"`.

### POST /api/firms

Create a new firm. Requires admin API key.

```bash
curl -X POST http://localhost:3000/api/firms \
  -H "Authorization: Bearer {ADMIN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme Accounting"}'
```

Add `"bind": {"provider": "stripe_fc", "account_ref": "acct_..."}` to tie the
firm to one provider account from the start. Without it, the firm's first link
sets the account.

**Response (201):**
```json
{
  "id": "uuid",
  "name": "Acme Accounting",
  "api_key": "acp_..."
}
```

> The `api_key` is returned only once. Store it securely.

### GET /api/firms

Lists the firms made since a given time, with the day's sign-up figures.
Requires the admin API key.

- `since`: a time. Firms made since then are listed. Default 24 hours ago.
- `day`: a UTC date, `YYYY-MM-DD`. The sign-up figures are for that day. Default today.

```bash
curl "http://localhost:3000/api/firms?since=2026-09-16T00:00:00Z&day=2026-09-16" \
  -H "Authorization: Bearer {ADMIN_API_KEY}"
```

**Response (200):**
```json
{
  "since": "...",
  "until": "...",
  "firms": [
    {
      "id": "uuid",
      "name": "Acme Accounting",
      "status": "active",
      "created_at": "...",
      "bindings": [
        { "provider": "stripe_fc", "account_ref": "acct_...", "verified_name": "Acme Accounting LLC" }
      ]
    }
  ],
  "signup_cap": {
    "day": "2026-09-16",
    "daily_cap": 20,
    "signups": 4,
    "cap_reached": false,
    "refused_over_cap": 0
  }
}
```

### PATCH /api/firms/:id

Suspend or reactivate a firm. Requires admin API key. A suspended firm's key
fails from its next request.

```bash
curl -X PATCH http://localhost:3000/api/firms/{id} \
  -H "Authorization: Bearer {ADMIN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": "suspended"}'
```

`status` is `suspended` or `active`. The answer is the firm's `id`, `name` and `status`.

### Provider account binding

When a firm's credentials let the provider say which account they belong to,
the firm's first channel or bundle records that account. A later request with
credentials for another account gets 403 with `code`
`provider_account_mismatch`. When the provider cannot say which account the
credentials belong to, the service makes the link and leaves any binding as it
is.

When the provider reports a verified name for the account holder, the page of a
link made with the bound account's credentials shows it under the firm's name.
For Stripe that is the account's registered company name, from a live key only.

For Stripe, **Accounts: Read** is the permission that lets the service see the
account. It is recommended for a restricted key, beside the required
**Financial Connections: Read and Write** and **Customers: Write**. With it, the
firm is tied to its own Stripe account, and its clients see the company name
Stripe verified. Links work without it. A check that fails for any other reason
gets 502 with `code` `provider_identify_failed`.

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
        "category": "cash",
        "subcategory": "checking"
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
        "category": "cash",
        "subcategory": "checking"
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

## Rate Limits

Per-endpoint, enforced via DB-backed windows (HTTP 429 with `Retry-After` on breach):

| Endpoint | Limit | Scope |
| --- | --- | --- |
| POST /api/signup | 3/hour, and 20/day in total | caller address; everyone |
| POST /api/firms | 10/min | admin |
| GET /api/firms | 30/min | admin |
| PATCH /api/firms/:id | 10/min | admin |
| POST /api/channels | 30/min | firm |
| POST /api/bundles | 10/min | firm |
| POST /api/channels/:id/results | 5/min | channel |
| POST /api/bundles/:id/results | 10/min | bundle |
| GET /api/channels/:id, /api/bundles/:id | 120/min | firm |

## Adding a New Provider

1. Create `lib/providers/{name}.ts` implementing the `Provider` interface:
   - `displayName`: the provider's name as a person reads it
   - `createSession(config, credentials)` — create provider session with transient credentials
   - `validateResults(raw)` — normalize provider response into `ProviderResultItem[]`
   - `identifyAccount(credentials)`: the account the credentials belong to, as `{ accountRef, verifiedName? }`, or `null` when the provider cannot say, such as a key without permission to look

2. Register in `lib/providers/index.ts`:
   ```typescript
   import { myProvider } from "./my-provider";
   // Add to providers map:
   my_provider: myProvider,
   ```

3. Add provider-specific client component handling in `AuthFlow.tsx`

## Deployment

Runs on Vercel with Neon Postgres integration.

WAGMI runs one instance of this code at `https://auth-my-accountant.vercel.app`.
The steps below deploy your own.

### Setup

1. Link repo to Vercel: `vercel link`
2. Add Neon Postgres via Vercel Marketplace (auto-injects `DATABASE_URL`)
3. Set env vars: `ADMIN_API_KEY`, `NEXT_PUBLIC_APP_URL`
4. Push schema to database: `npm run db:push`
5. Deploy: `vercel --prod`

### Database Schema Changes

Schema changes are pushed directly — no migration files in the build pipeline.

```bash
# Push schema changes to database (local dev or production)
npm run db:push

# Generate migration files (for version control/audit)
npm run db:generate

# Start dev server
npm run dev
```
