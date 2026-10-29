// Measured uptime of the site, the embed and the data API, read from the D1 table `uptime_checks` that the Cloudflare
// scheduler worker fills every 5 minutes (workers/scheduler/index.mjs, d1/0020_uptime.sql). Maths: lib/uptimeCalc.mjs.
// Server only. Cached 5 minutes, time-boxed, fails soft: any problem (no token, D1 slow, table not created yet) gives
// null and callers show "measuring". Reads are small: one counting query over 30 days, the failed rows, the newest row per
// target and the last 24 h of load times.

import { unstable_cache } from "next/cache";
import { d1Query, d1Configured } from "./d1";
import { timeBox } from "./nextHour";
import { TARGETS, WINDOWS, windowUptime, percentile, outagesFrom } from "./uptimeCalc.mjs";

export type UptimeTarget = "site" | "embed" | "api";
export type WindowKey = "24h" | "7d" | "30d";
export type UptimeWindow = { pct: number; checks: number; up: number; since: number | null } | null;
export type Outage = { target: UptimeTarget; start: number; end: number | null; durationMs: number; checks: number; ongoing: boolean };
export type TargetUptime = {
  windows: Record<WindowKey, UptimeWindow>;
  /** typical (p50) and slow (p95) time to load, last 24 h, ms; null = nothing measured */
  p50: number | null;
  p95: number | null;
  /** epoch ms of the very first measured check, null = none yet */
  firstTs: number | null;
};
export type UptimeReport = {
  generatedAt: string;
  measured: boolean;
  targets: Record<UptimeTarget, TargetUptime>;
  /** failed-check runs in the last 30 days, newest first (at most 20) */
  outages: Outage[];
};

const n = (v: unknown) => Number(v) || 0;

async function load(): Promise<UptimeReport> {
  const now = Date.now();
  const t24 = now - WINDOWS["24h"], t7 = now - WINDOWS["7d"], t30 = now - WINDOWS["30d"];
  const [counts, failed, latest, lat] = await Promise.all([
    d1Query(
      `SELECT target, MIN(ts) AS first,
              SUM(ts >= ?) AS c24, SUM(ok * (ts >= ?)) AS u24, SUM(ts >= ?) AS c7, SUM(ok * (ts >= ?)) AS u7,
              COUNT(*) AS c30, SUM(ok) AS u30
         FROM uptime_checks WHERE ts >= ? GROUP BY target`,
      [t24, t24, t7, t7, t30],
    ),
    d1Query("SELECT target, ts FROM uptime_checks WHERE ok = 0 AND ts >= ? ORDER BY ts LIMIT 3000", [t30]),
    d1Query("SELECT target, ts, ok FROM uptime_checks u WHERE ts = (SELECT MAX(ts) FROM uptime_checks WHERE target = u.target)"),
    d1Query("SELECT target, ms FROM uptime_checks WHERE ok = 1 AND ts >= ? LIMIT 2000", [t24]),
  ]);

  const targets = {} as Record<UptimeTarget, TargetUptime>;
  const outages: Outage[] = [];
  for (const t of TARGETS as UptimeTarget[]) {
    const c = counts.find((r) => r.target === t);
    const first = c ? n(c.first) : null;
    targets[t] = {
      windows: {
        "24h": windowUptime({ checks: n(c?.c24), up: n(c?.u24), firstTs: first }, now, WINDOWS["24h"]),
        "7d": windowUptime({ checks: n(c?.c7), up: n(c?.u7), firstTs: first }, now, WINDOWS["7d"]),
        "30d": windowUptime({ checks: n(c?.c30), up: n(c?.u30), firstTs: first }, now, WINDOWS["30d"]),
      },
      p50: percentile(lat.filter((r) => r.target === t).map((r) => n(r.ms)), 50),
      p95: percentile(lat.filter((r) => r.target === t).map((r) => n(r.ms)), 95),
      firstTs: first,
    };
    const last = latest.find((r) => r.target === t);
    const list = outagesFrom(failed.filter((r) => r.target === t).map((r) => n(r.ts)), last ? { ts: n(last.ts), ok: n(last.ok) } : null, now);
    for (const o of list) outages.push({ target: t, ...o });
  }
  outages.sort((a, b) => b.start - a.start);
  return { generatedAt: new Date(now).toISOString(), measured: counts.length > 0, targets, outages: outages.slice(0, 20) };
}

const cached = unstable_cache(load, ["uptime-v1"], { revalidate: 300 });

/** The uptime report, or null when it can't be read (no D1 token, D1 slow, nothing recorded yet). Never throws. */
export async function getUptime(): Promise<UptimeReport | null> {
  if (!d1Configured()) return null;
  const r = await timeBox(cached(), 2500);
  return r && r.measured ? r : null;
}
