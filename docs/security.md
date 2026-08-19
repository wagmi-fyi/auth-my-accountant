# Security at Auth My Accountant

*Last reviewed: 2026-06 · Audience: firms evaluating the platform and the clients they ask to connect accounts.*

*Scope: this page describes the hosted instance of Auth My Accountant that WAGMI FYI LLC operates, and its provider certifications, software versions, and controls attest to that deployment only. Anyone running this open-source code on their own infrastructure needs their own security page.*

Auth My Accountant (AMA) is the secure link your accounting firm sends you to connect a financial account. This page explains, in plain terms, what the service does with your information — and what it deliberately never touches.

## The one thing that matters most

**Your bank username and password are never seen by this app, and never seen by your accounting firm.**

When you connect an account, you authenticate through **Stripe Financial Connections** — a regulated payments provider — and, where your bank supports it, you log in on *your bank's own website*. Stripe (or its trusted data partners) handles the credentials; the merchant/platform never receives them. Stripe states this directly: "If Stripe obtains your financial institution login credentials, we do not share them with your merchant." ([Stripe support](https://support.stripe.com/questions/what-data-does-stripe-access-from-my-linked-financial-account))

What AMA receives back is **not your login** — it's a tokenized reference to the account plus a little display detail (the institution name, the last four digits, the account type). That's it.

## What AMA stores — and doesn't

| Data | Stored? | Notes |
|---|---|---|
| Your bank login / password | **Never** | Handled by Stripe / your bank; AMA never receives it. |
| Your transactions, balances, full account number | **Not stored by AMA** | These are retrieved by your firm's bookkeeping tools directly from Stripe under your consent — AMA itself only brokers the connection. |
| Tokenized account reference (`fca_…`) | Yes | An opaque ID; not your account number. |
| Display metadata | Yes | Institution name, last 4 digits, account type/nickname. |
| Your firm's Stripe secret key | **Never stored, never logged** | Used once, in-memory, to create the connection session, then discarded. |

Everything AMA does store lives in a database encrypted at rest with AES-256 and reachable only over encrypted connections (see Infrastructure below).

## What a breach could — and couldn't — expose

AMA is built to hold as little as possible, so that even a worst-case compromise has a small blast radius. The sensitive material simply isn't here to steal:

- **Credentials, balances, transactions, and full account numbers are never in AMA** — not in the database, not in logs. Bank logins go to Stripe/your bank; financial data is pulled by your firm's bookkeeping tools directly from Stripe under your consent and never passes through AMA.
- **The stored account reference (`fca_…`) is inert on its own.** Retrieving any data with it requires your firm's Stripe secret key — which AMA never stores. So a stolen reference can't be turned into anyone's transactions or balances; there is no path from an AMA compromise to your financial data.
- **The ceiling on what's retrievable** — even if our entire database were dumped — is low-sensitivity account *fingerprints* (institution name, last 4 digits, account type), your firm's internal client labels, and short-lived session tokens that expire within days and grant no access to financial data.

In plain terms: the things that could move money or unlock your records are deliberately kept out of this system. We hold pointers and display scraps, not the keys.

*One honest caveat for technical reviewers:* account-fingerprint metadata across many clients, while it can't be used to access funds or records, is still information that could aid a phishing or social-engineering attempt. We treat it as protected data accordingly — it lives only in the encrypted, access-controlled database described below.

## How connecting an account works

1. Your firm creates a one-time secure link and sends it to you.
2. You open it and see a **consent screen** naming your firm and what's being requested.
3. You pick your institution and authenticate through Stripe — on your bank's own site where supported (OAuth), or directly with Stripe/its partners otherwise. "Your user never shares their login credentials with Stripe" in the OAuth case. ([Stripe docs](https://docs.stripe.com/financial-connections/fundamentals))
4. **You see and approve exactly what's shared.** Stripe permissions data by scope — balances, transactions, ownership, payment method — and "you will have to provide consent before we share this information with your merchant." ([Stripe support](https://support.stripe.com/questions/who-can-access-data-that-ive-shared-from-my-linked-financial-account-and-for-what-purposes))
5. The connection's tokenized account ID returns to your firm. No transaction data passes through AMA.

