// @ts-nocheck
// Tests for the ops loop: lib/opsTriage.mjs (pure rules) and scripts/ops-triage.mjs (the job).
//   node --experimental-strip-types --no-warnings scripts/ops-triage.test.mts
// Nothing here touches a real service: D1 and GitHub are in-memory fakes, Slack is a recorder, and one test runs the real D1 adapter
// against a fake Cloudflare server on 127.0.0.1.
//
// The REPLAY test rebuilds the #river-notifyications history of 23 Oct - 11 Nov 2026 (research/ops/slack-history-2026-11-11.md) from
// the real message shapes and the senders' real kinds / keys / fingerprints, then runs the whole job every 30 minutes through it.
// Dates are from the history; counts of the very chatty families are approximate there and approximate here.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fingerprint } from "../lib/notify.mjs";
import { RULES, HEARTBEATS, dailySummary, workflowRunRows, findSilence, isInformational, renderBody, sanitise, triage, titleFor, summarise, dayNum } from "../lib/opsTriage.mjs";
import { MIN_GAP_MS, d1Adapter, run } from "./ops-triage.mjs";

const tests: { name: string; f: () => unknown }[] = [];
const test = (name: string, f: () => unknown) => tests.push({ name, f });
const quiet = { log: () => {}, warn: () => {} };

// ---------------------------------------------------------------------------------------------------------------------
// fixtures: the real message families, as the senders write them (kind / severity / key as in the scripts)
// ---------------------------------------------------------------------------------------------------------------------
const T = (s: string) => new Date(`2026-${s.slice(0, 5)}T${s.slice(6)}:00+05:30`).getTime(); // "11-08 12:26", Sri Lanka time
const H = 3_600_000, MIN = 60_000, D = 24 * H;
let nextId = 1;
const REPO = "shakee93/sl-water-levels";
const runUrl = (id: number) => `https://github.com/${REPO}/actions/runs/${id}`;
const row = (ts: number, source: string, kind: string, severity: string, text: string, key = "", run_url: string | null = null) => ({ id: nextId++, ts, source, kind, severity, text, fingerprint: fingerprint(text, source, kind, key), run_url, slack_ok: 1 });

const xFail = (detail: string, until: number, post: string) => `:rotating_light: X post failed (${detail}). Posting is paused until ${new Date(until).toISOString()}; its updates are kept for the next post (for up to 3 h). Not retrying in a loop.\n> ${post}`;
const X403 = "HTTP 403 Forbidden: You are not permitted to perform this action.";
const X280 = "HTTP 403 Forbidden: This account cannot create Posts longer than 280 characters.";
const down = (id: string, name: string, why: string, since: string) => (ts: number) => row(ts, "health-alert", "data-source-down", id === "gauges" ? "critical" : "error", `🔴 Data source down: ${name} — ${why}. Since ${since}. Users see: older readings. Status: https://waterlevels.lk/status · Issue: <https://github.com/${REPO}/issues/${ts % 97 + 3}|#${ts % 97 + 3}>`, `health:${id}`);
const still = (id: string, name: string, why: string, hrs: number) => (ts: number) => row(ts, "health-alert", "data-source-down", "error", `🔴 Still down: ${name} — ${why}. Down for ${hrs} h. Users see: older readings. Status: https://waterlevels.lk/status · Issue: <https://github.com/${REPO}/issues/21|#21>`, `health:${id}`);
const recovered = (id: string, name: string, hrs: number) => (ts: number) => row(ts, "health-alert", "data-source-recovered", "info", `✅ Recovered: ${name} (down ${hrs} h)`, `health:${id}`);
const wfFail = (name: string, ts: number, i: number) => row(ts, `workflow:${name}`, "workflow-failed", "error", `⚠️ Workflow failed: ${name} — ${runUrl(40_000_000_000 + i)}`, `workflow:${name}`, runUrl(40_000_000_000 + i));
const spread = (from: number, to: number, n: number) => Array.from({ length: n }, (_, i) => Math.round(from + ((to - from) * i) / (n - 1)));

const HMIS = "HMIS (Irrigation Department hydro-met system)";
const RIVERNET = "RiverNet (DMC / Leecom SCADA sensor network)";

