# Security Policy

Report a suspected vulnerability privately to **hello@wagmi.fyi**. Write "security"
in the subject line.

Do not open a GitHub issue for a vulnerability. Issues on this repository are
public from the moment you file one.

You do not need an account, a contract, or a relationship with an accounting firm
to use this address. Anyone can report.

## What to send

- What you did.
- What happened.
- What you expected instead.
- The affected file, endpoint, or URL.
- The commit you tested, if you tested the code.

A proof of concept helps. Put it in the message body as text.

## What happens next

We acknowledge every report that reaches this address.

You then get one of two answers: we reproduced it, or we could not. A reproduced
finding also gets our plan and a rough date. If we judge the behavior is not a
vulnerability, we say why rather than going quiet.

When the fix ships, we tell you. We credit you by name unless you ask us not to.

## Scope

In scope:

- The code in this repository.
- The instance WAGMI operates at `auth-my-accountant.vercel.app`.

Out of scope:

- Stripe, Vercel, and Neon. Each runs its own program. Report an issue in their
  systems to them.
- An instance somebody else self-hosts from this code. Report that to whoever
  runs it.

## Testing the instance WAGMI operates

That instance holds real accounting firms' data and real people's bank account
references. Run your own deployment and test against that.

If you have to test against ours, stay inside these limits:

- No automated scanning. No load testing or denial-of-service testing.
- Do not read, change, or keep data belonging to anyone else. Use your own.
- Stop as soon as you have confirmed the problem, then tell us.

We will not pursue a researcher who stays inside these limits and reports what
they find.

## What the platform is meant to do

`docs/security.md` states what the platform stores, what it never stores, and
how it protects the difference. Read it to find out what the design promises.
This file is how you tell us the design did not hold.
