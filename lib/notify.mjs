// The one way a job tells Slack something. Every message is posted exactly as before AND written as one row to the
// in-house log (Cloudflare D1 table `notifications`), so a triage job (scripts/ops-triage.mjs) can read the whole stream,
// group repeats by `fingerprint` and raise ONE tracked GitHub issue per recurring problem. Slack alone is a stream nobody
// triages: on 7-11 Nov 2026 "X post failed ... paused" went to Slack every 6 h for four days and "Data source down: HMIS"
// for 37 h, and nobody acted.
//
// Plain dependency-free ESM (bare `node` can import it). Rules (DOCS.md "Cloudflare D1 write rules"):
//  - Slack first, exactly as the caller did before (same JSON body, same webhook, same timeout, errors swallowed).
//  - The log write is ONE small INSERT over the D1 HTTP /query endpoint, never wrangler, never an import. The table is
//    created on first use only when the INSERT says "no such table" (so the normal path is a single statement).
//  - The log write is time-boxed (LOG_TIMEOUT_MS, one AbortSignal for the id lookup and the insert together), fails soft
//    (a console warning, never an exception), and is skipped without CLOUDFLARE_API_TOKEN (said once per process).
//  - Not retried: a retry of a write that timed out could land twice; a lost log row is cheaper than a duplicate.
//  - The text stored is the text sent, scrubbed of anything that looks like a secret and cut to 4,000 characters.
import { createHash } from "node:crypto";

