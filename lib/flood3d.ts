// Live inputs for the unlisted 3D flood test map (/lab/flood-3d): the Nagalagam Street and Hanwella gauges now, and the
// forecast level with its 80% range at +0, +3 and +6 hours. Everything comes from our own cached readers (getNational,
// loadForecast, the HMIS cache); the browser calls /api/flood3d and nothing else, and no official step is touched here.
import { unstable_cache } from "next/cache";
import { buildHmisNational, fetchBasinSnapshot, getNational, type NationalStation } from "./arcgis";
import { timeBox } from "./nextHour";
import { composeLive } from "./flood3dCompose";
import hanRel from "@/public/flood3d/hanwella-nag.json";
import { loadForecast } from "./forecast";
import { levelRecord } from "./apiData";
import { getHmisLevels, HMIS_FAST, HMIS_GAUGES, fasterReading } from "./hmis";
import { toShown } from "./units";

const BASIN = "Kelani Ganga";
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Rough Hanwella (m) -> Nagalagam Street (ft) relation, fitted offline on the hourly archive (scripts/flood3d/fit-hanwella.py): Nagalagam is paired with
 * Hanwella `HANWELLA_LAG_H` hours EARLIER (Hanwella leads at high flows). Only used to turn a "what if Hanwella reaches X" slider into a Nagalagam stage;
 * the map always prefers Nagalagam's own level, and shows this as "rough".
 */
export const HANWELLA_M_TO_NAG_FT = hanRel.table as [number, number][];
export const HANWELLA_LAG_H = hanRel.lag_hours as number;

export type { Horizon, GaugeLive, MapGauge, Flood3dLive } from "./flood3dCompose";
import type { Horizon, Flood3dLive } from "./flood3dCompose";
/** Gauges drawn on the map: Kelani gauges in and around the corridor, whichever source (ArcGIS or the HMIS-only ones). */
export const GAUGE_BOX = { south: 6.8, north: 7.2, west: 79.75, east: 80.5 };

function at(hs: { h: number; level: number; low: number | null; high: number | null }[], h: number, now: number): Horizon | null {
  const exact = hs.find((x) => x.h === h);
  const pick = (x: (typeof hs)[number]) => ({ h, level: x.level, low: x.low, high: x.high });
  if (exact) return pick(exact);
  const a = [...hs].filter((x) => x.h < h).sort((p, q) => q.h - p.h)[0];
  const b = [...hs].filter((x) => x.h > h).sort((p, q) => p.h - q.h)[0];
  if (a && b) {
    const f = (h - a.h) / (b.h - a.h);
    const lerp = (p: number | null, q: number | null) => (p == null || q == null ? null : p + (q - p) * f);
    return { h, level: a.level + (b.level - a.level) * f, low: lerp(a.low, b.low), high: lerp(a.high, b.high) };
  }
  void now;
  return null;
}

/** The forecast horizons (+3 h, +6 h) of one gauge, in feet. Optional: null when slow or unavailable. */
async function horizonsOf(name: string): Promise<{ horizons: Horizon[]; method: string } | null> {
  try {
    const snap = await fetchBasinSnapshot(BASIN);
    const f = await timeBox(loadForecast(BASIN, snap, name), 2500); // never hold the answer for the forecast
    if (!f || f.status === "unavailable" || f.method === "none" || !f.unit) return null;
    const u = f.unit;
    const conv = (v: number | null) => (v == null ? null : r2(toShown(v, u)));
    const horizons = [3, 6].map((h) => at(f.horizons, h, Date.now())).filter((x): x is Horizon => !!x).map((x) => ({ h: x.h, level: conv(x.level)!, low: conv(x.low), high: conv(x.high) }));
    return { horizons, method: f.method };
  } catch {
    return null;
  }
}

/** The HMIS 10-minute sensor reading for a gauge (offset-corrected onto the hourly scale), only when newer than the hourly one. Optional. */
async function fastOf(s: NationalStation, device: string): Promise<{ ft: number; at: string } | null> {
  try {
    const levels = await getHmisLevels(1500);
    const dev = levels?.devices.find((d) => d.device === device);
    if (!dev || !s.latest) return null;
    const hourly = s.trend24h.filter((r) => r.water_level != null).map((r) => ({ ts: r.ts, m: r.water_level as number }));
    const fr = fasterReading(dev.series, hourly, Date.now());
    return fr && fr.ts > s.latest.ts ? { ft: r2(toShown(fr.m, "m")), at: new Date(fr.ts).toISOString() } : null; // HMIS gauges are metre gauges (as in app/FasterReading.tsx)
  } catch {
    return null;
  }
}

export const getFlood3dLive = unstable_cache(
  async (): Promise<Flood3dLive> => {
    // ONE read of the national snapshot (parallel reads were rate-limited by ArcGIS and left Nagalagam null while gauges were present).
    // If it fails or lacks Nagalagam, throw: the data cache then keeps serving its last good entry instead of caching an empty one.
    const national: NationalStation[] = [...(await getNational())];
    const now = Date.now();
    const have = new Set(national.map((x) => x.station));
    const missing = HMIS_GAUGES.filter((g) => g.basin === BASIN && !have.has(g.station));
    const [extra, nag, han] = await Promise.all([
      missing.length ? getHmisLevels(2500).catch(() => null) : Promise.resolve(null),
      horizonsOf("Nagalagam Street"),
      horizonsOf("Hanwella"),
    ]);
    for (const def of missing) { const dev = extra?.devices.find((d) => d.device === def.device); if (dev) national.push(buildHmisNational(def, dev)); }
    const hanS = national.find((x) => x.station === "Hanwella");
    const fastDev = HMIS_FAST.find((f) => f.station === "Hanwella")?.device ?? null;
    const fast = hanS && fastDev ? await fastOf(hanS, fastDev) : null;
    const live = composeLive(national, { now, nag, han, fast }, (x) => levelRecord(x, now), HANWELLA_M_TO_NAG_FT, HANWELLA_LAG_H, GAUGE_BOX, BASIN);
    if (!live) throw new Error("flood3d: snapshot has no Nagalagam Street");
    return live;
  },
  ["flood3d-live-v4"],
  { revalidate: 120 },
);

let lastGood: Flood3dLive | null = null;
/** Never a 503 and never a blank: the fresh answer when it arrives in time, else the last good one (marked stale, with its own timestamps), else an empty partial the client retries. */
export async function getFlood3dLiveSafe(): Promise<Flood3dLive> {
  const fresh = await timeBox(getFlood3dLive(), 4500); // null on a throw or when slower than 4.5 s
  if (fresh?.nagalagam) { lastGood = fresh; return fresh; }
  if (lastGood) return { ...lastGood, stale: true };
  return { generatedAt: new Date().toISOString(), nagalagam: null, hanwella: null, hanwellaToNag: HANWELLA_M_TO_NAG_FT, hanwellaLagH: HANWELLA_LAG_H, gauges: [], partial: true };
}
