# AMA Platform Runbook

Audience: the **platform operator** (TYR). Everything here requires some combination of this repo checkout, Vercel auth (`tyr-jer`), the platform admin key, and prod DB access — none of which firms or their agents have.

Other docs: firm-facing onboarding → `docs/firm-onboarding.md`. Agent/consumer usage (bundles, mapping, pulls, troubleshooting) → the tyr-bookkeeping skill (`operations/connect-bank-feeds.md`, `reference/bank-feeds-troubleshooting.md`).

## Service map

- **Prod:** https://auth-my-accountant.vercel.app — Vercel project `tyr-projects/auth-my-accountant`
- **DB:** Neon Postgres via Vercel Marketplace. **The production `DATABASE_URL` is NOT the one in `.env.local`** — `.env.local` was pulled from the *development* env and points at a different branch. Always pull `--environment=production` when you mean prod.
- **Tables:** `firms`, `channels`, `channel_results`, `bundles`, `rate_limits`
- **Logs:** `vercel logs <deployment-url>` or the Vercel dashboard — every endpoint logs one structured JSON line (endpoint, status, duration, ids).

## Health probes

```bash
curl -s -o /dev/null -w "%{http_code}" https://auth-my-accountant.vercel.app/          # 200 = up
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer bogus" \
  https://auth-my-accountant.vercel.app/api/bundles/00000000-0000-0000-0000-000000000000  # 401 = auth enforced
# With a real firm key, the same request → 404 ("Not found") = full auth chain healthy
```

## Environment variables (prod)

`ADMIN_API_KEY`, `NEXT_PUBLIC_APP_URL`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`.

```bash
# Inspect (NEVER omit --environment=production; the default pulls development)
vercel --cwd <repo> env pull /tmp/ama-prod-env --environment=production --yes
# ... read what you need, then: rm /tmp/ama-prod-env   (it contains secrets)

# Set/replace WITHOUT a trailing newline (printf, not echo):
vercel --cwd <repo> env rm NAME production --yes
printf '%s' "$VALUE" | vercel --cwd <repo> env add NAME production
```

A trailing newline in an env value breaks exact-match auth and origin checks invisibly (headers can't carry `\n`). The code trims env reads as defense in depth — keep the `printf` hygiene anyway.

**`NEXT_PUBLIC_*` values are inlined at build time** — changing one requires a rebuild (`vercel --prod` or `vercel redeploy`), not just a new deployment alias.

## Deploys

```bash
vercel --cwd <repo> --prod                                        # build + deploy current working tree
vercel --cwd <repo> redeploy https://auth-my-accountant.vercel.app  # rebuild last deployment (picks up env changes)
vercel --cwd <repo> rollback                                      # revert the prod alias to the previous deployment
npm run db:push                                                   # push schema changes (verify which DATABASE_URL is in scope first!)
```

## Firm lifecycle

**Provision** (the `api_key` is returned exactly once — capture it immediately and deliver securely):

```bash
ADMIN_KEY=<from prod env pull>
curl -s -X POST https://auth-my-accountant.vercel.app/api/firms \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Firm Name"}'        # optional: "stripe_account_id":"acct_…" to pin
```

**Prod DB access pattern** (read-only by default; writes only with explicit intent):

```bash
DBURL=$(grep '^DATABASE_URL=' /tmp/ama-prod-env | head -1 | cut -d= -f2- | tr -d '"')
DATABASE_URL="$DBURL" node -e '
const {neon}=require("<repo>/node_modules/@neondatabase/serverless");
const sql=neon(process.env.DATABASE_URL);
(async()=>{ console.log(await sql`select id,name,status from firms order by created_at`); })()'
```

**Rename:** `update firms set name=${newName} where id=${firmId}` via the pattern above.

**Deactivate:** `update firms set status='inactive' where id=${firmId}` — firm auth filters on `status='active'`, so this kills the key immediately without deleting history.

**Lost firm key:** there is no rotate endpoint (platform gap). Two recovery paths:
1. *Hash swap (keeps firm id):* generate a key locally in the same format (`acp_` + 64 hex chars), SHA-256-hex it, `update firms set api_key_hash=${hash} where id=${firmId}`, deliver the new key. (`lib/auth.ts`: `generateApiKey` / `hashApiKey`.)
2. *Replacement firm:* provision a new firm, deactivate the old one. Bundles/channels stay queryable under the old firm only — prefer the hash swap when history matters.

For current firm state, query the `firms` table (pattern above) — never trust a doc for live state; git holds the history.

## Diagnostics

| Symptom | Check |
|---|---|
| Firm reports 401 on valid-looking key | Firm `status` in DB; key against `api_key_hash` (sha256); header is `Authorization: Bearer …` |
| Client finished connecting, but bundle shows no accounts | Origin validation: browser `Origin` must EXACTLY equal `NEXT_PUBLIC_APP_URL`. Check Vercel logs for the results POST status. |
| Bundle URL malformed | `NEXT_PUBLIC_APP_URL` content (the 2026-06-10 newline class) — URL is `${baseUrl}/b/${token}` |
| 429s | `rate_limits` table; per-endpoint limits in README |
| Stripe errors at bundle creation | Passed through verbatim to the firm — usually their key scopes (need FC RW **+ Customers Write**) or FC not enabled live |

## Stripe notes

The platform never stores firm Stripe credentials — they're used transiently at session creation. Firms own their Stripe relationship entirely (keys, FC enablement, data pricing). Minimum restricted-key scopes for a firm: **Financial Connections Read+Write, Customers Write**.
