// Rain per river gauge, from the three sources kept apart so no page mistakes one for another (lib/rainWords.ts has the words):
//   measured  : what the gauge's own sensor recorded (and the gauges upstream of it on the same river); null when it has no sensor
//   satellite : JAXA GSMaP over the catchment above the gauge (an estimate; over-reads in the dry zone)
//   forecast  : the weather model (Open-Meteo) over the same catchment, for the next hours; its "past" hours are a model estimate
//               and are never shown as what fell
// Used by /api/levels (the `rain` block), /api/rain (the archive job), river pages, Needs attention, the X reply facts.
import { unstable_cache } from "next/cache";
import { BASIN_ORDER, normaliseBasin } from "./basinOrder";
import { getGsmap, type GsmapFile } from "./gsmap";
import { gaugeRainNow, measuredInWindow, tripped, type RainRow } from "./measuredRain";
import { rainTriggersFor } from "./rainTriggers";
import { stationDisplayName } from "./displayName";
import { noRainSensor } from "./rainSensors";
import { rainWord } from "./rainWords";
import { getBasinWeather, hasCatchment } from "./weather";
import { getNational, type NationalStation } from "./arcgis";

const HOUR = 3_600_000;
const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

export type Measured = { mm1h: number | null; mm3h: number | null; mm24h: number | null; endTs: number };

/** Rain measured at one gauge up to its newest reading; null when it has no sensor, no reading, or the reading is older than 2 h. */
export function measuredAtGauge(station: string, rows: RainRow[], now = Date.now()): Measured | null {
  if (noRainSensor(station)) return null;
  const g = gaugeRainNow(station, rows, now);
  if (!g) return null;
  return { mm1h: g.mm1h, mm3h: g.mm3h, mm24h: measuredInWindow(rows, g.endTs, 24), endTs: g.endTs };
}

/** The gauge on this river, at or above `station`, that measured the most in 24 h (null when none has fresh data). */
export function heaviestUpstream(all: Pick<NationalStation, "station" | "basin" | "trend24h">[], basin: string, station: string, now = Date.now()): { gauge: string } & Measured | null {
  const order = BASIN_ORDER[normaliseBasin(basin)] ?? [];
  const i = order.indexOf(station);
  const chain = i >= 0 ? order.slice(0, i + 1) : [station];
  let best: ({ gauge: string } & Measured) | null = null;
  for (const g of chain) {
    const s = all.find((x) => x.station === g && x.basin.trim() === basin.trim());
    if (!s) continue;
    const m = measuredAtGauge(g, s.trend24h, now);
    if (m && (m.mm24h ?? 0) >= (best?.mm24h ?? -1)) best = { gauge: g, ...m };
  }
  return best;
}

/**
 * Heaviest measured rain on one river that reached the gauge's flood trigger (per-gauge threshold when lib/model/rain-thresholds.json
 * has one, else 25 mm / 1 h or 40 mm / 3 h), for the Needs attention badge. null = none, or no gauge has a fresh rain reading.
 */
export function heavyMeasuredOnRiver(all: Pick<NationalStation, "station" | "basin" | "trend24h">[], basin: string, now = Date.now()): { gaugeName: string; hours: 1 | 3; mm: number; local: boolean } | null {
  let best: { gaugeName: string; hours: 1 | 3; mm: number; local: boolean; score: number } | null = null;
  for (const s of all) {
    if (s.basin.trim() !== basin.trim() || noRainSensor(s.station)) continue;
    const g = gaugeRainNow(s.station, s.trend24h, now);
    if (!g) continue;
    const tr = rainTriggersFor(s.station);
    const hit = tripped(g, tr);
    if (hit && (!best || (g.mm3h ?? 0) > best.score)) best = { gaugeName: stationDisplayName(s.station), hours: hit.hours, mm: hit.mm, local: tr.local, score: g.mm3h ?? 0 };
  }
  return best ? { gaugeName: best.gaugeName, hours: best.hours, mm: best.mm, local: best.local } : null;
}

