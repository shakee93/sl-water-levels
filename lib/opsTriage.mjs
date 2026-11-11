// The rules of the ops loop (DOCS.md "Ops loop (in-house notification log)"). PURE: no I/O, no clock, no network.
//
// Input: the rows of the in-house notification log (lib/notify.mjs, D1 table `notifications`) for the last days and the stored
// `ops_issues` state. Output: what to do, per PROBLEM (a fingerprint): OPEN one tracked issue, UPDATE its counters quietly,
// COMMENT when it comes back after a quiet day, RESOLVE it; plus SILENCE (a source that normally speaks every day has gone quiet).
// scripts/ops-triage.mjs applies the actions (D1 + GitHub); this file only decides.
//
// Why rules and not "alert on every error": on 7-11 Nov 2026 the same Slack line repeated for days and nobody acted. Opening an
// issue on the FIRST message would bury the owner in blips (single 429s, one-off timeouts), so a problem must repeat first.
import { scrub, fingerprint } from "./notify.mjs";

const H = 3_600_000;
const D = 24 * H;
const SLT = 5.5 * H; // Sri Lanka time, UTC+5:30, no DST

/** Every threshold in one place (documented with its reason in DOCS.md). */
export const RULES = {
  lookbackMs: 14 * D, //        what the job reads from the log
  activeMs: 48 * H, //          a problem is "current" only if its newest message is this fresh; also the quiet time that resolves it
  repeatCount: 3, //            R1: the same problem 3 times within repeatWindowMs ...
  repeatWindowMs: 24 * H, //    ... (a single blip never opens an issue)
  workflowRepeatCount: 2, //    R1w: a workflow failed twice in 24 h (its Slack line already comes only on the 3rd failure in a row for the
  //                              frequent jobs, so such a line counts as workflowStreakWeight)
  workflowStreakWeight: 3,
  persistMs: 3 * H, //          R3: an error/critical still repeated 3 h after it first appeared, with no recovery between ...
  chainGapMs: 12 * H, //        ... where "still repeated" means no gap over 12 h between messages (reminders come every 6 h; two failures
  //                              of a workflow two days apart are two blips, not one problem)
  pauseRepeatCount: 2, //       R5: a "paused" state re-announced twice in 24 h (it was "paused" every 6 h for 4 days)
  flapEpisodes: 3, //           R4: 3 separate outages (each recovered) within flapWindowMs: flaky, not a blip
  flapWindowMs: 7 * D,
  flapResolveMs: 7 * D, //      a "keeps going down" issue closes only after this long without a new outage (recovery alone would flap it)
  recurQuietMs: 24 * H, //      a new message after this much quiet on an open issue gets a comment
  silenceFactor: 2, //          SILENCE: only a (source, kind) named in HEARTBEATS, after 2x its expected gap ...
  silenceMinDays: 5, //         ... and only once the log holds messages of that pair on at least 5 different days
  runsLookbackMs: 48 * H, //    failed workflow runs read from GitHub (scripts/ops-triage.mjs); nothing about runs is stored
  frequentMaxGapMs: 6 * H, //   a workflow whose recent runs are at most this far apart (median) is a "frequent" job, else a "daily" one
  frequentFailCount: 3, //      frequent job: this many failed runs within frequentFailWindowMs (no success between) ...
  frequentFailWindowMs: 2 * H,
  frequentStreakMs: H, //       ... or a streak of at least 2 failures with no success for this long
  dailyStreak: 2, //            daily (or unknown-cadence) job: this many failed runs in a row
  retentionDays: 180,
  maxOpenPerPass: 5, //         at most this many issues opened/reopened in one pass; the rest wait (not saved) for the next pass
};

/**
 * The ONLY (source, kind) pairs that may be reported as silent: truly scheduled messages that go out every day whether or not anything
 * happened. Value = the expected gap. Everything else (rain-driven street-water and shadow notes, held / dropped / budget lines, feedback
 * and reply reports, one-off digests ...) is event-driven: not speaking is normal, and good news after a fix, so it can never be "quiet".
 * Add a pair here only after checking in the code that the job sends it on every run (feedback-digest.mjs, learn-all.mjs, push-notify.mjs).
 */
export const HEARTBEATS = {
  "push-notify\u0000digest": 24 * H, //     "Push alerts: N subscribers ..." daily after the 06:10 Colombo run
  "learn-all\u0000digest": 24 * H, //       "What we learned: ..." daily at 00:20 Colombo
  "feedback-digest\u0000digest": 24 * H, // "Forecast feedback, <date>: N answers ..." daily
};

