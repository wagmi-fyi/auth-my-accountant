---
title: 'Auth Channel Platform'
slug: 'auth-channel-platform'
created: '2026-02-26'
status: 'implementation-complete'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - Next.js 15+ (App Router)
  - TypeScript
  - Vercel (hosting, serverless)
  - Neon Postgres (via Vercel Marketplace)
  - Drizzle ORM (neon-http driver)
  - Stripe.js / @stripe/react-stripe-js (first provider SDK)
  - stripe (server-side, transient use only)
  - '@neondatabase/serverless'
files_to_modify:
  - 'NEW: /Users/jeremiah/dev-tyr/authmyaccountant/ (greenfield repo)'
  - 'lib/schema.ts — Drizzle schema (firms, channels, channel_results)'
  - 'lib/db.ts — Neon/Drizzle database connection'
  - 'lib/auth.ts — API key validation, token generation, origin validation'
  - 'lib/validation.ts — Zod schemas for all API request bodies'
  - 'lib/providers/types.ts — provider interface definition'
  - 'lib/providers/stripe-fc.ts — Stripe FC provider module'
  - 'app/api/firms/route.ts — firm registration endpoint'
  - 'app/api/channels/route.ts — channel creation endpoint'
  - 'app/api/channels/[id]/route.ts — channel status/result retrieval'
  - 'app/api/channels/[id]/results/route.ts — client-side result submission'
  - 'app/c/[token]/page.tsx — client-facing auth page (Server Component)'
  - 'app/c/[token]/AuthFlow.tsx — provider SDK interaction (Client Component)'
  - 'app/c/[token]/success/page.tsx — post-auth success page'
  - 'drizzle.config.ts — Drizzle Kit configuration'
code_patterns:
  - 'Provider module pattern: each provider exports server-side session creator + client-side component'
  - 'API key auth via Authorization Bearer header, validated in route handlers'
  - 'Server Component loads channel data → Client Component renders provider SDK'
  - 'Transient credential pattern: provider keys used in single request, never persisted'
  - 'Drizzle ORM with Neon HTTP driver for zero-connection-management serverless'
test_patterns:
  - 'Manual testing with Stripe test mode (sk_test_ / pk_test_ keys)'
  - 'API testing via curl/httpie for all route handlers'
  - 'Stripe test institutions + test bank credentials for end-to-end flow'
---

# Tech-Spec: Auth Channel Platform

**Created:** 2026-02-26

## Overview

### Problem Statement

Accounting firms need to get permission from clients to access their financial data via third-party providers (Stripe Financial Connections, Plaid, etc.). This requires client-facing web pages that load provider SDKs to run auth flows. There is currently no mechanism to dynamically generate these auth flows, capture the resulting account reference IDs, and make them available to firm agents.

### Solution

A Next.js app on Vercel that acts as a session broker. Firm agents create auth channels via API (passing provider credentials transiently), the platform hosts client-facing auth pages, captures reference IDs from provider SDK callbacks, and exposes results via API. The platform never stores provider API secrets or financial data — credentials are used once during session creation and discarded. Stripe FC is the first provider module; the architecture supports adding providers (Plaid, etc.) via a modular pattern.

### Scope

**In Scope:**
- Multi-firm API (firm registration, API key auth)
- Auth channel lifecycle (create → unique client URL → capture result → retrieve)
- Client-facing auth page (dynamic consent display + provider SDK flow)
- Stripe Financial Connections as first provider module
- Transient credential model (provider keys used once at channel creation, never persisted)
- Neon Postgres for session and result persistence
- Modular provider architecture (clear pattern for adding new providers)
- Result retrieval API for firm agents

**Out of Scope:**
- Firm-facing web dashboard
- Self-service firm signup
- Agent-supplied arbitrary frontend code
- Storing provider API keys or secrets
- Financial data storage or processing
- Downstream TYR ingest adapters
- Payment processing

## Context for Development

### Project Setup

- **Repository:** `/Users/jeremiah/dev-tyr/authmyaccountant` (new repo, greenfield)
- **Confirmed Clean Slate** — no legacy constraints, no existing code to integrate with
- **Upstream of:** tyr-bookkeeping Stripe FC ingest adapters (which consume the account IDs this platform produces)

### Codebase Patterns