/** Every message of the history that the loop sees, oldest first. */
function history() {
  nextId = 1;
  const r: any[] = [];
  const add = (...x: any[]) => r.push(...x.flat());

  // --- PROBLEM families -------------------------------------------------------------------------------------------
  // X pause loop (8-11 Nov): 403 "not permitted" every ~6 h, 11 times, then the 280-character refusal twice; a burst of "dropped a held update" after each pause
  const t0 = T("11-08 12:26"), t1 = T("11-11 02:05");
  for (let i = 0; i < 11; i++) {
    const ts = Math.round(t0 + ((t1 - t0) * i) / 10);
    add(row(ts, "x-post", "post-failed", "error", xFail(X403, ts + 6 * H, i % 2 ? "Kelani at Hanwella 8.2 ft, rising" : "Good morning: 12 gauges steady")));
    for (let k = 0; k < 6; k++) add(row(ts + (k + 1) * 4 * MIN, "x-post", "held-dropped", "warn", `:warning: X account: dropped a held update that is now too old to send (${["storm", "gauge_clear", "reservoir_digest"][k % 3]}).`));
  }
  add(row(T("11-11 08:08"), "x-post", "post-failed", "error", xFail(X280, T("11-11 14:08"), "Evening update, 4 rivers high")));
  add(row(T("11-11 14:08"), "x-post", "post-failed", "error", xFail(X280, T("11-11 20:08"), "Evening update, 5 rivers high")));
  // HMIS: 4 Nov (7.5 h) and 7-9 Nov (37 h, "Still down" every 6 h)
  const hm = (id = "hmis") => ({ d: (s: string) => down(id, HMIS, "fetch failed", s), s: (h: number) => still(id, HMIS, "fetch failed", h), r: (h: number) => recovered(id, HMIS, h) });
  add(hm().d("2:00 pm")(T("11-04 14:00")), hm().s(6)(T("11-04 20:00")), hm().r(7)(T("11-04 21:30")));
  add(hm().d("8:07 pm")(T("11-07 20:07")));
  for (let k = 1; k <= 6; k++) add(hm().s(6 * k)(T("11-07 20:07") + 6 * k * H));
  add(hm().r(37)(T("11-09 09:07")));
  // RiverNet: four short timeouts (29 Oct, 2, 4, 10 Nov)
  for (const [a, b, hrs] of [["10-29 03:07", "10-29 05:07", 2], ["11-02 14:37", "11-02 16:37", 2], ["11-04 09:07", "11-04 12:07", 3], ["11-10 21:07", "11-10 23:37", 3]] as const) {
    add(down("rivernet", RIVERNET, "The operation was aborted due to timeout", "x")(T(a)), recovered("rivernet", RIVERNET, hrs)(T(b)));
  }
  // ArcGIS river gauges (critical): 429 on 24 Oct and twice on 26 Oct, about an hour each
  for (const [a, b] of [["10-24 10:07", "10-24 11:07"], ["10-26 16:08", "10-26 17:08"], ["10-26 21:07", "10-26 22:07"]]) add(down("gauges", "ArcGIS river gauges", "Too many requests: 34 of 42 stations report", "x")(T(a)), recovered("gauges", "ArcGIS river gauges", 1)(T(b)));
  // Mahaweli PDF weekend staleness (25 Oct 13:37 to 26 Oct 10:37)
  add(down("mahaweli", "Mahaweli WMS daily PDF", "last modified 2.1 days ago (limit 48 h)", "x")(T("10-25 13:37")));
  for (const [i, t] of ["10-25 19:37", "10-26 01:37", "10-26 07:37"].entries()) add(still("mahaweli", "Mahaweli WMS daily PDF", "last modified 2.4 days ago (limit 48 h)", 6 * (i + 1))(T(t)));
  add(recovered("mahaweli", "Mahaweli WMS daily PDF", 21)(T("10-26 10:37")));
  // Irrigation sheet false alarm (a row dated tomorrow), 8-9 Nov: our bug
  add(down("irrigation", "Irrigation reservoir sheet", "newest row is dated 2026-11-09, not today or yesterday", "x")(T("11-08 20:37")), still("irrigation", "Irrigation reservoir sheet", "newest row is dated 2026-11-09, not today or yesterday", 6)(T("11-09 02:37")), recovered("irrigation", "Irrigation reservoir sheet", 6)(T("11-09 03:07")));
  // Canal archive (CUrW): 27 Oct, 1 Nov, and today (still down at the end of the history)
  const cw = (hrs: number) => ({ d: down("curw-archive", "Colombo canal gauge archive (private)", "last run failed", "x"), r: recovered("curw-archive", "Colombo canal gauge archive (private)", hrs) });
  add(cw(3).d(T("10-27 20:07")), cw(3).r(T("10-27 23:07")), cw(3).d(T("11-01 11:07")), cw(3).r(T("11-01 14:07")), cw(0).d(T("11-11 20:37")));
  // one-offs
  add(down("openmeteo", "Open-Meteo rain feed", "HTTP error", "x")(T("11-02 20:37")), recovered("openmeteo", "Open-Meteo rain feed", 1)(T("11-02 21:37")));
  add(down("forecast-store", "Forecast store", "last run over 4 h ago", "x")(T("10-23 03:07")), recovered("forecast-store", "Forecast store", 4)(T("10-23 07:30")));
  add(wfFail("HMIS snapshot", T("11-04 15:08"), 1), wfFail("HMIS snapshot", T("11-06 11:17"), 2), wfFail("Daily data snapshot", T("10-26 13:05"), 3), wfFail("Accuracy snapshot", T("10-27 09:20"), 4));
  add(row(T("10-26 14:10"), "x-post", "post-failed", "error", xFail("HTTP 201 HTTP 201", T("10-26 20:10"), "Morning update")));
  add(row(T("10-26 15:00"), "x-post", "duplicate-rejected", "warn", ":warning: X rejected a post as a duplicate, skipped:\n> Evening update"));
  add(row(T("10-26 16:30"), "x-series", "post-failed", "warn", ':warning: X series "street-level" not posted: HTTP 403 Forbidden: You are not permitted to perform this action.'));
  add(row(T("11-05 00:10"), "ig-post", "post-failed", "error", ":rotating_light: Instagram post failed at container (OAuthException: code -2/2207003: Timeout); skipped, not retried.\n> Rivers right now"));
  // the 26-27 Oct "Workflow failed" storm (every 5 min, before the 3-in-a-row rule existed)
  [["X replies", 75], ["X account", 45], ["X reposts", 13]].forEach(([name, n], k) => spread(T("10-26 19:00"), T("10-27 11:00"), n as number).forEach((ts, i) => add(wfFail(name as string, ts, 100 * (k + 1) + i))));
  spread(T("10-26 22:00"), T("10-27 08:00"), 20).forEach((ts, i) => add(wfFail("GSMaP snapshot", ts, 900 + i)));

  // --- INFORMATIONAL families (never an issue) ---------------------------------------------------------------------
  for (let d = 23; d <= 41; d++) {
    const day = d <= 31 ? `10-${d}` : `11-${String(d - 31).padStart(2, "0")}`;
    if (d >= 27) add(row(T(`${day} 07:00`), "feedback-digest", "digest", "info", `*Forecast feedback, 2026-${day}*: ${60 + d} answers. Matches what they see: 63. Worse than shown: 20.`));
    if (d >= 28) add(row(T(`${day} 00:20`), "learn-all", "digest", "info", `*What we learned:* - Observations: ${200 + d} in the table. - Changed: no learned value moved.`));
    if (d >= 25) add(row(T(`${day} 07:30`), "push-notify", "digest", "info", `Push alerts: ${d - 20} subscribers (${d % 3} new in 24 h). Messages in 24 h: 6 sent, 0 gone, 0 failed.`));
  }
  for (let i = 0; i < 8; i++) add(row(T("10-26 12:00") + i * 90 * MIN, "x-post", "held", "info", `:information_source: X account: ${i % 4 + 1} post(s) held back by the daily limit (30/day, urgent undefined).`));
  for (let i = 0; i < 13; i++) add(row(T("11-02 09:00") + i * 2 * H, "ig-post", "held", "info", `:information_source: Instagram: ${i % 3 + 1} post(s) held back by the daily limit (20 stories + 3 feed posts a day).`));
  add(row(T("11-10 09:00"), "ig-post", "held", "info", ":information_source: Instagram: 1 post(s) held back by the daily limit."));
  for (let i = 0; i < 14; i++) add(row(T("10-26 10:00") + i * 20 * MIN, "x-post", "dry-run", "info", `*DRY RUN: not posted to X* (${i % 3 + 1}/3) [storm] 204/280 characters, est. cost $0.015`));
  for (let i = 0; i < 5; i++) add(row(T("10-28 11:00") + i * 5 * MIN, "ig-post", "dry-run", "info", `*DRY RUN: not posted to Instagram* (${i + 1}/5) [feed: Rivers right now]`));
  for (let i = 0; i < 5; i++) add(row(T("10-29 12:00") + i * H, "ig-post", "post-sent", "info", `:camera: Instagram: posted "Rivers right now" (first posts ${i + 1}/5).`));
  for (let i = 0; i < 8; i++) add(row(T(`10-${26 + (i % 2)} 18:00`) + i * 7 * H % D, "x-series", "post-sent", "info", `:mega: X series posted "rain-map": https://x.com/waterlevels/status/${1700000000000 + i}`));
  // rain-driven: a few wet days only (4 days of street-water, 7 of 11 for the shadow log), never "every day"
  for (const [i, day] of ["10-26", "11-01", "11-02", "11-10", "11-11"].entries()) for (let k = 0; k < 4; k++) add(row(T(`${day} 09:00`) + k * 5 * H, "street-rain-log", "street-water", "info", `Heavy rain, low spots may get water: Marawila (24 h rain at or above 60 mm). Satellite rain: 24 h ${60 + i + k} mm counted`));
  for (const [i, day] of ["11-01", "11-02", "11-04", "11-05", "11-08", "11-10", "11-11"].entries()) for (let k = 0; k < 3; k++) add(row(T(`${day} 10:00`) + k * 3 * H, "ground-rain-shadow", "shadow", "info", `Shadow (ground gauges): Ja-Ela street water possible: ${30 + i + k} mm in 24 h. Not shown to anyone.`));
  add(row(T("10-26 20:00"), "feedback-route", "urgent-feedback", "warn", `*Feedback: our verdict looks too mild.* Someone at Moragaswewa says it is worse than shown. They wrote: "my road ${1} is flooded, call 0771234567"`));
  add(row(T("10-27 20:00"), "feedback-route", "urgent-feedback", "warn", `*Feedback: our verdict looks too mild.* Someone at Colombo (gauge Nagalagam Street) says it is worse than shown. They wrote: "kamal@example.com"`));
  add(row(T("10-29 20:00"), "feedback-route", "urgent-feedback", "warn", `*Feedback: our verdict looks too mild.* Someone at Dematagoda says it is worse than shown.`));
  add(row(T("10-23 13:34"), "health-alert", "test", "info", "Sri Lanka Water Levels monitoring is connected ✅"), row(T("10-26 10:00"), "health-alert", "test", "info", "Sri Lanka Water Levels monitoring is connected ✅"));
  for (let i = 0; i < 30; i++) add(row(T("10-27 08:00") + i * 6 * H, "x-replies", "reply-posted", "info", `:speech_balloon: X replies: replied to a visitor at ${["Hanwella", "Kolonnawa"][i % 2]}.`));
  return r.sort((a, b) => a.ts - b.ts);
}

// ---------------------------------------------------------------------------------------------------------------------
// fakes: D1 (the adapter interface of scripts/ops-triage.mjs), GitHub, Slack
// ---------------------------------------------------------------------------------------------------------------------
function fakeD1(all: any[]) {
  const d: any = { issues: {}, state: {}, rows: all.slice(), visibleUntil: Infinity, saves: 0, failRead: false, failWrite: false };
  d.loadNotifications = async (since: number) => { if (d.failRead) throw new Error("D1 HTTP 500: storage operation exceeded timeout [code: 7429]"); return d.rows.filter((r: any) => r.ts >= since && r.ts <= d.visibleUntil && r.source !== "ops-triage").map((r: any) => ({ ...r })); };
  d.loadIssues = async () => { if (d.failRead) throw new Error("D1 HTTP 500: storage operation exceeded timeout [code: 7429]"); const c = (o: any) => Object.fromEntries(Object.entries(o).map(([k, v]: any) => [k, { ...v }])); return { issues: c(d.issues), state: c(d.state) }; };
  d.saveIssue = async (r: any) => { if (d.failWrite) throw new Error("D1 write failed"); d.saves++; (r.fingerprint.startsWith("_") ? d.state : d.issues)[r.fingerprint] = { ...r }; };
  d.purge = async (before: number) => { const n = d.rows.filter((r: any) => r.ts < before).length; d.rows = d.rows.filter((r: any) => r.ts >= before); return n; };
  return d;
}
function fakeGh() {
  const g: any = { items: new Map(), n: 100, calls: [], clock: 0, fail: false, labels: 0, made: [] };
  const rec = (name: string, ...a: any[]) => { if (g.fail) throw new Error("GitHub POST -> HTTP 502"); g.calls.push({ name, t: g.clock, a }); };
  g.ensureLabel = async () => { rec("ensureLabel"); g.labels++; };
  g.list = async () => { rec("list"); return [...g.items.values()].map((i: any) => ({ number: i.number, state: i.state, body: i.body, labels: i.labels, url: i.url })); };
  g.create = async (title: string, body: string) => { rec("create", title, body); const number = ++g.n; g.made.push(number); g.items.set(number, { number, title, body, state: "open", labels: ["ops-loop"], url: `https://github.com/${REPO}/issues/${number}`, comments: [] }); return { number, url: `https://github.com/${REPO}/issues/${number}` }; };
  g.comment = async (n: number, body: string) => { rec("comment", n, body); g.items.get(n).comments.push(body); };
  g.close = async (n: number) => { rec("close", n); g.items.get(n).state = "closed"; };
  g.reopen = async (n: number) => { rec("reopen", n); g.items.get(n).state = "open"; };
  g.retitle = async (n: number, title: string) => { rec("retitle", n, title); g.items.get(n).title = title; };
  return g;
}
const writes = (g: any) => g.calls.filter((c: any) => !["list", "ensureLabel"].includes(c.name));

