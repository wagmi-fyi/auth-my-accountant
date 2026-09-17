// Checks sign-up, the caps, the provider binding, the client page line and
// suspension against a local run. It never reaches a deployed copy.
//
// The local run needs AMA_ENABLE_TEST_PROVIDER=1 and the same
// SIGNUP_DAILY_CAP and SIGNUP_PER_ADDRESS_HOURLY this script reads. The
// script resets today's sign-up count in the database it is given, and
// deletes the firms it made when it ends.
//
//   node --env-file=<file> scripts/check-local.mjs [server log file]
//
// The env file holds DATABASE_URL and ADMIN_API_KEY for the local run.

import crypto from "node:crypto";
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`Refusing ${BASE}: this script runs against a local copy only.`);
  process.exit(2);
}
const ADMIN = process.env.ADMIN_API_KEY?.trim();
const DAILY_CAP = Number(process.env.SIGNUP_DAILY_CAP ?? 20);
const PER_ADDRESS = Number(process.env.SIGNUP_PER_ADDRESS_HOURLY ?? 3);
const LOG_FILE = process.argv[2];
const sql = neon(process.env.DATABASE_URL.trim());

const results = [];
// A detail never carries a response body: bodies hold keys and link tokens.
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const runTag = crypto.randomBytes(3).toString("hex");
const madeFirms = [];
const addressPrefix = `10.244.${crypto.randomInt(0, 255)}`;
let addressCount = 0;
const newAddress = () => `${addressPrefix}.${++addressCount}`;

async function call(method, path, { key, body, address } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (address) headers["X-Real-IP"] = address;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, json, text };
}

async function signup(address, name = `w244 check ${runTag}`) {
  const res = await call("POST", "/api/signup", { address, body: { name } });
  if (res.status === 201) madeFirms.push(res.json.id);
  return res;
}

const probe = (key) =>
  call("GET", "/api/bundles/00000000-0000-0000-0000-000000000000", { key });

function linkBody(accountRef, verifiedName = "none") {
  return {
    provider: "test",
    provider_config: { permissions: ["transactions"] },
    credentials: { secret_key: accountRef, publishable_key: verifiedName },
    consent: { title: "Connect", body: "Check run.", firm_name: "Check Firm" },
    max_sessions: 1,
  };
}

