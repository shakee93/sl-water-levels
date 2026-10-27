// Colombo canal levels for the public site, read from our own D1 archive (written every 15 minutes by
// scripts/curw-snapshot.mjs from CUrW's public charts at pub.curwsl.org). Shown with credit "Canal levels: CUrW / SLLDC".
// Owner decision 26 Oct 2026: the charts are published on a public site, we wrote to CUrW (23 Oct), and we will talk if
// they object. Everything fails soft: when D1 is slow or unset the callers show nothing, never an error.
import { unstable_cache } from "next/cache";
import { d1Configured, d1Query } from "./d1";
import { soft } from "./soft";
import { assessCanal, seaTrend, type Assessment, type Pt } from "./curwStatus";

/** Time the page waits for the canal read before leaving the block out. */
export const CANAL_BUDGET_MS = 1500;

export type CanalGauge = Assessment & {
  name: string;
  group: string;
  /** Last 24 h, about hourly. */
  series: Pt[];
};
export type Canals = { fetchedAt: number; gauges: CanalGauge[]; sea: { level: number | null; trend: "rising" | "falling" | "steady" | null; observedMs: number | null } };

type Row = { station: string; grp: string; ms: number; m: number };

async function load(): Promise<Canals> {
  const now = Date.now();
  // One ready-made row per gauge, built by scripts/curw-snapshot.mjs every 15 min (hourly for 7 days + the newest 3 h in full).
  // Scanning curw_levels here instead read the whole archive on every refresh and used up D1's daily read limit (26 Oct 2026).
  const [series, status] = await Promise.all([d1Query("SELECT station, grp, pts FROM curw_series"), d1Query("SELECT station, status FROM curw_status")]);
  const rows: Row[] = [];
  for (const s of series) {
    let pts: [number, number][] = [];
    try {
      pts = JSON.parse(String(s.pts));
    } catch {
      /* skip a damaged row */
    }
    for (const [ms, m] of pts) rows.push({ station: String(s.station), grp: String(s.grp), ms, m });
  }
  const off = new Set(status.filter((s) => s.status !== "ok").map((s) => String(s.station)));
  const by = new Map<string, { group: string; pts: Pt[] }>();
  for (const r of rows) {
    const g = by.get(r.station) ?? { group: r.grp, pts: [] };
    g.pts.push({ ms: Number(r.ms), m: Number(r.m) });
    by.set(r.station, g);
  }
  for (const s of status) if (!by.has(String(s.station))) by.set(String(s.station), { group: "", pts: [] });
  const gauges: CanalGauge[] = [...by].map(([name, g]) => ({
    name,
    group: g.group,
    ...assessCanal(name, g.pts, now, off.has(name)),
    series: g.pts.filter((p) => p.ms > now - 24 * 3_600_000 && p.ms % 3_600_000 < 900_000),
  }));
  const mut = by.get("Mutwal Inlet")?.pts ?? [];
  const mg = gauges.find((x) => x.name === "Mutwal Inlet");
  return { fetchedAt: now, gauges, sea: { level: mg && mg.state !== "offline" ? mg.level : null, trend: mg && mg.state !== "offline" ? seaTrend(mut) : null, observedMs: mg?.observedMs ?? null } };
}

const cached = unstable_cache(load, ["curw-canals-v1"], { revalidate: 300 });

/** null when D1 is unset, slow or empty. */
export async function getCanals(budgetMs = CANAL_BUDGET_MS): Promise<Canals | null> {
  if (!d1Configured()) return null;
  const c = await soft(cached().catch(() => null), budgetMs, null);
  return c && c.gauges.length ? c : null;
}
