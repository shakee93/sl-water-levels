// Pure helpers for the data-health checks "pipe-hmis-fresh" and "pipe-rivernet-fresh" (lib/health.ts): how old is the NEWEST RECORD in each snapshot archive on the
// `data` branch (hmis/rain-live.json, hmis/levels/<day>.json, rivernet/<year>/<day>.json)?
//
// Why the record and not the workflow run: on 7-9 Nov 2026 HMIS was unreachable for 37.5 h; hmis-snapshot.yml logged "fetch failed" twice per
// run, "No change.", and finished GREEN 73 times in a row, so the workflow-success check (checkWorkflow "pipe-hmis") could not see it. The age of
// the newest record in the archive itself is what matters, whatever the reason it stopped (upstream down, job skipped, scheduler dead, push lost).
// Pure and dependency-free so a node test can run it (test: node --experimental-strip-types --no-warnings scripts/archive-freshness.test.mts).

const LK_MS = 5.5 * 3_600_000;

/** The Colombo (UTC+05:30) day "YYYY-MM-DD" of an instant: the file name the snapshot scripts use. */
export const colomboDay = (ms) => new Date(ms + LK_MS).toISOString().slice(0, 10);

/** Newest record time (epoch ms UTC) in hmis/rain-live.json: devices[id].pts = [[epoch MINUTES, mm24h], ...]. null when none. */
export function newestRainLive(json) {
  const devices = json && typeof json === "object" ? json.devices : null;
  if (!devices || typeof devices !== "object") return null;
  let best = null;
  for (const e of Object.values(devices)) {
    const pts = e && Array.isArray(e.pts) ? e.pts : [];
    for (const p of pts) {
      const t = Array.isArray(p) ? Number(p[0]) * 60_000 : NaN;
      if (Number.isFinite(t) && (best == null || t > best)) best = t;
    }
  }
  return best;
}

/** Newest point time (epoch ms UTC) in a daily file { "<device>": { pts: [[epoch ms, value], ...] } } (hmis/levels, hmis/rain, rivernet). null when none. */
export function newestDayPts(json) {
  if (!json || typeof json !== "object") return null;
  let best = null;
  for (const e of Object.values(json)) {
    const pts = e && Array.isArray(e.pts) ? e.pts : [];
    const p = pts[pts.length - 1]; // pts are sorted ascending by the writers
    const t = Array.isArray(p) ? Number(p[0]) : NaN;
    if (Number.isFinite(t) && (best == null || t > best)) best = t;
  }
  return best;
}

/** Verdict for one archive: ok when the newest record is at most limitMs old. A record in the future (clock skew, bad unit) is ok but noted. */
export function judgeArchive(label, newestMs, now, limitMs) {
  if (newestMs == null) return { ok: false, label, ageMs: null, text: `${label}: no records found` };
  const ageMs = now - newestMs;
  return { ok: ageMs <= limitMs, label, ageMs, newestMs, text: `${label}: newest record ${fmt(ageMs)} old (limit ${fmt(limitMs)})` };
}

export function fmt(ms) {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 90) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 6) / 10} h`;
  return `${Math.round(m / 144) / 10} days`;
}

/** Limits (ms). HMIS levels and rain are refreshed every 30 min; RiverNet's archive runs every 2 h and its newest point is the last full hour, so 4 h. */
export const LIMITS = { hmisRain: 3 * 3_600_000, hmisLevels: 3 * 3_600_000, rivernet: 4 * 3_600_000 };
