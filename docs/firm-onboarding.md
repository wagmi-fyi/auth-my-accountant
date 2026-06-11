# Onboarding Your Firm to Auth My Accountant

Auth My Accountant (AMA) is a session broker for connecting your clients' financial accounts. You request a link, send it to your client, they authenticate their banks through Stripe Financial Connections, and you retrieve the connected account IDs (`fca_…`) by API — ready for transaction and balance pulls in your own tooling. AMA never sees or stores bank credentials, and stores no transaction data — only account IDs and display metadata (institution, last4, type).

## Prerequisites (your firm's side)

1. **A Stripe account** with **Financial Connections enabled** — live mode activation, including transactions data access (Stripe Dashboard → Financial Connections). Data pricing is between you and Stripe.
2. **API keys** from that account:
   - A **restricted secret key** with minimum scopes: **Financial Connections: Read + Write** and **Customers: Write** (AMA creates one transient Customer per bundle as the account holder). A full secret key also works; restricted is recommended.
   - Your **publishable key**.
3. Somewhere secure to keep your AMA firm key (an env var like `AMA_FIRM_API_KEY` is the expected pattern).

## Provisioning

Firm accounts are provisioned by the platform operator (there is no self-service signup). You'll receive your firm API key (`acp_…`) **exactly once** — store it immediately. Lost keys cannot be recovered, only replaced (contact the operator).

## Your first bundle

A *bundle* is one link your client can use to connect up to 20 institutions.

```bash
curl -X POST https://auth-my-accountant.vercel.app/api/bundles \
  -H "Authorization: Bearer $AMA_FIRM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "stripe_fc",
    "provider_config": {
      "permissions": ["transactions", "balances"],
      "prefetch": ["transactions", "balances"]
    },
    "credentials": {
      "secret_key": "rk_live_…",
      "publishable_key": "pk_live_…"
    },
    "consent": {
      "title": "Connect Your Bank Accounts",
      "body": "Please connect the accounts used for your business so we can retrieve transactions and balances for your bookkeeping.",
      "firm_name": "Your Firm Name"
    },
    "client_ref": "your-client-id",
    "max_sessions": 5,
    "expires_in_hours": 72
  }'
```

Your Stripe credentials are used once, during creation, and are not stored. The response contains the `url` to send to your client and the bundle `id` you'll poll:

```bash
curl https://auth-my-accountant.vercel.app/api/bundles/{id} \
  -H "Authorization: Bearer $AMA_FIRM_API_KEY"
```

Connected accounts appear as `{provider_account_id, account_metadata: {institution_name, last4, category, subcategory, display_name, status}, session_index}`.

## Lifecycle facts worth knowing

- Links expire (default 72h, max 168h). **Connected accounts remain retrievable from expired bundles indefinitely** — connecting is time-boxed; retrieving results is not.
- One bank login can surface multiple accounts (including sub-cards under a control account).
- **Re-authentication** (broken/revoked connections) means a fresh bundle — and the re-connected account gets a **new `fca` id**. Design your account mapping to handle remaps.
- The consent title/body/firm name you pass render on the page your client sees — write them for your client.
- Rate limits apply per firm and endpoint — current values are documented in the API README.

## If your agents run the tyr bookkeeping skill

All of the above is already wrapped: `adapters/ama_client.py` (bundle create/status), `scripts/manage_bank_feeds.py` (account↔ledger mapping incl. remap), `operations/connect-bank-feeds.md` (the setup workflow), and `reference/bank-feeds-troubleshooting.md` (failure modes). Set `AMA_FIRM_API_KEY`, `STRIPE_API_KEY`, `STRIPE_PUBLISHABLE_KEY` in the client workspace's `adapters/.env` and run the operation.

## Security model

- Transient credentials: your Stripe keys are used at session creation and never persisted.
- No financial data at rest: account IDs and display metadata only.
- Client submissions are origin-validated; all tokens compared timing-safe; your firm key is stored only as a SHA-256 hash.

Full posture — including the data-handling model, your clients' controls, and inherited provider certifications — is in [`docs/security.md`](security.md). It's written to be shareable with the clients you ask to connect accounts.