// Families that are never a problem: digests, summaries, dry-run samples, held-by-limit notes, street-water / shadow notes, visitor
// feedback and reply reports (events, not faults), the loop's own messages.
const INFO_KINDS = new Set([
  "digest", "info", "test", "dry-run", "held", "held-dropped", "config", "street-water", "street-water-clear", "shadow",
  "urgent-feedback", "ops-loop", "report", "correction", "emergency", "repost-skipped", "repost-declined", "repost-posted",
  "post-sent", "post-deleted",
]);
const PROBLEM_REPLY = /^(reply-failed|emergency-reply-failed)$/;

export const isRecovery = (n) => /recover/i.test(n.kind) || /^(✅|:white_check_mark:)\s*Recovered/i.test(n.text ?? "");
export function isInformational(n) {
  if (n.source === "ops-triage") return true;
  if (isRecovery(n)) return false;
  if (PROBLEM_REPLY.test(n.kind)) return false;
  if (/^reply-/.test(n.kind)) return true; // reply-<outcome> decisions
  return n.severity === "info" || INFO_KINDS.has(n.kind);
}
export const isProblem = (n) => !isInformational(n) && !isRecovery(n);
const isError = (n) => n.severity === "error" || n.severity === "critical";
const isPause = (n) => n.kind === "paused" || /\bpaused until\b|\bposting is paused\b/i.test(n.text ?? "");
const isStreak = (n) => /\b\d+ runs in a row\b/i.test(n.text ?? "");

// ---- time helpers (Sri Lanka calendar) -------------------------------------------------------------------------------

