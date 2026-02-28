---
title: 'Multi-Institution Auth Bundles'
slug: 'multi-institution-auth-bundles'
created: '2026-02-27'
status: 'implementation-complete'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - Next.js 15+ (App Router)
  - TypeScript
  - Vercel (hosting, serverless)
  - Neon Postgres (via Vercel Marketplace)
  - Drizzle ORM (neon-http driver)
  - Stripe.js / @stripe/react-stripe-js
  - stripe (server-side, transient use only)
  - '@neondatabase/serverless'
files_to_modify:
  - 'lib/schema.ts — add bundles table'
  - 'lib/validation.ts — add createBundleSchema, submitBundleResultsSchema'
  - 'middleware.ts — add /b/:path* matcher + add actual CSP headers (fix inherited no-op)'
  - 'NEW: app/api/bundles/route.ts — bundle creation endpoint'
  - 'NEW: app/api/bundles/[id]/route.ts — bundle retrieval endpoint'
  - 'NEW: app/api/bundles/[id]/results/route.ts — per-session result submission'
  - 'NEW: app/api/bundles/[id]/complete/route.ts — mark bundle complete'
  - 'NEW: app/b/[token]/page.tsx — bundle auth page (Server Component)'
  - 'NEW: app/b/[token]/BundleAuthFlow.tsx — sequential auth flow (Client Component)'
code_patterns:
  - 'Single bundles table with JSONB sessions array (no session/result child tables)'
  - 'Pre-creates N Stripe FC sessions — first creates customer, then Promise.all remaining sessions'
  - 'Sequential client-side auth flow with optional early exit'
  - 'Shared Stripe customer across all sessions in a bundle'
  - 'Postgres JSONB path updates with CAS for atomic session completion'
  - 'All session client_secrets passed to client upfront (single-use, browser-safe)'
  - 'Results stored as ProviderResultItem shape (provider_account_id + account_metadata) — same as channels'
  - 'Server-side auto-complete: results endpoint sets bundle to completed when all sessions done'
test_patterns:
  - 'Manual testing with Stripe test mode (sk_test_ / pk_test_ keys)'
  - 'API testing via curl/httpie for bundle endpoints'
  - 'Sequential multi-institution flow testing with Stripe test bank'
  - 'Pre-production: empirical Stripe FC session lifetime testing at 24h, 48h, 72h intervals'
---

# Tech-Spec: Multi-Institution Auth Bundles

**Created:** 2026-02-27

**Extends:** `tech-spec-auth-channel-platform.md` (implementation-complete)

## Overview

### Problem Statement

Firm clients needing to connect multiple bank institutions must currently receive a separate auth link for each institution. This requires the firm agent to create N channels and send N URLs, and the client to click through N separate flows. Bad UX for both sides — especially when the firm doesn't know how many institutions the client has.

### Solution

Introduce a "bundle" concept that pre-creates N Stripe FC sessions in a single API call (using the transient credentials once), serves them through one client URL with a sequential flow ("Connect bank → Add another? → Connect → I'm done"), and aggregates all results under one retrieval endpoint. Default max is 5 sessions per bundle; firms can request more if needed. Existing single-channel API remains unchanged for backward compatibility.

### Scope

