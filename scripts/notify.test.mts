// @ts-nocheck
// Tests for lib/notify.mjs (the Slack notifier that also writes the in-house notification log) and scripts/notify-cli.mjs.
//   node --experimental-strip-types --no-warnings scripts/notify.test.mts
// Nothing here touches the network: Slack is a mocked fetch, D1 is a fake HTTP server on 127.0.0.1.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { SCHEMA, _reset, classify, fingerprint, normalise, notify, scrub, writeRow } from "../lib/notify.mjs";

let n = 0;
const t = (name: string, f: () => unknown | Promise<unknown>) => ({ name, f });
const tests: ReturnType<typeof t>[] = [];
const test = (name: string, f: () => unknown | Promise<unknown>) => tests.push(t(name, f));

// ---------------------------------------------------------------------------------------------------------------------
// fingerprint: real message shapes from the code
// ---------------------------------------------------------------------------------------------------------------------
const xFail = (detail: string, until: string, quoted: string, hours = 6) =>
  `:rotating_light: X post failed (${detail}). Posting is paused until ${until}; its updates are kept for the next post (for up to ${hours} h). Not retrying in a loop.\n> ${quoted}`;

test("fingerprint: the same X failure at different times and with different quoted post text is ONE problem", () => {
  const a = fingerprint(xFail("HTTP 403: X rejected the post", "2026-11-07T06:00:00.000Z", "Kelani at Hanwella 8.2 ft, rising"), "x-post", "post-failed");
  const b = fingerprint(xFail("HTTP 403: X rejected the post", "2026-11-09T18:00:00.000Z", "Good morning. 12 gauges steady, 3 rising\n> second quoted line"), "x-post", "post-failed");
  assert.equal(a, b);
});
test("fingerprint: a different X failure (another cause) is a different problem", () => {
  const a = fingerprint(xFail("HTTP 403: X rejected the post", "2026-11-07T06:00:00.000Z", "x"), "x-post", "post-failed");
  const b = fingerprint(xFail("HTTP 401 Unauthorized", "2026-11-07T06:00:00.000Z", "x"), "x-post", "post-failed");
  assert.notEqual(a, b);
});
test("fingerprint: same words from another source or kind differ", () => {
  const s = xFail("HTTP 403", "2026-11-07T06:00:00.000Z", "x");
  assert.notEqual(fingerprint(s, "x-post", "post-failed"), fingerprint(s, "x-replies", "post-failed"));
  assert.notEqual(fingerprint(s, "x-post", "post-failed"), fingerprint(s, "x-post", "paused"));
});
test("fingerprint: budget note with different spend figures is one problem", () => {
  const m = (spent: string, budget: string) => `:moneybag: X account: estimated spend this month is $${spent} of the $${budget} budget (80% limit reached). Routine updates are paused until next month. Raise it with: gh variable set X_MONTHLY_BUDGET_USD --body 15`;
  assert.equal(fingerprint(m("8.12", "10"), "x-post", "budget"), fingerprint(m("8.44", "10"), "x-post", "budget"));
});
test("fingerprint: held-by-cap note with different counts is one problem", () => {
  const m = (k: number, r: number, a: number) => `:information_source: X account: ${k} update(s) held back by the daily limit (routine ${r}/day, all ${a}/day).`;
  assert.equal(fingerprint(m(2, 4, 8), "x-post", "held"), fingerprint(m(5, 4, 8), "x-post", "held"));
});
test("fingerprint: Instagram failure at the same stage with different details and pause time is one problem", () => {
  const m = (detail: string, until: string, cap: string) => `:rotating_light: Instagram post failed at publish (${detail}); skipped, not retried. Posting is paused until ${until}.\n> ${cap}`;
  assert.equal(fingerprint(m("HTTP 400 code 9007 id 1789", "2026-11-11T10:00:00.000Z", "Kelani rising"), "ig-post", "post-failed"), fingerprint(m("HTTP 400 code 9007 id 1790", "2026-11-12T04:30:00.000Z", "Calm day"), "ig-post", "post-failed"));
});
test("fingerprint: Data source down, with a key, survives 'still down' and recovery wording, run after run", () => {
  const down = (since: string, detail: string) => `🔴 Data source down: HMIS — ${detail}. Since ${since}. Users see: older readings. Status: https://waterlevels.lk/status · Issue: <https://github.com/x/y/issues/41|#41>`;
  const still = (span: string) => `🔴 Still down: HMIS — newest reading 37 h old. Down for ${span}. Users see: older readings. Status: https://waterlevels.lk/status · Issue: <https://github.com/x/y/issues/41|#41>`;
  const k = "health:hmis";
  const a = fingerprint(down("4:30 am", "newest reading 2 h old"), "health-alert", "data-source-down", k);
  assert.equal(a, fingerprint(still("37 h"), "health-alert", "data-source-down", k));
  assert.equal(a, fingerprint("✅ Recovered: HMIS (down 37 h)", "health-alert", "data-source-recovered", k));
  assert.notEqual(a, fingerprint(down("4:30 am", "x"), "health-alert", "data-source-down", "health:rivernet"));
});
test("fingerprint: without a key, 'Data source down' for the same source across days is one problem, another source is not", () => {
  const down = (name: string, since: string, hrs: number) => `🔴 Data source down: ${name} — HTTP 503 from the portal. Since ${since}. Users see: older readings. Status: https://waterlevels.lk/status · Issue: <https://x/issues/${hrs}|#${hrs}>`;
  assert.equal(fingerprint(down("HMIS", "4:30 am", 41), "health-alert", "data-source-down"), fingerprint(down("HMIS", "9:07 pm", 52), "health-alert", "data-source-down"));
  assert.notEqual(fingerprint(down("HMIS", "4:30 am", 41), "health-alert", "data-source-down"), fingerprint(down("RiverNet", "4:30 am", 41), "health-alert", "data-source-down"));
});
test("fingerprint: workflow failures: run id, streak and URL do not matter, the workflow name does", () => {
  const w = (name: string, run: number, streak?: number) => `⚠️ Workflow failed${streak ? ` ${streak} runs in a row` : ""}: ${name} — https://github.com/shakee93/sl-water-levels/actions/runs/${run}`;
  assert.equal(fingerprint(w("X post", 19000000001), "workflow:X post", "workflow-failed"), fingerprint(w("X post", 19000000999), "workflow:X post", "workflow-failed"));
  // the CLI passes key = source for workflow failures, so the 3-in-a-row wording joins the same problem
  assert.equal(fingerprint(w("X post", 1, 3), "workflow:X post", "workflow-failed", "workflow:X post"), fingerprint(w("X post", 2), "workflow:X post", "workflow-failed", "workflow:X post"));
  assert.notEqual(fingerprint(w("X post", 1), "workflow:X post", "workflow-failed"), fingerprint(w("Snapshot", 1), "workflow:Snapshot", "workflow-failed"));
});
test("fingerprint: gauge readings, clock times, dates and ids are ignored", () => {
  const a = "Latest: Hanwella 7.3 ft at 4:40 pm on 11 Nov 2026 (id a1b2c3d4e5f6) post 1987654321098765432 rain 12.5 mm";
  const b = "Latest: Hanwella 9.1 ft at 11:05 am on 3 Dec 2026 (id 9f8e7d6c5b4a) post 1987654321098765999 rain 0.4 mm";
  assert.equal(normalise(a), normalise(b));
});
test("fingerprint: urls, @names and emoji codes are ignored; pure and stable (known value shape)", () => {
  const a = fingerprint(":warning: @nimal says something looks wrong. https://x.com/i/status/1\n> it is wrong", "x-replies", "correction");
  const b = fingerprint(":x: @kamala says something looks wrong. https://x.com/i/status/22\n> different words", "x-replies", "correction");
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, fingerprint(":warning: @nimal says something looks wrong. https://x.com/i/status/1\n> it is wrong", "x-replies", "correction"));
});
test("fingerprint: two different digest/health problems differ", () => {
  assert.notEqual(
    fingerprint("🔴 Data source down: HMIS — timeout", "health-alert", "data-source-down"),
    fingerprint("🔴 Data source down: HMIS — HTTP 503", "health-alert", "data-source-down"),
  );
});

