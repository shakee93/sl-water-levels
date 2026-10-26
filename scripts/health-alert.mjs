// Turns /api/health output into alerts: one GitHub issue per failing check, plus Slack messages.
//
// Usage:
//   node scripts/health-alert.mjs <health.json>                 real run (CI)
//   node scripts/health-alert.mjs <health.json> --dry-run [--state state.json]
//                                                               print what it would do; touches nothing
//   node scripts/health-alert.mjs --slack-test                  send the one-off "connected" message
//
// Rules
//  - A check must fail on 2 consecutive runs (30 min apart) before anything is opened, so single
//    blips are ignored.
//  - Opening: one issue labelled "data-health" titled "Data source down: <name>" and one Slack
//    message. Never a second issue while one is open (an open issue with that title is adopted).
//  - Still failing: a comment and a Slack reminder every 6 hours, not every run.
//  - Recovered: a closing comment, the issue is closed, one Slack message ("down 2 h 10 min").
//  - Exit code 1 while a confirmed critical check is failing, so GitHub emails the owner about the
//    failed scheduled run. A health.json that is missing or unparsable (the site itself is down)
//    counts as a critical "site" failure.
//
// State between runs lives in one issue labelled "data-health-state" (JSON in its body), because
// scheduled runs share nothing else for free. Env: GITHUB_TOKEN, GITHUB_REPOSITORY (set by Actions),
// SLACK_WEBHOOK_URL (optional; skipped silently when empty and never printed), SITE_URL.
// No dependencies.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const DRY = flag("--dry-run");
const file = args.find((a) => !a.startsWith("--") && a !== opt("--state"));
const SITE = process.env.SITE_URL || "https://waterlevels.lk";
const REPO = process.env.GITHUB_REPOSITORY || "shakee93/sl-water-levels";
const TOKEN = process.env.GITHUB_TOKEN || "";
const SLACK = process.env.SLACK_WEBHOOK_URL || "";
const LABEL = "data-health";
const STATE_LABEL = "data-health-state";
const CONFIRM_AFTER = 2;
const REMIND_MS = 6 * 3_600_000;

const log = (...a) => console.log(...a);

// ---------------------------------------------------------------- helpers

const clock = (ms) =>
  new Date(ms).toLocaleTimeString("en-US", { timeZone: "Asia/Colombo", hour: "numeric", minute: "2-digit" }).replace(" AM", " am").replace(" PM", " pm");