export const dayNum = (ts) => Math.floor((ts + SLT) / D);
export const colomboDay = (ts) => new Date(ts + SLT).toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (ts) => { const d = new Date(ts + SLT); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
export const clockTime = (ts) => { const d = new Date(ts + SLT); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
export const slTime = (ts) => `${shortDate(ts)} ${new Date(ts + SLT).getUTCFullYear()}, ${clockTime(ts)}`;

// ---- sanitiser: everything that goes into a PUBLIC GitHub issue passes through here ----------------------------------

/**
 * Makes a notification text safe for a public issue: no secrets, URLs (a bare link can carry a token or a visitor's query),
 * emails, @handles, quoted lines or quoted spans (other people's words, post text), nothing after "They wrote:", no emoji codes.
 * Free-form personal names cannot be detected, which is why only the system's own problem messages are ever sampled and
 * why quoted/visitor text is cut out by shape first.
 */
export function sanitise(text, max = 320) {
  let t = scrub(String(text ?? ""), {});
  t = t.split("\n").filter((l) => !/^\s*>/.test(l)).join("\n"); // quoted lines
  t = t.replace(/\b(?:they wrote|wrote|said|says)\s*:[\s\S]*$/i, ""); // a visitor's own words follow
  t = t.replace(/<@[A-Z0-9]+(?:\|[^>]*)?>/g, " ").replace(/<[^>\n]*\|[^>\n]*>/g, " [link] ").replace(/<https?:[^>\n]*>/g, " [link] ");
  t = t.replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link]");
  t = t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]");
  t = t.replace(/(^|[^\w])@[\w.]+/g, "$1[handle]");
  t = t.replace(/"[^"\n]{1,300}"|“[^”\n]{1,300}”|‘[^’\n]{1,200}’/g, "[quote]");
  t = t.replace(/(?<![\w/]):[a-z0-9_+-]+:(?!\w)/gi, " ").replace(/\p{Extended_Pictographic}️?/gu, " ");
  t = t.replace(/(?<!\d)\+?\d[\d\s().-]{8,}\d(?!\d)/g, (m) => (/^\d{4}-\d{2}-\d{2}/.test(m) || m.replace(/\D/g, "").length < 9 ? m : "[number]"));
  t = t.replace(/[*_`~<>]/g, "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}
const RUN_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/;
export const safeRunUrl = (u) => (typeof u === "string" && RUN_URL.test(u) ? u : null);

// ---- naming ------------------------------------------------------------------------------------------------------------

const LABELS = {
  "x-post": "X posting", "x-replies": "X replies", "x-reposts": "X reposts", "x-series": "X series posts", "ig-post": "Instagram posting",
  "health-alert": "Data health monitor", "push-notify": "Push alerts", "feedback-digest": "Feedback digest", "feedback-learn": "Feedback learning",
  "learn-all": "Nightly learning", "street-rain-log": "Street-rain log", "ground-rain-shadow": "Ground-rain shadow log", "feedback-route": "Feedback form",
};
const FILES = {
  "x-post": ["scripts/x-post.mjs", ".github/workflows/x-post.yml"], "x-replies": ["scripts/x-replies.mjs", ".github/workflows/x-replies.yml"],
  "x-reposts": ["scripts/x-reposts.mjs", ".github/workflows/x-reposts.yml"], "x-series": ["scripts/x-series.mjs"], "ig-post": ["scripts/ig-post.mjs", ".github/workflows/ig-post.yml"],
  "health-alert": ["scripts/health-alert.mjs", "lib/health.ts", ".github/workflows/health-check.yml"], "push-notify": ["scripts/push-notify.mjs", ".github/workflows/push-notify.yml"],
  "feedback-digest": ["scripts/feedback-digest.mjs"], "feedback-learn": ["scripts/feedback-learn.mjs", ".github/workflows/feedback-learn.yml"],
  "learn-all": ["scripts/learn-all.mjs", ".github/workflows/learn-all.yml"], "street-rain-log": ["scripts/street-rain-log.mjs", ".github/workflows/gsmap-snapshot.yml"],
  "ground-rain-shadow": ["scripts/ground-rain-shadow.mjs"], "feedback-route": ["app/api/feedback/route.ts"],
};
export const sourceLabel = (source) => (source.startsWith("workflow:") ? `Workflow: ${sanitise(source.slice(9), 60)}` : LABELS[source] ?? sanitise(source, 40));

/** The files most likely to hold the cause. `workflowFiles` maps a workflow name to its file (the job reads it from .github/workflows). */
export function likelyFiles(source, workflowFiles = {}) {
  if (source.startsWith("workflow:")) {
    const name = source.slice(9);
    return workflowFiles[name] ? [workflowFiles[name]] : [`.github/workflows/ (the workflow named "${sanitise(name, 60)}")`];
  }
  return FILES[source] ?? [`scripts/ (source "${sanitise(source, 40)}")`];
}

/** "HMIS" out of "Data source down: HMIS (Irrigation Department ...) — fetch failed. Since ...". */
function dataSourceName(text) {
  const m = /(?:Data source down|Still down|Recovered):\s*(.+?)(?:\s+[—–-]\s+|\s+\(down\b|$)/.exec(String(text ?? "").split("\n")[0]);
  return m ? sanitise(m[1].replace(/\s*\([^)]*\)\s*$/, ""), 60) : null;
}
function dataSourceReason(text) {
  const m = /(?:Data source down|Still down):\s*.+?\s+[—–]\s+(.+?)(?:\.\s+(?:Since|Down for)\b|\.?\s+Users see\b|$)/.exec(String(text ?? "").split("\n")[0]);
  return m ? sanitise(m[1], 110) : null;
}
const PHRASES = [
  [/longer than 280|over 280|280 characters/i, "X rejects posts over 280 characters"],
  [/not permitted to perform/i, "X says the account is not permitted to post (HTTP 403)"],
  [/duplicate/i, "X rejects the post as a duplicate"],
  [/rate limit|too many requests|\b429\b/i, "the rate limit is hit"],
  [/timeout|timed out|aborted/i, "the request times out"],
];
/** Why it fails, in a few words, from the latest message of the family. */
export function reasonPhrase(text) {
  const t = String(text ?? "");
  for (const [re, p] of PHRASES) if (re.test(t)) return p;
  const m = /\b(?:failed|error)\b[^(]*\(([^)]{3,160})\)/i.exec(t.split("\n")[0]);
  return m ? sanitise(m[1], 100) : null;
}

// ---- the rules ---------------------------------------------------------------------------------------------------------

const bucketOf = (n) => [3, 5, 10, 25, 50, 100, 250, 500, 1000].filter((b) => n >= b).length; // title is refreshed when this changes
const parseNote = (s) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };

/** Sliding 24 h window: the largest weighted count of rows inside any `windowMs`, and where that window ends. */
function maxWindow(rows, windowMs, weight = () => 1) {
  let best = 0, end = 0, lo = 0, sum = 0;
  for (let i = 0; i < rows.length; i++) {
    sum += weight(rows[i]);
    while (rows[i].ts - rows[lo].ts > windowMs) sum -= weight(rows[lo++]);
    if (sum > best) { best = sum; end = rows[i].ts; }
  }
  return { best, end };
}

/** Episodes: runs of problem rows between recovery messages. Returns [{start, rows}] in time order. */
function episodes(events) {
  const out = [];
  let cur = null;
  for (const e of events) {
    if (isRecovery(e)) cur = null;
    else {
      if (!cur) out.push((cur = { start: e.ts, rows: [] }));
      cur.rows.push(e);
    }
  }
  return out;
}

/**
 * Failed-run rule for a workflow whose runs the job read from GitHub (cadence "frequent" | "daily"). `streak` = the failures since the
 * last success (a success is a recovery row, so a later successful run closes the issue). Frequent job (runs at most 6 h apart): 3 failed runs
 * within 2 h, or at least 2 failures with no success for 1 h. Daily job (or cadence unknown): 2 failed runs in a row.
 */
function workflowRunReason(streak, cadence, rules) {
  if (streak.length < 2) return null;
  const span = streak[streak.length - 1].ts - streak[0].ts;
  if (cadence === "frequent") {
    const w = maxWindow(streak, rules.frequentFailWindowMs);
    if (w.best >= rules.frequentFailCount) return { code: "run-burst", text: `the job runs often and ${w.best} runs failed within 2 h with no success between` };
    if (span >= rules.frequentStreakMs) return { code: "run-streak", text: `the job runs often and has had no successful run for ${Math.max(1, Math.floor(span / H))} h or more (${streak.length} failed runs in a row)` };
    return null;
  }
  if (streak.length >= rules.dailyStreak) return { code: "run-daily", text: `the job runs about daily or less and its last ${streak.length} runs failed in a row` };
  return null;
}

/** Why this problem deserves an issue now ({code, text}) or null. `events` = this problem's problem + recovery rows, oldest first. */
function openReason(events, now, rules, cadence) {
  const probs = events.filter(isProblem);
  if (!probs.length) return null;
  const last = events[events.length - 1];
  if (isRecovery(last) || now - last.ts > rules.activeMs) return null; // recovered, or not happening any more
  const isWorkflow = probs[0].source.startsWith("workflow:");
  const eps = episodes(events);
  const cur = eps[eps.length - 1];
  if (isWorkflow && cadence) return workflowRunReason(cur.rows, cadence, rules); // runs known from GitHub: this rule alone decides
  // R5: a "paused" state that keeps being re-announced
  const pauses = probs.filter(isPause);
  if (pauses.length >= rules.pauseRepeatCount && maxWindow(pauses, rules.repeatWindowMs).best >= rules.pauseRepeatCount && now - pauses[pauses.length - 1].ts <= rules.activeMs)
    return { code: "pause-repeats", text: `a pause was announced ${maxWindow(pauses, rules.repeatWindowMs).best} times within 24 h` };
  // R3: error/critical still repeated 3 h after it first appeared, no recovery between
  let chainStart = cur.rows.length - 1;
  while (chainStart > 0 && cur.rows[chainStart].ts - cur.rows[chainStart - 1].ts <= rules.chainGapMs) chainStart--;
  const chain = cur.rows.slice(chainStart);
  if (isError(chain[0]) && chain[chain.length - 1].ts - chain[0].ts >= rules.persistMs)
    return { code: "persists", text: "an error still being repeated 3 h or more after it first appeared, with no recovery message" };
  // R1w: a workflow failed twice in 24 h
  if (isWorkflow) {
    const w = maxWindow(probs, rules.repeatWindowMs, (r) => (isStreak(r) ? rules.workflowStreakWeight : 1));
    if (w.best >= rules.workflowRepeatCount && now - w.end <= rules.activeMs) return { code: "workflow-twice", text: "the workflow failed at least twice within 24 h" };
  }
  // R1: the same problem 3 times within 24 h
  const r1 = maxWindow(probs, rules.repeatWindowMs);
  if (r1.best >= rules.repeatCount && now - r1.end <= rules.activeMs) return { code: "repeat24h", text: `the same message ${r1.best} times within 24 h` };
  // R2: on two consecutive Sri Lanka days (the later one is today or yesterday)
  const days = new Set(probs.map((r) => dayNum(r.ts)));
  const today = dayNum(now);
  for (const d of days) if (days.has(d + 1) && d + 1 >= today - 1) return { code: "two-days", text: "the same message on two consecutive days" };
  // R4: flaky: several separate outages in a week
  const recent = eps.filter((e) => now - e.start <= rules.flapWindowMs);
  if (events.some(isRecovery) && recent.length >= rules.flapEpisodes && isError(probs[0])) return { code: "flapping", text: `${recent.length} separate outages within 7 days` };
  return null;
}

/** Counters and a sanitised sample for one problem. */
export function summarise(key, probs, now, workflowFiles = {}) {
  const first = probs[0];
  const lastRow = probs[probs.length - 1];
  const sev = probs.some((r) => r.severity === "critical") ? "critical" : probs.some((r) => r.severity === "error") ? "error" : "warn";
  return {
    key, source: first.source, kind: lastRow.kind, severity: sev, count: probs.length, firstTs: first.ts, lastTs: lastRow.ts,
    last24h: probs.filter((r) => now - r.ts <= D).length, sample: sanitise(lastRow.text.split("\n").filter((l) => !/^\s*>/.test(l)).slice(0, 2).join(" ")),
    name: dataSourceName(lastRow.text), reason: dataSourceReason(lastRow.text) ?? reasonPhrase(lastRow.text),
    paused: probs.some(isPause), runs: [...new Set(probs.map((r) => safeRunUrl(r.run_url)).filter(Boolean))].slice(-5), files: likelyFiles(first.source, workflowFiles),
  };
}

/** A plain, specific title built from the family, never from one message. */
export function titleFor(s, reasonCode = "", episodesN = 0) {
  const since = shortDate(s.firstTs);
  const label = sourceLabel(s.source);
  if (s.kind === "silence") return `${label} has gone quiet: it normally reports every day, nothing for ${s.silentDays} day${s.silentDays === 1 ? "" : "s"}`;
  if (s.source.startsWith("workflow:")) return `${label} keeps failing (${s.count} failure${s.count === 1 ? "" : "s"} since ${since})`;
  if (/^data-source/.test(s.kind) && s.name) {
    if (reasonCode === "flapping") return `${s.name} keeps going down (${episodesN} outages since ${since})`;
    return `${s.name} is down or stale${s.reason ? `: ${s.reason}` : ""} (${s.count} alert${s.count === 1 ? "" : "s"} since ${since})`;
  }
  if (s.paused || /post-failed|paused/.test(s.kind)) return `${label} keeps ${s.paused ? "pausing" : "failing"}${s.reason ? `: ${s.reason}` : ""} (${s.count} times since ${since})`;
  return `${label}: "${s.kind}" problem keeps repeating${s.reason ? ` (${s.reason})` : ""} (${s.count} times since ${since})`;
}

export function renderBody(s, reason, key, related = null) {
  const lines = [
    `<!-- ops-loop:${key} -->`,
    `**What it is.** ${s.kind === "silence" ? `${sourceLabel(s.source)} normally sends a "${s.silentKind}" message about every ${Math.round(s.usualGapMs / H)} h and has said nothing for ${s.silentDays} days.` : `${sourceLabel(s.source)} keeps reporting the same problem to Slack (kind: \`${s.kind}\`, severity: ${s.severity}).`}`,
    "",
    `**Why it was raised.** ${reason.text}.`,
    "",
    `**Since.** ${slTime(s.firstTs)} (Sri Lanka time). **Last seen** ${slTime(s.lastTs)}.`,
    "",
    `**How often.** ${s.count} message${s.count === 1 ? "" : "s"} in the log, ${s.last24h} in the last 24 h.`,
    "",
    ...(related
      ? [`**Diagnosis.** The live status issue #${Number(related.number)} already tracks this data source (cause, impact, timeline); it is not repeated here.`, ""]
      : ["**Latest message (sanitised: no links, names, handles or quoted text).**", `> ${s.sample || "(none)"}`, ""]),
  ];
  if (s.runs?.length) lines.push("**Recent runs.** " + s.runs.map((u) => `[${u.split("/").pop()}](${u})`).join(", "), "");
  lines.push(`**Likely source.** ${s.files.map((f) => `\`${f}\``).join(", ")}`, "",
    "**Checklist**", "", "- [ ] diagnosis", "- [ ] fix", "- [ ] verified (the problem has not come back for 48 h)", "",
    "_Raised by the ops loop (`scripts/ops-triage.mjs`, DOCS.md \"Ops loop\") from the in-house notification log. It closes itself when a recovery message arrives or the problem is quiet for 48 h. Add the label `ops-ignore` to stop it for good._");
  return lines.join("\n");
}
export const renderRecurrence = (s) => `Back after a quiet spell: ${slTime(s.lastTs)} (Sri Lanka time). ${s.count} messages in total so far, ${s.last24h} in the last 24 h.\n\n> ${s.sample || "(none)"}`;
export const renderResolved = (why, now) => (why === "recovered" ? `Closed by the ops loop (${slTime(now)}): a recovery message for this problem arrived.` : why === "spoke-again" ? `Closed by the ops loop (${slTime(now)}): the source is reporting again.` : `Closed by the ops loop (${slTime(now)}): not seen for the required quiet period. It reopens by itself if it comes back.`);

// ---- silence -----------------------------------------------------------------------------------------------------------

/**
 * Heartbeat pairs (HEARTBEATS only) that have said nothing for twice their expected gap, once the log holds that pair on at least
 * silenceMinDays different Sri Lanka days. Any other (source, kind) can never be reported: not speaking is normal for event-driven messages.
 */
export function findSilence(rows, now, rules = RULES, heartbeats = HEARTBEATS) {
  const by = new Map();
  for (const r of rows) {
    const k = `${r.source}\u0000${r.kind}`;
    if (!(k in heartbeats) || isRecovery(r)) continue;
    (by.get(k) ?? by.set(k, []).get(k)).push(r.ts);
  }
  const out = [];
  for (const [k, tsList] of by) {
    tsList.sort((a, b) => a - b);
    if (new Set(tsList.map(dayNum)).size < rules.silenceMinDays) continue;
    const expected = heartbeats[k];
    const last = tsList[tsList.length - 1];
    if (now - last <= rules.silenceFactor * expected) continue;
    const [source, kind] = k.split("\u0000");
    out.push({ key: `silence:${source}:${kind}`, source, kind, lastTs: last, usualGapMs: expected, silentDays: Math.floor((now - last) / D), firstTs: now });
  }
  return out;
}

// ---- failed workflow runs (read from GitHub by scripts/ops-triage.mjs) ------------------------------------------------

const RUN_ID = /\/actions\/runs\/(\d+)/;
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };

/**
 * Turns the workflow runs GitHub reports into synthetic notifications, so the same rules and the same issue handle them.
 * @param {{runs: {id:number,name:string,conclusion:string,ts:number,startTs?:number,url?:string}[], notifications: any[], now: number, rules?: typeof RULES}} p
 *   runs: completed runs of the workflows that had a failure (failures AND successes; ts = completion time). Nothing here is stored.
 * @returns {{rows: any[], cadence: Record<string,"frequent"|"daily">}}
 *   rows: source `workflow:<name>`, kind `run-failed` (severity error), run_url; a failed run already logged by the workflow's own
 *   "Tell Slack the workflow failed" step (a `workflow-failed` row whose run_url holds the same run id) is skipped, so one run counts once.
 *   A later successful run is a `run-recovered` row. cadence: "frequent" when the median gap between the workflow's recent run starts is at most 6 h.
 */
export function workflowRunRows({ runs, notifications = [], now, rules = RULES }) {
  const logged = new Set();
  for (const n of notifications) if (n.source?.startsWith("workflow:") && n.kind === "workflow-failed") { const m = RUN_ID.exec(n.run_url ?? ""); if (m) logged.add(`${n.source}#${m[1]}`); }
  const byName = new Map();
  for (const r of runs) (byName.get(r.name) ?? byName.set(r.name, []).get(r.name)).push(r);
  const rows = [], cadence = {};
  let id = -1;
  for (const [name, list] of byName) {
    const source = `workflow:${name}`;
    const failed = list.filter((r) => /^(failure|timed_out)$/.test(r.conclusion) && r.ts <= now && now - r.ts <= rules.runsLookbackMs);
    if (!failed.length) continue;
    const starts = list.map((r) => r.startTs ?? r.ts).sort((a, b) => a - b);
    cadence[name] = list.length >= 3 && median(starts.slice(1).map((t, i) => t - starts[i])) <= rules.frequentMaxGapMs ? "frequent" : "daily";
    const fp = fingerprint("", source, "workflow-failed", source);
    const first = Math.min(...failed.map((r) => r.ts));
    for (const r of failed) {
      if (logged.has(`${source}#${r.id}`)) continue;
      rows.push({ id: id--, ts: r.ts, source, kind: "run-failed", severity: "error", text: `Workflow failed: ${name}`, fingerprint: fp, run_url: safeRunUrl(r.url) ?? null, slack_ok: null });
    }
    for (const r of list) if (r.conclusion === "success" && r.ts > first && r.ts <= now) rows.push({ id: id--, ts: r.ts, source, kind: "run-recovered", severity: "info", text: `Recovered: ${name}`, fingerprint: fp, run_url: null, slack_ok: null });
  }
  return { rows, cadence };
}