// ---------------------------------------------------------------------------------------------------------------------
// classifier
// ---------------------------------------------------------------------------------------------------------------------
test("classify: words to kind and severity", () => {
  assert.deepEqual(classify(xFail("HTTP 403", "2026-11-07T06:00:00.000Z", "x")), { kind: "paused", severity: "error" });
  assert.deepEqual(classify("⚠️ Workflow failed: X post — https://github.com/x/actions/runs/1"), { kind: "workflow-failed", severity: "error" });
  assert.deepEqual(classify("🔴 Data source down: HMIS — timeout. Since 4:30 am."), { kind: "data-source-down", severity: "error" });
  assert.deepEqual(classify("✅ Recovered: HMIS (down 3 h)"), { kind: "recovered", severity: "info" });
  assert.deepEqual(classify(":warning: X replies: could not read mentions (HTTP 429)."), { kind: "failed", severity: "error" });
  assert.deepEqual(classify(":warning: X account: dropped a held update that is now too old"), { kind: "held", severity: "warn" });
  assert.deepEqual(classify(":warning: Instagram posting: not configured."), { kind: "warning", severity: "warn" });
  assert.equal(classify("*DRY RUN: not posted to X* (1/2) [summary] 120/280 characters\n> down by 3 ft failed").kind, "dry-run");
  assert.equal(classify("*SAMPLE, DRY RUN: not posted to X*").severity, "info");
  assert.deepEqual(classify("Push alerts: 12 subscribers. Messages in 24 h: 30 sent, 0 gone, 0 failed.").severity, "error"); // 'failed' wins: callers that know better pass severity
  assert.deepEqual(classify("*Feedback digest* for 10 Nov: 4 answers summary"), { kind: "digest", severity: "info" });
  assert.equal(classify("hello there").kind, "info");
});
test("classify: quoted lines (other people's words) do not decide", () => {
  assert.equal(classify(":speech_balloon: Report from @a: not confirmed.\n> the road is down and everything failed").severity, "info");
});