The link is single-purpose and time-limited (it expires, by default within a few days). Connecting can only happen before expiry.

## Your controls

- **Consent is explicit and scoped.** You approve the specific data types before anything is shared; broadening them later requires you to go through the flow again.
- **You can disconnect at any time.** You can ask your firm to revoke access, or request disconnection (and data deletion) directly from Stripe. ([How to disconnect](https://support.stripe.com/questions/how-can-my-users-disconnect-or-request-deletion-of-the-data-from-their-linked-financial-accounts)) Stripe does not sell your financial account information to third parties. ([Stripe support](https://support.stripe.com/questions/who-can-access-data-that-ive-shared-from-my-linked-financial-account-and-for-what-purposes))

## Infrastructure and compliance

AMA is built on three providers that carry independent, audited security certifications:

- **Stripe** (bank connectivity) — PCI DSS **Service Provider Level 1**, the most stringent level in the payments industry; **SOC 1 & SOC 2 Type II** reports produced annually; bank account information is tokenized and "encrypted in transit and at rest." ([Stripe security](https://docs.stripe.com/security), [FC safety](https://support.stripe.com/questions/is-my-financial-account-information-safe))
- **Vercel** (hosting) — **SOC 2 Type 2** attestation and **ISO 27001:2022** certification; every deployment served over **HTTPS/TLS 1.3**; data encrypted at rest with **AES-256**; automatic DDoS mitigation. ([Vercel compliance](https://vercel.com/docs/security/compliance))
- **Neon** (database) — **SOC 2 Type 1 & 2** and **ISO 27001 / 27701**; **AES-256** encryption at rest with managed key rotation; **TLS 1.2/1.3** enforced in transit. ([Neon security](https://neon.com/docs/security/security-overview), [Neon compliance](https://neon.com/docs/security/compliance))

## Application security controls

What the AMA application itself enforces:

- **Transient credentials.** Your firm's Stripe secret key is used once to create a session and is never persisted or written to logs.
- **No credential storage.** Firm API keys are stored only as **SHA-256 hashes**; a database read never yields a usable key. Secret comparisons are **timing-safe**.
- **Strict access scoping.** Every firm can only read its own connections — requests are filtered by firm identity at the database layer; identifiers are unguessable UUIDs with high-entropy tokens.
- **Browser-submission protections.** Client-facing submissions are origin-validated and carry a timing-safe single-use token; connection links expire and cannot be reused after completion or expiry.
- **Rate limiting** on every API endpoint, failing closed (a backend error denies rather than bypasses).
- **HTTPS/TLS 1.3 everywhere**, and a **Content-Security-Policy** restricting script and frame sources on the account-connection pages.
- **Transparent logging.** Operational logs record identifiers, status, and timing only — never secrets or financial data.

## Recent hardening

- Runs **Next.js 16.2.6**, which includes the fix for the SSRF advisory **GHSA-c4j6-fc7j-m34r** (shipped in 16.2.5). Vercel-hosted deployments were not affected by that issue; the platform was upgraded as defense in depth. ([Advisory](https://github.com/advisories/GHSA-c4j6-fc7j-m34r))

## Responsible disclosure

Security is reviewed on an ongoing basis. If you believe you've found a vulnerability, contact the platform operator (your accounting firm can route this to us) — please report privately rather than disclosing publicly, and allow reasonable time to remediate.

---

*This document describes the security posture of the Auth My Accountant platform. It is not a substitute for the security documentation of Stripe, Vercel, or Neon, linked throughout. Provider certifications are accurate as of the last-reviewed date above; consult each provider's trust page for current attestations.*