**In Scope:**
- Bundle creation API — pre-creates N sessions (default 5, firm can set higher), one Stripe customer shared across all sessions
- Single client URL with sequential auth flow (one institution at a time, optional "add another")
- Bundle status & aggregated result retrieval for firm agents
- Client "I'm done" exit at any point (don't force all N)
- Backward compatible — existing single-channel API unchanged

**Out of Scope:**
- Modifying an existing bundle after creation (firm sends a new link instead)
- Parallel/simultaneous institution selection UI
- New provider modules (still Stripe FC only)
- Firm-facing dashboard

## Context for Development

### Codebase Patterns

**Target repo:** `/Users/jeremiah/dev-tyr/auth-my-accountant`

**Current architecture:** Each channel maps 1:1 to a Stripe FC session. Channel holds a single `providerSessionId`, `providerClientSecret`, and `providerPublishableKey`. The `AuthFlow.tsx` client component calls `stripe.collectFinancialConnectionsAccounts()` once and submits results. Channel transitions atomically from `pending` → `completed`.

**Key constraint:** Transient credential model — Stripe secret keys are used only during session creation and never persisted. This means all sessions in a bundle must be pre-created in the initial API call while the credentials are in memory.

**Simplified schema approach:** Sessions and results are stored as a JSONB array on the `bundles` table — no child tables. Each session object in the array contains its Stripe session artifacts, status, and connected accounts inline. Atomic updates use Postgres `jsonb_set()` with CAS conditions via Drizzle's `sql` template.

**Data format consistency:** Bundle results are stored using the same `ProviderResultItem` shape as channel results (`provider_account_id` + `account_metadata`), not raw Stripe account objects. This ensures a consistent data contract across channels and bundles for firm agents consuming the results.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `lib/schema.ts` | Drizzle schema — add `bundles` table with JSONB `sessions` column |
| `lib/providers/stripe-fc.ts` | Stripe FC provider — `createSession()` called N times per bundle |
| `lib/providers/types.ts` | Provider interface — no changes needed |
| `lib/validation.ts` | Zod schemas — add bundle creation + result submission schemas |
| `lib/auth.ts` | Auth utilities — reused (validateFirmApiKey, generateChannelToken, validateOrigin) |
| `app/api/channels/route.ts` | Pattern reference for bundle creation endpoint |
| `app/c/[token]/page.tsx` | Pattern reference for bundle auth page |
| `app/c/[token]/AuthFlow.tsx` | Pattern reference for sequential bundle flow |
| `app/api/channels/[id]/results/route.ts` | Pattern reference for bundle result submission |
| `middleware.ts` | CSP middleware — currently a no-op, needs actual CSP headers added for both `/c/` and `/b/` |

### Technical Decisions

- **Single table with JSONB:** All session and result data stored as a JSONB `sessions` array on the `bundles` table. No child tables. Sessions are always accessed in the context of their bundle, never independently queried.
- **Pre-creation model with parallelization:** Session 0 is created first (creates the Stripe customer). Sessions 1 through N-1 are created in parallel via `Promise.all`, all sharing the same `customer_id`. This caps the Stripe API latency at ~2 round-trips regardless of session count, avoiding Vercel serverless timeout issues.
- **Shared Stripe customer:** All sessions in a bundle share one Stripe customer ID. Created once (if not provided by firm) and reused for all session creation calls.
- **Default 5, configurable higher:** 5 covers the vast majority of cases (most clients have 1-3 banks). Firms can specify a higher max if they know the client has more.
- **Default 72-hour expiry:** Bookkeeping clients can be slow to respond to emails. A 72-hour window gives firms time to send the link and clients time to act. Max 168 hours (7 days).
- **Sequential UX:** Client connects one institution at a time, sees success, then gets "Connect another bank account" option. Can exit anytime with "I'm done."
- **Bundle URL:** `/b/{token}` — separate route from channels (`/c/{token}`) for clean separation.
- **All client_secrets passed upfront:** The Server Component passes all session client_secrets to the Client Component. These are single-use Stripe tokens designed for browser embedding — not sensitive. Avoids round-trips between institution connections.
- **Atomic JSONB updates:** Session completion uses `jsonb_set()` with a CAS condition (`WHERE sessions->index->>'status' = 'pending'`). The sequential flow means no concurrent writes to the same session index. **Developer note:** JSONB path arguments in Postgres `jsonb_set()` are text array paths (e.g., `'{0,status}'`), not parameterized values. The `session_index` integer must be interpolated into a path string literal — it cannot use standard `$1` parameter binding for the path argument. Use Drizzle's `sql` template to build the path: `` sql`'{${sql.raw(String(sessionIndex))},status}'` ``.
- **Server-side auto-complete:** The results endpoint checks if all sessions are completed after each submission. If so, it sets the bundle status to `"completed"` directly. The `/complete` endpoint is only for explicit "I'm Done" (when the client has unused sessions remaining). This eliminates the race condition between the final result submission and a client-side auto-complete POST.
- **Bundle status model:** `pending` (no sessions used) → `active` (1+ completed) → `completed` (client clicked "I'm done", all sessions used, or server-side auto-complete). `expired` computed at read time — but **expired bundles with results still return their accounts** (see retrieval endpoint).
- **Backward compatible:** Existing channel API and `/c/{token}` flow are untouched. Bundles are fully additive.
- **Result data format:** Accounts in the JSONB `sessions[].accounts` array use the `ProviderResultItem` shape: `{ provider_account_id: string, account_metadata: { institution_name, last4, category, subcategory, display_name, status } }`. This matches the `channel_results` table format so firm agents get a consistent data contract whether they use channels or bundles.

### Database Schema

**bundles** (new table)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `defaultRandom()` |
| `firm_id` | uuid FK → firms | |
| `token` | text, unique | URL-safe, used in `/b/{token}` |
| `provider` | text | e.g., `"stripe_fc"` |
| `provider_publishable_key` | text | Shared across all sessions |
| `provider_config` | jsonb | Shared provider config (permissions, prefetch) |
| `consent` | jsonb, notNull | `{ title, body, firm_name }` |
| `client_ref` | text, nullable | Firm's reference for their client |
| `max_sessions` | integer | Default 5 |
| `sessions` | jsonb, notNull | Array of session objects (see below) |
| `status` | text | `pending`, `active`, `completed` |
| `expires_at` | timestamp, **notNull** | Matches channels table constraint |
| `created_at` | timestamp | `defaultNow()` |

**sessions JSONB structure:**

```json
[
  {
    "session_id": "fcsess_...",
    "client_secret": "fcsess_..._secret_...",
    "status": "pending|completed",
    "accounts": [
      {
        "provider_account_id": "fca_...",
        "account_metadata": {
          "institution_name": "Chase",
          "last4": "4242",
          "category": "checking",
          "subcategory": "savings",
          "display_name": "Chase Checking",
          "status": "active"
        }
      }
    ]
  }
]
```

### Data Flow

```
FIRM AGENT                     PLATFORM (Vercel)              CLIENT (browser)            STRIPE
──────────                     ─────────────────              ────────────────            ──────

1. POST /api/bundles
   { credentials, consent,
     provider_config,
     max_sessions: 5 }
                               2. Creates Stripe customer
                                  (if needed) + session[0]
                               3. Promise.all: sessions
                                  1-4 in parallel
                                  (reuses customer_id)
                               4. Stores: bundle with
                                  sessions[] JSONB
                                  (discards secret key)
← { id, url, status,
    max_sessions }

5. Sends URL to client

                                                              6. Clicks /b/{token}
                                                              7. Server Component loads
                                                                 bundle + all sessions
                                                              8. Sees consent page
                                                              9. Clicks "Connect"
                                                              10. Stripe.js uses
                                                                  session[0].client_secret
                                                              11. Modal opens           ←→  Bank login
                                                              12. Completes auth
                                                              13. POSTs results to
                                                                  /api/bundles/{id}/results
                                                                  { session_index: 0, accounts }
                               14. JSONB update: session[0]
                                   status → completed,
                                   accounts populated
                               15. Bundle status → active
                               16. Check: all sessions done?
                                   No → return sessions_remaining
                                                              17. "Connect another?"
                                                                  → Yes: repeat with
                                                                    session[1].client_secret
                                                                  → No ("I'm Done"):
                                                                    POST /complete
                               18. Bundle status → completed

                                   (OR if all sessions used,
                                    step 16 auto-completes
                                    the bundle server-side)

6. GET /api/bundles/{id}
← { status, sessions_completed,
    accounts: [...all...] }
```

### Security Model

- Same transient credential model as channels — secret keys never persisted
- **Bundle token auth on result submission uses `X-Bundle-Token` header** (NOT `X-Channel-Token` — different header name) + Origin validation
- All session client_secrets are passed to the client browser — these are Stripe-designed browser-safe tokens
- Consent content rendered as plain text only (same as channels)
- CSP header on `/b/:path*` and `/c/:path*` pages: `default-src 'self'; script-src 'self' https://js.stripe.com; frame-src https://js.stripe.com;` — **note: the existing middleware is a no-op and must be fixed as part of this spec (Task 10)**
- Rate limiting on all bundle endpoints (including the complete endpoint)

## Implementation Plan

### Tasks

- [x] Task 1: Add bundles table to Drizzle schema
  - File: `lib/schema.ts`
  - Action: Add `bundles` table definition using `pgTable` with columns: `id` (uuid PK, defaultRandom), `firmId` (uuid FK → firms), `token` (text, unique), `provider` (text, notNull), `providerPublishableKey` (text), `providerConfig` (jsonb), `consent` (jsonb, notNull), `clientRef` (text, nullable), `maxSessions` (integer, notNull, default 5), `sessions` (jsonb, notNull), `status` (text, notNull, default "pending"), `expiresAt` (timestamp, **notNull**), `createdAt` (timestamp, defaultNow, notNull).
  - Notes: No child tables. Sessions and results are embedded in the `sessions` JSONB array. `expiresAt` is `notNull` — matches the channels table constraint.

- [x] Task 2: Generate and apply database migration
  - Action: Run `npx drizzle-kit generate` to create migration SQL for the new `bundles` table. Run `npx drizzle-kit push` for local dev.
  - Notes: Migration must be committed to git. Depends on Task 1.

- [x] Task 3: Add Zod validation schemas for bundle endpoints
  - File: `lib/validation.ts`
  - Action: Add two schemas:
    - `createBundleSchema`: Same shape as `createChannelSchema` but with `max_sessions: z.number().int().min(1).max(20).default(5)` and `expires_in_hours: z.number().min(1).max(168).default(72)`. Fields: `provider` (enum), `provider_config` (object with permissions, prefetch, customer_id), `credentials` (secret_key, publishable_key), `consent` (title, body, firm_name), `client_ref` (optional), `expires_in_hours`, `max_sessions`.
    - `submitBundleResultsSchema`: `{ session_index: z.number().int().min(0), accounts: z.array(...).min(1) }` — same accounts array shape as `submitResultsSchema` but with added `session_index` field.

- [x] Task 4: Implement bundle creation API endpoint
  - File: `app/api/bundles/route.ts` (NEW)
  - Action: Implement `POST` handler following the pattern in `app/api/channels/route.ts`:
    1. Validate firm API key via `validateFirmApiKey(request)`
    2. Rate limit: 10 requests/minute per firm (lower than channels — each bundle creates N Stripe sessions)
    3. Parse and validate body with `createBundleSchema`
    4. Get provider via `getProvider(data.provider)`
    5. Stripe account pinning check (same pattern as channel creation)
    6. Create sessions with parallelization:
       - Call `provider.createSession()` for session index 0. If no `customer_id` in provider_config, the provider creates a Stripe customer. Extract `customer_id` from `provider_data` in the result.
       - For sessions 1 through N-1: create all in parallel via `Promise.all`, each calling `provider.createSession()` with the `customer_id` from session 0 injected into `provider_config.customer_id`.
       - Build `sessions` JSONB array: each entry has `session_id`, `client_secret`, `status: "pending"`, `accounts: []`.
       - If any session creation fails (including within `Promise.all`): return 502 with context about the failure. Do NOT store a partial bundle — all-or-nothing.
    7. Generate token via `generateChannelToken()` (reuse existing function)
    8. Calculate `expires_at` from `expires_in_hours` (default 72 hours)
    9. Insert bundle record into DB
    10. Return `{ id, token, url: "{BASE_URL}/b/{token}", status: "pending", max_sessions, expires_at }`
  - Notes: The credentials object is used to create sessions and never touches the database. The `customer_id` from session 0 is threaded through to subsequent sessions so all sessions share one Stripe customer. Parallelizing sessions 1-N caps Stripe API latency at ~2 round-trips total (session 0 + all remaining in parallel), keeping the response time well within Vercel's default 10-second serverless timeout even at `max_sessions: 20`.

- [x] Task 5: Implement bundle retrieval API endpoint
  - File: `app/api/bundles/[id]/route.ts` (NEW)
  - Action: Implement `GET` handler following the pattern in `app/api/channels/[id]/route.ts`:
    1. Validate firm API key
    2. Rate limit: 120 requests/minute per firm
    3. Look up bundle by `id` param, verify `firm_id` matches
    4. If not found or wrong firm: return 404
    5. Compute effective status: if DB status is `pending` and `expires_at < now`, return `status: "expired"`. **If DB status is `active` and `expires_at < now`, return `status: "expired"` BUT still include the accounts** (expiry means "no more sessions can be used", not "data is gone").
    6. Parse `sessions` JSONB to compute: `sessions_completed` (count of sessions with status "completed"), `sessions_total` (length of array)
    7. **Always** aggregate accounts from all completed sessions into a flat array, each with the originating `session_index`. Return as `accounts: [...]` — **never return `null`**, always an array (empty `[]` if no sessions completed).
    8. Return `{ id, token, provider, status, client_ref, consent, max_sessions, sessions_completed, sessions_total, expires_at, created_at, accounts: [...] }`
  - Notes: Firm agents poll this endpoint to check if the client has connected accounts. Accounts are **always** returned regardless of bundle status — even for expired bundles. An expired active bundle still has valuable connected account data that the firm needs.

- [x] Task 6: Implement bundle result submission API endpoint
  - File: `app/api/bundles/[id]/results/route.ts` (NEW)
  - Action: Implement `POST` handler following the pattern in `app/api/channels/[id]/results/route.ts`:
    1. Origin validation via `validateOrigin(request)` — reject 403 if mismatch
    2. Rate limit: 10 requests/minute per bundle
    3. **Bundle token auth: extract `X-Bundle-Token` header** (NOT `X-Channel-Token`). Look up bundle by `id`, verify token match with `crypto.timingSafeEqual`. Return 401 if missing, 404 if mismatch.
    4. Check bundle expiry: if `expires_at < now`, return 410 Gone
    5. Parse and validate body with `submitBundleResultsSchema`
    6. Validate `session_index` is within bounds: `0 <= session_index < sessions.length`. Return 400 if out of bounds.
    7. Check session status: if `sessions[session_index].status === "completed"`, return 409 Conflict
    8. Validate results through provider: call `provider.validateResults(accounts)` to get `ProviderResultItem[]` array. **Store this normalized shape** in the JSONB, not the raw Stripe account objects.
    9. Atomic JSONB update using Drizzle `sql` template. **Developer note on JSONB paths:** Postgres `jsonb_set()` takes a text array path (e.g., `'{0,status}'`). The `session_index` integer must be interpolated into a path string — it cannot use standard `$1` parameter binding for the path argument. Build the path with: `` sql`'{${sql.raw(String(sessionIndex))},status}'` ``. The full update:
       ```sql
       UPDATE bundles
       SET
         sessions = jsonb_set(
           jsonb_set(sessions, '{<index>,status}', '"completed"'),
           '{<index>,accounts}', <accounts>::jsonb
         ),
         status = CASE
           WHEN (
             -- Check if ALL sessions are now completed after this update
             SELECT bool_and(s->>'status' = 'completed')
             FROM jsonb_array_elements(
               jsonb_set(sessions, '{<index>,status}', '"completed"')
             ) AS s
           ) THEN 'completed'
           WHEN status = 'pending' THEN 'active'
           ELSE status
         END
       WHERE id = $id
         AND sessions-><index>->>'status' = 'pending'
       RETURNING id, status
       ```
       If 0 rows affected: return 409 (race condition). The `RETURNING status` value tells the caller whether the bundle auto-completed.
    10. Compute `sessions_remaining`: count of sessions still `"pending"` after update (0 if auto-completed)
    11. Return `{ success: true, sessions_remaining }`
  - Notes: The CAS condition on `sessions->index->>'status' = 'pending'` prevents double-submission. **Server-side auto-complete:** the SQL checks if all sessions are now completed after this update and transitions directly to `"completed"` if so. This eliminates the race condition between a final result submission and a separate auto-complete POST. The `/complete` endpoint (Task 7) is only needed for explicit "I'm Done" when unused sessions remain.

- [x] Task 7: Implement bundle completion API endpoint
  - File: `app/api/bundles/[id]/complete/route.ts` (NEW)
  - Action: Implement `POST` handler:
    1. Origin validation via `validateOrigin(request)`
    2. Rate limit: 5 requests/minute per bundle
    3. **Bundle token auth: `X-Bundle-Token` header** (NOT `X-Channel-Token`), verify match
    4. Look up bundle, verify it's `active` (at least one session completed). If `pending`: return 400 "No accounts connected yet". If already `completed`: return 200 `{ success: true }` (idempotent).
    5. Update `status` to `"completed"` with CAS: `WHERE id = $id AND status = 'active'`
    6. Return `{ success: true }`
  - Notes: Called when client clicks "I'm Done" with unused sessions remaining. Idempotent — safe to call multiple times. If client closes the tab without clicking "I'm Done", bundle stays `active` until expiry; the firm can still retrieve connected accounts via polling.

- [x] Task 8: Build bundle auth page (Server Component)
  - File: `app/b/[token]/page.tsx` (NEW)
  - Action: Implement Server Component following the pattern in `app/c/[token]/page.tsx`:
    1. Await `params` to get `token`
    2. Query DB for bundle by token
    3. If not found: `notFound()`
    4. If expired (`expires_at < now`): render expired message — "This link has expired. Please contact your accountant for a new link."
    5. If `completed`: render completion summary — show all connected accounts from all completed sessions in the JSONB array, using `account_metadata.institution_name` and `account_metadata.last4` for display
    6. If `pending` or `active`: render consent content (plain text, same approach as channels) and mount `BundleAuthFlow` Client Component, passing:
       - `bundleId` (string)
       - `bundleToken` (string)
       - `provider` (string)
       - `publishableKey` (string)
       - `sessions`: array of `{ index: number, client_secret: string, status: string, accounts: ProviderResultItem[] }` — pass all sessions so the client can manage the sequence
    7. Consent content rendered as plain text only — no `dangerouslySetInnerHTML`
    8. Reuse the `PageShell` layout pattern from `app/c/[token]/page.tsx` for visual consistency
  - Notes: For `active` bundles (client returning to an in-progress bundle), the page still renders — the BundleAuthFlow component skips completed sessions and picks up at the first pending one.

- [x] Task 9: Build BundleAuthFlow (Client Component)
  - File: `app/b/[token]/BundleAuthFlow.tsx` (NEW)
  - Action: Implement Client Component (`'use client'`) managing a sequential multi-institution auth flow:
    1. Props: `bundleId`, `bundleToken`, `provider`, `publishableKey`, `sessions` (array with client_secret, status, accounts per session)
    2. State:
       - `currentIndex`: index of the session being connected (initialized to first session with `status === "pending"`)
       - `flowStatus`: `"idle"` | `"connecting"` | `"submitting"` | `"session_success"` | `"all_done"` | `"error"`
       - `error`: error message string
       - `retryable`: boolean
       - `allConnectedAccounts`: accumulator of all accounts connected across sessions (initialized from any pre-completed sessions)
    3. **Idle state**: Show "Connect Your Bank Account" button (or "Connect Another Bank Account" if `allConnectedAccounts.length > 0`). Show count: "Institution {N} of {max}" or similar progress indicator.
    4. **Connect handler** (same pattern as `AuthFlow.tsx`):
       a. `loadStripe(publishableKey)` — load once and reuse across sessions (same publishable key)
       b. `stripe.collectFinancialConnectionsAccounts({ clientSecret: sessions[currentIndex].client_secret })`
       c. On Stripe error: handle stale secret (non-retryable) vs other errors (retryable), same as existing AuthFlow
       d. On success: extract accounts, set `flowStatus` to `"submitting"`
       e. POST to `/api/bundles/{bundleId}/results` with `{ session_index: currentIndex, accounts }` and **`X-Bundle-Token: {bundleToken}` header** (NOT `X-Channel-Token`)
       f. On submit success: check `sessions_remaining` from response. Append accounts to `allConnectedAccounts`. If `sessions_remaining === 0`: set `flowStatus` to `"all_done"` (server already auto-completed the bundle). Otherwise: set `flowStatus` to `"session_success"`.
    5. **Session success state**: Show connected account(s) for this session (institution name, last4). Show running total of all connected accounts. Show two buttons:
       - "Connect Another Bank Account" — increments `currentIndex` to next pending session, resets `flowStatus` to `"idle"`.
       - "I'm Done" — POST to `/api/bundles/{bundleId}/complete` with `X-Bundle-Token` header. Set `flowStatus` to `"all_done"`.
    6. **All done state**: Show final summary of all connected accounts. "You can close this page now."
    7. **Error state**: Same pattern as existing `AuthFlow.tsx` — show error message, "Try Again" button if retryable, "Contact your accountant for a new link" if not (stale client_secret).
  - Notes: The component initializes by scanning the `sessions` prop for the first pending session. If all sessions are already completed (shouldn't happen — Server Component handles this), show the "all done" state.

- [x] Task 10: Fix middleware CSP headers and add bundle route matcher
  - File: `middleware.ts`
  - Action: **The existing middleware is a no-op** — it calls `NextResponse.next()` without setting any headers. Fix this by adding actual CSP headers for both `/c/:path*` and `/b/:path*` routes:
    ```typescript
    export function middleware() {
      const response = NextResponse.next();
      response.headers.set(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' https://js.stripe.com; frame-src https://js.stripe.com;"
      );
      return response;
    }

    export const config = {
      matcher: ["/c/:path*", "/b/:path*"],
    };
    ```
  - Notes: This fixes an inherited gap from the original implementation — CSP was specified in the original tech spec but never actually implemented in the middleware. This task fixes it for both existing channel pages and new bundle pages.

- [x] Task 11: Update README with bundle API documentation
  - File: `README.md`
  - Action: Add a "Bundles (Multi-Institution)" section documenting:
    - Purpose and use case
    - `POST /api/bundles` — request/response shape, note 72-hour default expiry
    - `GET /api/bundles/{id}` — request/response shape, note accounts always returned
    - `POST /api/bundles/{id}/results` — request/response shape (client-facing, uses `X-Bundle-Token`)
    - `POST /api/bundles/{id}/complete` — request/response shape (client-facing, uses `X-Bundle-Token`)
    - Bundle lifecycle: pending → active → completed (with server-side auto-complete)
    - Example curl commands for creating and retrieving bundles
    - Note about Stripe FC session lifetime (see pre-production testing)

### Acceptance Criteria

**Bundle Creation:**
- [x] AC 1: Given a valid firm API key and valid Stripe credentials, when POST /api/bundles is called with `max_sessions: 3`, then 3 Stripe FC sessions are created sharing one Stripe customer (session 0 first, sessions 1-2 in parallel), a bundle record is stored with a `sessions` JSONB array of 3 entries (each with session_id, client_secret, status "pending", empty accounts), and the response contains `{ id, token, url, status: "pending", max_sessions: 3, expires_at }`.
- [x] AC 2: Given a valid firm API key, when POST /api/bundles is called without `max_sessions` or `expires_in_hours`, then a bundle with 5 sessions and 72-hour expiry is created (defaults).
- [x] AC 3: Given a valid firm API key but invalid Stripe credentials, when POST /api/bundles is called, then a 502 response is returned and no bundle record is stored.
- [x] AC 4: Given a bundle record in the database, when the record is inspected, then NO Stripe secret keys are present — only session_ids, client_secrets, and publishable_key are stored.

**Client Sequential Flow:**
- [x] AC 5: Given a valid, non-expired bundle token with status "pending", when a client visits `/b/{token}`, then the page displays the firm name, consent title, consent body, and a "Connect Your Bank Account" button.
- [x] AC 6: Given a pending bundle, when the client completes the first Stripe FC bank auth flow, then session[0] in the JSONB is updated to status "completed" with accounts stored as `ProviderResultItem` shape (`provider_account_id` + `account_metadata`), and the bundle status becomes "active".
- [x] AC 7: Given an active bundle with remaining pending sessions, when the client clicks "Connect Another Bank Account" and completes a second Stripe FC flow, then session[1] is updated to "completed" with its accounts, and the client sees a running total of all connected accounts.
- [x] AC 8: Given an active bundle, when the client clicks "I'm Done", then the bundle status becomes "completed" and the page shows a final summary of all connected accounts.
- [x] AC 9: Given a bundle where all N sessions have been completed via the results endpoint, then the bundle is auto-completed server-side (status set to "completed" by the results endpoint SQL), and the client sees the final summary without needing a separate POST to `/complete`.

**Bundle Retrieval:**
- [x] AC 10: Given a firm API key and a completed bundle ID, when GET /api/bundles/{id} is called, then the response contains `{ status: "completed", sessions_completed: N, sessions_total: N, accounts: [...] }` with all connected accounts aggregated from all completed sessions.
- [x] AC 11: Given a firm API key and an active bundle, when GET /api/bundles/{id} is called, then the response contains `{ status: "active", sessions_completed: M, sessions_total: N, accounts: [...] }` with accounts from completed sessions.
- [x] AC 12: Given a firm API key, when GET /api/bundles/{id} is called for a bundle belonging to a different firm, then a 404 response is returned.
- [x] AC 13: Given a firm API key and an expired bundle that had 2 sessions completed before expiry, when GET /api/bundles/{id} is called, then the response contains `{ status: "expired", sessions_completed: 2, accounts: [...] }` with the 2 completed sessions' accounts still accessible.

**Expiry & Edge Cases:**
- [x] AC 14: Given an expired bundle token, when a client visits `/b/{token}`, then the page displays an "expired" message and does not load the Stripe SDK.
- [x] AC 15: Given a firm API key and a pending bundle whose `expires_at` has passed, when GET /api/bundles/{id} is called, then the response contains `status: "expired"` and `accounts: []`.
- [x] AC 16: Given a session that has already been completed, when results are submitted again for the same `session_index`, then a 409 Conflict response is returned.
- [x] AC 17: Given a result submission POST without an `X-Bundle-Token` header, when the request is received, then a 401 Unauthorized response is returned.
- [x] AC 18: Given a result submission POST with an `Origin` header that doesn't match `NEXT_PUBLIC_APP_URL`, then a 403 Forbidden response is returned.

**Returning Client:**
- [x] AC 19: Given an active bundle (some sessions completed, some pending), when the client re-visits `/b/{token}`, then the page shows previously connected accounts and offers to continue connecting with the next pending session.

**CSP (fixing inherited gap):**
- [x] AC 20: Given a client visiting `/b/{token}` or `/c/{token}`, when the response headers are inspected, then a `Content-Security-Policy` header is present with `script-src 'self' https://js.stripe.com; frame-src https://js.stripe.com;`.

## Additional Context

### Dependencies

No new dependencies required. Uses existing Stripe SDK, Drizzle ORM, and Zod. All changes are additive to the current codebase.

### Testing Strategy

**Pre-Production (BLOCKING):**
- [ ] **Empirically test Stripe FC session lifetime:** Create a Stripe FC session in test mode. Attempt to use the `client_secret` at 24-hour, 48-hour, and 72-hour intervals. Document the actual expiry behavior. This test determines whether the 72-hour default bundle expiry is viable or needs adjustment. Stripe does not publicly document the FC session lifetime — this must be verified empirically before production launch.

**Manual Testing Sequence:**
1. Start local dev server (`npm run dev`)
2. Create a firm via `curl POST /api/firms` (if not already done)
3. Create a bundle via `curl POST /api/bundles` with Stripe test keys and `max_sessions: 3`
4. Verify response contains `url`, `status: "pending"`, `max_sessions: 3`
5. Open the bundle URL in browser
6. Verify consent page renders with firm name and content
7. Click "Connect", complete Stripe test bank flow for institution 1
8. Verify success state shows connected account + "Connect Another" button
9. Click "Connect Another", complete flow for institution 2
10. Verify running total shows both institutions
11. Click "I'm Done"
12. Verify final summary page
13. Poll `GET /api/bundles/{id}` — verify `status: "completed"`, `sessions_completed: 2`, accounts array has both institutions with `provider_account_id` + `account_metadata` shape
14. Re-visit the bundle URL — verify "Already Connected" page with full account list

**Auto-Complete Testing:**
- Create bundle with `max_sessions: 2`, complete both sessions — verify bundle auto-completes server-side without needing a POST to `/complete`
- Verify `sessions_remaining: 0` in the final result submission response

**Edge Case Testing:**
- Create bundle, let it expire, visit URL → verify expired message
- Create bundle, complete 1 session, let it expire, poll → verify `status: "expired"` with 1 account still returned
- Create bundle, submit results for same session_index twice → verify 409
- Create bundle, submit results without X-Bundle-Token → verify 401
- Create bundle with firm A, retrieve with firm B → verify 404
- Verify CSP headers on both `/c/` and `/b/` pages

**API Testing:**
- Test all four bundle endpoints with curl/httpie
- Verify auth (valid key, invalid key, missing key)
- Verify bundle lifecycle (create → pending → active → completed)
- Verify firm isolation
- Verify expiry handling (accounts preserved on expired active bundles)

### Notes

**High-Risk Items:**
- **Stripe FC session lifetime is undocumented.** Stripe does not publish how long a Financial Connections session's `client_secret` remains valid. Analogous Stripe products (Checkout Sessions, Identity VerificationSessions) expire after 24 hours. The pre-production empirical test (see Testing Strategy) is **blocking** — if FC sessions expire in less than 72 hours, the default `expires_in_hours` must be reduced to match, or the architectural approach reconsidered. The `BundleAuthFlow` handles stale-secret errors gracefully with a clear message ("contact your accountant for a new link"), but this is a fallback, not a solution.
- **All-or-nothing session creation**: If session creation fails within `Promise.all` (e.g., Stripe rate limit), the entire bundle creation fails with 502. No partial bundles. The firm agent retries the full request. `Promise.all` will reject on the first failure — the other parallel session creations will complete in the background (Stripe has already processed them) but their results are discarded. This is acceptable since unused sessions are free.
- **JSONB atomic updates**: The `jsonb_set()` with CAS pattern is sound for sequential access but hasn't been battle-tested at scale. The sequential client flow inherently prevents concurrent writes to the same session index, so the CAS is a safety net, not a primary concurrency mechanism.

**Known Limitations:**
- No way to add sessions to an existing bundle — firm creates a new bundle (new link) if more institutions are needed.
- Unused sessions waste Stripe FC session resources (but sessions are free to create).
- If client closes browser mid-flow without clicking "I'm Done", bundle stays `active` until expiry. Firm still gets all connected accounts via polling.
- Max 20 sessions per bundle (Zod validation cap). If a client genuinely has 20+ institutions, firm creates additional bundles.
- Publishable key is not validated against the Stripe account (inherited gap from channels — the secret key is validated via account pinning, but the publishable key is echoed through without cross-checking). Low practical risk since mismatched keys would cause the Stripe.js modal to fail.

**Adversarial Review Resolution Log:**
- F1 (data format): **Fixed** — results stored as `ProviderResultItem` shape, matching channels
- F2 (session expiry): **Acknowledged** — default expiry set to 72h, pre-production empirical test added as blocking
- F3 (complete rate limit): **Fixed** — 5/min per bundle
- F4 (expiresAt notNull): **Fixed** — matches channels constraint
- F5 (sequential latency): **Fixed** — `Promise.all` parallelization after session 0
- F6 (JSONB path interpolation): **Fixed** — developer note added to Task 6
- F7 (auto-complete race): **Fixed** — server-side auto-complete in results endpoint SQL
- F8 (accounts null vs array): **Fixed** — always return accounts array, never null
- F9 (generateChannelToken naming): **Deferred** — naming nit, not worth a spec revision
- F10 (middleware no-op): **Fixed** — Task 10 adds actual CSP headers for both `/c/` and `/b/`
- F11 (header name confusion): **Fixed** — bold callouts in Tasks 6, 7, 9
- F12 (indexing): **Deferred** — unique constraint + PK cover all queries at this scale
- F13 (min(1) accounts): **Deferred** — consistent with existing channel pattern
- F14 (publishable key validation): **Deferred** — inherited gap, noted in limitations
- F15 (expired active data loss): **Fixed** — expired bundles still return accounts

**v2 Considerations (out of scope):**
- Bundle listing endpoint with pagination and status filtering (`GET /api/bundles?status=active`)
- Webhook notification when bundle reaches `completed` or `active` (avoid polling)
- Lazy session creation (create sessions on demand from stored credentials — breaks transient model but improves session freshness for later institutions)
- Bundle analytics (sessions used vs created, time between connections)