export type ForecastRain = {
  /** Hour boundary the forecast counts from (ms). */
  issuedAt: number;
  next6h: number | null;
  next6hP90: number | null;
  next24h: number | null;
  next24hP90: number | null;
  /** The weather model's own estimate of what fell: NOT a measurement. */
  modelPast6h: number | null;
  modelPast24h: number | null;
};

const sum = (r: Record<number, number> | undefined, fromExcl: number, hours: number): number | null => {
  if (!r) return null;
  let s = 0;
  for (let k = 1; k <= hours; k++) {
    const v = r[fromExcl + k * HOUR];
    if (v == null) return null;
    s += v;
  }
  return s;
};

/** Forecast rain for one catchment from the cached weather fetch; null when there is no grid or the fetch failed. */
export async function forecastRainFor(basin: string, station: string, now = Date.now()): Promise<ForecastRain | null> {
  if (!hasCatchment(basin, station)) return null;
  const w = await getBasinWeather(basin, station, now);
  if (!w.ok) return null;
  const d = w.data;
  return {
    issuedAt: d.nowHour,
    next6h: sum(d.rain, d.nowHour, 6),
    next6hP90: sum(d.scenarios?.p90, d.nowHour, 6),
    next24h: d.next24hMm.det,
    next24hP90: d.next24hMm.p90,
    modelPast6h: d.past6hMm,
    modelPast24h: d.past24hMm,
  };
}

/** Forecast rain for every gauge with a rain grid, keyed "Basin/Station". Cached 30 min like the forecast itself; never throws. */
export const getForecastRainAll = unstable_cache(
  async (): Promise<Record<string, ForecastRain>> => {
    const all = await getNational();
    const out: Record<string, ForecastRain> = {};
    const list = all.filter((s) => hasCatchment(s.basin, s.station));
    for (let i = 0; i < list.length; i += 8) {
      await Promise.all(
        list.slice(i, i + 8).map(async (s) => {
          try {
            const f = await forecastRainFor(s.basin, s.station);
            if (f) out[`${s.basin.trim()}/${s.station}`] = f;
          } catch {
            /* one catchment failing leaves it out */
          }
        }),
      );
    }
    return out;
  },
  ["forecast-rain-all-v1"],
  { revalidate: 1800 },
);

/** The `rain` block of /api/levels for one gauge. Every field is null when unknown (never 0 for "not measured"). */
export function rainBlock(s: Pick<NationalStation, "station" | "basin" | "trend24h">, sat: GsmapFile | null, fc: Record<string, ForecastRain> | null, now = Date.now()) {
  const key = `${s.basin.trim()}/${s.station}`;
  const sensor = !noRainSensor(s.station);
  const m = measuredAtGauge(s.station, s.trend24h, now);
  const g = sat?.stations[key] ?? null;
  const f = fc?.[key] ?? null;
  const sources = [m ? "gauge" : null, g ? "satellite (JAXA GSMaP)" : null, f ? "forecast model (Open-Meteo)" : null].filter((x): x is string => !!x);
  return {
    sensor,
    fallen_1h_mm: r1(m?.mm1h ?? null),
    fallen_3h_mm: r1(m?.mm3h ?? null),
    fallen_24h_mm: r1(m?.mm24h ?? null),
    fallen_24h_word: rainWord("24h", m?.mm24h ?? null),
    satellite_6h_mm: r1(g?.mm6h ?? null),
    satellite_24h_mm: r1(g?.mm24h ?? null),
    forecast_6h_mm: r1(f?.next6h ?? null),
    forecast_24h_mm: r1(f?.next24h ?? null),
    forecast_24h_heavier_mm: r1(f?.next24hP90 ?? null),
    forecast_24h_word: rainWord("24h", f?.next24h ?? null),
    sources,
  };
}
export type RainBlock = ReturnType<typeof rainBlock>;

export async function loadSatellite(): Promise<GsmapFile | null> {
  return getGsmap().catch(() => null);
}