// ---- triage ------------------------------------------------------------------------------------------------------------

/**
 * @param {{notifications: any[], issues?: Record<string, any>, now: number, rules?: typeof RULES, workflowFiles?: Record<string,string>, workflowCadence?: Record<string,string>, related?: {number:number,title:string}[]}} p
 *   issues: ops_issues rows by fingerprint ({status, github_issue, first_ts, last_ts, count, opened_ts, resolved_ts, note, title ...})
 * @returns {{actions: any[], issues: Record<string, any>, silence: any[], deferred: number, deferredKeys: string[]}}
 *   actions: {type: "open"|"reopen"|"update"|"comment"|"resolve", key, ...}; `issues` is the NEXT state (feed it back in: a second run
 *   with no new messages returns no actions).
 */
export function triage({ notifications, issues = {}, now, rules = RULES, workflowFiles = {}, workflowCadence = {}, related = [] }) {
  // A workflow with run data from GitHub: its logged "workflow-failed" rows older than the run window have no recovery rows to
  // end their episode (successes are only read inside the window), so they would merge with a new failure into a false streak.
  const staleLogged = (r) => r.kind === "workflow-failed" && r.source?.startsWith("workflow:") && r.source.slice(9) in workflowCadence && r.ts < now - rules.runsLookbackMs;
  const rows = notifications.filter((r) => r.ts >= now - rules.lookbackMs && r.ts <= now && !staleLogged(r)).sort((a, b) => a.ts - b.ts || (a.id ?? 0) - (b.id ?? 0));
  const next = {};
  for (const [k, v] of Object.entries(issues)) next[k] = { ...v };
  const actions = [];
  const groups = new Map();
  for (const r of rows) {
    if (r.source === "ops-triage" || isInformational(r)) continue;
    (groups.get(r.fingerprint) ?? groups.set(r.fingerprint, []).get(r.fingerprint)).push(r);
  }

  const reasonCadence = (prior, ev) => { const src = prior?.source ?? ev[0]?.source ?? ""; return src.startsWith("workflow:") ? workflowCadence[src.slice(9)] : undefined; };
  const handle = (key, events, mk) => {
    const prior = next[key];
    if (prior?.status === "ignored") return;
    const probs = events.filter(isProblem);
    const lastEv = events[events.length - 1];
    if (prior?.status === "open") {
      const note = parseNote(prior.note);
      const lastProb = probs.length ? probs[probs.length - 1].ts : prior.last_ts;
      const recovered = lastEv && isRecovery(lastEv) && lastEv.ts > lastProb;
      const quietFor = now - Math.max(lastProb, prior.last_ts ?? 0);
      if (recovered && note.reason !== "flapping") return void resolve(key, "recovered", lastEv.ts, prior);
      if (quietFor >= (note.reason === "flapping" ? rules.flapResolveMs : rules.activeMs)) return void resolve(key, "quiet", now, prior);
      const fresh = probs.filter((r) => r.ts > (prior.last_ts ?? 0));
      if (fresh.length) {
        const s = mk(probs);
        const gap = fresh[0].ts - (prior.last_ts ?? fresh[0].ts);
        const count = (prior.count ?? 0) + fresh.length;
        const tb = bucketOf(count);
        const retitle = tb !== (note.tb ?? 0);
        next[key] = { ...prior, last_ts: fresh[fresh.length - 1].ts, count, severity: s.severity, note: JSON.stringify({ ...note, tb }) };
        actions.push({ type: gap >= rules.recurQuietMs ? "comment" : "update", key, issue: next[key], github_issue: prior.github_issue, summary: { ...s, count, firstTs: prior.first_ts }, retitle: retitle ? titleFor({ ...s, count, firstTs: prior.first_ts }, note.reason, episodes(events).length) : null });
      }
      return;
    }
    // no issue yet, or resolved: only fresh evidence counts after a resolve
    const floor = prior?.status === "resolved" ? prior.resolved_ts ?? 0 : 0;
    const ev = events.filter((e) => e.ts > floor);
    const reason = openReason(ev, now, rules, reasonCadence(prior, ev));
    if (!reason) return;
    // runs known from GitHub: the counters and "since" are those of the CURRENT failing streak (a success ends an episode)
    const pr = (() => { const own = reasonCadence(prior, ev); return own ? episodes(ev).at(-1).rows : ev.filter(isProblem); })();
    const s = mk(pr);
    const title = titleFor(s, reason.code, episodes(ev).length);
    const row = { fingerprint: key, title, source: s.source, kind: s.kind, severity: s.severity, first_ts: s.firstTs, last_ts: s.lastTs, count: s.count, status: "open", github_issue: prior?.github_issue ?? null, opened_ts: now, resolved_ts: null, note: JSON.stringify({ reason: reason.code, tb: bucketOf(s.count) }) };
    next[key] = row;
    actions.push({ type: prior?.github_issue ? "reopen" : "open", key, issue: row, title, reason, summary: s, github_issue: prior?.github_issue ?? null, related: s.name ? related.find((r) => r.title.toLowerCase().includes(s.name.toLowerCase())) ?? null : null });
  };
  function resolve(key, why, at, prior) {
    next[key] = { ...prior, status: "resolved", resolved_ts: at };
    actions.push({ type: "resolve", key, why, issue: next[key], github_issue: prior.github_issue });
  }

  for (const [key] of groups) {
    const events = rows.filter((r) => r.fingerprint === key && r.source !== "ops-triage" && (isProblem(r) || isRecovery(r)));
    handle(key, events, (p) => summarise(key, p, now, workflowFiles));
  }
  // open issues with no rows at all in the window: quiet
  for (const [key, iss] of Object.entries(next)) {
    if (iss.status === "open" && !key.startsWith("silence:") && !groups.has(key) && now - (iss.last_ts ?? 0) >= rules.activeMs) {
      if (!actions.some((a) => a.key === key)) resolve(key, "quiet", now, iss);
    }
  }

  // SILENCE
  const silence = findSilence(rows, now, rules);
  const silentKeys = new Set(silence.map((s) => s.key));
  for (const s of silence) {
    const prior = next[s.key];
    if (prior?.status === "ignored" || prior?.status === "open") continue;
    const sum = { ...s, count: 1, firstTs: s.lastTs, lastTs: s.lastTs, last24h: 0, severity: "warn", kind: "silence", silentKind: s.kind, sample: `Last "${s.kind}" message: ${slTime(s.lastTs)} (Sri Lanka time).`, runs: [], files: likelyFiles(s.source, workflowFiles) };
    const reason = { code: "silence", text: `${sourceLabel(s.source)} normally reports about every ${Math.round(s.usualGapMs / H)} h (${rules.silenceMinDays}+ days of history) and has been silent for more than ${rules.silenceFactor}x that` };
    const title = titleFor(sum);
    const row = { fingerprint: s.key, title, source: s.source, kind: "silence", severity: "warn", first_ts: s.lastTs, last_ts: s.lastTs, count: 1, status: "open", github_issue: prior?.github_issue ?? null, opened_ts: now, resolved_ts: null, note: JSON.stringify({ reason: "silence", tb: 0, silentKind: s.kind }) };
    next[s.key] = row;
    actions.push({ type: prior?.github_issue ? "reopen" : "open", key: s.key, issue: row, title, reason, summary: sum, github_issue: prior?.github_issue ?? null });
  }
  for (const [key, iss] of Object.entries(next)) {
    if (!key.startsWith("silence:") || iss.status !== "open" || silentKeys.has(key)) continue;
    const kind = parseNote(iss.note).silentKind;
    const spoke = rows.some((r) => r.source === iss.source && r.kind === kind && r.ts > (iss.last_ts ?? 0));
    if (spoke) resolve(key, "spoke-again", now, iss);
  }
  // CAP: a mass event (a GitHub / D1 outage failing 15 workflows) must not open 15 issues and 15 Slack lines at once. Opens and reopens are
  // ordered by severity, then count, then last seen; only the first maxOpenPerPass go through. The deferred ones are rolled back in `next`
  // (and so never saved), which makes the next pass pick them up again; the 3 h gate between passes sets the pace.
  const SEV = { critical: 3, error: 2, warn: 1, info: 0 };
  const isOpen = (a) => a.type === "open" || a.type === "reopen";
  const opens = actions.filter(isOpen).sort((a, b) => (SEV[b.issue.severity] ?? 0) - (SEV[a.issue.severity] ?? 0) || (b.issue.count ?? 0) - (a.issue.count ?? 0) || (b.issue.last_ts ?? 0) - (a.issue.last_ts ?? 0) || (a.key < b.key ? -1 : 1));
  const kept = opens.slice(0, rules.maxOpenPerPass ?? opens.length);
  const deferred = opens.slice(kept.length);
  for (const a of deferred) { if (issues[a.key]) next[a.key] = { ...issues[a.key] }; else delete next[a.key]; }
  const ordered = [...actions.filter((a) => !isOpen(a)), ...kept];
  return { actions: ordered, issues: next, silence, deferred: deferred.length, deferredKeys: deferred.map((a) => a.key) };
}

