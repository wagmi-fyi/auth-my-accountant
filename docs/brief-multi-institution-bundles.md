# Feature Brief: Multi-Institution Auth Bundles

## Problem

A firm's client may need to connect accounts at multiple financial institutions (e.g., Chase AND Wells Fargo). Currently, each channel = one Stripe FC session = one institution. To connect multiple institutions, the firm agent must create separate channels, generating separate URLs, requiring separate emails to the client. This is poor UX for multi-institution scenarios.

## Proposed Solution: Channel Bundles

A "bundle" groups multiple channels under a single client-facing URL. The firm creates a bundle with N channel requests in one API call. Each channel gets its own Stripe FC session (preserving the transient credential model). The client visits one URL and completes each auth flow sequentially.

## API Design

### POST /api/bundles

Authenticated with firm API key. Creates multiple channels in one request.

```json
{
  "channels": [
    {
      "provider": "stripe_fc",
      "provider_config": { "permissions": ["transactions", "balances"] },
      "credentials": { "secret_key": "sk_test_...", "publishable_key": "pk_test_..." }
    },
    {
      "provider": "stripe_fc",
      "provider_config": { "permissions": ["transactions", "balances"] },
      "credentials": { "secret_key": "sk_test_...", "publishable_key": "pk_test_..." }
    }
  ],
  "consent": {
    "title": "Connect Your Bank Accounts",
    "body": "We need access to your accounts at multiple banks.",
    "firm_name": "Acme Accounting"
  },
  "client_ref": "client-123",
  "expires_in_hours": 24
}
```

**Response:**
```json
{
  "id": "bundle-uuid",
  "url": "https://authmyaccountant.com/b/{bundle_token}",
  "channels": [
    { "id": "ch-uuid-1", "status": "pending" },
    { "id": "ch-uuid-2", "status": "pending" }
  ],
  "status": "pending",
  "expires_at": "..."
}
```

### GET /api/bundles/:id

Returns bundle status + aggregated results from all channels.

**Bundle status logic:**
- `pending` — at least one channel is pending
- `completed` — all channels are completed
- `partial` — some completed, some expired/failed
- `expired` — all expired

## Database Changes

### New table: `bundles`
- `id` (uuid, PK)
- `firm_id` (uuid, FK → firms)
- `token` (text, unique) — used in client URL `/b/{token}`
- `consent` (jsonb)
- `client_ref` (text, nullable)
- `status` (text: pending, completed, partial, expired)
- `expires_at` (timestamp)
- `created_at` (timestamp)

### Modify: `channels`
- Add `bundle_id` (uuid, nullable, FK → bundles) — null for standalone channels

## Client-Facing Page

### Route: `/app/b/[token]/page.tsx`

Server Component:
1. Load bundle + all associated channels
2. Determine which channels are pending (not yet completed)
3. Render consent content once at the top
4. Pass first pending channel's data to AuthFlow component

### Modified AuthFlow behavior in bundle context:
1. Client completes auth flow for channel 1
2. On success, instead of showing final success, check if more channels are pending
3. Show "Bank connected! Connect your next bank account" with a "Continue" button
4. Load next pending channel's `clientSecret` + `publishableKey`
5. Repeat until all channels are done
6. Show final success with all connected accounts across all institutions

**Key detail:** Each channel has its own `clientSecret` and `publishableKey` (created upfront during bundle creation). The page just cycles through them sequentially. No new server calls to create sessions — everything was pre-created.

## Constraints & Notes

- **Transient credential model preserved** — all Stripe sessions are created at bundle creation time, secrets discarded immediately. Same pattern as standalone channels.
- **Stripe account pinning applies** — if the firm has a pinned `stripe_account_id`, all channels in the bundle are verified against it.
- **Rate limiting applies** — bundle creation counts as N channel creations against the firm's rate limit.
- **Backwards compatible** — standalone `POST /api/channels` continues to work unchanged. Bundles are additive.
- **Mixed providers possible** — each channel in a bundle can use a different provider (e.g., Stripe FC for one, Plaid for another when Plaid is added). The page dispatches to the right AuthFlow sub-component per channel.
- **Partial completion** — if the client completes 2 of 3 flows and closes the browser, the firm sees `status: "partial"` with results for the completed channels. The client can re-open the URL to complete remaining flows.
- **Individual channels in a bundle can be polled** — `GET /api/channels/:id` still works for each channel independently.

## Implementation Scope

### New files:
- `app/api/bundles/route.ts` — POST handler (create bundle)
- `app/api/bundles/[id]/route.ts` — GET handler (retrieve bundle + results)
- `app/b/[token]/page.tsx` — Server Component for bundle auth page
- `app/b/[token]/BundleAuthFlow.tsx` — Client Component that cycles through channels

### Modified files:
- `lib/schema.ts` — add `bundles` table, add `bundle_id` to `channels`
- `lib/validation.ts` — add `createBundleSchema`
- `lib/auth.ts` — add `generateBundleToken()` (or reuse `generateChannelToken`)

### Unchanged:
- Provider interface, provider implementations, result submission endpoint, firm registration — all unchanged.

## Acceptance Criteria

- [ ] Firm can create a bundle with 2+ channels in one API call
- [ ] Client receives a single URL for the bundle
- [ ] Client completes auth flows sequentially, one per institution
- [ ] After each flow, client sees progress ("1 of 3 connected") and continues
- [ ] After all flows complete, client sees summary of all connected accounts
- [ ] Firm can poll bundle status and see aggregated results
- [ ] Partial completion is handled — client can return to finish remaining flows
- [ ] Standalone channels continue to work unchanged
- [ ] Rate limiting counts each channel in the bundle against firm limits
- [ ] Stripe account pinning validates all channels in the bundle

## Estimated Complexity

Moderate. The core infrastructure (providers, auth, result submission) is unchanged. Main work is the bundle API layer, the new client page with sequential flow logic, and the schema additions. The sequential AuthFlow component is the most nuanced piece — managing state across multiple provider sessions in a single page session.