// ---------------------------------------------------------------------------------------------------------------------
// scrubber
// ---------------------------------------------------------------------------------------------------------------------
test("scrub: webhook URLs, tokens, keys and secret env values never get stored", () => {
  const hook = "https://hooks.slack.com/services/T000/B000/abcdefghijklmnop";
  const out = scrub(`posted to ${hook} with Bearer abcdefghijklmnopqrstuvwxyz and ghp_${"a".repeat(36)} and sk-${"b".repeat(30)} and xoxb-1234567890-abcdefghij`, {});
  assert.ok(!out.includes("hooks.slack.com") && !out.includes("abcdefghijklmnopqrstuvwxyz") && !out.includes("ghp_") && !out.includes("sk-b") && !out.includes("xoxb"));
  assert.ok(out.includes("[secret]"));
  assert.ok(!scrub("token: s3cr3tvalue99 and api_key=ZZZ-123456789", {}).includes("s3cr3tvalue99"));
  assert.ok(!scrub("key 0123456789abcdef0123456789abcdef0123", {}).includes("0123456789abcdef"));
  assert.ok(!scrub("opaque Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0FeDcBa", {}).includes("Zx9Yw8"));
  assert.ok(!scrub("env value leaked: my-private-webhook-value-123", { SLACK_WEBHOOK_URL: "my-private-webhook-value-123" }).includes("my-private"));
});
test("scrub: ordinary messages, links and slugs are left alone; long text is cut to 4,000", () => {
  const s = ":rotating_light: X post failed (HTTP 403). https://waterlevels.lk/flood/nagalagam-street <https://x.com/i/status/1987654321|open on X>";
  assert.equal(scrub(s, {}), s);
  const long = scrub("river ".repeat(2000), {});
  assert.equal(long.length, 4000);
});

