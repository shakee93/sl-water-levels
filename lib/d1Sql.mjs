// Runs a .sql file / list of statements on the Cloudflare D1 database "sl-water-levels" through the HTTP /query endpoint,
// in small batches. Plain JS (no TypeScript) so a bare `node` in a workflow can use it.
//
// Why not `wrangler d1 execute --file`: wrangler sends a file (and any multi-statement --command) through D1's IMPORT path, which
// prints "your D1 database will be unavailable to serve queries" and holds the database while it runs. On 27 Oct 2026 the
// 15-minute CUrW snapshot (a 2-3 MB file of base64 chart chunks), the hourly forecast store and the street-rain log did that all
// day on a 200 MB database; every other client (X jobs, GSMaP, the website) then timed out ("D1 DB storage operation exceeded
// timeout", code 7429). /query takes ordinary requests that only hold the database for the length of their own statements.
//
// Every caller's statements are idempotent (INSERT OR IGNORE, ON CONFLICT ... DO UPDATE, INSERT OR REPLACE, DELETE by condition),
// so a batch that timed out is simply sent again (2 retries, 2 s then 6 s). Batches are at most 50 statements / 100 KB; a
// single statement bigger than that (a 48 KB base64 chunk is the largest) goes alone.
//
// Needs CLOUDFLARE_API_TOKEN (CLOUDFLARE_ACCOUNT_ID optional). CF_API_BASE exists only so tests can point at a fake server.

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "83e812aa5ee674fe01ce3a9eb1e04cbe";
const DB_NAME = "sl-water-levels";
const MAX_STATEMENTS = 50;
const MAX_BYTES = 100_000;
const base = () => process.env.CF_API_BASE || "https://api.cloudflare.com/client/v4";

/** Splits SQL text into statements: respects '...' and "..." strings (with '' escapes), drops -- and a slash-star comments. */
export function splitSql(text) {
  const out = [];
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === c) {
          if (text[j + 1] === c) j += 2;
          else break;
        } else j++;
      }
      cur += text.slice(i, j + 1);
      i = j;
    } else if (c === "-" && text[i + 1] === "-") {
      while (i < text.length && text[i] !== "\n") i++;
      cur += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const e = text.indexOf("*/", i + 2);
      i = e < 0 ? text.length : e + 1;
      cur += " ";
    } else if (c === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Groups statements into batches of at most `maxStatements` / `maxBytes` (a statement bigger than maxBytes gets a batch to itself). */
export function chunkStatements(statements, maxStatements = MAX_STATEMENTS, maxBytes = MAX_BYTES) {
  const chunks = [];
  let cur = [], bytes = 0;
  for (const s of statements) {
    const n = Buffer.byteLength(s);
    if (cur.length && (cur.length >= maxStatements || bytes + n > maxBytes)) {
      chunks.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(s);
    bytes += n;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export class D1HttpError extends Error {
  constructor(message, { status = 0, transient = false } = {}) {
    super(message);
    this.status = status;
    this.transient = transient;
  }
}

async function cf(path, body, timeoutMs) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new D1HttpError("CLOUDFLARE_API_TOKEN is not set");
  let res;
  try {
    res = await fetch(`${base()}${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new D1HttpError(`D1 request failed: ${e instanceof Error ? e.message : e}`, { transient: true });
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) {
    const msg = (j.errors ?? []).map((e) => `${e.message}${e.code ? ` [code: ${e.code}]` : ""}`).join("; ").slice(0, 300);
    // 5xx, 429 and D1's own "storage operation exceeded timeout / object reset" (7429) are worth another try
    throw new D1HttpError(`D1 HTTP ${res.status}: ${msg}`, { status: res.status, transient: res.status >= 500 || res.status === 429 || /timeout|reset|overloaded|7429|7500/i.test(msg) && res.status !== 400 });
  }
  return j;
}

let dbId = process.env.CF_D1_DATABASE_ID || "";
async function databaseId() {
  if (dbId) return dbId;
  const j = await cf(`/accounts/${ACCOUNT_ID}/d1/database?name=${DB_NAME}`, null, 15_000);
  const hit = (j.result ?? []).find((d) => d.name === DB_NAME);
  if (!hit) throw new D1HttpError(`D1 database ${DB_NAME} not found`);
  return (dbId = hit.uuid);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BACKOFF = [2000, 6000];

async function withRetry(f, retries) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await f();
    } catch (e) {
      if (!(e instanceof D1HttpError) || !e.transient || attempt >= retries) throw e;
      console.warn(`D1 attempt ${attempt + 1} failed (${e.message}); retrying in ${BACKOFF[Math.min(attempt, BACKOFF.length - 1)] / 1000} s`);
      await sleep(BACKOFF[Math.min(attempt, BACKOFF.length - 1)]);
    }
  }
}

let batchSupported = true;

/** Runs one batch. Prefers the REST `batch` form; if the API rejects it as malformed, sends the statements one by one. */
async function runChunk(statements, { timeoutMs, retries }) {
  const id = await databaseId();
  const path = `/accounts/${ACCOUNT_ID}/d1/database/${id}/query`;
  if (batchSupported && statements.length > 1) {
    try {
      return await withRetry(() => cf(path, { batch: statements.map((sql) => ({ sql })) }, timeoutMs), retries);
    } catch (e) {
      if (!(e instanceof D1HttpError) || (e.status !== 400 && e.status !== 422)) throw e;
      console.warn(`D1 rejected the batch form (${e.message}); sending statements one at a time`);
      batchSupported = false;
    }
  }
  let last;
  for (const sql of statements) last = await withRetry(() => cf(path, { sql }, timeoutMs), retries);
  return last;
}

/** Runs statements in order, in batches. Returns {statements, batches}. Throws D1HttpError (with .transient) on failure. */
export async function runStatements(statements, { timeoutMs = 30_000, retries = 2, label = "D1" } = {}) {
  const chunks = chunkStatements(statements);
  let done = 0;
  for (const chunk of chunks) {
    await runChunk(chunk, { timeoutMs, retries });
    done += chunk.length;
  }
  console.log(`${label}: ${done} statements in ${chunks.length} batch${chunks.length === 1 ? "" : "es"} (HTTP /query, no import lock)`);
  return { statements: done, batches: chunks.length };
}

/** One read with its rows; retried twice on timeouts. */
export async function selectRows(sql, params = [], { timeoutMs = 15_000, retries = 2 } = {}) {
  const id = await databaseId();
  const j = await withRetry(() => cf(`/accounts/${ACCOUNT_ID}/d1/database/${id}/query`, { sql, params }, timeoutMs), retries);
  return j.result?.[0]?.results ?? [];
}

// CLI: node lib/d1Sql.mjs <file.sql> [--soft]
//   --soft: a transient D1 failure (timeout, 5xx, 7429) prints a warning and exits 0, for jobs that run again soon
//   with all-idempotent statements; any other error still exits 1.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import("node:fs");
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node lib/d1Sql.mjs <file.sql> [--soft]");
    process.exit(1);
  }
  const stmts = splitSql(readFileSync(file, "utf8"));
  try {
    await runStatements(stmts, { label: file });
  } catch (e) {
    const soft = process.argv.includes("--soft") && e instanceof D1HttpError && e.transient;
    console.error(`${soft ? "::warning::" : "::error::"}${e instanceof Error ? e.message : e}`);
    process.exit(soft ? 0 : 1);
  }
}