function span(ms) {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

async function slack(text) {
  if (DRY) return log(`[dry-run] Slack message: ${text}`);
  if (!SLACK) return;
  try {
    const res = await fetch(SLACK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) log(`Slack post failed: HTTP ${res.status}`);
  } catch (e) {
    log(`Slack post failed: ${e instanceof Error ? e.name : "error"}`);
  }
}

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "sl-water-levels-health" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok && !(method === "POST" && path === "/labels" && res.status === 422)) {
    throw new Error(`GitHub ${method} ${path} -> HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

// ---------------------------------------------------------------- state

let stateIssue = null; // issue number holding the JSON
let before = "";
async function loadState() {
  if (DRY) {
    const f = opt("--state");
    return f && existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { checks: {} };
  }
  for (const [name, color] of [[LABEL, "d93f0b"], [STATE_LABEL, "ededed"]]) await gh("POST", "/labels", { name, color });
  const list = await gh("GET", `/issues?labels=${STATE_LABEL}&state=all&per_page=1`);
  if (list?.[0]) {
    stateIssue = list[0].number;
    const m = /```json\n([\s\S]*?)\n```/.exec(list[0].body || "");
    before = m ? m[1] : "";
    try {
      return JSON.parse(before);
    } catch {
      /* start fresh */
    }
  }
  return { checks: {} };
}
async function saveState(state) {
  const json = JSON.stringify(state, null, 1);
  if (DRY) {
    const f = opt("--state");
    if (f) writeFileSync(f, json);
    return;
  }
  if (json === before) return; // no change, no edit
  const body = `Machine state for the data-health monitor (scripts/health-alert.mjs). Do not edit or close.\n\n\`\`\`json\n${json}\n\`\`\``;
  if (stateIssue) await gh("PATCH", `/issues/${stateIssue}`, { body, state: "open" });
  else await gh("POST", "/issues", { title: "Data health monitor state (do not close)", body, labels: [STATE_LABEL] });
}

// ---------------------------------------------------------------- issues

const titleOf = (c) => `Data source down: ${c.name}`;
const issueBody = (c, since) =>
  [
    `**${c.name}** has failed the health check on ${CONFIRM_AFTER} runs in a row.`,
    "",
    `- Problem: ${c.detail}`,
    `- Failing since: about ${clock(since)} Sri Lanka time (${new Date(since).toISOString()})`,
    c.lastGoodAt ? `- Last good data: ${c.lastGoodAt}` : null,
    `- What visitors see: ${c.userImpact || "see /status"}`,
    `- Severity: ${c.severity}`,
    `- Live status: ${SITE}/status  ·  raw: ${SITE}/api/health?deep=1`,
    "",
    "Opened automatically by the Data health check workflow. It comments every 6 hours while the problem lasts and closes this issue when the check passes again.",
  ]
    .filter((x) => x != null)
    .join("\n");

async function findOpenIssue(c) {
  if (DRY) return null;
  const open = await gh("GET", `/issues?labels=${LABEL}&state=open&per_page=100`);
  return (open || []).find((i) => !i.pull_request && i.title === titleOf(c)) ?? null;
}

// ---------------------------------------------------------------- main

async function main() {
  if (flag("--slack-test")) {
    await slack("Sri Lanka Water Levels monitoring is connected ✅");
    log(SLACK || DRY ? "Slack test message sent." : "SLACK_WEBHOOK_URL is empty; nothing sent.");
    return 0;
  }
  if (!file) {
    console.error("usage: node scripts/health-alert.mjs <health.json> [--dry-run [--state f]] | --slack-test");
    return 2;
  }
  if (!DRY && !TOKEN) {
    console.error("GITHUB_TOKEN is not set");
    return 2;
  }

  let checks;
  let now = Date.now();
  try {
    const report = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(report.checks)) throw new Error("no checks array");
    checks = report.checks;
    if (Number.isFinite(Date.parse(report.checkedAt))) now = Date.parse(report.checkedAt);
  } catch (e) {
    log(`health payload unusable (${e instanceof Error ? e.message : "error"}): treating the site as down`);
    checks = [
      {
        id: "site",
        name: "Website",
        ok: false,
        severity: "critical",
        detail: "the site did not return a valid health response (down, or the health endpoint is broken)",
        userImpact: "the whole site may be unavailable",
      },
    ];
  }

  const state = await loadState();
  state.checks ||= {};
  let criticalDown = false;

  for (const c of checks) {
    const s = state.checks[c.id];
    if (!c.ok) {
      const cur = s || { fails: 0, since: now };
      cur.fails += 1;
      state.checks[c.id] = cur;
      log(`FAIL ${c.id}: ${c.detail} (run ${cur.fails}/${CONFIRM_AFTER})`);
      if (cur.fails < CONFIRM_AFTER) continue;
      if (c.severity === "critical") criticalDown = true;
      const link = (n) => (n ? `https://github.com/${REPO}/issues/${n}` : "(issue link)");

      if (cur.issue == null) {
        const existing = await findOpenIssue(c); // never a second issue for the same check
        if (existing) {
          cur.issue = existing.number;
          cur.lastNotified = now;
          log(`  adopting open issue #${existing.number}`);
        } else {
          if (DRY) {
            cur.issue = 0;
            log(`[dry-run] would open issue "${titleOf(c)}" labelled ${LABEL}:\n${issueBody(c, cur.since).replace(/^/gm, "    ")}`);
          } else cur.issue = (await gh("POST", "/issues", { title: titleOf(c), body: issueBody(c, cur.since), labels: [LABEL] })).number;
          cur.lastNotified = now;
          await slack(`🔴 Data source down: ${c.name} — ${c.detail}. Since ${clock(cur.since)}. Users see: ${c.userImpact}. Status: ${SITE}/status · Issue: ${link(cur.issue)}`);
        }
      } else if (now - (cur.lastNotified || 0) >= REMIND_MS) {
        const text = `Still failing after ${span(now - cur.since)}: ${c.detail}`;
        if (DRY) log(`[dry-run] would comment on #${cur.issue}: ${text}`);
        else await gh("POST", `/issues/${cur.issue}/comments`, { body: text });
        cur.lastNotified = now;
        await slack(`🔴 Still down: ${c.name} — ${c.detail}. Down for ${span(now - cur.since)}. Users see: ${c.userImpact}. Status: ${SITE}/status · Issue: ${link(cur.issue)}`);
      }
    } else if (s) {
      delete state.checks[c.id];
      if (s.issue != null) {
        log(`RECOVERED ${c.id}`);
        const text = `Recovered: the check passes again (${c.detail}). It was failing for about ${span(now - s.since)}.`;
        if (DRY) log(`[dry-run] would comment on #${s.issue}, close it: ${text}`);
        else {
          await gh("POST", `/issues/${s.issue}/comments`, { body: text });
          await gh("PATCH", `/issues/${s.issue}`, { state: "closed", state_reason: "completed" });
        }
        await slack(`✅ Recovered: ${c.name} (down ${span(now - s.since)})`);
      } else log(`ok again ${c.id} (blip, nothing had been opened)`);
    }
  }

  await saveState(state);
  if (criticalDown) log("A critical check is failing: failing this run so GitHub emails the owner.");
  return criticalDown ? 1 : 0;
}

process.exit(await main());