// ---------------------------------------------------------------------------------------------------------------------
// the log: fake D1 server
// ---------------------------------------------------------------------------------------------------------------------
type Fake = { url: string; hits: { path: string; body: any }[]; close: () => Promise<void> };
async function fakeD1(mode: "ok" | "error" | "slow" | "no-table"): Promise<Fake> {
  const hits: Fake["hits"] = [];
  let noTableOnce = true;
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      hits.push({ path: String(req.url), body });
      if (mode === "slow") return; // never answers
      res.setHeader("Content-Type", "application/json");
      if (mode === "error") {
        res.statusCode = 500;
        return res.end(JSON.stringify({ success: false, errors: [{ message: "D1 DB storage operation exceeded timeout", code: 7429 }] }));
      }
      if (mode === "no-table" && noTableOnce && /INSERT INTO notifications/.test(body?.sql ?? "")) {
        noTableOnce = false;
        res.statusCode = 400;
        return res.end(JSON.stringify({ success: false, errors: [{ message: "D1_ERROR: no such table: notifications: SQLITE_ERROR" }] }));
      }
      res.end(JSON.stringify({ success: true, result: [{ results: [] }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, hits, close: () => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }) };
}
const envFor = (f: Fake | null, extra: Record<string, string> = {}) => ({ CLOUDFLARE_API_TOKEN: "test-token", CF_API_BASE: f ? f.url : "http://127.0.0.1:9", CF_D1_DATABASE_ID: "db-test", SLACK_WEBHOOK_URL: "https://hooks.example/slack", ...extra });
const slackOk = () => { const calls: { url: string; init: any }[] = []; return { calls, doFetch: async (url: string, init: any) => { calls.push({ url, init }); return new Response("ok"); } }; };
const quiet = async <T,>(f: () => Promise<T>) => { const w = console.warn; const msgs: string[] = []; console.warn = (...a) => { msgs.push(a.join(" ")); }; try { return { v: await f(), msgs }; } finally { console.warn = w; } };

test("log: one INSERT with the row, text scrubbed, run url from the Actions env; Slack unaffected", async () => {
  const d1 = await fakeD1("ok");
  try {
    const s = slackOk();
    const env = envFor(d1, { GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "shakee93/sl-water-levels", GITHUB_RUN_ID: "777" });
    const r = await notify("🔴 Data source down: HMIS — token: abcdef123456 timeout", { source: "health-alert", kind: "data-source-down", severity: "critical", env, doFetch: s.doFetch, now: 1_700_000_000_000, key: "health:hmis" });
    assert.deepEqual(r, { slackOk: true, logged: true });
    assert.equal(s.calls.length, 1);
    assert.equal(d1.hits.length, 1, "exactly one D1 statement");
    const h = d1.hits[0];
    assert.match(h.path, /\/d1\/database\/db-test\/query$/);
    assert.match(h.body.sql, /^INSERT INTO notifications \(ts, source, kind, severity, text, fingerprint, run_url, slack_ok, meta\) VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?\)$/);
    const [ts, source, kind, sev, text, fp, run, ok, meta] = h.body.params;
    assert.deepEqual([ts, source, kind, sev, ok, meta], [1_700_000_000_000, "health-alert", "data-source-down", "critical", 1, null]);
    assert.ok(!text.includes("abcdef123456") && text.includes("[secret]"));
    assert.equal(fp, fingerprint("anything else", "health-alert", "data-source-down", "health:hmis"));
    assert.equal(run, "https://github.com/shakee93/sl-water-levels/actions/runs/777");
  } finally { await d1.close(); }
});
test("log: Slack failing is recorded as slack_ok 0 and the row is still written", async () => {
  const d1 = await fakeD1("ok");
  try {
    const { v, msgs } = await quiet(() => notify("x failed", { source: "t", env: envFor(d1), doFetch: async () => { throw new Error("net"); }, kind: "test" }));
    assert.deepEqual(v, { slackOk: false, logged: true });
    assert.equal(d1.hits[0].body.params[7], 0);
    assert.ok(msgs.some((m) => /Slack post failed/.test(m)));
    const { v: v2 } = await quiet(() => notify("x", { source: "t", env: envFor(d1), doFetch: async () => new Response("no", { status: 500 }) }));
    assert.deepEqual(v2, { slackOk: false, logged: true });
    assert.equal(d1.hits[1].body.params[7], 0);
  } finally { await d1.close(); }
});
test("log: no Slack webhook means no Slack request, slack_ok NULL, row still written", async () => {
  const d1 = await fakeD1("ok");
  try {
    const s = slackOk();
    const env = envFor(d1); delete (env as any).SLACK_WEBHOOK_URL;
    const r = await notify("*DRY RUN*", { source: "x-post", kind: "dry-run", env, doFetch: s.doFetch });
    assert.deepEqual(r, { slackOk: false, logged: true });
    assert.equal(s.calls.length, 0);
    assert.equal(d1.hits[0].body.params[7], null);
  } finally { await d1.close(); }
});
test("log: first use creates the tables (only when the INSERT says no such table) and retries once", async () => {
  const d1 = await fakeD1("no-table");
  try {
    const r = await notify("hello", { source: "t", env: envFor(d1), doFetch: slackOk().doFetch });
    assert.equal(r.logged, true);
    const sqls = d1.hits.map((h) => h.body.sql);
    assert.equal(sqls.length, 1 + SCHEMA.length + 1);
    assert.deepEqual(sqls.slice(1, 1 + SCHEMA.length), SCHEMA);
    assert.ok(SCHEMA.every((s) => /IF NOT EXISTS/.test(s)));
    assert.match(sqls[0], /^INSERT/); assert.match(sqls.at(-1)!, /^INSERT/);
  } finally { await d1.close(); }
});
test("log: D1 returning an error never throws, Slack is posted, a warning is printed", async () => {
  const d1 = await fakeD1("error");
  try {
    const s = slackOk();
    const { v, msgs } = await quiet(() => notify("x failed", { source: "t", env: envFor(d1), doFetch: s.doFetch }));
    assert.deepEqual(v, { slackOk: true, logged: false });
    assert.equal(s.calls.length, 1);
    assert.equal(d1.hits.length, 1, "a failed write is not retried (it may have landed)");
    assert.ok(msgs.some((m) => /could not log the notification/.test(m)));
  } finally { await d1.close(); }
});
test("log: D1 down (connection refused) fails soft and fast", async () => {
  const s = slackOk();
  const t0 = Date.now();
  const { v } = await quiet(() => notify("x failed", { source: "t", env: envFor(null), doFetch: s.doFetch }));
  assert.deepEqual(v, { slackOk: true, logged: false });
  assert.ok(Date.now() - t0 < 2000);
});
test("log: D1 that never answers is cut at the time box; Slack was already posted", async () => {
  const d1 = await fakeD1("slow");
  try {
    const s = slackOk();
    const t0 = Date.now();
    const { v, msgs } = await quiet(() => notify("x failed", { source: "t", env: envFor(d1), doFetch: s.doFetch, logTimeoutMs: 400 }));
    const took = Date.now() - t0;
    assert.deepEqual(v, { slackOk: true, logged: false });
    assert.ok(took >= 350 && took < 2500, `took ${took} ms`);
    assert.ok(msgs.some((m) => /no answer in 0\.4 s/.test(m)), msgs.join("|"));
    assert.equal(s.calls.length, 1);
  } finally { await d1.close(); }
});
test("log: the default time box is 5 s", async () => {
  const mod = await import("../lib/notify.mjs");
  assert.equal(mod.LOG_TIMEOUT_MS, 5000);
});
test("log: without CLOUDFLARE_API_TOKEN nothing is sent to D1, Slack is unaffected, and the warning comes once", async () => {
  _reset();
  const s = slackOk();
  const env = { SLACK_WEBHOOK_URL: "https://hooks.example/slack", CF_API_BASE: "http://127.0.0.1:9" };
  const { v, msgs } = await quiet(async () => [await notify("a", { env, doFetch: s.doFetch }), await notify("b", { env, doFetch: s.doFetch }), await writeRow({} as never, { env })]);
  assert.deepEqual(v[0], { slackOk: true, logged: false });
  assert.equal(s.calls.length, 2);
  assert.equal(msgs.filter((m) => /CLOUDFLARE_API_TOKEN is not set/.test(m)).length, 1);
});
test("log: a throwing classifier or odd input cannot break the caller", async () => {
  const r = await notify(undefined as never, { source: "t", env: { SLACK_WEBHOOK_URL: "https://hooks.example/slack" }, doFetch: slackOk().doFetch });
  assert.equal(r.slackOk, true);
});

