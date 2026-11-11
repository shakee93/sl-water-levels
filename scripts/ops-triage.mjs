// The ops loop job: reads the in-house notification log (D1 table `notifications`, written by lib/notify.mjs) and the stored
// `ops_issues`, applies the pure rules of lib/opsTriage.mjs, and raises / updates / closes ONE GitHub issue (label ops-loop) per
// recurring problem. Open issues labelled ops-loop are the to-do list. DOCS.md "Ops loop (in-house notification log)".
//
//   node scripts/ops-triage.mjs [--dry-run] [--force] [--input fixture.json]
//
//   --dry-run   prints what it would do and touches nothing (no D1 write, no GitHub call, no Slack). Reads D1 when
//               CLOUDFLARE_API_TOKEN is set, or a fixture {notifications, issues} from --input.
//   --force     skips the "at most one full pass every 3 hours" gate.
//
// Env: CLOUDFLARE_API_TOKEN (D1), GITHUB_TOKEN + GITHUB_REPOSITORY (issues), SLACK_WEBHOOK_URL (one line per opened issue + a daily summary).
// Fails soft: D1 or GitHub down is a warning and exit 0 (the next trigger does the same work); only a bug exits 1.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { RULES, triage, dailySummary, workflowRunRows, renderBody, renderRecurrence, renderResolved, colomboDay, sanitise } from "../lib/opsTriage.mjs";
import { notify as realNotify, SCHEMA } from "../lib/notify.mjs";
import { selectRows, runStatements } from "../lib/d1Sql.mjs";

export const MIN_GAP_MS = 2 * 3_600_000 + 50 * 60_000; // a full pass at most about every 3 h (cron every 3 h must not skip itself)
const STATE_RUN = "_state:last-run";
const STATE_SUMMARY = "_state:last-summary";
const STATE_TROUBLE = "_state:gh-trouble"; // consecutive passes in which a GitHub call failed (count) and the Sri Lanka day of the last Slack line (note)
export const EARLY_GAP_MS = 25 * 60_000; // inside the 3 h gate a pass is still allowed when GitHub shows a NEW failed run, but never twice within this
const LABEL = "ops-loop";
const IGNORE_LABEL = "ops-ignore";
const SLICE = 500;
const MAX_SLICES = 10;

// ---- D1 adapter --------------------------------------------------------------------------------------------------------

const lit = (v) => (v == null ? "NULL" : typeof v === "number" ? (Number.isFinite(v) ? String(Math.trunc(v)) : "NULL") : `'${String(v).replace(/'/g, "''")}'`);

/** The real D1 (HTTP /query through lib/d1Sql.mjs: reads retried, writes are single idempotent statements). */
export function d1Adapter({ sel = selectRows, exec = runStatements } = {}) {
  const read = async (sql, params) => {
    try {
      return await sel(sql, params);
    } catch (e) {
      if (!/no such table/i.test(String(e?.message))) throw e;
      for (const s of SCHEMA) await exec([s], { label: "ops schema" });
      return sel(sql, params);
    }
  };
  return {
    async loadNotifications(since) {
      // info rows carry no text (the rules never read it): keeps the read small on a busy day
      return read("SELECT id, ts, source, kind, severity, fingerprint, run_url, slack_ok, CASE WHEN severity = 'info' THEN '' ELSE substr(text, 1, 1500) END AS text FROM notifications WHERE ts >= ? AND source != 'ops-triage' ORDER BY ts, id", [since]);
    },
    async loadIssues() {
      const rows = await read("SELECT fingerprint, title, source, kind, severity, first_ts, last_ts, count, status, github_issue, opened_ts, resolved_ts, note FROM ops_issues", []);
      const issues = {}, state = {};
      for (const r of rows) (r.fingerprint.startsWith("_") ? state : issues)[r.fingerprint] = r;
      return { issues, state };
    },
    async saveIssue(r) {
      const cols = ["fingerprint", "title", "source", "kind", "severity", "first_ts", "last_ts", "count", "status", "github_issue", "opened_ts", "resolved_ts", "note"];
      const upd = cols.slice(1).map((c) => `${c} = excluded.${c}`).join(", ");
      await exec([`INSERT INTO ops_issues (${cols.join(", ")}) VALUES (${cols.map((c) => lit(r[c])).join(", ")}) ON CONFLICT(fingerprint) DO UPDATE SET ${upd}`], { label: "ops_issues" });
    },
    async purge(before) {
      let removed = 0;
      for (let i = 0; i < MAX_SLICES; i++) {
        const [c] = await sel("SELECT COUNT(*) AS c FROM notifications WHERE ts < ?", [before]);
        if (!c?.c) break;
        await exec([`DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE ts < ${lit(before)} ORDER BY ts LIMIT ${SLICE})`], { label: "notifications retention" });
        removed += Math.min(SLICE, c.c);
      }
      return removed;
    },
  };
}