export const LOG_TIMEOUT_MS = 5_000;
export const MAX_TEXT = 4_000;
const DB_NAME = "sl-water-levels";
const DEFAULT_ACCOUNT = "83e812aa5ee674fe01ce3a9eb1e04cbe"; // an identifier, not a secret (same as lib/d1Sql.mjs)

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, severity TEXT NOT NULL, text TEXT NOT NULL, fingerprint TEXT NOT NULL, run_url TEXT, slack_ok INTEGER, meta TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_ts ON notifications (ts)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_fp_ts ON notifications (fingerprint, ts)`,
  `CREATE TABLE IF NOT EXISTS ops_issues (fingerprint TEXT PRIMARY KEY, title TEXT, source TEXT, kind TEXT, severity TEXT, first_ts INTEGER, last_ts INTEGER, count INTEGER, status TEXT, github_issue INTEGER, opened_ts INTEGER, resolved_ts INTEGER, note TEXT)`,
];
const INSERT = "INSERT INTO notifications (ts, source, kind, severity, text, fingerprint, run_url, slack_ok, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";

// ---- scrubber --------------------------------------------------------------------------------------------------------

const SECRET_PATTERNS = [
  /https?:\/\/hooks\.slack\.com\/\S+/gi, // Slack incoming webhooks are secrets
  /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g, // OpenAI-style keys
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b(?:authorization|api[_-]?key|api[_-]?secret|access[_-]?token|access[_-]?secret|secret|token|password|passwd)\b\s*[:=]\s*["']?[^\s"',;]{6,}/gi,
  /\b[0-9a-fA-F]{32,}\b/g, // long hex (hashes, keys)
];
// a long mixed-case + digit run with no punctuation is a key, not a word (slugs have hyphens and are lower case)
const LONG_KEY = /\b(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}\b/g;

/** Removes anything that looks like a token, webhook URL or key. Exact secret values found in `env` are removed first. */
export function scrub(text, env = process.env) {
  let t = String(text ?? "");
  for (const k of ["SLACK_WEBHOOK_URL", "SLACK_X_WEBHOOK_URL", "CLOUDFLARE_API_TOKEN", "GITHUB_TOKEN", "GH_TOKEN", "OPENAI_API_KEY", "X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET", "IG_ACCESS_TOKEN", "FB_PAGE_TOKEN", "FLOOD_PHOTO_SECRET"]) {
    const v = env?.[k];
    if (v && String(v).length >= 8) t = t.split(String(v)).join("[secret]");
  }
  for (const re of SECRET_PATTERNS) t = t.replace(re, (m) => (/^(authorization|api|access|secret|token|password|passwd)/i.test(m) ? m.replace(/([:=]\s*["']?).*$/s, "$1[secret]") : "[secret]"));
  t = t.replace(LONG_KEY, "[secret]");
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT - 1) + "…" : t;
}

// ---- classifier ------------------------------------------------------------------------------------------------------

const unquoted = (text) => String(text).split("\n").filter((l) => !/^\s*>/.test(l)).join("\n");

/** Infers {kind, severity} from the words of a message (quoted lines, which are other people's words, are ignored). */
export function classify(text) {
  const t = unquoted(text).toLowerCase();
  let kind = "info";
  if (/dry run|\bsample\b/.test(t)) kind = "dry-run";
  else if (/recovered|all clear|back up\b/.test(t)) kind = "recovered";
  else if (/data source down|still down/.test(t)) kind = "data-source-down";
  else if (/paused/.test(t)) kind = "paused";
  else if (/workflow failed/.test(t)) kind = "workflow-failed";
  else if (/\bfailed\b|\bfailure\b|\berror\b|rejected|refused|not posted|not sent|could not|couldn't|cannot/.test(t)) kind = "failed";
  else if (/held back|\bheld\b/.test(t)) kind = "held";
  else if (/budget|spend|\$\d/.test(t)) kind = "budget";
  else if (/digest|summary|what we learned|learned/.test(t)) kind = "digest";
  else if (/:warning:|⚠/.test(t)) kind = "warning";
  let severity = "info";
  if (kind === "dry-run" || kind === "digest" || kind === "recovered") severity = "info";
  else if (/:rotating_light:|🔴|:x:|\bfailed\b|\berror\b|\bpaused\b|\bdown\b|critical|emergency|could not|couldn't|cannot/.test(t)) severity = "error";
  else if (/:warning:|⚠/.test(t) || kind === "held" || kind === "budget") severity = "warn";
  if (kind === "held" && severity === "error") severity = "warn";
  return { kind, severity };
}

const SEVERITIES = new Set(["info", "warn", "error", "critical"]);

// ---- fingerprint -----------------------------------------------------------------------------------------------------

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december";

/** The message with everything that changes between two occurrences of the SAME problem removed. */
export function normalise(text) {
  let t = unquoted(text);
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/<https?:[^>]*>/g, " "); // Slack <url|label>
  t = t.replace(/https?:\/\/\S+/g, " ");
  t = t.replace(/"[^"\n]{0,300}"/g, " ").replace(/[“”][^“”\n]{0,300}[“”]/g, " "); // quoted names / post text
  t = t.replace(/@[\w.]+/g, " ");
  t = t.replace(/(?<![\w/]):[a-z0-9_+-]+:(?!\w)/gi, " "); // :emoji: codes
  t = t.replace(/\p{Extended_Pictographic}️?/gu, " ");
  t = t.replace(/\b\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?\b/g, " "); // ISO dates and timestamps
  t = t.replace(new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\b\\.?(?:\\s+\\d{4})?`, "gi"), " "); // 11 Nov 2026
  t = t.replace(new RegExp(`\\b(?:${MONTHS})\\b\\.?\\s+\\d{1,2}(?:,?\\s+\\d{4})?`, "gi"), " "); // Nov 11, 2026
  t = t.replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\s?(?:am|pm|utc|z|slt)?\b/gi, " "); // clock times
  t = t.replace(/\b[0-9a-f]{7,}\b/gi, (m) => (/\d/.test(m) ? " " : m)); // hashes, ids
  t = t.replace(/\b[a-z]{0,6}[-_]?\d{4,}\b/gi, " "); // run ids, tweet ids, row ids
  t = t.replace(/[-+]?\d+(?:[.,]\d+)*/g, " "); // every remaining number (readings, counts, HTTP codes, costs)
  t = t.replace(/\b(?:ft|feet|m|mm|cm|cusecs?|mw|km|min|mins|minutes?|h|hrs?|hours?|days?|s|sec|%|usd)\b/gi, " "); // units left behind
  t = t.replace(/[$%()[\]{}*_~`|·—–:;,.!?'"<>=/\\]+/g, " ");
  return t.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Stable id of a PROBLEM. Pure. Same source + kind + the same words (times, dates, numbers, ids, URLs, quoted lines and
 * gauge readings aside) give the same id. When `key` is given it names the problem outright (source + key, kind left
 * out, so "down", "still down" and "recovered" rows of one data source share one id).
 */
export function fingerprint(text, source = "", kind = "", key = "") {
  const basis = key ? `${source}\u0000${key}` : `${source}\u0000${kind}\u0000${normalise(text)}`;
  return createHash("sha1").update(basis).digest("hex").slice(0, 16);
}

// ---- the D1 log ------------------------------------------------------------------------------------------------------

let warnedNoToken = false;
let cachedDbId = "";
/** Tests only. */
export function _reset() {
  warnedNoToken = false;
  cachedDbId = "";
}

const cfBase = (env) => env.CF_API_BASE || process.env.CF_API_BASE || "https://api.cloudflare.com/client/v4";

async function cf(env, path, body, signal) {
  const res = await fetch(`${cfBase(env)}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) {
    const msg = (j.errors ?? []).map((e) => e.message).join("; ").slice(0, 200);
    throw new Error(`D1 HTTP ${res.status}: ${msg}`);
  }
  return j;
}