// ---------------------------------------------------------------------------------------------------------------------
// Slack body identity: each sender's OLD helper (verbatim from the commit before this change) against the SHIPPED new one
// ---------------------------------------------------------------------------------------------------------------------
type Req = { url: string; method: string; headers: unknown; body: string; timeoutMs: number | undefined };
const ORIGINAL_TIMEOUT = AbortSignal.timeout;
/** Runs f with a recording fetch (both global and returned) and AbortSignal.timeout spy; returns what went to Slack. */
async function record(f: (doFetch: typeof fetch) => Promise<unknown>, respond: "ok" | "fail" | "throw") {
  const reqs: Req[] = [];
  let lastMs: number | undefined;
  AbortSignal.timeout = ((ms: number) => { lastMs = ms; return ORIGINAL_TIMEOUT.call(AbortSignal, ms); }) as typeof AbortSignal.timeout;
  const fake = (async (url: string, init: any) => {
    reqs.push({ url: String(url), method: init?.method, headers: init?.headers, body: init?.body, timeoutMs: lastMs });
    if (respond === "throw") throw new Error("net");
    return new Response("x", { status: respond === "ok" ? 200 : 500 });
  }) as unknown as typeof fetch;
  const realFetch = globalThis.fetch;
  globalThis.fetch = fake;
  const w = console.warn; console.warn = () => {};
  const l = console.log; console.log = () => {};
  let ret: unknown, threw = false;
  try { ret = await f(fake); } catch { threw = true; } finally { globalThis.fetch = realFetch; AbortSignal.timeout = ORIGINAL_TIMEOUT; console.warn = w; console.log = l; }
  return { reqs, ret, threw };
}
/** Pulls `async function slack(...) {...}` (or postSlack) out of a script and builds it with stand-ins for the script's globals. */
function shipped(file: string, name: string, globals: Record<string, unknown>) {
  const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const start = src.search(new RegExp(`(export )?async function ${name}\\(`));
  assert.ok(start >= 0, `${file}: ${name} not found`);
  const end = src.indexOf("\n}\n", start);
  const code = src.slice(start, end + 3).replace(/^export /, "").replace(/\(text: string\): Promise<boolean>/, "(text)");
  return new Function("notify", ...Object.keys(globals), `${code}\nreturn ${name};`)(notify, ...Object.values(globals));
}