// ---- GitHub adapter (REST) -------------------------------------------------------------------------------------------

export function githubAdapter({ token, repo, doFetch = fetch }) {
  const call = async (method, path, body) => {
    const res = await doFetch(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "sl-water-levels-ops-loop" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 204) return null;
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(`GitHub ${method} ${path.split("?")[0]} -> HTTP ${res.status}`), { status: res.status });
    return j;
  };
  return {
    async ensureLabel() {
      for (const [name, color, description] of [[LABEL, "d93f0b", "Raised by the ops loop from the notification log"], [IGNORE_LABEL, "cccccc", "Tell the ops loop to stop raising this problem"]]) {
        try { await call("GET", `/labels/${name}`); } catch (e) { if (e.status === 404) await call("POST", "/labels", { name, color, description }).catch(() => {}); else throw e; }
      }
    },
    async list() {
      const out = [];
      for (let page = 1; page <= 3; page++) {
        const part = await call("GET", `/issues?labels=${LABEL}&state=all&per_page=100&page=${page}`);
        out.push(...part.filter((i) => !i.pull_request));
        if (part.length < 100) break;
      }
      return out.map((i) => ({ number: i.number, state: i.state, body: i.body ?? "", labels: (i.labels ?? []).map((l) => (typeof l === "string" ? l : l.name)), url: i.html_url }));
    },
    create: async (title, body) => { const j = await call("POST", "/issues", { title, body, labels: [LABEL] }); return { number: j.number, url: j.html_url }; },
    comment: (n, body) => call("POST", `/issues/${n}/comments`, { body }),
    close: (n) => call("PATCH", `/issues/${n}`, { state: "closed", state_reason: "completed" }),
    reopen: (n) => call("PATCH", `/issues/${n}`, { state: "open" }),
    // Read-only calls for failed workflow runs (needs `actions: read`; the repo is public, so the built-in token is enough).
    async hasFailedRunsSince(sinceMs) {
      const j = await call("GET", `/actions/runs?status=failure&created=${encodeURIComponent(">=" + new Date(sinceMs).toISOString().slice(0, 19) + "Z")}&per_page=1`);
      return (j?.total_count ?? 0) > 0;
    },
    /** Completed runs of EVERY workflow that failed since `sinceMs`, plus the recent completed runs (successes too) of each such workflow:
     *  the success is the recovery and the run spacing is the cadence. One list call per 100 failures, one call per failing workflow (<= 25). */
    async listRuns(sinceMs) {
      const iso = encodeURIComponent(">=" + new Date(sinceMs).toISOString().slice(0, 19) + "Z");
      const mapRun = (r) => ({ id: r.id, name: r.name, conclusion: r.conclusion, ts: Date.parse(r.updated_at), startTs: Date.parse(r.run_started_at ?? r.created_at), url: r.html_url, workflowId: r.workflow_id });
      const byId = new Map(), workflows = new Map();
      for (const status of ["failure", "timed_out"]) {
        for (let page = 1; page <= 10; page++) {
          const j = await call("GET", `/actions/runs?status=${status}&created=${iso}&per_page=100&page=${page}`);
          const part = j?.workflow_runs ?? [];
          for (const r of part) { byId.set(r.id, mapRun(r)); workflows.set(r.workflow_id, r.name); }
          if (part.length < 100) break;
        }
      }
      for (const wid of [...workflows.keys()].slice(0, 25)) {
        const j = await call("GET", `/actions/workflows/${wid}/runs?status=completed&per_page=40`);
        for (const r of j?.workflow_runs ?? []) byId.set(r.id, mapRun(r));
      }
      // a run that failed before its workflow file parsed is named by its path: use the workflow's real name
      const nameById = new Map();
      for (const r of byId.values()) if (!/^\.github\//.test(r.name ?? "")) nameById.set(r.workflowId, r.name);
      return [...byId.values()].map((r) => (nameById.has(r.workflowId) ? { ...r, name: nameById.get(r.workflowId) } : r));
    },
    /** Open issues the health monitor keeps for a data source (label data-health): {number, title}. */
    async listDataHealth() {
      const part = await call("GET", `/issues?labels=data-health&state=open&per_page=50`);
      return part.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: String(i.title ?? "") }));
    },
    retitle: (n, title) => call("PATCH", `/issues/${n}`, { title }),
  };
}

