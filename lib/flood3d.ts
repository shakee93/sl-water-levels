// Live inputs for the unlisted 3D flood test map (/lab/flood-3d): the Nagalagam Street and Hanwella gauges now, and the
// forecast level with its 80% range at +0, +3 and +6 hours. Everything comes from our own cached readers (getNational,
// loadForecast, the HMIS cache); the browser calls /api/flood3d and nothing else, and no official step is touched here.
import { unstable_cache } from "next/cache";
import { buildHmisNational, fetchBasinSnapshot, getNational, type NationalStation } from "./arcgis";
import { timeBox } from "./nextHour";
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

export type Horizon = { h: number; level: number; low: number | null; high: number | null };
export type GaugeLive = {
  station: string;
  levelFt: number | null;
  hourlyAt: string | null;
  marks: { alert: number | null; minor: number | null; major: number | null };
  status: string;
  trend: string | null;
  changePerHourFt: number | null;
  /** 10-minute HMIS sensor (offset-corrected onto the hourly gauge's scale), only when newer than the hourly reading. */
  fastFt: number | null;
  fastAt: string | null;
  horizons: Horizon[];
  method: string | null;
};
/** A river gauge for the map markers: official step, level and trend straight from levelRecord (the same words as the gauge pages). */
export type MapGauge = { name: string; lat: number; lon: number; levelFt: number | null; status: string; statusLabel: string; trend: string | null; observedAt: string | null; url: string; fastFt: number | null; fastAt: string | null };
export type Flood3dLive = { generatedAt: string; nagalagam: GaugeLive | null; hanwella: GaugeLive | null; hanwellaToNag: [number, number][]; hanwellaLagH: number; gauges: MapGauge[]; /** true when this is the last good answer because the sources were slow */ stale?: boolean; /** true when nothing could be read in time: the client tries again soon */ partial?: boolean };
/** Gauges drawn on the map: Kelani gauges in and around the corridor, whichever source (ArcGIS or the HMIS-only ones). */
const GAUGE_BOX = { south: 6.8, north: 7.2, west: 79.75, east: 80.5 };

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

async function gauge(name: string, fastDevice: string | null): Promise<GaugeLive | null> {
  const national = await getNational();
  const s = national.find((x) => x.station === name);
  if (!s) return null;
  const rec = levelRecord(s, Date.now());
  let horizons: Horizon[] = [];
  let method: string | null = null;
  try {
    const snap = await fetchBasinSnapshot(BASIN);
    const f = await timeBox(loadForecast(BASIN, snap, name), 2500); // never hold the answer for the forecast
    if (!f) throw new Error("forecast slow");
    if (f.status !== "unavailable" && f.method !== "none" && f.unit) {
      method = f.method;
      const u = f.unit;
      const conv = (v: number | null) => (v == null ? null : r2(toShown(v, u)));
      const hs = f.horizons;
      horizons = [3, 6].map((h) => at(hs, h, Date.now())).filter((x): x is Horizon => !!x).map((x) => ({ h: x.h, level: conv(x.level)!, low: conv(x.low), high: conv(x.high) }));
    }
  } catch {
    /* forecast is optional */
  }
  let fastFt: number | null = null;
  let fastAt: string | null = null;
  if (fastDevice) {
    try {
      const levels = await getHmisLevels(1500);
      const dev = levels?.devices.find((d) => d.device === fastDevice);
      if (dev && s.latest) {
        const hourly = s.trend24h.filter((r) => r.water_level != null).map((r) => ({ ts: r.ts, m: r.water_level as number }));
        const fr = fasterReading(dev.series, hourly, Date.now());
        if (fr && fr.ts > s.latest.ts) {
          fastFt = r2(toShown(fr.m, "m")); // HMIS gauges are metre gauges (same assumption as app/FasterReading.tsx)
          fastAt = new Date(fr.ts).toISOString();
        }
      }
    } catch {
      /* HMIS slow or down: hourly only */
    }
  }
  return { station: name, levelFt: rec.level, hourlyAt: rec.observedAt, marks: rec.marks, status: rec.status, trend: rec.trend, changePerHourFt: rec.changePerHour3h, fastFt, fastAt, horizons, method };
}

export const getFlood3dLive = unstable_cache(
  async (): Promise<Flood3dLive> => {
    const fast = HMIS_FAST.find((f) => f.station === "Hanwella")?.device ?? null;
    const [nagalagam, hanwella] = await Promise.all([gauge("Nagalagam Street", null).catch(() => null), gauge("Hanwella", fast).catch(() => null)]);
    const national: NationalStation[] = await getNational().catch(() => [] as NationalStation[]);
    const now = Date.now();
    // HMIS-only gauges of this river (Karawanella Bridge): getNational leaves them out when HMIS is slow, so read the HMIS cache directly
    const have = new Set(national.map((x) => x.station));
    const missing = HMIS_GAUGES.filter((g) => g.basin === BASIN && !have.has(g.station));
    if (missing.length) {
      const lv = await getHmisLevels(2500);
      for (const def of missing) { const dev = lv?.devices.find((d) => d.device === def.device); if (dev) national.push(buildHmisNational(def, dev)); }
    }
    const gauges: MapGauge[] = national
      .filter((x) => x.latitude >= GAUGE_BOX.south && x.latitude <= GAUGE_BOX.north && x.longitude >= GAUGE_BOX.west && x.longitude <= GAUGE_BOX.east && x.basin.trim() === BASIN)
      .map((x) => {
        const r = levelRecord(x, now);
        const fast = x.station === "Hanwella" ? hanwella : null;
        return { name: r.station, lat: x.latitude, lon: x.longitude, levelFt: r.level, status: r.status, statusLabel: r.statusLabel, trend: r.trend, observedAt: r.observedAt, url: r.url, fastFt: fast?.fastFt ?? null, fastAt: fast?.fastAt ?? null };
      });
    // an empty answer (ArcGIS rate-limited or slow) must not be cached for 2 minutes: throw, so the caller serves the last good one
    if (!nagalagam && gauges.length === 0) throw new Error("flood3d: no gauge data");
    return { generatedAt: new Date().toISOString(), nagalagam, hanwella, hanwellaToNag: HANWELLA_M_TO_NAG_FT, hanwellaLagH: HANWELLA_LAG_H, gauges };
  },
  ["flood3d-live-v3"],
  { revalidate: 120 },
);

let lastGood: Flood3dLive | null = null;
/** Never a 503: the fresh answer when it arrives in time, else the last good one (marked stale), else an empty partial the client retries. */
export async function getFlood3dLiveSafe(): Promise<Flood3dLive> {
  const fresh = await timeBox(getFlood3dLive(), 4500); // null on a throw or when slower than 4.5 s
  if (fresh && (fresh.nagalagam || fresh.gauges.length)) { lastGood = fresh; return fresh; }
  if (lastGood) return { ...lastGood, stale: true };
  return fresh ?? { generatedAt: new Date().toISOString(), nagalagam: null, hanwella: null, hanwellaToNag: HANWELLA_M_TO_NAG_FT, hanwellaLagH: HANWELLA_LAG_H, gauges: [], partial: true };
}