const OLD = {
  xPost: async (text: string, { env = process.env as any, doFetch = fetch } = {}) => {
    const hook = env.SLACK_WEBHOOK_URL; if (!hook) return false;
    try { const res = await doFetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(20_000) }); return res.ok; } catch { return false; }
  },
  xX: async (text: string, { env, doFetch }: any) => {
    const hook = env.SLACK_X_WEBHOOK_URL || env.SLACK_WEBHOOK_URL; if (!hook) return false;
    try { const res = await doFetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(20_000) }); return res.ok; } catch { return false; }
  },
  xSeries: async (text: string, env: any) => { if (!env.SLACK_WEBHOOK_URL) return; await fetch(env.SLACK_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(20_000) }).catch(() => {}); },
  health: async (text: string, SLACK: string) => {
    if (!SLACK) return;
    try { await fetch(SLACK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] }), signal: AbortSignal.timeout(15_000) }); } catch {}
  },
  fifteen: async (text: string, SLACK: string) => {
    if (!SLACK) return false;
    try { const res = await fetch(SLACK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(15_000) }); return res.ok; } catch { return false; }
  },
  learnPost: async (text: string, SLACK: string) => {
    if (!text || !SLACK) return;
    try { await fetch(SLACK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(15_000) }); } catch {}
  },
  streetRain: async (msg: string, SLACK: string) => {
    if (!SLACK) return false;
    try { const res = await fetch(SLACK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: msg }), signal: AbortSignal.timeout(15_000) }); return res.ok; } catch { return false; }
  },
  route: async (text: string, url: string) => {
    if (!url) return false;
    try { const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(8_000) }); return res.ok; } catch { return false; }
  },
  pushStats: async (text: string, hook: string, post: typeof fetch) => {
    const res = await post(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(20_000) });
    return { text, posted: res.ok };
  },
};

const TEXTS = [
  ":rotating_light: X post failed (HTTP 403). Posting is paused until 2026-11-07T06:00:00.000Z; its updates are kept.\n> Kelani at Hanwella 8.2 ft",
  "🔴 Data source down: HMIS — timeout. Since 4:30 am. Users see: older readings. Status: https://waterlevels.lk/status · Issue: <https://x/issues/41|#41>",
  "*Feedback digest* — “quotes”, emoji 🙂, \"double\" and 'single', <!channel> & ampersand\nsecond line\n\ttabbed",
  "Push alerts: 12 subscribers (3 new in 24 h).",
  "",
];
const same = (a: Req[], b: Req[], label: string) => { assert.equal(a.length, 1, `${label}: old made one request`); assert.deepEqual(b, a, `${label}: request differs`); };
const IDENT = [
  { name: "x-post", file: "scripts/x-post.mjs", fn: "slack", g: { log: () => {} } },
] as const;

async function compareHelper(label: string, oldCall: (text: string, doFetch: typeof fetch, env: any) => Promise<unknown>, newCall: (text: string, doFetch: typeof fetch, env: any) => Promise<unknown>, env: any, texts = TEXTS, opts: { swallowsNow?: boolean } = {}) {
  for (const text of texts) for (const respond of ["ok", "fail", "throw"] as const) {
    const o = await record((df) => oldCall(text, df, env), respond);
    const nw = await record((df) => newCall(text, df, env), respond);
    same(o.reqs, nw.reqs, `${label}/${respond}`);
    // what the callers branch on: delivered or not (old helpers returned booleans, or nothing)
    if (typeof o.ret === "boolean") assert.equal(nw.ret, o.ret, `${label}/${respond}: return value`);
    if (o.ret && typeof o.ret === "object") assert.deepEqual(nw.ret, o.ret, `${label}/${respond}: return value`);
    if (!(opts.swallowsNow && o.threw)) assert.equal(nw.threw, o.threw, `${label}/${respond}: throws like before`);
  }
}
const HOOK = "https://hooks.example/main";
const XHOOK = "https://hooks.example/xchannel";