// ---- the pass ------------------------------------------------------------------------------------------------------------

/** Maps a workflow's display name to its file by reading `name:` from .github/workflows/*.yml. */
export function workflowFileMap(dir = ".github/workflows") {
  const map = {};
  if (!existsSync(dir)) return map;
  for (const f of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(f)) continue;
    const m = /^name:\s*["']?(.+?)["']?\s*$/m.exec(readFileSync(`${dir}/${f}`, "utf8"));
    if (m) map[m[1]] = `${dir}/${f}`;
  }
  return map;
}

const marker = (key) => `<!-- ops-loop:${key} -->`;

/**
 * One pass. Everything outside is injected so tests run on mocks (never the real D1, GitHub or Slack).
 * @returns {Promise<{skipped?: string, d1Down?: boolean, actions: any[], opened: number, resolved: number, changed: boolean}>}
 */
export async function run({ env = process.env, now = Date.now(), dryRun = false, force = false, d1, gh, notify = realNotify, log = console, workflowFiles = {}, input = null } = {}) {
  const res = { actions: [], opened: 0, resolved: 0, changed: false };
  const repo = env.GITHUB_REPOSITORY || "";
  const repoUrl = repo ? `https://github.com/${repo}` : "";
  let issues, state, notifications;
  try {
    if (input) {
      issues = input.issues ?? {};
      notifications = input.notifications ?? [];
      state = {};
    } else {
      if (!d1) throw new Error("CLOUDFLARE_API_TOKEN is not set");
      ({ issues, state } = await d1.loadIssues());
      if (!force && !dryRun && state[STATE_RUN] && now - state[STATE_RUN].last_ts < MIN_GAP_MS) {
        // inside the gate a NEW failed workflow run (one cheap GitHub call) still earns a pass, at most every 25 min: a canal job failing
        // every 15 min must not wait up to 3 h for its issue
        const age = now - state[STATE_RUN].last_ts;
        const early = age >= EARLY_GAP_MS && gh?.hasFailedRunsSince ? await gh.hasFailedRunsSince(state[STATE_RUN].last_ts).catch(() => false) : false;
        if (!early) {
          log.log(`ops-triage: last full pass was ${Math.round(age / 60_000)} min ago; skipping (at most one every 3 h).`);
          return { ...res, skipped: "recent-pass" };
        }
        log.log(`ops-triage: last full pass was ${Math.round(age / 60_000)} min ago, but a new failed workflow run exists; running early.`);
      }
      notifications = await d1.loadNotifications(now - RULES.lookbackMs);
    }
  } catch (e) {
    log.warn(`::warning::ops-triage: could not read D1 (${String(e?.message ?? e).slice(0, 200)}); nothing done, the next trigger tries again.`);
    return { ...res, d1Down: true };
  }

  const say = (m) => log.log(`${dryRun ? "[dry-run] " : ""}${m}`);
  const slack = async (text) => (dryRun ? say(`Slack: ${text}`) : notify(text, { source: "ops-triage", kind: "ops-loop", severity: "info", env }).catch(() => {}));
  // A GitHub call that keeps failing must become visible: after 3 passes in a row with a failed GitHub call, ONE Slack line per Sri Lanka day.
  const trouble = async (failed, what = "") => {
    if (dryRun || !d1) return;
    try {
      const prev = state[STATE_TROUBLE];
      if (!failed && !prev?.count) return;
      const count = failed ? (prev?.count ?? 0) + 1 : 0;
      let note = prev?.note ?? "";
      if (failed && count >= 3 && note !== colomboDay(now)) {
        await slack(`:wrench: Ops loop: GitHub calls have failed on ${count} passes in a row (${sanitise(what, 100)}); problems are not being opened or closed until this works. Check the "Ops triage" workflow run.`);
        note = colomboDay(now);
      }
      await d1.saveIssue({ fingerprint: STATE_TROUBLE, status: "state", last_ts: now, count, note });
    } catch { /* best effort */ }
  };

  // Failed workflow runs, straight from GitHub (read-only; nothing about runs is stored): synthetic notifications for the same rules.
  let runsFailed = false, cadence = {};
  const runSource = input ? input.runs ?? null : gh?.listRuns ? await gh.listRuns(now - RULES.runsLookbackMs).catch((e) => { runsFailed = true; log.warn(`::warning::ops-triage: could not list workflow runs (${String(e?.message ?? e).slice(0, 120)}); using the notification log only.`); return null; }) : null;
  if (runSource?.length) {
    const w = workflowRunRows({ runs: runSource, notifications, now });
    notifications = [...notifications, ...w.rows];
    cadence = w.cadence;
  }

  const live = !dryRun && gh;
  let ghIssues = [];
  const byKey = new Map();
  if (live) {
    try {
      await gh.ensureLabel();
      ghIssues = await gh.list();
      for (const i of ghIssues) { const m = /<!-- ops-loop:(\S+) -->/.exec(i.body); if (m) byKey.set(m[1], i); }
    } catch (e) {
      log.warn(`::warning::ops-triage: GitHub is not reachable (${String(e?.message ?? e).slice(0, 120)}); nothing done this pass.`);
      await trouble(true, String(e?.message ?? e));
      return { ...res, d1Down: false, skipped: "github-down" };
    }
    // The owner's hand: label ops-ignore stops a problem for good; closing an issue by hand resolves it.
    for (const [key, iss] of Object.entries(issues)) {
      const g = byKey.get(key);
      if (!g || iss.status === "ignored") continue;
      if (g.labels.includes(IGNORE_LABEL)) { issues[key] = { ...iss, status: "ignored" }; await d1?.saveIssue(issues[key]).catch(() => {}); log.log(`ops-triage: #${g.number} is labelled ${IGNORE_LABEL}; ignored for good.`); }
      else if (iss.status === "open" && g.state === "closed") { issues[key] = { ...iss, status: "resolved", resolved_ts: now }; await d1?.saveIssue(issues[key]).catch(() => {}); log.log(`ops-triage: #${g.number} was closed by hand; marked resolved.`); }
    }
  }

  let related = [];
  if (gh?.listDataHealth) related = await gh.listDataHealth().catch(() => []);
  const out = triage({ notifications, issues, now, workflowFiles, workflowCadence: cadence, related });
  res.actions = out.actions;
  if (!out.actions.length) say("ops-triage: nothing to open, update or close.");

  let applyFailed = runsFailed, failWhat = runsFailed ? "listing workflow runs" : "";
  const save = async (row) => { if (!dryRun && d1) await d1.saveIssue(row); };

  for (const a of out.actions) {
    try {
      if (a.type === "open" || a.type === "reopen") {
        const existing = byKey.get(a.key);
        let n = a.github_issue ?? existing?.number ?? null, url = existing?.url ?? (n && repoUrl ? `${repoUrl}/issues/${n}` : "");
        const body = renderBody(a.summary, a.reason, a.key, a.related);
        say(`${a.type.toUpperCase()}: ${a.title}\n  why: ${a.reason.text}\n  sample: ${a.summary.sample}\n  files: ${a.summary.files.join(", ")}`);
        if (live) {
          if (existing) {
            if (existing.state === "closed") { await gh.reopen(existing.number); await gh.comment(existing.number, `Reopened by the ops loop: ${a.reason.text}.\n\n${renderRecurrence(a.summary)}`); }
            await gh.retitle(existing.number, a.title);
          } else {
            const c = await gh.create(a.title, body);
            n = c.number; url = c.url;
          }
          a.issue.github_issue = n;
        }
        await save(a.issue);
        res.opened++;
        await slack(`:wrench: Ops loop opened ${n ? `#${n}` : "an issue"}: ${a.title}${url ? ` ${url}` : ""}`);
      } else if (a.type === "comment") {
        say(`COMMENT #${a.github_issue}: recurred after a quiet day (${a.summary.count} in total)`);
        if (live && a.github_issue) await gh.comment(a.github_issue, renderRecurrence(a.summary));
        if (live && a.retitle && a.github_issue) await gh.retitle(a.github_issue, a.retitle);
        await save(a.issue);
      } else if (a.type === "update") {
        say(`UPDATE #${a.github_issue}: ${a.issue.count} in total${a.retitle ? `; new title: ${a.retitle}` : ""}`);
        if (live && a.retitle && a.github_issue) await gh.retitle(a.github_issue, a.retitle);
        await save(a.issue);
      } else if (a.type === "resolve") {
        say(`RESOLVE #${a.github_issue}: ${a.why}`);
        if (live && a.github_issue) { await gh.comment(a.github_issue, renderResolved(a.why, now)); await gh.close(a.github_issue); }
        await save(a.issue);
        res.resolved++;
      }
      res.changed = true;
    } catch (e) {
      applyFailed = true; failWhat = String(e?.message ?? e).slice(0, 100);
      log.warn(`::warning::ops-triage: could not apply ${a.type} for ${a.key} (${String(e?.message ?? e).slice(0, 160)}); it is tried again next pass.`);
    }
  }

  res.deferred = out.deferred ?? 0;
  if (res.deferred) await slack(`:wrench: Ops loop: ${res.deferred} more problem${res.deferred === 1 ? "" : "s"} waiting; they open on the next pass.`);

  if (dryRun) return res;
  if (live) await trouble(applyFailed, failWhat);
  try {
    if (d1) {
      await d1.saveIssue({ fingerprint: STATE_RUN, status: "state", last_ts: now, count: out.actions.length, note: colomboDay(now) });
      // the daily summary, once per Sri Lanka day, after 08:00
      const hour = new Date(now + 5.5 * 3_600_000).getUTCHours();
      if (hour >= 8 && state[STATE_SUMMARY]?.note !== colomboDay(now)) {
        const line = dailySummary(out.issues, now, { repoUrl, silence: out.silence });
        if (line) await slack(line); // nothing open, opened or resolved: no daily "0 open problems" line
        await d1.saveIssue({ fingerprint: STATE_SUMMARY, status: "state", last_ts: now, note: colomboDay(now) });
      }
      const removed = await d1.purge(now - RULES.retentionDays * 86_400_000);
      if (removed) log.log(`ops-triage: removed ${removed} notification rows older than ${RULES.retentionDays} days.`);
    }
  } catch (e) {
    log.warn(`::warning::ops-triage: bookkeeping skipped (${String(e?.message ?? e).slice(0, 160)}).`);
  }
  return res;
}

// ---- CLI -------------------------------------------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force") || process.env.OPS_FORCE === "1";
  const i = argv.indexOf("--input");
  const input = i >= 0 ? JSON.parse(readFileSync(argv[i + 1], "utf8")) : null;
  const env = process.env;
  const d1 = env.CLOUDFLARE_API_TOKEN ? d1Adapter() : null;
  const gh = env.GITHUB_TOKEN && env.GITHUB_REPOSITORY ? githubAdapter({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY }) : null;
  if (!dryRun && !input && (!d1 || !gh)) {
    console.warn(`::warning::ops-triage: ${!d1 ? "CLOUDFLARE_API_TOKEN" : "GITHUB_TOKEN / GITHUB_REPOSITORY"} is not set; nothing done.`);
    process.exit(0);
  }
  try {
    const r = await run({ env, dryRun, force, d1, gh, input, workflowFiles: workflowFileMap() });
    console.log(`ops-triage: ${r.skipped ? `skipped (${r.skipped})` : r.d1Down ? "D1 unavailable" : `${r.actions.length} action(s), ${r.opened} opened, ${r.resolved} resolved`}`);
  } catch (e) {
    console.error(`::error::ops-triage failed: ${e instanceof Error ? e.stack : e}`);
    process.exit(1);
  }
}