async function main() {
  await sql`DELETE FROM rate_limits WHERE identifier = 'all' AND endpoint = 'POST /api/signup daily'`;

  // 1. Sign-up gives a working key, once, uncached.
  const home = newAddress();
  const first = await signup(home);
  const key1 = first.json?.api_key ?? "";
  check("sign-up answers 201", first.status === 201, `got ${first.status}`);
  check("the answer carries a firm key", key1.startsWith("acp_") && key1.length === 68);
  check("the answer is not cached", first.headers.get("cache-control") === "no-store");
  check("the new key works", (await probe(key1)).status === 404);

  // 2. The per-address limit.
  for (let i = 1; i < PER_ADDRESS; i++) await signup(home);
  const limited = await signup(home);
  check("one sign-up past the address limit gets 429", limited.status === 429);
  check("it says rate_limited", limited.json?.code === "rate_limited");
  check("its words give the wait in minutes", /Try again in \d+ minutes?\./.test(limited.json?.error ?? ""), limited.json?.error);
  check("it carries Retry-After", Number(limited.headers.get("retry-after")) > 0);

  const bad = await call("POST", "/api/signup", { address: newAddress(), body: { name: "" } });
  check("an empty name gets 400", bad.status === 400);

  // 3. The daily cap.
  for (let i = PER_ADDRESS; i < DAILY_CAP; i++) await signup(newAddress());
  const over1 = await signup(newAddress());
  const over2 = await signup(newAddress());
  check("the first sign-up past the daily cap gets 429", over1.status === 429);
  check("it says daily_cap_reached", over1.json?.code === "daily_cap_reached", over1.json?.error);
  check("the next one is refused too", over2.json?.code === "daily_cap_reached");
  check("the firms made match the cap", madeFirms.length === DAILY_CAP, `${madeFirms.length}`);

  const digest = await call("GET", "/api/firms?since=" + new Date(Date.now() - 600000).toISOString(), { key: ADMIN });
  const cap = digest.json?.signup_cap;
  check("the digest answers 200", digest.status === 200);
  check("the digest lists every firm made", madeFirms.every((id) => digest.json.firms.some((f) => f.id === id)));
  check("the digest says the cap was reached", cap?.cap_reached === true && cap?.signups === DAILY_CAP && cap?.refused_over_cap === 2, JSON.stringify(cap));

  // 4. The binding.
  const bundleA = await call("POST", "/api/bundles", { key: key1, body: linkBody("acct_A", "Acme Books LLC") });
  check("a first link with account A answers 201", bundleA.status === 201, `got ${bundleA.status}`);
  const bundleB = await call("POST", "/api/bundles", { key: key1, body: linkBody("acct_B") });
  check("a link with account B gets 403", bundleB.status === 403);
  check("it says provider_account_mismatch", bundleB.json?.code === "provider_account_mismatch", bundleB.json?.error);
  const bundleA2 = await call("POST", "/api/bundles", { key: key1, body: linkBody("acct_A") });
  check("a link with account A again answers 201", bundleA2.status === 201);
  const channelB = await call("POST", "/api/channels", { key: key1, body: linkBody("acct_B") });
  check("the channel route refuses account B", channelB.status === 403 && channelB.json?.code === "provider_account_mismatch");
  const channelA = await call("POST", "/api/channels", { key: key1, body: linkBody("acct_A") });
  check("the channel route takes account A", channelA.status === 201, `got ${channelA.status}`);
  const [bound] = await sql`SELECT verified_name FROM firm_provider_bindings WHERE firm_id = ${madeFirms[0]}`;
  check("a later link with no name keeps the verified name", bound?.verified_name === "Acme Books LLC");

  // A key that cannot say which account it is: the link is made, the
  // binding is left alone, and its page shows no verified name.
  const cannotSay = await call("POST", "/api/bundles", { key: key1, body: linkBody("unknown") });
  check("a bound firm's key that cannot say still makes a link", cannotSay.status === 201, `got ${cannotSay.status}`);
  const [still] = await sql`SELECT account_ref, verified_name FROM firm_provider_bindings WHERE firm_id = ${madeFirms[0]}`;
  check("and leaves the binding as it was", still?.account_ref === "acct_A" && still?.verified_name === "Acme Books LLC");
  const cannotSayChannel = await call("POST", "/api/channels", { key: key1, body: linkBody("unknown") });
  check("the channel route makes that link too", cannotSayChannel.status === 201);

  const unknownProvider = await call("POST", "/api/bundles", { key: key1, body: { ...linkBody("acct_A"), provider: "stripe_fcx" } });
  check("an unknown provider gets 400", unknownProvider.status === 400);

  const key2 = (await call("POST", "/api/firms", { key: ADMIN, body: { name: `w244 check ${runTag} admin` } })).json?.api_key;
  const firm2 = (await sql`SELECT id FROM firms WHERE name = ${`w244 check ${runTag} admin`}`)[0]?.id;
  madeFirms.push(firm2);
  const unbound = await call("POST", "/api/bundles", { key: key2, body: linkBody("unknown") });
  check("a provider that cannot say answers 201", unbound.status === 201);
  const none = await sql`SELECT count(*)::int AS n FROM firm_provider_bindings WHERE firm_id = ${firm2}`;
  check("and makes no binding", none[0].n === 0);
  const failed = await call("POST", "/api/bundles", { key: key2, body: linkBody("fail") });
  check("a provider that fails gets 502 provider_identify_failed", failed.status === 502 && failed.json?.code === "provider_identify_failed", failed.json?.error);

  // Two first links at once agree on one account.
  const key3 = (await call("POST", "/api/firms", { key: ADMIN, body: { name: `w244 check ${runTag} race` } })).json?.api_key;
  madeFirms.push((await sql`SELECT id FROM firms WHERE name = ${`w244 check ${runTag} race`}`)[0]?.id);
  const race = await Promise.all([
    call("POST", "/api/bundles", { key: key3, body: linkBody("acct_X") }),
    call("POST", "/api/bundles", { key: key3, body: linkBody("acct_Y") }),
  ]);
  const codes = race.map((r) => r.status).sort().join(",");
  check("two first links at once give one 201 and one 403", codes === "201,403", codes);

  // An admin-made firm bound at creation.
  const pinned = await call("POST", "/api/firms", { key: ADMIN, body: { name: `w244 check ${runTag} bound`, bind: { provider: "test", account_ref: "acct_P" } } });
  check("an admin firm made with a binding answers 201", pinned.status === 201, `got ${pinned.status}`);
  if (pinned.json?.id) madeFirms.push(pinned.json.id);
  const pinnedOther = await call("POST", "/api/bundles", { key: pinned.json?.api_key, body: linkBody("acct_Q") });
  check("its link with another account gets 403", pinnedOther.status === 403);
  const oldField = await call("POST", "/api/firms", { key: ADMIN, body: { name: "old field", stripe_account_id: "acct_1" } });
  check("the retired stripe_account_id field gets 400", oldField.status === 400);

  // 5. The client page line.
  const pageBound = await call("GET", `/b/${bundleA.json?.token}`);
  check("the bound firm's page shows the line", pageBound.text.includes("Their Test account is registered to Acme Books LLC."));
  const pageCannotSay = await call("GET", `/b/${cannotSay.json?.token}`);
  check("the page of a link whose key could not say has no line", pageCannotSay.status === 200 && !pageCannotSay.text.includes("account is registered to"));
  const channelCannotSay = await call("GET", `/c/${cannotSayChannel.json?.token}`);
  check("the same holds on the channel page", channelCannotSay.status === 200 && !channelCannotSay.text.includes("account is registered to"));
  const pageUnbound = await call("GET", `/b/${unbound.json?.token}`);
  check("the unbound firm's page has no line", pageUnbound.status === 200 && !pageUnbound.text.includes("account is registered to"));
  const channelPage = await call("GET", `/c/${channelA.json?.token}`);
  check("the channel page shows the line", channelPage.text.includes("Their Test account is registered to Acme Books LLC."));

  // 6. Suspend and reactivate.
  const suspend = await call("PATCH", `/api/firms/${madeFirms[0]}`, { key: ADMIN, body: { status: "suspended" } });
  check("suspend answers 200", suspend.status === 200 && suspend.json?.status === "suspended");
  check("the key fails on the next request", (await probe(key1)).status === 401);
  await call("PATCH", `/api/firms/${madeFirms[0]}`, { key: ADMIN, body: { status: "active" } });
  check("reactivated, the key works again", (await probe(key1)).status === 404);
  const badStatus = await call("PATCH", `/api/firms/${madeFirms[0]}`, { key: ADMIN, body: { status: "inactive" } });
  check("an unknown status gets 400", badStatus.status === 400);
  const noFirm = await call("PATCH", "/api/firms/not-a-uuid", { key: ADMIN, body: { status: "suspended" } });
  check("a bad firm id gets 404", noFirm.status === 404);

  // 7. The admin routes need the admin key.
  check("GET /api/firms without the admin key gets 401", (await call("GET", "/api/firms")).status === 401);
  check("GET /api/firms with a firm key gets 401", (await call("GET", "/api/firms", { key: key1 })).status === 401);
  check("PATCH without the admin key gets 401", (await call("PATCH", `/api/firms/${madeFirms[0]}`, { body: { status: "suspended" } })).status === 401);
  check("POST /api/firms without the admin key gets 401", (await call("POST", "/api/firms", { body: { name: "x" } })).status === 401);

  // 8. The server log.
  if (LOG_FILE) {
    await new Promise((r) => setTimeout(r, 1500));
    const log = fs.readFileSync(LOG_FILE, "utf8");
    check("the server log holds no firm key", !/acp_/.test(log));
    check("the server log holds no caller address", !log.includes(addressPrefix));
    const alerts = log.split("\n").filter((l) => l.includes('"alert":"signup_daily_cap_reached"'));
    check("the server log holds the cap alert", alerts.length >= 1, `${alerts.length}`);
  }
}

async function cleanup() {
  const ids = madeFirms.filter(Boolean);
  if (!ids.length) return;
  await sql`DELETE FROM firm_provider_bindings WHERE firm_id = ANY(${ids})`;
  await sql`DELETE FROM bundles WHERE firm_id = ANY(${ids})`;
  await sql`DELETE FROM channels WHERE firm_id = ANY(${ids})`;
  await sql`DELETE FROM firms WHERE id = ANY(${ids})`;
  await sql`DELETE FROM rate_limits WHERE identifier = 'all' AND endpoint = 'POST /api/signup daily'`;
  console.log(`cleaned up ${ids.length} firms`);
}

try {
  await main();
} catch (err) {
  check("the run finished", false, err instanceof Error ? err.message : String(err));
} finally {
  await cleanup();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