test("identity x-post: same request (url, method, headers, body, 20 s timeout) and return value; no webhook posts nothing", async () => {
  const f = shipped("scripts/x-post.mjs", "slack", { log: () => {}, notify });
  await compareHelper("x-post", (tx, df, env) => OLD.xPost(tx, { env, doFetch: df }), (tx, df, env) => f(tx, { env, doFetch: df, kind: "held", severity: "info" }), { SLACK_WEBHOOK_URL: HOOK });
  const none = await record((df) => f("hi", { env: {}, doFetch: df }), "ok");
  assert.equal(none.reqs.length, 0); assert.equal(none.ret, false);
});
test("identity x-post: SLACK_X_WEBHOOK_URL is NOT used by x-post (it never was)", async () => {
  const f = shipped("scripts/x-post.mjs", "slack", { log: () => {}, notify });
  const r = await record((df) => f("hi", { env: { SLACK_WEBHOOK_URL: HOOK, SLACK_X_WEBHOOK_URL: XHOOK }, doFetch: df }), "ok");
  assert.equal(r.reqs[0].url, HOOK);
});
test("identity x-replies and x-reposts: the X webhook wins when set, else the main one; same body and timeout", async () => {
  for (const file of ["scripts/x-replies.mjs", "scripts/x-reposts.mjs"]) {
    const f = shipped(file, "slack", { log: () => {}, notify });
    for (const env of [{ SLACK_WEBHOOK_URL: HOOK }, { SLACK_WEBHOOK_URL: HOOK, SLACK_X_WEBHOOK_URL: XHOOK }, { SLACK_X_WEBHOOK_URL: XHOOK }]) {
      await compareHelper(file, (tx, df, e) => OLD.xX(tx, { env: e, doFetch: df }), (tx, df, e) => f(tx, { env: e, doFetch: df, kind: "x", severity: "info" }), env);
    }
    const none = await record((df) => f("hi", { env: {}, doFetch: df }), "ok");
    assert.equal(none.reqs.length, 0); assert.equal(none.ret, false);
  }
});
test("identity ig-post: same request as the old helper", async () => {
  const f = shipped("scripts/ig-post.mjs", "slack", { log: () => {}, notify });
  await compareHelper("ig-post", (tx, df, env) => OLD.xPost(tx, { env, doFetch: df }), (tx, df, env) => f(tx, { env, doFetch: df, kind: "dry-run", severity: "info" }), { SLACK_WEBHOOK_URL: HOOK });
});
test("identity x-series: same request, never throws", async () => {
  const f = shipped("scripts/x-series.mjs", "slack", { env: { SLACK_WEBHOOK_URL: HOOK }, notify });
  await compareHelper("x-series", (tx, df, env) => OLD.xSeries(tx, env), (tx) => f(tx, { kind: "budget", severity: "warn" }), { SLACK_WEBHOOK_URL: HOOK });
});
test("identity health-alert: text AND blocks, 15 s timeout, same body byte for byte", async () => {
  const f = shipped("scripts/health-alert.mjs", "slack", { DRY: false, SLACK: HOOK, log: () => {}, notify });
  await compareHelper("health-alert", (tx) => OLD.health(tx, HOOK), (tx) => f(tx, { kind: "data-source-down", severity: "error", key: "health:hmis" }), {});
  const r = await record(() => f("hello", {}), "ok");
  assert.equal(r.reqs[0].body, JSON.stringify({ text: "hello", blocks: [{ type: "section", text: { type: "mrkdwn", text: "hello" } }] }));
});
test("identity feedback-digest, feedback-learn (postSlack, also used by learn-all), street-rain-log, ground shadow: same request, 15 s timeout", async () => {
  const digest = shipped("scripts/feedback-digest.mjs", "slack", { DRY: false, SLACK: HOOK, notify });
  await compareHelper("feedback-digest", (tx) => OLD.fifteen(tx, HOOK), (tx) => digest(tx), {}, TEXTS.filter(Boolean));
  const learn = shipped("scripts/feedback-learn.mjs", "postSlack", { SLACK: HOOK, notify });
  await compareHelper("feedback-learn", (tx) => OLD.learnPost(tx, HOOK), (tx) => learn(tx), {}, TEXTS.filter(Boolean));
  await compareHelper("learn-all via postSlack", (tx) => OLD.learnPost(tx, HOOK), (tx) => learn(tx, { source: "learn-all", kind: "digest", severity: "info" }), {}, TEXTS.filter(Boolean));
  const street = shipped("scripts/street-rain-log.mjs", "slack", { DRY: false, SLACK: HOOK, notify });
  await compareHelper("street-rain-log", (tx) => OLD.streetRain(tx, HOOK), (tx) => street(tx), {}, TEXTS.filter(Boolean));
  await compareHelper("ground-rain-shadow", (tx) => OLD.streetRain(tx, HOOK), (tx) => street(tx, { source: "ground-rain-shadow", kind: "shadow", severity: "info" }), {}, TEXTS.filter(Boolean));
});
test("identity feedback route (TypeScript): same request, 8 s timeout", async () => {
  const f = shipped("app/api/feedback/route.ts", "slack", { process: { env: { SLACK_WEBHOOK_URL: HOOK } }, notify });
  await compareHelper("feedback-route", (tx) => OLD.route(tx, HOOK), (tx) => f(tx), {}, TEXTS.filter(Boolean));
});
test("identity push-notify --stats: same request through notify with the caller's fetch", async () => {
  // the inline block in stats(): hook = process.env.SLACK_WEBHOOK_URL, fetch = post ?? fetch, 20 s timeout, {text}
  const src = readFileSync(new URL("../scripts/push-notify.mjs", import.meta.url), "utf8");
  assert.match(src, /notify\(text, \{ source: "push-notify", kind: "digest", severity: "info", env: process\.env, doFetch: post \?\? fetch, webhook: hook \}\)/);
  await compareHelper("push-notify", (tx, df) => OLD.pushStats(tx, HOOK, df), async (tx, df) => { const { slackOk } = await notify(tx, { source: "push-notify", kind: "digest", severity: "info", env: {}, doFetch: df, webhook: HOOK }); return { text: tx, posted: slackOk }; }, {}, TEXTS.filter(Boolean).slice(0, 4), { swallowsNow: true }); // the old inline post let a network error crash the --stats run; notify swallows it (the one deliberate difference)
});
test("identity: no sender still builds its own Slack request (every hooks/webhook fetch goes through notify)", () => {
  const files = ["x-post", "x-replies", "x-reposts", "x-series", "ig-post", "health-alert", "push-notify", "feedback-digest", "feedback-learn", "learn-all", "street-rain-log", "ground-rain-shadow"].map((n) => `scripts/${n}.mjs`).concat("app/api/feedback/route.ts");
  for (const f of files) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.ok(!/fetch\((?:hook|SLACK|env\.SLACK_WEBHOOK_URL|url)\b/.test(src.replace(/\/\/.*$/gm, "")), `${f} still posts to Slack by itself`);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// the CLI used by workflow steps
// ---------------------------------------------------------------------------------------------------------------------
test("cli: posts the same body the curl step did, exits 0 on success, 1 when Slack refuses, 0 without a webhook", async () => {
  const bodies: string[] = [];
  const slack = createServer((req, res) => { let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => { bodies.push(raw); res.statusCode = bodies.length > 1 ? 500 : 200; res.end("ok"); }); });
  await new Promise<void>((r) => slack.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(slack.address() as { port: number }).port}/hook`;
  const msg = "⚠️ Workflow failed 3 runs in a row: X post — https://github.com/shakee93/sl-water-levels/actions/runs/1";
  const run = (env: Record<string, string>) => {
    try { execFileSync("node", ["scripts/notify-cli.mjs", "--source", "workflow:X post", "--kind", "workflow-failed", "--severity", "error", msg], { env: { PATH: process.env.PATH!, ...env }, stdio: "pipe", cwd: new URL("..", import.meta.url).pathname }); return 0; }
    catch (e: any) { return e.status as number; }
  };
  try {
    // async spawn needed: the fake Slack server lives in this process, so run the CLI without blocking the event loop
    const { spawn } = await import("node:child_process");
    const go = (env: Record<string, string>) => new Promise<number>((resolve) => { const p = spawn("node", ["scripts/notify-cli.mjs", "--source", "workflow:X post", "--kind", "workflow-failed", "--severity", "error", msg], { env: { PATH: process.env.PATH!, ...env }, cwd: new URL("..", import.meta.url).pathname, stdio: "ignore" }); p.on("close", (c) => resolve(c ?? -1)); });
    assert.equal(await go({ SLACK_WEBHOOK_URL: url }), 0);
    assert.equal(bodies[0], JSON.stringify({ text: msg }));
    assert.equal(await go({ SLACK_WEBHOOK_URL: url }), 1, "Slack refused -> exit 1 so the step falls back to curl");
    assert.equal(await go({}), 0);
    assert.equal(bodies.length, 2, "no webhook: nothing sent");
    void run;
  } finally { slack.close(); }
});

// ---------------------------------------------------------------------------------------------------------------------
for (const { name, f } of tests) {
  try { await f(); n++; console.log(`ok   ${name}`); }
  catch (e) { console.error(`FAIL ${name}\n`, e); process.exitCode = 1; }
}
console.log(`${n}/${tests.length} notify tests passed`);
