// Pure maths for the measured-uptime figures (no I/O). Checks run every 5 minutes (workers/scheduler/index.mjs).
// A window with no rows is "not measured" (null), never 0% and never "down": a gap in the probe is not an outage of the site.

export const TARGETS = ["site", "embed", "api"];
export const INTERVAL_MS = 5 * 60_000;
/** failed checks further apart than this are two outages (a hole in the probe in between is not counted as down time) */
export const OUTAGE_JOIN_MS = 2.5 * INTERVAL_MS;
const DAY = 86_400_000;
export const WINDOWS = { "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY };

/** Uptime for one window from counted checks: { checks, up, firstTs }. null = not measured. `since` is set when measuring began inside the window. */
export function windowUptime(agg, now, windowMs) {
  const checks = Number(agg?.checks) || 0;
  if (checks <= 0) return null;
  const up = Math.min(checks, Math.max(0, Number(agg.up) || 0));
  const first = Number(agg.firstTs);
  // started within the window (more than an hour after its start): say "since", so a 2-day-old probe never claims 30 days
  const since = Number.isFinite(first) && first > now - windowMs + 3_600_000 ? first : null;
  return { pct: (up / checks) * 100, checks, up, since };
}

/** Floors to `digits` decimals, so 99.996 shows 99.99 and only a perfect record shows 100. */
export function fmtPct(pct, digits = 1) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const k = 10 ** digits;
  const v = Math.floor(pct * k + 1e-9) / k;
  return v.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

/** Nearest-rank percentile of numbers; null when empty. */
export function percentile(values, p) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))];
}

/**
 * Outages from the timestamps of FAILED checks (ascending). Consecutive failures (<= OUTAGE_JOIN_MS apart) are one outage:
 * start = first failed check, end = last failed check + one interval (the next check was the first good one), so one failed check = 5 min.
 * `latest` = the newest row ({ ts, ok }): when it is a failure no older than the join window, the last outage is still going (end null).
 */
export function outagesFrom(failedTs, latest, now) {
  const ts = [...failedTs].filter(Number.isFinite).sort((a, b) => a - b);
  const out = [];
  for (const t of ts) {
    const last = out[out.length - 1];
    if (last && t - last.lastTs <= OUTAGE_JOIN_MS) {
      last.lastTs = t;
      last.checks++;
    } else out.push({ start: t, lastTs: t, checks: 1 });
  }
  return out.map((o, i) => {
    const ongoing = i === out.length - 1 && latest && latest.ok === 0 && latest.ts === o.lastTs && now - o.lastTs <= OUTAGE_JOIN_MS;
    const end = ongoing ? null : o.lastTs + INTERVAL_MS;
    return { start: o.start, end, durationMs: (end ?? Math.max(now, o.lastTs + INTERVAL_MS)) - o.start, checks: o.checks, ongoing: !!ongoing };
  });
}

/** Whole-minute wording helper input: rounds a duration up to whole minutes (min 1). */
export const minutesOf = (ms) => Math.max(1, Math.round(ms / 60_000));