**Provider Module Pattern:**
Each auth provider (Stripe FC, Plaid, etc.) is a self-contained module with:
1. A server-side session creator function (called during channel creation with transient credentials)
2. A client-side React component (loaded on the auth page to render the provider's SDK flow)
3. A result mapper (normalizes provider-specific responses into a common result shape)

**API Pattern:**
- Route Handlers in `/app/api/` with exported HTTP method functions
- API key auth via `Authorization: Bearer {firm_api_key}` header
- Structured JSON error responses with appropriate HTTP status codes
- Platform admin key for privileged operations (firm provisioning)

**Page Pattern:**
- Server Component at `/app/c/[token]/page.tsx` — does DB lookup, validates token/expiry, loads channel config
- Client Component (`AuthFlow.tsx`) — receives `client_secret` + provider config, loads provider SDK, runs auth flow, POSTs results back to platform API
- `notFound()` for invalid/expired tokens

**Database Pattern:**
- Drizzle ORM with `@neondatabase/serverless` HTTP driver
- Schema defined in TypeScript (`lib/schema.ts`)
- Migrations via `drizzle-kit generate` → committed to git → applied at build time via `drizzle-kit migrate && next build`
- Local dev uses `drizzle-kit push` for rapid iteration

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `_tyr-output/builder-docs/briefs/stripe-fc-auth-service-brief.md` (tyr-bookkeeping) | Original brief with Stripe FC context, API surface, and design questions |
| `_tyr-output/builder-docs/skill-specs/tech-spec-stripe-fc-ingest-adapters.md` (tyr-bookkeeping) | Downstream adapters that consume the account IDs this platform produces |

### Technical Decisions

- **Hosting:** Vercel — serverless, edge-optimized, native Next.js support
- **Database:** Neon Postgres via Vercel Marketplace — auto-injects `DATABASE_URL`, provides branching for preview deployments, free tier sufficient for dev/early production (0.5GB storage, 100 CU-hours/month)
- **ORM:** Drizzle ORM with `neon-http` driver — lightweight, SQL-like, zero connection management in serverless, first-class Neon support
- **Credential model:** Transient — firm agent passes provider API key per channel creation request. Platform uses it in a single API call to create the provider session, stores only the session artifacts (session_id, client_secret), discards the key immediately. Platform is a session broker, not a secrets vault.
- **Multi-tenancy:** Each firm has their own provider accounts (e.g., their own Stripe account). The provider modal shows the firm's name/branding, not the platform's.
- **Provider architecture:** Built-in provider modules (server-side session creator + client-side React component per provider). The channel API is provider-agnostic — dispatches to the right module based on `provider` field. Adding a new provider is a well-scoped, formulaic task.
- **Firm management:** API-first, agent-operated. No web UI for firms. Platform admin key provisions firms; firm API key authenticates all subsequent calls.
- **Frontend:** Client-facing auth pages only. No firm dashboard. Consent text and display content are inputs from the channel creation payload, not hardcoded.

### Stripe FC Technical Constraints

- **Session creation** requires `account_holder.customer` (Stripe Customer ID) + `permissions[]`. The firm agent must either pass an existing customer ID or the platform creates one transiently during channel creation.
- **`client_secret`** is single-use. Once the auth flow completes, the session is consumed.
- **Stripe.js `collectFinancialConnectionsAccounts()`** returns full account objects on the client side: `id` (`fca_...`), `institution_name`, `last4`, `category`, `subcategory`, `display_name`, `status`, `permissions`.
- **No server-side call needed after auth** — the client-side response has all account metadata needed. This confirms the transient credential model.
- **`prefetch` parameter** can request `transactions`, `balances`, `ownership` to start data refresh immediately on connection. Useful optimization but data arrives async (webhook or poll).
- **4 permissions available:** `balances`, `transactions`, `ownership`, `payment_method`.
- **Webhooks:** `financial_connections.account.created` fires per linked account. No session-level webhooks. Client-side capture is the primary result path; webhooks can serve as backup/reconciliation.
- **Stripe.js requires a publishable key** to initialize. For multi-firm, each firm provides their publishable key (in addition to secret key) during channel creation. The publishable key is safe to embed in the client page.

### Data Flow

```
FIRM AGENT                     PLATFORM (Vercel)              CLIENT (browser)            STRIPE
──────────                     ─────────────────              ────────────────            ──────

1. POST /api/channels
   { stripe_secret_key,
     stripe_publishable_key,
     customer_id (or create),
     permissions, consent }
                               2. Calls Stripe API with
                                  firm's secret key:
                                  - Create customer (if needed)
                                  - Create FC session
                               3. Stores: session_id,
                                  client_secret, publishable_key,
                                  channel config
                                  (discards secret key)
← { channel_url, channel_id }

4. Sends URL to client
   (email, SMS, etc.)
                                                              5. Clicks link
                                                              6. Server Component loads
                                                                 channel from DB
                                                              7. Sees consent page with
                                                                 firm-supplied content
                                                              8. Clicks "Connect"
                                                              9. Stripe.js inits with
                                                                 firm's publishable key
                                                              10. Modal opens           ←→  Bank login
                                                              11. Completes auth
                                                              12. Stripe.js returns full
                                                                  account objects
                                                              13. Page auto-POSTs results
                                                                  to POST /api/channels/
                                                                  {id}/results
                               14. Stores account metadata
                                   (IDs, institution, last4...)
                               15. Marks channel "completed"

5. GET /api/channels/{id}
   (polls whenever ready)
← { status: "completed",
    accounts: [{ id, institution_name,
    last4, category, ... }] }
```

### Security Model

- Provider API keys are **never persisted** — used transiently during channel creation, then discarded from memory
- Publishable keys are stored (they're designed to be client-facing and safe to expose)
- Stored data (account IDs, session artifacts) is useless without the firm's provider secret key
- Platform never sees, stores, or transmits actual financial data (transactions, balances, etc.)
- Firm API keys authenticate all management API calls (hashed in DB via SHA-256, never stored plaintext, compared with `crypto.timingSafeEqual`)
- Client auth links use unique tokens with configurable expiry (default: 24 hours — aligned with estimated Stripe client_secret lifetime)
- **Result submission endpoint auth:** The channel `token` is required as an `X-Channel-Token` header on POST to `/api/channels/{id}/results`. The channel ID alone is not sufficient — both the UUID and the token must match. This prevents result injection from leaked channel IDs.
- **CSRF/origin validation:** The result submission endpoint validates the `Origin` header matches `NEXT_PUBLIC_APP_URL`. Requests from other origins are rejected with 403.
- **Consent content sanitization:** All firm-supplied consent fields (`title`, `body`, `firm_name`) are rendered as **plain text only** — never as raw HTML. React's default JSX escaping handles this, but the spec mandates no use of `dangerouslySetInnerHTML` on consent fields. A `Content-Security-Policy` header is set on auth pages: `default-src 'self'; script-src 'self' https://js.stripe.com; frame-src https://js.stripe.com;`
- **Input validation:** All API endpoints validate request bodies using Zod schemas. Invalid payloads return 400 with structured error details.
- **Logging:** All API requests are logged with structured context (endpoint, firm_id, channel_id, status code, duration). Errors include stack traces. Use `console.log`/`console.error` with JSON structure — Vercel captures these in its built-in log viewer. Sentry or equivalent is a v2 addition.

### Database Schema

**firms**
- `id` (uuid, PK)
- `name` (text)
- `api_key_hash` (text) — SHA-256 hash (hex-encoded), never stored plain
- `created_at` (timestamp)
- `status` (enum: active, suspended)

**channels**
- `id` (uuid, PK)
- `firm_id` (uuid, FK → firms)
- `token` (text, unique, indexed) — used in client-facing URL `/c/{token}`
- `provider` (text) — e.g., "stripe_fc"
- `provider_session_id` (text) — e.g., Stripe FC session ID
- `provider_client_secret` (text) — e.g., Stripe client_secret (client-safe, single-use)
- `provider_publishable_key` (text) — e.g., Stripe publishable key (client-safe)
- `provider_config` (jsonb) — provider-specific config (permissions, prefetch, customer_id, etc.)
- `consent` (jsonb) — { title, body, firm_name, ... }
- `client_ref` (text, nullable) — firm's reference for their client
- `status` (enum: pending, completed, expired, failed)
- `expires_at` (timestamp)
- `created_at` (timestamp)

**channel_results**
- `id` (uuid, PK)
- `channel_id` (uuid, FK → channels)
- `provider_account_id` (text) — e.g., `fca_...`
- `account_metadata` (jsonb) — { institution_name, last4, category, subcategory, display_name, status, ... }
- `created_at` (timestamp)
- **Unique constraint:** `(channel_id, provider_account_id)` — prevents duplicate account entries from double-submissions

## Implementation Plan

### Tasks

- [x] Task 1: Scaffold Next.js project
  - File: `/Users/jeremiah/dev-tyr/authmyaccountant/` (new directory)
  - Action: Run `npx create-next-app@latest authmyaccountant` with TypeScript, App Router, Tailwind CSS, ESLint. Initialize git repo.
  - Notes: Use `src/` directory — no. Keep flat `app/` at root for simplicity. Accept defaults for import alias (`@/`).

- [x] Task 2: Install dependencies
  - File: `package.json`
  - Action: Install runtime deps: `drizzle-orm`, `@neondatabase/serverless`, `@stripe/stripe-js`, `@stripe/react-stripe-js`, `stripe`, `zod`. Install dev deps: `drizzle-kit`.
  - Notes: `zod` is used for API request validation on all endpoints. No other additional dependencies needed — Next.js ships with everything else.

- [x] Task 3: Configure Drizzle ORM
  - File: `drizzle.config.ts`
  - Action: Create Drizzle Kit config pointing to `lib/schema.ts`, output to `drizzle/` directory, dialect `postgresql`, credentials from `DATABASE_URL` env var.
  - File: `lib/db.ts`
  - Action: Create database connection module. Import `neon` from `@neondatabase/serverless`, `drizzle` from `drizzle-orm/neon-http`. Export `db` instance with schema.
  - Notes: Uses Neon HTTP driver — single-shot queries, zero connection pooling needed.

- [x] Task 4: Define database schema
  - File: `lib/schema.ts`
  - Action: Define three tables using Drizzle's `pgTable`:
    - `firms` — id (uuid default random), name (text), api_key_hash (text), status (text default 'active'), created_at (timestamp default now)
    - `channels` — id (uuid), firm_id (uuid references firms), token (text unique), provider (text), provider_session_id (text), provider_client_secret (text), provider_publishable_key (text nullable), provider_config (jsonb), consent (jsonb), client_ref (text nullable), status (text default 'pending'), expires_at (timestamp), created_at (timestamp default now)
    - `channel_results` — id (uuid), channel_id (uuid references channels), provider_account_id (text), account_metadata (jsonb), created_at (timestamp default now). Add unique constraint on `(channel_id, provider_account_id)`.
  - Notes: Use `pgEnum` for status fields if Drizzle supports it cleanly, otherwise text with application-level validation. Add index on `channels.token` for fast lookups. The unique constraint on channel_results prevents duplicate account entries from network retries or double-clicks.

- [x] Task 5: Generate and apply initial migration
  - Action: Run `npx drizzle-kit generate` to create SQL migration files. Run `npx drizzle-kit push` for local dev (or `migrate` if a database is available).
  - File: `drizzle/` directory (auto-generated migration SQL)
  - File: `package.json` — add script: `"db:generate": "drizzle-kit generate"`, `"db:push": "drizzle-kit push"`, `"db:migrate": "drizzle-kit migrate"`
  - Notes: Migrations committed to git. Production build command: `npx drizzle-kit migrate && next build`.

- [x] Task 6: Create auth utilities
  - File: `lib/auth.ts`
  - Action: Implement:
    - `generateApiKey()` — generates a random API key string (e.g., `acp_` prefix + 32 random hex chars) using `crypto.randomBytes`
    - `hashApiKey(key)` — returns SHA-256 hash (hex-encoded) of the key using `crypto.createHash('sha256')`
    - `validateFirmApiKey(request)` — extracts `Authorization: Bearer {key}` header, hashes it, looks up in firms table using `crypto.timingSafeEqual` for comparison, returns firm record or null
    - `validateAdminKey(request)` — checks against `ADMIN_API_KEY` env var using `crypto.timingSafeEqual`
    - `generateChannelToken()` — generates a URL-safe random token (e.g., 24 chars, base62) using `crypto.randomBytes`
    - `validateOrigin(request)` — checks `Origin` header matches `NEXT_PUBLIC_APP_URL`, returns boolean
  - Notes: SHA-256 is sufficient for API keys (they're high-entropy random strings, not passwords — no salt needed). All comparisons use `crypto.timingSafeEqual` to prevent timing side-channels. bcrypt is overkill here.

- [x] Task 7: Define provider interface
  - File: `lib/providers/types.ts`
  - Action: Define TypeScript interfaces:
    - `ProviderSessionRequest` — { provider_config: Record<string, unknown>, consent: ConsentConfig }
    - `ProviderSessionResult` — { session_id: string, client_secret: string, publishable_key?: string, provider_data?: Record<string, unknown> }
    - `ProviderResultItem` — { provider_account_id: string, account_metadata: Record<string, unknown> }
    - `ConsentConfig` — { title: string, body: string, firm_name: string }
    - `Provider` interface — { name: string, createSession(config: ProviderSessionRequest, credentials: Record<string, unknown>): Promise<ProviderSessionResult>, validateResults(raw: unknown): ProviderResultItem[] }
  - File: `lib/providers/index.ts`
  - Action: Create provider registry — a map of provider name → Provider implementation. Export `getProvider(name: string)` function.
  - Notes: The `credentials` param in `createSession` is the transient secret key object — used once and not retained.

- [x] Task 8: Implement Stripe FC provider module
  - File: `lib/providers/stripe-fc.ts`
  - Action: Implement the `Provider` interface for Stripe Financial Connections:
    - `createSession(config, credentials)`:
      1. Initialize Stripe SDK with `credentials.secret_key` (transient)
      2. If no `customer_id` in `config.provider_config`, create a Stripe Customer (name from consent.firm_name + client_ref)
      3. Call `stripe.financialConnections.sessions.create()` with account_holder, permissions, optional prefetch
      4. Return `{ session_id, client_secret, publishable_key: credentials.publishable_key }`
    - `validateResults(raw)`:
      1. Expect array of account objects from Stripe.js response
      2. Map each to `ProviderResultItem` with `provider_account_id` = `account.id`, `account_metadata` = { institution_name, last4, category, subcategory, display_name, status }
  - Notes: The Stripe SDK instance is created per-request and garbage collected — never stored. The `credentials` object containing the secret key is used only within this function scope.

- [x] Task 9: Implement firm registration API
  - File: `app/api/firms/route.ts`
  - Action: Implement `POST` handler:
    1. Validate admin API key via `validateAdminKey(request)`
    2. Parse and validate body with Zod: `{ name: z.string().min(1).max(200) }`
    3. Generate API key via `generateApiKey()`
    4. Hash key via `hashApiKey()`
    5. Insert firm record into DB
    6. Return `{ id, name, api_key }` (return the unhashed key ONCE — this is the only time the firm sees it)
    7. Return 401 for invalid admin key, 400 for missing/invalid name (include Zod error details)
  - Notes: The plain API key is returned only in the creation response. It's never retrievable again — if lost, generate a new one.

- [x] Task 10: Implement channel creation API
  - File: `app/api/channels/route.ts`
  - File: `lib/validation.ts` — Zod schemas for all API endpoints (shared)
  - Action: Implement `POST` handler:
    1. Validate firm API key via `validateFirmApiKey(request)` — get firm record
    2. Parse and validate body with Zod schema:
       ```
       {
         provider: z.enum(["stripe_fc"]),  // extend as providers are added
         provider_config: z.object({
           permissions: z.array(z.enum(["transactions", "balances", "ownership", "payment_method"])).min(1),
           prefetch: z.array(z.string()).optional(),
           customer_id: z.string().optional(),
         }),
         credentials: z.object({
           secret_key: z.string().min(1),
           publishable_key: z.string().min(1),
         }),
         consent: z.object({
           title: z.string().min(1).max(200),
           body: z.string().min(1).max(5000),
           firm_name: z.string().min(1).max(200),
         }),
         client_ref: z.string().max(500).optional(),
         expires_in_hours: z.number().min(1).max(168).default(24),
       }
       ```
    3. Look up provider via `getProvider(provider)` — return 400 if unknown
    4. Call `provider.createSession(config, credentials)` — the credentials object is used here and nowhere else
    5. Generate channel token via `generateChannelToken()`
    6. Calculate `expires_at` from `expires_in_hours` (default 24 hours)
    7. Insert channel record into DB with all session artifacts
    8. Return `{ id, token, url: "{BASE_URL}/c/{token}", status: "pending", expires_at }`
    9. Error handling: 401 unauthorized, 400 bad request with Zod error details, 502 if provider session creation fails (log the Stripe error with structured context)
  - Notes: The `credentials` object is destructured into the provider call and never touches the database. `BASE_URL` comes from `NEXT_PUBLIC_APP_URL` env var (must always be set — do not fall back to `VERCEL_URL` to avoid preview deployment URL leakage). Default expiry is 24 hours (aligned with estimated Stripe client_secret lifetime). Firms can request up to 168 hours (7 days) but are warned that the provider session may expire before the channel does.

- [x] Task 11: Implement channel retrieval API
  - File: `app/api/channels/[id]/route.ts`
  - Action: Implement `GET` handler:
    1. Validate firm API key — get firm record
    2. Look up channel by `id` param, verify `firm_id` matches (firms can only see their own channels)
    3. If channel not found or wrong firm: return 404
    4. **Compute effective status at read time:** If DB status is "pending" but `expires_at < now`, return `status: "expired"` in the response (no DB write needed — this is a read-time computation)
    5. If channel status is "completed": join with `channel_results` to include accounts
    6. Return `{ id, token, provider, status, client_ref, consent, expires_at, created_at, accounts: [...] | null }`
  - Notes: The firm agent polls this endpoint to check if the client has completed the auth flow. The effective status computation ensures agents never see a stale "pending" status on an expired channel.

- [x] Task 12: Implement result submission API
  - File: `app/api/channels/[id]/results/route.ts`
  - Action: Implement `POST` handler:
    1. **Origin validation:** Call `validateOrigin(request)` — reject with 403 if Origin header doesn't match `NEXT_PUBLIC_APP_URL`
    2. **Channel token auth:** Extract `X-Channel-Token` header. This is mandatory — reject with 401 if missing.
    3. Look up channel by `id` param. Verify `channel.token` matches the `X-Channel-Token` header. If mismatch: return 404.
    4. Check channel status and expiry: if already completed return 409 Conflict, if expired return 410 Gone, if not "pending" return 400.
    5. Parse and validate body with Zod: `{ accounts: z.array(z.object({ id: z.string(), institution_name: z.string().optional(), last4: z.string().optional(), category: z.string().optional(), subcategory: z.string().optional(), display_name: z.string().nullable().optional(), status: z.string().optional() })).min(1) }`
    6. Look up the provider via channel's `provider` field, call `provider.validateResults(accounts)` to normalize
    7. **Atomic status transition:** Use `UPDATE channels SET status = 'completed' WHERE id = ? AND status = 'pending'` and check affected row count. If 0 rows affected (race condition — another request completed first), return 409 Conflict.
    8. Insert results into `channel_results` using `ON CONFLICT (channel_id, provider_account_id) DO NOTHING` to handle duplicate account entries from retries.
    9. Return `{ success: true }`
    10. Log: channel_id, firm_id, number of accounts, success/failure (structured JSON)
  - Notes: This endpoint is called from the client's browser after Stripe.js returns. Auth is via Origin header validation + mandatory `X-Channel-Token` header (the token from the URL path, which the page knows). The atomic status transition and unique constraint together prevent all race conditions from double-submissions.

- [x] Task 13: Build client-facing auth page (Server Component)
  - File: `app/c/[token]/page.tsx`
  - Action: Implement Server Component:
    1. Await `params` to get `token` (Next.js 15+ params is a Promise)
    2. Query DB for channel by token
    3. If not found: call `notFound()`
    4. If expired (`expires_at < now`): render expired message page with "This link has expired. Please contact your accountant for a new link."
    5. If already completed: render "already completed" message with connected account summary
    6. If pending: render consent content from `channel.consent` and mount the `AuthFlow` Client Component, passing: `channelId`, `channelToken` (for X-Channel-Token header), `clientSecret`, `publishableKey`, `provider`
    7. **Consent content is rendered as plain text only.** Use React's default JSX text rendering (`{consent.title}`, `{consent.body}`). **Never use `dangerouslySetInnerHTML`** on any consent field.
    8. Set `Content-Security-Policy` header via Next.js metadata or middleware: `default-src 'self'; script-src 'self' https://js.stripe.com; frame-src https://js.stripe.com;`
  - Notes: The consent content is rendered server-side from the DB record. Only the interactive SDK flow is client-side. The CSP header ensures only Stripe.js can run third-party scripts on this page, preventing any XSS from consent content even if React's escaping were somehow bypassed.

- [x] Task 14: Build auth flow Client Component
  - File: `app/c/[token]/AuthFlow.tsx`
  - Action: Implement Client Component (`'use client'`):
    1. Accept props: `channelId`, `channelToken`, `clientSecret`, `publishableKey`, `provider`
    2. State: `status` (idle, connecting, success, error), `error` message
    3. On "Connect" button click:
      a. Load Stripe.js with `loadStripe(publishableKey)`
      b. Call `stripe.collectFinancialConnectionsAccounts({ clientSecret })`
      c. On success: extract accounts from response
      d. POST accounts to `/api/channels/{channelId}/results` with `X-Channel-Token: {channelToken}` header
      e. On success: set status to "success", show success message
      f. On Stripe error (including stale `client_secret`): set status to "error", show user-friendly message: "We couldn't connect to your bank. This may happen if the link has been open for a while. Please contact your accountant for a new link." Log the Stripe error code to console for debugging.
      g. On network/submission error: set status to "error", show "Something went wrong. Please try again." with retry button
    4. UI states:
      - **idle**: Show "Connect Your Bank Account" button
      - **connecting**: Show loading spinner
      - **success**: Show "Account connected successfully" with institution name(s) and last4
      - **error**: Show error message + "Try Again" button (for retryable errors) or "Contact your accountant" (for stale secret / expired session errors)
  - Notes: Currently only handles `stripe_fc` provider. When adding new providers, this component can dispatch to provider-specific sub-components based on the `provider` prop. Keep the Stripe-specific logic isolated so it's easy to extract later. The stale-secret error handling (step 3f) addresses the known risk that Stripe's `client_secret` may expire before the channel's `expires_at`. The error message guides the client to request a new link rather than leaving them stuck.

- [x] Task 15: Build success page
  - File: `app/c/[token]/success/page.tsx`
  - Action: Simple static success page as an alternative landing after auth. Server Component that queries channel status and displays confirmation.
  - Notes: Optional — the AuthFlow component handles the success state inline. This page is a fallback if the client navigates away and returns.

- [x] Task 16: Add global layout and styling
  - File: `app/layout.tsx`
  - Action: Clean, minimal layout. No navigation bar (this isn't a SaaS dashboard). Just a centered content container. Set metadata (title, description).
  - File: `app/globals.css`
  - Action: Minimal Tailwind CSS setup. Clean, professional styling for the consent page. Mobile-responsive (clients will often open links on their phone).
  - Notes: The page should look trustworthy — clean typography, clear firm branding, no clutter. The firm name should be prominent.

- [x] Task 17: Configure environment variables and deployment
  - File: `.env.local` (local dev, gitignored)
  - Action: Document required env vars:
    - `DATABASE_URL` — Neon connection string (auto-injected by Vercel Marketplace integration)
    - `ADMIN_API_KEY` — Platform admin key for firm provisioning
    - `NEXT_PUBLIC_APP_URL` — Base URL for channel links (e.g., `https://authmyaccountant.com`)
  - File: `.env.example`
  - Action: Create example env file with placeholder values and comments
  - File: `package.json`
  - Action: Set build command to include migration: add `"build": "drizzle-kit migrate && next build"` or configure in `vercel.json`
  - Notes: No Stripe keys in env — they're passed per-request by firm agents. The only platform-level secrets are `DATABASE_URL` and `ADMIN_API_KEY`.

- [x] Task 18: Add README with API documentation
  - File: `README.md`
  - Action: Document:
    - Project overview (what it does, architecture)
    - Setup instructions (clone, install, env vars, database)
    - API reference: all endpoints with request/response shapes
    - Adding a new provider (step-by-step guide for the provider module pattern)
    - Deployment to Vercel
  - Notes: This README is the primary reference for firm agents and for agents that will extend the platform with new providers.

### Acceptance Criteria

**Firm Management:**
- [x] AC 1: Given a valid admin API key, when POST /api/firms is called with `{ name: "Test Firm" }`, then a firm record is created and the response contains `{ id, name, api_key }` where `api_key` is a unique, unhashed key string.
- [x] AC 2: Given an invalid or missing admin API key, when POST /api/firms is called, then a 401 Unauthorized response is returned.

**Channel Creation:**
- [x] AC 3: Given a valid firm API key and valid Stripe credentials, when POST /api/channels is called with provider "stripe_fc", permissions, consent config, and Stripe keys, then a Stripe FC session is created, channel record is stored with session artifacts (but NOT the secret key), and response contains `{ id, token, url, status: "pending", expires_at }`.
- [x] AC 4: Given a valid firm API key but an unknown provider name, when POST /api/channels is called, then a 400 Bad Request response is returned with a clear error message.
- [x] AC 5: Given a valid firm API key but invalid Stripe credentials, when POST /api/channels is called, then a 502 response is returned indicating the provider session creation failed.

**Client Auth Flow:**
- [x] AC 6: Given a valid, non-expired channel token, when a client visits `/c/{token}`, then the page displays the firm name, consent title, consent body, and a "Connect" button.
- [x] AC 7: Given a valid channel, when the client clicks "Connect" and completes the Stripe FC bank auth flow, then the linked account IDs and metadata (institution_name, last4, category) are POSTed to the results API and stored in channel_results.
- [x] AC 8: Given a completed auth flow, when the results are successfully submitted, then the channel status updates to "completed" and the client sees a success confirmation with the connected account details.

**Result Retrieval:**
- [x] AC 9: Given a firm API key and a completed channel ID, when GET /api/channels/{id} is called, then the response contains `{ status: "completed", accounts: [{ provider_account_id, account_metadata }] }`.
- [x] AC 10: Given a firm API key and a pending channel ID, when GET /api/channels/{id} is called, then the response contains `{ status: "pending", accounts: null }`.

**Expiry & Edge Cases:**
- [x] AC 11: Given an expired channel token, when a client visits `/c/{token}`, then the page displays an "expired" message and does not load the provider SDK.
- [x] AC 12: Given a channel that has already been completed, when the results API receives another POST, then a 409 Conflict response is returned.
- [x] AC 13: Given a firm API key, when GET /api/channels/{id} is called for a channel belonging to a different firm, then a 404 response is returned (no data leakage between firms).

**Security:**
- [x] AC 14: Given a channel record in the database, when the database is inspected, then NO provider secret keys are present — only session_id, client_secret, and publishable_key are stored.
- [x] AC 15: Given a firm registration, when the firm record is inspected in the database, then the API key is stored only as a SHA-256 hash, never in plaintext.
- [x] AC 16: Given a result submission POST without an `X-Channel-Token` header, when the request is received, then a 401 Unauthorized response is returned.
- [x] AC 17: Given a result submission POST with an `X-Channel-Token` that doesn't match the channel's token, when the request is received, then a 404 response is returned.
- [x] AC 18: Given a result submission POST with an `Origin` header that doesn't match `NEXT_PUBLIC_APP_URL`, when the request is received, then a 403 Forbidden response is returned.
- [x] AC 19: Given firm-supplied consent content containing HTML tags (e.g., `<script>alert('xss')</script>`), when the client visits the auth page, then the tags are rendered as visible plain text, not executed as HTML.
- [x] AC 20: Given a firm API key and a channel whose `expires_at` has passed, when GET /api/channels/{id} is called, then the response contains `status: "expired"` (not "pending").
- [x] AC 21: Given two simultaneous result submission POSTs for the same channel, when both are processed, then exactly one succeeds (200) and the other receives 409 Conflict, with no duplicate entries in channel_results.

## Additional Context

### Dependencies

**Runtime packages:**
- `next` (15+) — framework
- `react`, `react-dom` (19+) — UI
- `drizzle-orm` — database ORM
- `@neondatabase/serverless` — Neon Postgres HTTP driver
- `zod` — runtime schema validation for all API request bodies
- `@stripe/stripe-js` — Stripe.js loader (client)
- `@stripe/react-stripe-js` — React bindings for Stripe Elements (client)
- `stripe` — Stripe Node.js SDK (server, transient use)

**Dev packages:**
- `drizzle-kit` — schema migrations
- `typescript`, `@types/node`, `@types/react` — type checking

**Infrastructure:**
- Vercel account with Neon Postgres integration (Vercel Marketplace)
- Domain configuration (authmyaccountant.com or similar)
- Stripe account in test mode for development

**No other task/feature dependencies** — this is a standalone greenfield project.

### Testing Strategy

**Stripe Test Mode:**
- Use `sk_test_` / `pk_test_` keys throughout development
- Stripe test mode provides sandbox FC flow with test institutions (e.g., "Test Bank") and test bank credentials
- No real bank accounts are connected during testing

**Manual Testing Sequence:**
1. Start local dev server (`npm run dev`)
2. Create a firm via `curl -X POST /api/firms -H "Authorization: Bearer {admin_key}" -d '{"name":"Test Firm"}'`
3. Create a channel via `curl -X POST /api/channels -H "Authorization: Bearer {firm_api_key}" -d '{...}'` using Stripe test keys
4. Open the channel URL in browser
5. Verify consent page renders with correct firm name and content
6. Click "Connect", complete Stripe test bank flow
7. Verify success state shows connected account details
8. Poll `GET /api/channels/{id}` and verify completed status with account data

**API Testing:**
- Test all route handlers with curl/httpie
- Verify auth (valid key, invalid key, missing key)
- Verify channel lifecycle (create → pending → completed)
- Verify firm isolation (firm A can't see firm B's channels)
- Verify expiry handling

**Future:**
- Add integration tests once patterns stabilize
- Consider Playwright for end-to-end browser testing of the auth flow

### Notes

**High-Risk Items:**
- Stripe FC session creation is the critical external dependency. If the Stripe API is down or credentials are invalid, channel creation fails. The 502 error response handles this, but firm agents should be prepared to retry.
- The `client_secret` lifecycle is not well-documented by Stripe. Assumed to be valid for at least 24 hours based on analogous Stripe products. Default channel expiry is set to 24 hours to align with this. Firms can request up to 7 days but are warned that the provider session may expire first. The AuthFlow component handles stale-secret errors with a clear user message ("contact your accountant for a new link") rather than a cryptic failure.

**Known Limitations:**
- No webhook integration for v1 — relies entirely on client-side result capture. If the client's browser fails to POST results (network error, page close), the channel stays "pending" until it expires. Mitigation: the firm agent can create a new channel.
- No firm API key rotation mechanism in v1 — if a key is compromised, a new firm must be provisioned.
- No rate limiting implemented in v1 — add before production traffic.

**v2 Backlog (from adversarial review — acknowledged, deferred):**
- Per-provider Zod validation schemas for `provider_config` (currently uses a generic object schema per provider; adding a second provider should formalize this)
- Channel listing endpoint with pagination and status filtering (`GET /api/channels?status=pending&page=1`)
- Encrypt `client_secret` at rest with a platform-level encryption key (low actual risk since secrets are single-use and short-lived, but defense-in-depth)
- Admin API key rotation mechanism and admin action audit logging (timestamp, source IP, action)
- Sentry or equivalent error tracking integration
- Data retention policy for completed channels and PII-adjacent data
- Neon backup/restore documentation and migration rollback procedure
- `NEXT_PUBLIC_APP_URL` must always be set explicitly — never fall back to `VERCEL_URL` (prevents preview deployment URL leakage into channel links)
- HSTS headers (Vercel sets these automatically for custom domains, but document the expectation)

**Future Considerations (out of scope):**
- Plaid Link provider module (second provider, validates the modular architecture)
- Webhook-based result capture as backup to client-side
- Firm API key rotation
- Channel status webhooks (notify firm agent when channel completes instead of polling)
- Firm-facing dashboard (if demand emerges)
- Lazy session creation (create provider session on page load instead of channel creation, trading transient credentials for session freshness)

## Review Notes

- Adversarial review completed (17 findings)
- Findings: 17 total, 6 fixed, 11 deferred (by-design or v2 scope)
- Resolution approach: auto-fix real issues
- **Fixed:** CSP header (middleware.ts), auth full-scan → hash lookup, non-atomic writes → .returning() + batch insert, validateResults runtime validation, timing-safe token comparison, redundant index removal
- **Deferred:** Rate limiting, cleanup/TTL, test suite, origin validation hardening, cascade constraints (all acknowledged as v2 backlog items)