/** The job, as many times as `steps` say, over a fake D1 / GitHub; returns what happened. */
async function replay(all: any[], from: number, to: number, stepMs = 30 * MIN, tweak?: (t: number, d: any, g: any) => void) {
  const d = fakeD1(all), g = fakeGh(), slack: { t: number; text: string }[] = [];
  const events: { t: number; type: string; n: number; title?: string; why?: string }[] = [];
  for (let t = from; t <= to; t += stepMs) {
    d.visibleUntil = t; g.clock = t; tweak?.(t, d, g);
    const before = g.calls.length, madeBefore = g.made.length;
    await run({ now: t, force: true, d1: d, gh: g, env: { GITHUB_REPOSITORY: REPO }, log: quiet, notify: async (text: string, o: any) => { slack.push({ t, text }); d.rows.push({ id: nextId++, ts: t, source: o.source, kind: o.kind, severity: o.severity, text, fingerprint: fingerprint(text, o.source, o.kind) }); return { slackOk: true, logged: true }; } });
    let made = madeBefore;
    for (const c of g.calls.slice(before)) if (["create", "reopen", "close"].includes(c.name)) events.push({ t, type: c.name, n: c.name === "create" ? g.made[made++] : c.a[0], title: c.name === "create" ? c.a[0] : g.items.get(c.a[0])?.title });
  }
  return { d, g, slack, events };
}
const fmt = (ms: number) => new Date(ms + 5.5 * H).toISOString().slice(5, 16).replace("T", " ");

// ---------------------------------------------------------------------------------------------------------------------
// sanitiser
// ---------------------------------------------------------------------------------------------------------------------
const REAL_SAMPLES = [
  `*Feedback: our verdict looks too mild.* Someone at Moragaswewa says it is worse than shown. They wrote: "12 Temple Road is flooded, call 0771234567, kamal@example.com"`,
  ":speech_balloon: Report from @some_user (Wellampitiya): not confirmed, from one person. <https://x.com/some_user/status/1?s=20&t=abc|link>\n> water in front of my house, please help",
  xFail(X403, T("11-09 18:00"), "Kelani at Hanwella 8.2 ft, rising\n> second quoted line"),
  `🔴 Data source down: ${HMIS} — fetch failed. Since 8:07 pm. Users see: older readings. Status: https://waterlevels.lk/status?utm=x&token=abc123 · Issue: <https://github.com/${REPO}/issues/21|#21>`,
  ':rotating_light: Instagram post failed at publish (OAuthException: access_token=EAABwzLixnjYBO1234567890abcdefghijklmn code 190); skipped.\n> "Rain, last 24 hours"',
  ":warning: X rejected a post as a duplicate, skipped: Hanwella 8.2 ft, call 117 now",
  `⚠️ Workflow failed: X replies — ${runUrl(43041490544)}`,
  "Some text with Bearer abcdefghijklmnopqrstuvwxyz0123 and https://hooks.slack.com/services/T000/B000/XXXXXXXX",
];
test("sanitiser: no URL, email, handle, quote, phone number, token or visitor text survives, on every real family", () => {
  for (const s of REAL_SAMPLES) {
    const c = sanitise(s);
    assert.ok(!/https?:|www\.|@|\?|[“”"]|0771|kamal|Temple|some_user|abc123|EAAB|hooks\.slack|abcdefghijklmnop/i.test(c), `leaked: ${c}`);
    assert.ok(!/please help|second quoted line|water in front|Hanwella 8\.2 ft, rising|Evening update/i.test(c), `quoted text kept: ${c}`);
    assert.ok(c.length <= 320);
  }
  assert.match(sanitise(REAL_SAMPLES[3]), /Data source down/);
  assert.equal(sanitise(REAL_SAMPLES[0]).includes("They wrote"), false);
});
test("sanitiser: the rendered issue body has no URL except Actions run links, and no quoted post text", () => {
  const rows = history().filter((r) => r.source === "x-post" && r.kind === "post-failed").slice(0, 3);
  const s = summarise("k", rows, rows[2].ts);
  const body = renderBody({ ...s, runs: [runUrl(5)] }, { text: "x" }, "abc");
  const urls = body.match(/https?:\/\/[^\s)\]]+/g) ?? [];
  assert.ok(urls.every((u) => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/.test(u)), urls.join(","));
  assert.ok(!/Kelani at Hanwella|Good morning|\?/.test(body.replace(/\*\*Checklist[\s\S]*$/, "")));
  assert.ok(body.startsWith("<!-- ops-loop:abc -->") && /- \[ \] diagnosis/.test(body) && /- \[ \] fix/.test(body) && /- \[ \] verified/.test(body));
  assert.ok(/scripts\/x-post\.mjs/.test(body) && /Since\./.test(body) && /How often\./.test(body) && /Latest message/.test(body));
});
test("sanitiser: a run URL with a query string is dropped from the issue", () => {
  const r = [{ ...history().find((x) => x.kind === "post-failed"), run_url: `${runUrl(7)}?token=zzz` }];
  assert.deepEqual(summarise("k", r, r[0].ts).runs, []);
});

// ---------------------------------------------------------------------------------------------------------------------
// rules, one by one
// ---------------------------------------------------------------------------------------------------------------------
const NOW = T("11-12 12:00");
const mk = (ts: number, over: any = {}) => ({ id: nextId++, ts, source: "x-post", kind: "post-failed", severity: "error", text: "boom", fingerprint: "fp1", run_url: null, ...over });
const opens = (rows: any[], now: number, issues: any = {}) => triage({ notifications: rows, issues, now }).actions.filter((a) => a.type === "open" || a.type === "reopen");

