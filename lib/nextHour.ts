// The next-hour forecast as plain data, for the JSON API, the MCP tools, llms.txt and the sentences on
// the station, river and town pages. One definition of "next hour" so every surface says the same thing
// as the forecast card: the 1 h point of lib/forecast.ts, shown in feet, with its range.
//
// Fetching is cached per river (5 min) and always time-boxed by the caller: a slow forecast must never
// hold back a page or an API answer, it just leaves the next-hour part out.
import { unstable_cache } from "next/cache";
import { after } from "next/server";
import { fetchBasinSnapshot, getNational } from "./arcgis";
import { loadForecast, type Forecast } from "./forecast";
import { rainRiskLine, type RainRisk } from "./rainRisk";
import { FT_IN_M, toShown, type Unit } from "./units";
import { STEADY_M_PER_H } from "./forecastRules.mjs";

const SLOW_M_PER_H = 0.05;
const r2 = (v: number) => Math.round(v * 100) / 100;

export type NextHour = {
  /** Expected level in about an hour, feet. */
  level_ft: number;
  /** Range the level is expected to stay inside (80%); null for the simple trend estimate, which has none. */
  low_ft: number | null;
  high_ft: number | null;
  /** Expected change over the hour, feet. */
  change_ft: number;
  direction: "rising" | "falling" | "steady";
  /** True when the rise is gentle (under about 0.16 ft an hour). */
  slow: boolean;
  /** "may reach alert level" etc., only when the range reaches a flood mark within the hour; else null. */
  crossing: string | null;
  /** The reading the forecast starts from (ISO 8601). The hour counts from here. */
  issuedAt: string;
  /** "model" = fitted on upstream gauges and rain; "trend" = recent change carried forward. */
  method: "model" | "trend";
  /** True while the forecast is still new and its ranges are widened. */
  experimental: boolean;
  /**
   * Heavy rain forecast over the hills above the gauge in the next 24 hours (lib/rainRisk.ts), else null. When set, the river may
   * rise faster than the forecast line: level "heavy" = 50 mm or more forecast, "very-heavy" = 100 mm or more, "possible" = only the
   * heavier ensemble scenario reaches 100 mm.
   */
  rainRisk: {
    /** What fired: the rain forecast, rain the gauges measured, or both. */
    kind: "forecast" | "measured" | "both";
    level: RainRisk["level"] | null;
    mm_24h: number | null;
    forecast_mm_24h: number | null;
    heavier_scenario_mm_24h: number | null;
    /** Rain the gauges measured (this gauge or one upstream): mm in the last `hours` hours at `gauge`. null when only the forecast fired. */
    measured: { gauge: string; upstream: boolean; hours: 1 | 3; mm: number } | null;
    /** The plain sentence shown beside the chart (English). */
    line: string;
  } | null;
};

const MARK: Record<string, string> = { alert: "alert level", minor: "minor flood level", major: "major flood level" };

/** The 1 h point of a forecast in feet, or null when there is none (stale gauge, unknown unit, no forecast). */
export function nextHourOf(f: Forecast): NextHour | null {
  const h1 = f.horizons.find((h) => h.h === 1);
  const unit: Unit = f.unit;
  if (!h1 || f.currentLevel == null || f.asOfTs == null || f.status === "unavailable" || f.method === "none" || unit == null) return null;
  const mpu = unit === "m" ? 1 : FT_IN_M;
  const dM = (h1.level - f.currentLevel) * mpu;
  const direction = Math.abs(dM) < STEADY_M_PER_H ? "steady" : dM < 0 ? "falling" : "rising";
  const hi = h1.high ?? h1.level;
  let crossing: string | null = null;
  for (const c of [...f.crossings].sort((a, b) => a.level - b.level)) {
    if (f.currentLevel >= c.level) continue;
    if (hi >= c.level) {
      crossing = `${h1.level >= c.level ? "expected to reach" : "may reach"} ${MARK[c.threshold]}`;
      break;
    }
  }
  return {
    level_ft: r2(toShown(h1.level, unit)),
    low_ft: h1.low == null ? null : r2(toShown(h1.low, unit)),
    high_ft: h1.high == null ? null : r2(toShown(h1.high, unit)),
    change_ft: r2(toShown(h1.level - f.currentLevel, unit)),
    direction,
    slow: direction === "steady" || Math.abs(dM) < SLOW_M_PER_H,
    crossing,
    issuedAt: new Date(f.asOfTs).toISOString(),
    method: f.method,
    experimental: f.experimental,
    rainRisk: f.rainRisk
      ? {
          kind: f.rainRisk.kind ?? "forecast",
          level: f.rainRisk.kind === "measured" ? null : f.rainRisk.level,
          mm_24h: f.rainRisk.kind === "measured" ? null : f.rainRisk.mm,
          forecast_mm_24h: f.rainRisk.detMm == null ? null : Math.round(f.rainRisk.detMm),
          heavier_scenario_mm_24h: f.rainRisk.p90Mm == null ? null : Math.round(f.rainRisk.p90Mm),
          measured: f.rainRisk.measured ? { gauge: f.rainRisk.measured.gaugeName, upstream: f.rainRisk.measured.upstream, hours: f.rainRisk.measured.hours, mm: f.rainRisk.measured.mm } : null,
          line: rainRiskLine(f.rainRisk, "en"),
        }
      : null,
  };
}

/** Next hour for every gauge on one river, keyed by gauge name. Cached 5 min; never throws. */
const cachedBasin = unstable_cache(
  async (basin: string): Promise<Record<string, NextHour | null>> => {
    const snap = await fetchBasinSnapshot(basin);
    const out: Record<string, NextHour | null> = {};
    await Promise.all(
      snap.map(async (s) => {
        try {
          out[s.station] = s.latest ? nextHourOf(await loadForecast(basin, snap, s.station)) : null;
        } catch {
          out[s.station] = null;
        }
      }),
    );
    return out;
  },
  ["next-hour-basin-v2"],
  { revalidate: 300 },
);

export const getNextHourForBasin = (basin: string) => cachedBasin(basin.trim());

/** Next hour for the gauges on these rivers, keyed by gauge name. */
export async function getNextHourForBasins(basins: string[]): Promise<Record<string, NextHour | null>> {
  const parts = await Promise.all([...new Set(basins.map((b) => b.trim()))].map((b) => getNextHourForBasin(b).catch(() => ({}) as Record<string, NextHour | null>)));
  return Object.assign({}, ...parts);
}

/** Next hour for every gauge, keyed by gauge name. */
export async function getNextHourAll(): Promise<Record<string, NextHour | null>> {
  return getNextHourForBasins((await getNational()).map((s) => s.basin));
}

/**
 * Wait up to `ms` for `p`; null when it is slower or fails. A slow computation keeps running in the
 * background (after()) so the cache is warm for the next visitor.
 */
export async function timeBox<T>(p: Promise<T>, ms = 1500): Promise<T | null> {
  const safe = p.catch(() => null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  const got = await Promise.race([safe, slow]);
  clearTimeout(timer);
  if (got === null) {
    try {
      after(() => safe);
    } catch {
      /* outside a request: nothing to keep alive */
    }
  }
  return got;
}