/** The once-a-day Slack summary (sent through notify with source ops-triage, kind ops-loop; never re-triaged). "" when there is nothing to say. */
export function dailySummary(issues, now, { repoUrl = "", silence = [] } = {}) {
  const all = Object.values(issues).filter((i) => i.fingerprint && !i.fingerprint.startsWith("_"));
  const open = all.filter((i) => i.status === "open");
  const opened = all.filter((i) => i.opened_ts && now - i.opened_ts <= D).length;
  const resolved = all.filter((i) => i.resolved_ts && now - i.resolved_ts <= D).length;
  if (!open.length && !opened && !resolved && !silence.length) return ""; // nothing to say: no daily "0 open problems" line
  const list = open.slice(0, 5).map((i) => `#${i.github_issue ?? "?"} ${sanitise(i.title, 90)}`).join("; ");
  return `Ops loop, ${colomboDay(now)}: ${open.length} open problem${open.length === 1 ? "" : "s"}${list ? ` (${list}${open.length > 5 ? "; ..." : ""})` : ""}. Opened ${opened}, resolved ${resolved} in the last 24 h.${silence.length ? ` Quiet sources: ${silence.map((s) => `${s.source}/${s.kind}`).join(", ")}.` : ""}${open.length && repoUrl ? ` ${repoUrl}/issues?q=is%3Aopen+label%3Aops-loop` : ""}`;
}