test("rules: informational families are never raised, however loud", () => {
  const families = [["feedback-digest", "digest"], ["push-notify", "digest"], ["ig-post", "dry-run"], ["x-post", "held"], ["x-post", "held-dropped"], ["street-rain-log", "street-water"], ["ground-rain-shadow", "shadow"], ["feedback-route", "urgent-feedback"], ["x-replies", "reply-posted"], ["x-replies", "report"], ["x-replies", "emergency"], ["ig-post", "post-sent"], ["health-alert", "test"]];
  for (const [source, kind] of families) for (const severity of ["info", "warn", "error", "critical"]) {
    const rows = Array.from({ length: 40 }, (_, i) => mk(NOW - i * 20 * MIN, { source, kind, severity, fingerprint: `${source}${kind}` }));
    assert.equal(triage({ notifications: rows, now: NOW }).actions.length, 0, `${source}/${kind}/${severity}`);
  }
  // a plain severity=info row of ANY kind, and the loop's own messages
  assert.equal(triage({ notifications: Array.from({ length: 30 }, (_, i) => mk(NOW - i * H, { kind: "whatever", severity: "info" })), now: NOW }).actions.length, 0);
  assert.equal(triage({ notifications: Array.from({ length: 30 }, (_, i) => mk(NOW - i * H, { source: "ops-triage", kind: "ops-loop", severity: "error" })), now: NOW }).actions.length, 0);
  assert.ok(isInformational(mk(NOW, { source: "ops-triage", kind: "post-failed" })));
});
test("rules: one-off warnings and short blips are not raised", () => {
  assert.equal(opens([mk(NOW - H, { severity: "warn" })], NOW).length, 0, "one warning");
  assert.equal(opens([mk(NOW - 5 * H, { severity: "warn" }), mk(NOW - H, { severity: "warn" })], NOW).length, 0, "two warnings the same day");
  assert.equal(opens([mk(NOW - 2 * H), mk(NOW - 10 * MIN)], NOW).length, 0, "an error repeated only 2 h apart");
  assert.equal(opens([mk(NOW - 44 * H), mk(NOW - H)], NOW).length, 0, "an error twice, 43 h apart, is two blips, not one repeating problem");
});
test("rules: the repeat rules open", () => {
  assert.equal(opens([mk(NOW - 2 * H, { severity: "warn" }), mk(NOW - H, { severity: "warn" }), mk(NOW - 10 * MIN, { severity: "warn" })], NOW)[0].reason.code, "repeat24h", "R1: three warnings in 24 h");
  assert.equal(opens([mk(NOW - 4 * H), mk(NOW - 5 * MIN)], NOW)[0].reason.code, "persists", "R3: an error still repeated 3 h on");
  const d1 = T("11-11 23:00"), d2 = T("11-12 07:00");
  assert.equal(opens([mk(d1, { severity: "warn" }), mk(d2, { severity: "warn" })], NOW)[0].reason.code, "two-days", "R2: consecutive Sri Lanka days (the day boundary is 00:00 +05:30, not UTC)");
  assert.equal(dayNum(T("11-11 23:59")) + 1, dayNum(T("11-12 00:01")));
  assert.equal(opens([mk(NOW - 3 * H, { kind: "paused", severity: "warn" }), mk(NOW - 10 * MIN, { kind: "paused", severity: "warn" })], NOW)[0].reason.code, "pause-repeats", "R5: a pause re-announced");
  const wf = (ts: number, text = "⚠️ Workflow failed: Snapshot — x") => mk(ts, { source: "workflow:Snapshot", kind: "workflow-failed", text, fingerprint: "wf" });
  assert.equal(opens([wf(NOW - 2 * H), wf(NOW - H)], NOW)[0].reason.code, "workflow-twice", "a workflow that failed twice in 24 h");
  assert.equal(opens([wf(NOW - H, "⚠️ Workflow failed 3 runs in a row: Snapshot — x")], NOW)[0].reason.code, "workflow-twice", "a '3 runs in a row' line stands for 3 failures");
  assert.equal(opens([wf(NOW - H)], NOW).length, 0, "one failure of a workflow is a blip");
});
test("rules: only a CURRENT problem opens (recovered, or quiet for 48 h, does not)", () => {
  const rec = (ts: number) => mk(ts, { kind: "data-source-recovered", severity: "info", text: "✅ Recovered" });
  assert.equal(opens([mk(NOW - 7 * H), mk(NOW - 2 * H), rec(NOW - H)], NOW).length, 0, "recovered");
  assert.equal(opens([mk(NOW - 80 * H), mk(NOW - 70 * H), mk(NOW - 60 * H)], NOW).length, 0, "old");
});
test("rules: 'ignored' is respected for ever", () => {
  const ign = { fp1: { fingerprint: "fp1", status: "ignored", github_issue: 5 } };
  const rows = Array.from({ length: 10 }, (_, i) => mk(NOW - i * H));
  const out = triage({ notifications: rows, issues: ign, now: NOW });
  assert.equal(out.actions.length, 0);
  assert.equal(out.issues.fp1.status, "ignored");
  // and a recovery or 60 h of quiet does not un-ignore it
  assert.equal(triage({ notifications: [], issues: ign, now: NOW + 100 * H }).issues.fp1.status, "ignored");
});
test("rules: update is quiet; a comment only after a quiet day; resolve on recovery or 48 h of quiet", () => {
  const first = [mk(NOW - 7 * H), mk(NOW - H)];
  const a = triage({ notifications: first, now: NOW });
  assert.equal(a.actions[0].type, "open");
  // a minute later, nothing new: nothing
  assert.equal(triage({ notifications: first, issues: a.issues, now: NOW + MIN }).actions.length, 0);
  // two more rows the same day: a silent update
  const more = [...first, mk(NOW + 2 * H), mk(NOW + 3 * H)];
  const u = triage({ notifications: more, issues: a.issues, now: NOW + 4 * H });
  assert.deepEqual(u.actions.map((x) => x.type), ["update"]);
  assert.equal(u.issues.fp1.count, 4);
  // back after more than a quiet day: a comment
  const back = [...more, mk(NOW + 40 * H)];
  assert.deepEqual(triage({ notifications: back, issues: u.issues, now: NOW + 41 * H }).actions.map((x) => x.type), ["comment"]);
  // quiet for 48 h
  const r = triage({ notifications: more, issues: u.issues, now: NOW + 3 * H + 49 * H });
  assert.deepEqual(r.actions.map((x) => `${x.type}:${x.why}`), ["resolve:quiet"]);
  // recovery
  const rec = [...more, mk(NOW + 5 * H, { kind: "data-source-recovered", severity: "info", text: "✅ Recovered" })];
  assert.deepEqual(triage({ notifications: rec, issues: u.issues, now: NOW + 6 * H }).actions.map((x) => `${x.type}:${x.why}`), ["resolve:recovered"]);
  // after a resolve, the OLD rows do not reopen it; fresh evidence does
  const res = triage({ notifications: rec, issues: u.issues, now: NOW + 6 * H }).issues;
  assert.equal(triage({ notifications: rec, issues: res, now: NOW + 7 * H }).actions.length, 0);
  const again = [...rec, mk(NOW + 10 * H), mk(NOW + 14 * H)];
  assert.deepEqual(triage({ notifications: again, issues: { fp1: { ...res.fp1, github_issue: 5 } }, now: NOW + 14 * H + MIN }).actions.map((x) => x.type), ["reopen"]);
});
test("rules: a flaky source (3 outages in 7 days) opens once and stays open until a week of calm", () => {
  const dn = { kind: "data-source-down", fingerprint: "s", text: "🔴 Data source down: Feed — timeout. Since 1:00 am." };
  const ep = (ts: number) => [mk(ts, dn), mk(ts + 2 * H, { kind: "data-source-recovered", severity: "info", text: "✅ Recovered", fingerprint: "s" })];
  const rows = [...ep(NOW - 6 * D), ...ep(NOW - 3 * D)];
  assert.equal(opens(rows, NOW).length, 0, "two outages: no");
  const rows3 = [...rows, mk(NOW - H, dn)];
  const o = triage({ notifications: rows3, now: NOW });
  assert.equal(o.actions[0].reason.code, "flapping");
  assert.match(o.actions[0].title, /keeps going down \(3 outages since/);
  const rec = [...rows3, mk(NOW + H, { kind: "data-source-recovered", severity: "info", text: "✅ Recovered", fingerprint: "s" })];
  assert.equal(triage({ notifications: rec, issues: o.issues, now: NOW + 2 * H }).actions.length, 0, "a recovery alone does not close a flapping issue");
  assert.equal(triage({ notifications: rec, issues: o.issues, now: NOW + 8 * D }).actions[0].why, "quiet");
});
test("silence: a daily source that stops is flagged at twice its usual gap; sources are derived from the data", () => {
  const rows: any[] = [];
  for (let d = 0; d < 12; d++) rows.push(mk(T("11-01 07:00") + d * D, { source: "push-notify", kind: "digest", severity: "info", fingerprint: "pd" }));
  for (let d = 0; d < 12; d++) rows.push(mk(T("11-01 00:20") + d * D, { source: "learn-all", kind: "digest", severity: "info", fingerprint: "ld" }));
  for (let i = 0; i < 40; i++) rows.push(mk(T("11-01 00:00") + i * 6 * H, { source: "x-reposts", kind: "reply-posted", severity: "info", fingerprint: "xr" })); // 6-hourly: not "daily"
  for (const d of [1, 4, 9]) rows.push(mk(T("11-01 10:00") + d * D, { source: "street-rain-log", kind: "street-water", severity: "info", fingerprint: "sr" })); // rain-driven: not daily
  const at = (t: number) => findSilence(rows.filter((r) => r.ts <= t), t).map((s) => `${s.source}/${s.kind}`).sort();
  assert.deepEqual(at(T("11-12 07:00")), [], "both daily digests are on time (usual gap 24 h)");
  const s = findSilence(rows, T("11-14 08:00"));
  assert.deepEqual(s.map((x) => x.source).sort(), ["learn-all", "push-notify"]);
  assert.ok(findSilence(rows, T("11-14 08:00")).every((x) => x.usualGapMs === 24 * H));
  // fewer than 5 days of history: nothing is "usual" yet
  assert.deepEqual(findSilence(rows.filter((r) => r.ts < T("11-04 00:00")), T("11-20 00:00")), []);
  // the job opens it, and closes it when the source speaks again
  const out = triage({ notifications: rows, now: T("11-14 08:00") });
  assert.deepEqual(out.actions.map((a) => a.type), ["open", "open"]);
  assert.match(out.actions[0].title, /has gone quiet: it normally reports every day, nothing for \d days/);
  assert.deepEqual(triage({ notifications: rows, issues: out.issues, now: T("11-14 09:00") }).actions, [], "still silent: no second issue");
  const spoke = [...rows, mk(T("11-14 12:00"), { source: "push-notify", kind: "digest", severity: "info", fingerprint: "pd" })];
  const back = triage({ notifications: spoke, issues: out.issues, now: T("11-14 13:00") });
  assert.deepEqual(back.actions.map((a) => `${a.type}:${a.why}:${a.issue.source}`), ["resolve:spoke-again:push-notify"]);
});
test("titles: plain and specific, built from the family", () => {
  const rows = history().filter((r) => r.source === "x-post" && r.kind === "post-failed" && /not permitted/.test(r.text));
  const s = summarise("k", rows, rows[rows.length - 1].ts);
  assert.equal(titleFor(s, "persists"), "X posting keeps pausing: X says the account is not permitted to post (HTTP 403) (11 times since 8 Nov)");
  const r280 = history().filter((r) => r.kind === "post-failed" && /longer than 280/.test(r.text));
  assert.match(titleFor(summarise("k", r280, r280[1].ts)), /^X posting keeps pausing: X rejects posts over 280 characters \(2 times since 11 Nov\)$/);
  const hm = history().filter((r) => r.fingerprint === fingerprint("", "health-alert", "x", "health:hmis"));
  assert.match(titleFor(summarise("k", hm.filter((r) => r.kind === "data-source-down"), hm[8].ts)), /^HMIS is down or stale: fetch failed \(\d+ alerts since 4 Nov\)$/);
  const wf = history().filter((r) => r.source === "workflow:X replies");
  assert.equal(titleFor(summarise("k", wf, wf[1].ts)), "Workflow: X replies keeps failing (75 failures since 26 Oct)");
});

// ---------------------------------------------------------------------------------------------------------------------
// replay of the real history
// ---------------------------------------------------------------------------------------------------------------------
const VERDICT: [RegExp, "real" | "noise", string][] = [
  [/Workflow: X replies/, "real", "27 Oct X replies timing out every 5 min for 16 h"],
  [/Workflow: X account/, "real", "same storm"],
  [/Workflow: X reposts/, "real", "same storm"],
  [/Workflow: GSMaP snapshot/, "real", "wrangler d1 execute failure, 20 alerts"],
  [/ArcGIS river gauges keeps going down/, "noise", "three 1 h rate-limit blips in 3 days (the history rates it noise-level; the critical gauge source arguably earns one issue)"],
  [/Mahaweli WMS daily PDF/, "noise", "weekend publication gap, never a fault"],
  [/X posting keeps pausing: X says the account is not permitted/, "real", "the 4-day pause loop"],
  [/X posting keeps pausing: X rejects posts over 280/, "real", "the long-post refusal (fixed 11 Nov)"],
  [/HMIS is down or stale/, "real", "4 Nov and 7-9 Nov outages"],
  [/RiverNet .* keeps going down|RiverNet keeps going down/, "real", "four timeouts in 13 days, flaky upstream"],
  [/Irrigation reservoir sheet/, "real", "our bug: a row dated tomorrow is rejected"],
];
let replayResult: any;
const HISTORY_FROM = T("10-23 00:00"), HISTORY_END = T("11-11 22:00");
test("replay: the real history, the whole job every 30 minutes (issues, times, nothing informational, precision)", async () => {
  const all = history();
  replayResult = await replay(all, HISTORY_FROM, HISTORY_END);
  const { g, events, slack, d } = replayResult;
  const table = events.map((e: any) => `${fmt(e.t)}  ${e.type.padEnd(6)} #${e.n}  ${e.title}`);
  console.log("\n  replay (Sri Lanka time, 30-minute steps):\n  " + table.join("\n  "));

  const created = events.filter((e: any) => e.type === "create");
  const titles = created.map((e: any) => e.title);
  // nothing informational, nothing from one-offs
  for (const t of titles) assert.ok(!/digest|Push alerts|Feedback|Instagram|street|Shadow|Quiet|quiet|dry/i.test(t), `informational title: ${t}`);
  const one = ["HMIS snapshot", "Daily data snapshot", "Accuracy snapshot", "Open-Meteo", "Forecast store", "Colombo canal"];
  for (const o of one) assert.ok(!titles.some((t: string) => t.includes(o)), `one-off raised: ${o}`);
  assert.ok(!titles.some((t: string) => /Instagram|X series/.test(t)), "single IG / series failures");
  assert.ok(!titles.some((t: string) => /HTTP 201|duplicate/.test(t)));
  // every issue the loop opened is on the verdict list
  const verdicts = created.map((e: any) => ({ title: e.title, v: VERDICT.find(([re]) => re.test(e.title)) }));
  for (const x of verdicts) assert.ok(x.v, `unlabelled issue: ${x.title}`);
  const real = verdicts.filter((x: any) => x.v[1] === "real").length;
  console.log(`\n  precision on the real history: ${real} of ${created.length} issues opened are real problems (${Math.round((100 * real) / created.length)}%); noise: ${verdicts.filter((x: any) => x.v[1] === "noise").map((x: any) => x.title).join(" | ")}`);
  assert.equal(created.length, 11);
  assert.equal(real, 9);

  const when = (re: RegExp, type = "create") => events.filter((e: any) => e.type === type && re.test(e.title ?? "")).map((e: any) => fmt(e.t));
  // exact days and hours (30-minute steps: the opening is at the first step at or after the message)
  assert.deepEqual(when(/X says the account is not permitted/), ["11-08 19:00"], "second pause message at 18:36 (12:26 + 6 h 10 min)");
  assert.deepEqual(when(/X rejects posts over 280/), ["11-11 14:30"]);
  assert.deepEqual(when(/HMIS is down/), ["11-04 20:00"], "first 'Still down' (6 h reminder)");
  assert.deepEqual(when(/HMIS is down/, "reopen"), ["11-08 02:30"], "second HMIS outage reopens the same issue at its first 'Still down'");
  assert.deepEqual(when(/HMIS is down/, "close"), ["11-04 21:30", "11-09 09:30"], "closed by the recovery message each time");
  assert.deepEqual(when(/Irrigation reservoir sheet/), ["11-09 03:00"]);
  assert.deepEqual(when(/RiverNet .*keeps going down/), ["11-04 09:30"], "third outage in 7 days");
  assert.deepEqual(when(/Mahaweli/), ["10-25 20:00"]);
  assert.deepEqual(when(/Mahaweli/, "close"), ["10-26 11:00"]);
  assert.deepEqual(when(/ArcGIS/), ["10-26 21:30"]);
  assert.deepEqual(when(/Workflow: X replies/).length, 1);
  assert.ok(when(/Workflow: X replies/)[0] < "10-26 20:00", "the storm is caught at its second message (about an hour in), not 16 hours later");
  assert.ok(when(/Workflow: X replies/, "close")[0] >= "10-29 11:00", "closed 48 h after the last failure");
  assert.deepEqual(when(/not permitted/, "close"), ["11-13 02:30"].filter(() => false), "the history ends before the 48 h of calm");

  // the pause loop on 11 Nov: still open at the end; canal archive down at the end is NOT yet an issue
  const open = Object.values(d.issues).filter((i: any) => i.status === "open").map((i: any) => i.title);
  assert.ok(open.some((t: string) => /not permitted/.test(t)) && open.some((t: string) => /280/.test(t)));
  assert.ok(!open.some((t: string) => /canal/i.test(t)));

  // Slack: one line per newly opened (or reopened) issue + at most one summary a day, all from source ops-triage and none re-triaged
  const lines = slack.filter((s: any) => /Ops loop opened/.test(s.text));
  assert.equal(lines.length, created.length + events.filter((e: any) => e.type === "reopen").length);
  const sums = slack.filter((s: any) => /^Ops loop, /.test(s.text));
  assert.equal(sums.length, new Set(sums.map((s: any) => fmt(s.t).slice(0, 5))).size, "at most one summary a day");
  assert.ok(sums.length >= 5 && sums.length < 19, `${sums.length} daily summaries: days with nothing to say send none`);
  assert.ok(!sums.some((x: any) => /: 0 open problems\. Opened 0, resolved 0/.test(x.text)), "no empty daily line");
  // comments are rare: no spam (the 280 issue and the 403 loop got updates, but quietly)
  const comments = g.calls.filter((c: any) => c.name === "comment").length;
  console.log(`  GitHub writes: ${created.length} issues, ${comments} comments, ${events.filter((e: any) => e.type === "close").length} closes; Slack: ${lines.length} opened-lines + ${sums.length} daily summaries over 20 days`);
  assert.ok(comments <= 40, `${comments} comments`);
});
test("replay: a second run changes nothing", async () => {
  const { d, g } = replayResult;
  const before = JSON.stringify([d.issues, g.calls.length]);
  const saves = d.saves;
  await run({ now: HISTORY_END, force: true, d1: d, gh: g, env: { GITHUB_REPOSITORY: REPO }, log: quiet, notify: async () => ({}) });
  await run({ now: HISTORY_END, force: true, d1: d, gh: g, env: { GITHUB_REPOSITORY: REPO }, log: quiet, notify: async () => ({}) });
  const mut = g.calls.filter((c: any, i: number) => i >= JSON.parse(before)[1] && !["list", "ensureLabel"].includes(c.name));
  assert.equal(mut.length, 0, "no GitHub writes");
  assert.equal(JSON.stringify(d.issues), JSON.stringify(JSON.parse(before)[0]), "issue state unchanged");
  assert.ok(d.saves - saves <= 4, "only the pass-state rows are written");
});
test("replay: the 'Still down' repeats of one outage do not multiply issues; HMIS has ONE GitHub issue across both outages", () => {
  const hmis = [...replayResult.g.items.values()].filter((i: any) => /^HMIS is down/.test(i.title));
  assert.equal(hmis.length, 1);
  assert.ok(hmis[0].comments.some((c: string) => /Reopened by the ops loop/.test(c)));
  assert.ok(hmis[0].comments.some((c: string) => /recovery message/.test(c)));
});

// ---------------------------------------------------------------------------------------------------------------------
// the job
// ---------------------------------------------------------------------------------------------------------------------
const baseRows = () => [mk(T("11-11 08:00")), mk(T("11-11 14:00"))];
const NOWJ = T("11-11 15:00");
const envJ = { GITHUB_REPOSITORY: REPO };
test("job: opens one issue with label, marker, body; a Slack line; state saved", async () => {
  const d = fakeD1(baseRows()), g = fakeGh(), slack: string[] = [];
  const r = await run({ now: NOWJ, force: true, d1: d, gh: g, env: envJ, log: quiet, notify: async (t: string, o: any) => (slack.push(`${o.source}/${o.kind}/${o.severity}: ${t}`), {}) });
  assert.equal(r.opened, 1);
  assert.equal(g.labels, 1);
  const issue = g.items.get(101);
  assert.ok(issue.labels.includes("ops-loop") && issue.body.includes("<!-- ops-loop:fp1 -->"));
  assert.equal(slack.filter((s) => /ops-triage\/ops-loop\/info: :wrench: Ops loop opened #101/.test(s)).length, 1);
  assert.equal(d.issues.fp1.github_issue, 101);
  assert.ok(d.state["_state:last-run"]);
});
test("job: at most one full pass every 3 h; --force and a later pass run", async () => {
  const d = fakeD1(baseRows()), g = fakeGh();
  const go = (now: number, force = false) => run({ now, force, d1: d, gh: g, env: envJ, log: quiet, notify: async () => ({}) });
  assert.equal((await go(NOWJ)).skipped, undefined);
  const calls = g.calls.length;
  assert.equal((await go(NOWJ + 2 * H)).skipped, "recent-pass");
  assert.equal(g.calls.length, calls, "skipped pass makes no GitHub call at all");
  assert.equal((await go(NOWJ + 2 * H, true)).skipped, undefined);
  assert.equal((await go(NOWJ + 2 * H + 2 * H + 51 * MIN)).skipped, undefined, "2 h 51 min after the last pass: the 3-hourly cron must not skip itself");
  assert.ok(MIN_GAP_MS < 3 * H && MIN_GAP_MS > 2 * H);
});
test("job: ignored by label or by D1 sticks; closed by hand resolves; a repeat after a human close needs fresh evidence", async () => {
  // label
  let d = fakeD1(baseRows()), g = fakeGh();
  await run({ now: NOWJ, force: true, d1: d, gh: g, env: envJ, log: quiet, notify: async () => ({}) });
  g.items.get(101).labels.push("ops-ignore");
  d.rows.push(mk(NOWJ + H), mk(NOWJ + 2 * H));
  await run({ now: NOWJ + 3 * H, force: true, d1: d, gh: g, env: envJ, log: quiet, notify: async () => ({}) });
  assert.equal(d.issues.fp1.status, "ignored");
  const n = writes(g).length;
  d.rows.push(mk(NOWJ + 4 * H));
  await run({ now: NOWJ + 5 * H, force: true, d1: d, gh: g, env: envJ, log: quiet, notify: async () => ({}) });
  assert.equal(writes(g).length, n, "no GitHub write for an ignored problem");
  // by hand in D1: the first pass never even creates an issue
  d = fakeD1(baseRows()); g = fakeGh();
  d.issues.fp1 = { fingerprint: "fp1", status: "ignored", github_issue: null };
  await run({ now: NOWJ, force: true, d1: d, gh: g, env: envJ, log: quiet, notify: async () => ({}) });
  assert.equal(writes(g).length, 0);
  // a human closes the issue
  d = fakeD1(baseRows()); g = fakeGh();
  await run({ now: NOWJ, force: true, d1: d, gh: g, env: envJ, log: quiet, notify: async () => ({}) });
  g.items.get(101).state = "closed";
  await run({ now: NOWJ + H, force: true, d1: d, gh: g, env: envJ, log: quiet, notify: async () => ({}) });
  assert.equal(d.issues.fp1.status, "resolved");
  assert.equal(writes(g).filter((c: any) => c.name === "create").length, 1, "not opened a second time from the old rows");
  d.rows.push(mk(NOWJ + 2 * H), mk(NOWJ + 6 * H));
  await run({ now: NOWJ + 7 * H, force: true, d1: d, gh: g, env: envJ, log: quiet, notify: async () => ({}) });
  assert.equal(g.items.get(101).state, "open", "fresh evidence reopens the same GitHub issue");
  assert.equal(writes(g).filter((c: any) => c.name === "create").length, 1);
});
test("job: an issue that exists on GitHub but is unknown to D1 is adopted, not duplicated (marker in the body)", async () => {
  const d = fakeD1(baseRows()), g = fakeGh();
  g.items.set(77, { number: 77, title: "old", body: "<!-- ops-loop:fp1 -->\nx", state: "open", labels: ["ops-loop"], url: `https://github.com/${REPO}/issues/77`, comments: [] });
  await run({ now: NOWJ, force: true, d1: d, gh: g, env: envJ, log: quiet, notify: async () => ({}) });
  assert.equal(g.calls.filter((c: any) => c.name === "create").length, 0);
  assert.equal(d.issues.fp1.github_issue, 77);
});
test("job: fails soft. D1 down, GitHub down, a write that fails: no throw, nothing half-applied", async () => {
  let d = fakeD1(baseRows()); d.failRead = true;
  let g = fakeGh();
  const warns: string[] = [];
  const r1 = await run({ now: NOWJ, force: true, d1: d, gh: g, env: envJ, log: { log() {}, warn: (m: string) => warns.push(m) }, notify: async () => ({}) });
  assert.equal(r1.d1Down, true);
  assert.ok(warns[0].startsWith("::warning::"));
  assert.equal(g.calls.length, 0);
  d = fakeD1(baseRows()); g = fakeGh(); g.fail = true;
  const r2 = await run({ now: NOWJ, force: true, d1: d, gh: g, env: envJ, log: quiet, notify: async () => ({}) });
  assert.equal(r2.skipped, "github-down");
  assert.equal(Object.keys(d.issues).length, 0);
  d = fakeD1(baseRows()); g = fakeGh(); d.failWrite = true;
  await run({ now: NOWJ, force: true, d1: d, gh: g, env: envJ, log: quiet, notify: async () => ({}) }); // must not throw
  // next pass (D1 writable again) adopts the issue the failed pass created
  d.failWrite = false;
  await run({ now: NOWJ + 4 * H, force: true, d1: d, gh: g, env: envJ, log: quiet, notify: async () => ({}) });
  assert.equal(g.items.size, 1, "no duplicate");
  assert.equal(d.issues.fp1.github_issue, 101);
});
test("job: --dry-run touches nothing (no D1 write, no GitHub call, no Slack) and prints the plan", async () => {
  const d = fakeD1(baseRows()), g = fakeGh(), said: string[] = [], slack: string[] = [];
  const r = await run({ now: NOWJ, dryRun: true, d1: d, gh: g, env: envJ, log: { log: (m: string) => said.push(m), warn() {} }, notify: async (t: string) => (slack.push(t), {}) });
  assert.equal(g.calls.length, 0);
  assert.equal(d.saves, 0);
  assert.equal(slack.length, 0);
  assert.equal(r.actions.length, 1);
  assert.ok(said.some((m) => /^\[dry-run\] OPEN: /.test(m)));
  // a fixture file works the same way, with no services at all
  const r2 = await run({ now: NOWJ, dryRun: true, input: { notifications: baseRows() }, env: envJ, log: quiet });
  assert.equal(r2.actions.length, 1);
});
test("job: the issue text of every real family is clean (title, body, comments, Slack line)", async () => {
  const { g, slack } = replayResult;
  const everything = [...g.items.values()].flatMap((i: any) => [i.title, i.body, ...i.comments]).concat(slack.map((s: any) => s.text));
  for (const t of everything) {
    const urls = (t.match(/https?:\/\/[^\s)\]]+/g) ?? []).filter((u: string) => !/^https:\/\/github\.com\/shakee93\/sl-water-levels\/(actions\/runs\/\d+|issues\/\d+|issues\?q=[\w%+.:-]+)$/.test(u));
    assert.deepEqual(urls, [], `URL in public text: ${t.slice(0, 120)}`);
    assert.ok(!/@[\w]|kamal|0771|They wrote|Kelani at Hanwella|Good morning/.test(t), `personal or quoted text: ${t.slice(0, 120)}`);
  }
  assert.ok(everything.length > 40);
});

// ---------------------------------------------------------------------------------------------------------------------
// D1 adapter: the statements it sends
// ---------------------------------------------------------------------------------------------------------------------
test("d1 adapter: one idempotent statement per write, quotes escaped, retention in slices, schema on 'no such table'", async () => {
  const stmts: string[] = [];
  const reads: string[] = [];
  let missing = true;
  const sel = async (sql: string) => {
    reads.push(sql);
    if (missing && /FROM ops_issues/.test(sql)) throw new Error("D1 HTTP 400: no such table: ops_issues");
    if (/COUNT/.test(sql)) return [{ c: stmts.filter((s) => /^DELETE/.test(s)).length < 3 ? 1200 : 0 }];
    return [];
  };
  const exec = async (s: string[]) => { stmts.push(...s); if (s[0].startsWith("CREATE TABLE IF NOT EXISTS ops_issues")) missing = false; };
  const a = d1Adapter({ sel, exec });
  await a.loadIssues();
  assert.ok(stmts.some((s) => /^CREATE TABLE IF NOT EXISTS notifications/.test(s)) && stmts.some((s) => /^CREATE TABLE IF NOT EXISTS ops_issues/.test(s)));
  stmts.length = 0;
  await a.saveIssue({ fingerprint: "ab12", title: "X's posting; DROP TABLE x -- 'quoted'", source: "x-post", kind: "post-failed", severity: "error", first_ts: 1, last_ts: 2, count: 3, status: "open", github_issue: 9, opened_ts: 4, resolved_ts: null, note: "{}" });
  assert.equal(stmts.length, 1);
  assert.match(stmts[0], /^INSERT INTO ops_issues \(fingerprint, title,.*\) VALUES \('ab12', 'X''s posting; DROP TABLE x -- ''quoted''', 'x-post'.*NULL, '\{\}'\) ON CONFLICT\(fingerprint\) DO UPDATE SET title = excluded\.title/);
  stmts.length = 0;
  const removed = await a.purge(1_000);
  assert.equal(stmts.length, 3, "three slices");
  assert.ok(stmts.every((s) => /^DELETE FROM notifications WHERE id IN \(SELECT id FROM notifications WHERE ts < 1000 ORDER BY ts LIMIT 500\)$/.test(s)));
  assert.equal(removed, 1500);
  const n = await a.loadNotifications(5);
  void n;
  assert.ok(reads.some((s) => /severity = 'info' THEN ''/.test(s) && /source != 'ops-triage'/.test(s)), "info rows are read without their text");
});
test("d1 adapter: through the real lib/d1Sql.mjs against a fake Cloudflare server (reads retried, writes are /query statements)", async () => {
  const seen: any[] = [];
  const srv = createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)).on("end", () => {
      const j = b ? JSON.parse(b) : {};
      seen.push({ url: req.url, body: j });
      const sqls = j.batch ? j.batch.map((x: any) => x.sql) : [j.sql];
      const first = seen.filter((s) => /FROM ops_issues/.test(JSON.stringify(s.body))).length === 1 && /FROM ops_issues/.test(sqls[0] ?? "");
      if (first) { res.statusCode = 500; res.end(JSON.stringify({ success: false, errors: [{ message: "D1 DB storage operation exceeded timeout", code: 7429 }] })); return; }
      res.end(JSON.stringify({ success: true, result: [{ results: /FROM ops_issues/.test(sqls[0] ?? "") ? [{ fingerprint: "a", status: "open" }, { fingerprint: "_state:last-run", last_ts: 5 }] : [] }] }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as any).port;
  process.env.CF_API_BASE = `http://127.0.0.1:${port}`;
  process.env.CLOUDFLARE_API_TOKEN = "test-token-not-real";
  process.env.CF_D1_DATABASE_ID = "00000000-0000-0000-0000-000000000000";
  try {
    const real = await import("../lib/d1Sql.mjs?ops=1");
    const a = d1Adapter({ sel: real.selectRows, exec: real.runStatements });
    const { issues, state } = await a.loadIssues();
    assert.deepEqual(Object.keys(issues), ["a"]);
    assert.equal(state["_state:last-run"].last_ts, 5);
    assert.ok(seen.length >= 2, "the 7429 timeout was retried");
    await a.saveIssue({ fingerprint: "zz", title: "t", status: "open" });
    assert.ok(/INSERT INTO ops_issues/.test(JSON.stringify(seen[seen.length - 1].body)) && /\/query$/.test(seen[seen.length - 1].url));
  } finally { srv.close(); delete process.env.CF_API_BASE; delete process.env.CLOUDFLARE_API_TOKEN; delete process.env.CF_D1_DATABASE_ID; }
});

test("cap: 15 workflows failing at once open at most 5 issues, worst first; the rest wait and open on the next pass", async () => {
  const wf = (i: number, ts: number, over: any = {}) => mk(ts, { source: `workflow:W${i}`, kind: "workflow-failed", text: `⚠️ Workflow failed: W${i} — x`, fingerprint: `wf${i}`, ...over });
  const rows: any[] = [];
  for (let i = 0; i < 15; i++) { rows.push(wf(i, NOW - 2 * H)); rows.push(wf(i, NOW - H)); }
  // W14 is critical with the most messages: it must be first even though it sorts last by name
  rows.push(wf(14, NOW - 30 * MIN, { severity: "critical" }), wf(14, NOW - 20 * MIN, { severity: "critical" }));
  const out = triage({ notifications: rows, now: NOW });
  const o = out.actions.filter((a: any) => a.type === "open");
  assert.equal(o.length, RULES.maxOpenPerPass);
  assert.equal(o[0].key, "wf14", "severity, then count, comes first");
  assert.equal(out.deferred, 10);
  assert.equal(Object.keys(out.issues).length, 5, "deferred problems are not saved in the next state");
  // the job: one pass opens 5 issues + 5 Slack lines + ONE 'more waiting' line; the next pass (3 h gate aside) opens the next 5
  const d = fakeD1(rows), g = fakeGh(), slack: string[] = [];
  const notify = async (text: string) => { slack.push(text); return { slackOk: true, logged: true }; };
  const pass = (now: number) => run({ now, force: true, d1: d, gh: g, env: { GITHUB_REPOSITORY: REPO }, log: quiet, notify });
  const r1 = await pass(NOW);
  assert.equal(g.made.length, 5);
  assert.equal(r1.deferred, 10);
  assert.equal(slack.filter((t) => /more problems? waiting/.test(t)).length, 1);
  assert.match(slack.find((t) => /waiting/.test(t)) ?? "", /10 more problems waiting/);
  assert.equal(slack.filter((t) => /opened/.test(t)).length, 5);
  await pass(NOW + 10 * MIN);
  assert.equal(g.made.length, 10, "the deferred ones are picked up by the next pass");
  assert.equal(new Set(g.made).size, 10, "no duplicates");
  await pass(NOW + 20 * MIN);
  assert.equal(g.made.length, 15);
  const r4 = await pass(NOW + 30 * MIN);
  assert.equal(r4.deferred ?? 0, 0);
  assert.equal(g.made.length, 15, "nothing left, nothing new");
});


// ---------------------------------------------------------------------------------------------------------------------
// T1 (11 Nov 2026): explicit heartbeats, failed workflow runs read from GitHub, small fixes
// ---------------------------------------------------------------------------------------------------------------------
test("silence: only HEARTBEATS pairs can be quiet; the verifier's event-driven families never are", () => {
  const rows: any[] = [];
  // 6 days of rain-driven / event-driven lines, then 5 quiet days (the verifier's failing fixtures)
  for (let d = 0; d < 6; d++) {
    const t = T("11-01 10:00") + d * D;
    rows.push(mk(t, { source: "street-rain-log", kind: "street-water", severity: "info", fingerprint: "a" }), mk(t, { source: "ground-rain-shadow", kind: "shadow", severity: "info", fingerprint: "b" }),
      mk(t, { source: "x-post", kind: "held-dropped", severity: "warn", fingerprint: "c" }), mk(t, { source: "x-post", kind: "budget", severity: "warn", fingerprint: "d" }),
      mk(t, { source: "feedback-route", kind: "urgent-feedback", severity: "warn", fingerprint: "e" }), mk(t, { source: "x-replies", kind: "reply-posted", severity: "info", fingerprint: "f" }));
  }
  assert.deepEqual(findSilence(rows, T("11-12 10:00")), []);
  assert.deepEqual(triage({ notifications: rows, now: T("11-12 10:00") }).actions, [], "no issue about any of them");
  // a real heartbeat (push digest) needs 5 days of log, and silence only after 2x the expected 24 h
  const hb = (n: number) => Array.from({ length: n }, (_, i) => mk(T("11-01 07:30") + i * D, { source: "push-notify", kind: "digest", severity: "info", fingerprint: "pd" }));
  assert.deepEqual(findSilence(hb(4), T("11-12 08:00")), [], "only 4 days of log for the pair");
  assert.deepEqual(findSilence(hb(5), T("11-05 07:30") + 47 * H), [], "47 h: inside twice the gap");
  assert.equal(findSilence(hb(5), T("11-05 07:30") + 49 * H).length, 1, "49 h: silent");
  assert.equal(findSilence([...hb(5), ...rows], T("11-12 10:00")).map((s: any) => s.source).join(), "push-notify");
  // a daily-looking pair that is not in the table is never reported, however regular
  const daily = Array.from({ length: 12 }, (_, i) => mk(T("11-01 09:00") + i * D, { source: "x-series", kind: "post-sent", severity: "info", fingerprint: "xs" }));
  assert.deepEqual(findSilence(daily, T("11-20 09:00")), []);
  assert.deepEqual(Object.keys(HEARTBEATS).sort(), ["feedback-digest\u0000digest", "learn-all\u0000digest", "push-notify\u0000digest"]);
});

test("daily summary: nothing to say means no line", () => {
  assert.equal(dailySummary({}, NOW, { silence: [] }), "");
  const open = { a: { fingerprint: "a", status: "open", github_issue: 5, title: "Workflow: X replies keeps failing (3 failures since 26 Oct)", opened_ts: NOW - 2 * D } };
  assert.match(dailySummary(open, NOW, {}), /1 open problem \(#5 Workflow: X replies keeps failing/, "the workflow name is kept in the Slack line");
  assert.notEqual(dailySummary({ a: { fingerprint: "a", status: "resolved", resolved_ts: NOW - H } }, NOW, {}), "");
});

// ---- failed workflow runs ----------------------------------------------------------------------------------------------
const WF = "CUrW snapshot";
const run1 = (id: number, name: string, conclusion: string, at: number, startAt = at - 2 * MIN) => ({ id, name, conclusion, ts: at, startTs: startAt, url: `https://github.com/${REPO}/actions/runs/${id}` });
/** a job that runs every `everyMin`, success until `failFrom`, failure after, up to `until` */
const series = (name: string, every: number, from: number, failFrom: number, until: number, id0 = 1000) => {
  const out: any[] = []; let i = 0;
  for (let t = from; t <= until; t += every * MIN) out.push(run1(id0 + i++, name, t >= failFrom ? "failure" : "success", t + 2 * MIN, t));
  return out;
};
const passAt = (runs: any[], t: number, rows: any[] = [], issues: any = {}) => {
  const visible = runs.filter((r: any) => r.ts <= t);
  const w = workflowRunRows({ runs: visible, notifications: rows, now: t });
  return { w, out: triage({ notifications: [...rows, ...w.rows], issues, now: t, workflowCadence: w.cadence }) };
};
test("runs: a frequent job opens at 3 failed runs in 2 h; its first failures are blips; a success is the recovery", () => {
  const start = T("11-11 19:30"); // 14:00 UTC
  const runs = series(WF, 15, start - 6 * H, start, start + 3 * H);
  const first = (stop: number) => { for (let t = start; t <= stop; t += 15 * MIN) { const r = passAt(runs, t); if (r.out.actions.some((a: any) => a.type === "open")) return { t, a: r.out.actions[0], w: r.w }; } return null; };
  const hit = first(start + 3 * H)!;
  assert.equal(hit.w.cadence[WF], "frequent");
  assert.equal(hit.a.reason.code, "run-burst");
  assert.equal(fmt(hit.t), "11-11 20:15", "the 3rd failed run starts 20:00 and ends 20:02: found at the first 15-minute step after it");
  assert.match(hit.a.title, /^Workflow: CUrW snapshot keeps failing \(3 failures since 11 Nov\)$/);
  // two failures only: not yet; a success in between: never
  assert.equal(passAt(runs, start + 20 * MIN).out.actions.length, 0);
    // recovery: a later success closes the open issue
  const ok = [...runs, run1(9999, WF, "success", start + 3 * H + 17 * MIN, start + 3 * H + 15 * MIN)];
  const o = passAt(runs, start + H).out;
  const rec = passAt(ok, start + 4 * H, [], o.issues).out;
  assert.deepEqual(rec.actions.map((a: any) => `${a.type}:${a.why}`), ["resolve:recovered"]);
});
test("runs: a frequent job with a slow failure (every 70 min) opens on the 1-hour streak rule", () => {
  const start = T("11-11 10:00");
  const runs = series("Hourly job", 70, start - 5 * H, start, start + 3 * H);
  let hit: any = null;
  for (let t = start; t <= start + 3 * H && !hit; t += 10 * MIN) { const r = passAt(runs, t); hit = r.out.actions.find((a: any) => a.type === "open") ?? null; }
  assert.equal(hit.reason.code, "run-streak");
  assert.match(hit.reason.text, /no successful run for 1 h or more/);
});
test("runs: a daily job opens at 2 failures in a row, not at 1, and not after a success in between", () => {
  const name = "Nightly learn";
  const day = (d: number, c: string, id: number) => run1(id, name, c, T("11-0" + d + " 00:30"), T("11-0" + d + " 00:20"));
  const one = [day(4, "success", 1), day(5, "success", 2), day(6, "success", 3), day(7, "failure", 4)];
  const p1 = passAt(one, T("11-07 06:00"));
  assert.equal(p1.w.cadence[name], "daily");
  assert.equal(p1.out.actions.length, 0, "one failed run of a daily job: wait");
  const two = [...one, day(8, "failure", 5)];
  const p2 = passAt(two, T("11-08 06:00"));
  assert.equal(p2.out.actions[0].reason.code, "run-daily");
  const mixed = [day(4, "success", 1), day(5, "success", 2), day(6, "failure", 3), day(7, "success", 4), day(8, "failure", 5)];
  assert.equal(passAt(mixed, T("11-08 06:00")).out.actions.length, 0, "a success between the failures resets the count");
});
test("runs: a failure the workflow's own Slack step already logged counts once (run id in run_url)", () => {
  const start = T("11-11 19:30");
  const runs = series(WF, 15, start - 2 * H, start, start + 40 * MIN);
  const failed = runs.filter((r: any) => r.conclusion === "failure");
  const logged = [row(failed[0].ts + 5_000, `workflow:${WF}`, "workflow-failed", "error", `⚠️ Workflow failed: ${WF} — ${failed[0].url}`, `workflow:${WF}`, failed[0].url)];
  const w = workflowRunRows({ runs, notifications: logged, now: start + 40 * MIN });
  assert.equal(w.rows.filter((r: any) => r.kind === "run-failed").length, failed.length - 1);
  const all = [...logged, ...w.rows].filter((r: any) => r.kind !== "run-recovered");
  assert.equal(new Set(all.map((r: any) => r.fingerprint)).size, 1, "logged and synthetic rows share ONE fingerprint, so one issue");
  assert.equal(all.length, failed.length, "each failed run once");
  // a run older than 48 h, a cancelled run and a failure of a workflow with no failures are not rows
  const old = [run1(1, "Old", "failure", start - 49 * H), run1(2, "Old", "failure", start - 50 * H), run1(3, "Quiet", "cancelled", start - H), run1(4, "Quiet", "success", start - 2 * H)];
  assert.deepEqual(workflowRunRows({ runs: old, now: start }).rows, []);
});
test("runs: an isolated failure 3 days before a new isolated failure is not a streak (logged Slack rows older than the run window are ignored)", () => {
  const name = "Daily thing";
  const day = (d: number, c: string, id: number) => run1(id, name, c, T("11-0" + d + " 00:30"), T("11-0" + d + " 00:20"));
  const runs = [day(1, "failure", 1), day(2, "success", 2), day(3, "success", 3), day(4, "success", 4), day(5, "failure", 5)];
  const logged = [1, 5].map((d) => row(T("11-0" + d + " 00:31"), `workflow:${name}`, "workflow-failed", "error", `Workflow failed: ${name}`, `workflow:${name}`, `https://github.com/${REPO}/actions/runs/${d === 1 ? 1 : 5}`));
  const p = passAt(runs, T("11-05 06:00"), logged);
  assert.equal(p.out.actions.length, 0, "two single failures with successes between: no issue");
  // two real failures in a row inside the window still open one
  const two = [day(3, "success", 3), day(4, "failure", 6), day(5, "failure", 5)];
  assert.equal(passAt(two, T("11-05 06:00"), [logged[1]]).out.actions[0]?.type, "open");
});
test("runs: the job reads runs through the adapter, opens ONE issue, and a repeat pass adds nothing; the early pass inside the 3 h gate", async () => {
  const start = T("11-11 19:30");
  const runs = series(WF, 15, start - 6 * H, start, start + 3 * H);
  const d = fakeD1([]), g = fakeGh(), slack: string[] = [];
  let visible = start + 20 * MIN;
  g.listRuns = async () => runs.filter((r: any) => r.ts <= visible);
  g.hasFailedRunsSince = async (since: number) => runs.some((r: any) => r.conclusion === "failure" && r.startTs > since && r.ts <= visible);
  g.listDataHealth = async () => [];
  const notify = async (t: string) => (slack.push(t), {});
  const go = (now: number) => { visible = now; return run({ now, d1: d, gh: g, env: envJ, log: quiet, notify }); };
  assert.equal((await go(start + 20 * MIN)).opened, 0, "two failed runs: not yet");
  assert.equal((await go(start + 26 * MIN)).skipped, "recent-pass", "inside the gate and under 25 min: skipped");
  const r = await go(start + 50 * MIN);
  assert.equal(r.skipped, undefined, "a new failed run earns an early pass");
  assert.equal(r.opened, 1);
  assert.equal(g.made.length, 1);
  assert.match(g.items.get(101).title, /^Workflow: CUrW snapshot keeps failing/);
  assert.match(g.items.get(101).body, /actions\/runs\/\d+/);
  assert.ok(slack.some((t) => /Ops loop opened #101: Workflow: CUrW snapshot keeps failing/.test(t)));
  await go(start + 80 * MIN);
  assert.equal(g.made.length, 1, "still failing: no second issue");
  // runs API down: the log alone is used, the pass still completes
  g.listRuns = async () => { throw new Error("GitHub GET /actions/runs -> HTTP 403"); };
  assert.equal((await go(start + 110 * MIN)).skipped, undefined);
});
test("job: a GitHub issue call that keeps failing becomes ONE Slack line a day", async () => {
  const d = fakeD1(baseRows()), g = fakeGh(), slack: string[] = [];
  const notify = async (t: string) => (slack.push(t), {});
  g.create = async () => { throw new Error("GitHub POST /issues -> HTTP 403"); };
  const pass = (now: number) => run({ now, force: true, d1: d, gh: g, env: envJ, log: quiet, notify });
  await pass(NOWJ); await pass(NOWJ + 30 * MIN);
  assert.equal(slack.filter((t) => /GitHub calls have failed/.test(t)).length, 0, "two passes: not yet");
  await pass(NOWJ + 60 * MIN); await pass(NOWJ + 90 * MIN);
  assert.equal(slack.filter((t) => /GitHub calls have failed on \d passes in a row/.test(t)).length, 1, "from the 3rd pass, once a day");
  assert.equal(d.state["_state:gh-trouble"].count, 4);
  g.fail = true; // GitHub fully down
  await pass(NOWJ + 2 * H);
  assert.equal(slack.filter((t) => /GitHub calls have failed/.test(t)).length, 1, "same day: no second line");
  await pass(NOWJ + 26 * H);
  assert.equal(slack.filter((t) => /GitHub calls have failed/.test(t)).length, 2, "next day: one more");
  g.fail = false; g.create = async (title: string, body: string) => ({ number: 7, url: "x" });
  await pass(NOWJ + 27 * H);
  assert.equal(d.state["_state:gh-trouble"].count, 0, "a good pass resets it");
});
test("job: a data-health issue for the same source is linked instead of repeating the diagnosis", async () => {
  const rows = [row(T("11-11 08:00"), "health-alert", "data-source-down", "error", down("hmis", HMIS, "fetch failed", "x")(0).text, "health:hmis"), row(T("11-11 14:00"), "health-alert", "data-source-down", "error", still("hmis", HMIS, "fetch failed", 6)(0).text, "health:hmis")];
  const d = fakeD1(rows), g = fakeGh();
  g.listDataHealth = async () => [{ number: 21, title: "Data source down: HMIS (Irrigation Department hydro-met system)" }, { number: 22, title: "Data source down: Open-Meteo" }];
  await run({ now: NOWJ, force: true, d1: d, gh: g, env: envJ, log: quiet, notify: async () => ({}) });
  const body = g.items.get(101).body;
  assert.match(body, /live status issue #21 already tracks this data source/);
  assert.ok(!/Latest message/.test(body));
  // no matching issue: the sample stays
  const g2 = fakeGh(); g2.listDataHealth = async () => [{ number: 22, title: "Data source down: Open-Meteo" }];
  await run({ now: NOWJ, force: true, d1: fakeD1(rows), gh: g2, env: envJ, log: quiet, notify: async () => ({}) });
  assert.match(g2.items.get(101).body, /Latest message/);
});

// ---------------------------------------------------------------------------------------------------------------------
let n = 0;
for (const { name, f } of tests) {
  try { await f(); n++; console.log(`ok   ${name}`); }
  catch (e) { console.error(`FAIL ${name}\n`, e); process.exitCode = 1; }
}
console.log(`${n}/${tests.length} ops-triage tests passed`);
void RULES;