async function dbPath(env, signal) {
  const account = env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT;
  let id = env.CF_D1_DATABASE_ID || process.env.CF_D1_DATABASE_ID || cachedDbId;
  if (!id) {
    const j = await cf(env, `/accounts/${account}/d1/database?name=${DB_NAME}`, null, signal);
    const hit = (j.result ?? []).find((d) => d.name === DB_NAME);
    if (!hit) throw new Error(`D1 database ${DB_NAME} not found`);
    id = cachedDbId = hit.uuid;
  }
  return `/accounts/${account}/d1/database/${id}/query`;
}

/** Writes one row. Resolves true when stored; never throws. */
export async function writeRow(row, { env = process.env, timeoutMs = LOG_TIMEOUT_MS } = {}) {
  if (!env.CLOUDFLARE_API_TOKEN) {
    if (!warnedNoToken) {
      warnedNoToken = true;
      console.warn("notify: CLOUDFLARE_API_TOKEN is not set; notifications are not logged in D1 (Slack is unaffected).");
    }
    return false;
  }
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const path = await dbPath(env, signal);
    const params = [row.ts, row.source, row.kind, row.severity, row.text, row.fingerprint, row.run_url ?? null, row.slack_ok ?? null, row.meta ?? null];
    try {
      await cf(env, path, { sql: INSERT, params }, signal);
    } catch (e) {
      if (!/no such table/i.test(String(e instanceof Error ? e.message : e))) throw e;
      for (const sql of SCHEMA) await cf(env, path, { sql }, signal);
      await cf(env, path, { sql: INSERT, params }, signal);
    }
    return true;
  } catch (e) {
    console.warn(`notify: could not log the notification (${signal.aborted ? `no answer in ${timeoutMs / 1000} s` : e instanceof Error ? e.message.slice(0, 160) : "error"}); Slack is unaffected.`);
    return false;
  }
}

// ---- notify ----------------------------------------------------------------------------------------------------------

/**
 * @typedef {{ source?: string, kind?: string, severity?: string, meta?: unknown, env?: Record<string, string | undefined>, doFetch?: typeof fetch, now?: number, webhook?: string, blocks?: unknown[], timeoutMs?: number, key?: string, runUrl?: string | null, logTimeoutMs?: number }} NotifyOptions
 */

/**
 * Posts `text` to Slack (same request the callers always sent) and logs it.
 * @param o.source     who is speaking (x-post, health-alert, workflow:<name>, ...)
 * @param o.kind       machine word (post-failed, paused, held, budget, digest, dry-run, ...); inferred when omitted
 * @param o.severity   info | warn | error | critical; inferred when omitted
 * @param o.webhook    overrides env.SLACK_WEBHOOK_URL (the X jobs prefer SLACK_X_WEBHOOK_URL)
 * @param o.blocks     Slack blocks, sent next to `text` (health-alert)
 * @param o.timeoutMs  Slack request timeout (default 20 s, what most senders used)
 * @param o.key        names the problem outright for the fingerprint (see fingerprint())
 * @param o.runUrl     the Actions run URL; defaults to the GITHUB_* variables
 * @param {string} text
 * @param {NotifyOptions} [options]
 * @returns {Promise<{slackOk: boolean, logged: boolean}>}
 */
export async function notify(text, { source = "unknown", kind, severity, meta, env = process.env, doFetch = fetch, now = Date.now(), webhook, blocks, timeoutMs = 20_000, key, runUrl, logTimeoutMs = LOG_TIMEOUT_MS } = {}) {
  const hook = webhook ?? env.SLACK_WEBHOOK_URL;
  let slackOk = null;
  if (hook) {
    try {
      const res = await doFetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(blocks ? { text, blocks } : { text }), signal: AbortSignal.timeout(timeoutMs) });
      slackOk = !!res.ok;
      if (!res.ok) console.warn(`Slack post failed: HTTP ${res.status}`);
    } catch (e) {
      slackOk = false;
      console.warn(`Slack post failed: ${e instanceof Error ? e.name : "error"}`);
    }
  }
  let logged = false;
  try {
    const inferred = classify(text);
    const k = String(kind || inferred.kind).slice(0, 40);
    const sev = SEVERITIES.has(severity) ? severity : inferred.severity;
    const clean = scrub(text, env);
    const run = runUrl ?? (env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL || "https://github.com"}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null);
    logged = await writeRow(
      { ts: now, source: String(source), kind: k, severity: sev, text: clean, fingerprint: fingerprint(text, String(source), k, key), run_url: run, slack_ok: slackOk === null ? null : slackOk ? 1 : 0, meta: meta ? scrub(JSON.stringify(meta), env).slice(0, 1000) : null },
      { env, timeoutMs: logTimeoutMs },
    );
  } catch (e) {
    console.warn(`notify: logging skipped (${e instanceof Error ? e.message.slice(0, 120) : "error"})`);
  }
  return { slackOk: slackOk === true, logged };
}
