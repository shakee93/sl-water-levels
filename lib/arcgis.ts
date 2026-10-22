import { cache } from "react";
import { unstable_cache } from "next/cache";
import {
  ageMinutes,
  HOUR_MS,
  metresPerUnit,
  rainTotal,
  rate,
  sanitizeLevel,
  sanitizeRain,
  sanitizeThresholds,
  type Reading,
  type Thresholds,
} from "./readings";
import { levelTier, statusFor, type Tier } from "./status";
import { basinPath, basinSlug, stationPath } from "./slug";
import { detectUnit, type Unit } from "./units";

export { statusFor } from "./status";
export type { Status, StatusTone, Tier } from "./status";
export type { Reading, Thresholds } from "./readings";

const SERVICES = "https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services";
const PAGE_SIZE = 1000; // layer maxRecordCount
const MAX_PAGES = 20;

export type Station = {
  basin: string;
  station: string;
  latitude: number;
  longitude: number;
};

export type StationData = {
  station: string;
  basin: string;
  thresholds: Thresholds;
  readings: Reading[];
  latest: Reading | null;
};

type ArcgisPage = {
  features: { attributes: Record<string, unknown> }[];
  exceededTransferLimit?: boolean;
};

// ArcGIS answers rate-limits ("Too many requests.") with HTTP 200 and an
// {error:{...}} body. Next's fetch cache would store that as a success for the
// full revalidate window, so the request is made INSIDE unstable_cache and
// validated before returning: a throw is never cached, and a previously cached
// good value keeps being served while a refresh fails.
const fetchPage = unstable_cache(
  async (url: string): Promise<ArcgisPage> => {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 600));
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`ArcGIS -> HTTP ${r.status}`);
        const json = (await r.json()) as ArcgisPage & { error?: { code?: number; message?: string } };
        if (json.error) {
          throw new Error(`ArcGIS error ${json.error.code ?? ""}: ${json.error.message ?? "unknown"}`.trim());
        }
        if (!Array.isArray(json.features)) throw new Error("ArcGIS response had no features");
        return { features: json.features, exceededTransferLimit: json.exceededTransferLimit };
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastErr ?? new Error("ArcGIS request failed");
  },
  ["arcgis-page"],
  { revalidate: 60 },
);

function queryUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`${SERVICES}/${path}`);
  url.searchParams.set("f", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/**
 * Run a query and page through `exceededTransferLimit` until exhausted.
 * Callers MUST pass a deterministic `orderByFields` (ideally with a unique
 * tie-breaker) or pages can overlap/skip rows.
 */
async function arcgis(path: string, params: Record<string, string>): Promise<ArcgisPage["features"]> {
  const out: ArcgisPage["features"] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchPage(
      queryUrl(path, {
        ...params,
        resultRecordCount: String(PAGE_SIZE),
        resultOffset: String(page * PAGE_SIZE),
      }),
    );
    out.push(...res.features);
    if (!res.exceededTransferLimit || res.features.length === 0) break;
  }
  return out;
}

export function cleanName(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

export const fetchStations = cache(async (): Promise<Station[]> => {
  const features = await arcgis("hydrostations/FeatureServer/0/query", {
    where: "1=1",
    outFields: "basin,station,latitude,longitude",
    returnGeometry: "false",
    orderByFields: "basin ASC, station ASC, objectid ASC",
  });
  const seen = new Set<string>();
  return features
    .map((f) => ({
      basin: cleanName(f.attributes.basin),
      station: cleanName(f.attributes.station),
      latitude: Number(f.attributes.latitude),
      longitude: Number(f.attributes.longitude),
    }))
    .filter((s) => {
      // A station with no basin has no routable /basin/station URL.
      if (!s.station || !s.basin) return false;
      const k = `${s.basin}|${s.station}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
});

type RawGauge = {
  gauge?: string;
  basin?: string;
  water_level?: number | null;
  rain_fall?: number | null;
  CreationDate?: number;
  alertpull?: number | null;
  minorpull?: number | null;
  majorpull?: number | null;
};

const GAUGE_FIELDS = "gauge,basin,water_level,rain_fall,CreationDate,alertpull,minorpull,majorpull";

// Sanitising happens exactly once, here: sentinel levels become null, bad rain
// becomes null, thresholds <= 0 become null.
function toReading(a: RawGauge): Reading {
  return {
    ts: Number(a.CreationDate),
    water_level: sanitizeLevel(a.water_level),
    rain_fall: sanitizeRain(a.rain_fall),
  };
}

function toThresholds(a: RawGauge): Thresholds {
  return sanitizeThresholds({
    alert: a.alertpull ?? null,
    minor: a.minorpull ?? null,
    major: a.majorpull ?? null,
  });
}

/** Per-gauge history for the long chart. gauges_2_view only retains ~7 days. */
export async function fetchStationData(stationName: string, days = 4): Promise<StationData> {
  const features = await arcgis("gauges_2_view/FeatureServer/0/query", {
    where: `gauge='${stationName.replace(/'/g, "''")}'`,
    outFields: GAUGE_FIELDS,
    orderByFields: "CreationDate DESC, objectid DESC",
    returnGeometry: "false",
  });

  const cutoff = Date.now() - days * 24 * HOUR_MS;
  const rows = features.map((f) => f.attributes as RawGauge).filter((a) => Number.isFinite(a.CreationDate));
  const newest = rows[0] ?? null;

  const readings = rows
    .filter((a) => (a.CreationDate as number) >= cutoff)
    .map(toReading)
    .sort((a, b) => a.ts - b.ts);

  return {
    station: stationName,
    basin: cleanName(newest?.basin),
    thresholds: newest ? toThresholds(newest) : { alert: null, minor: null, major: null },
    readings,
    latest: newest ? toReading(newest) : null,
  };
}

// ---------------------------------------------------------------------------
// National snapshot
// ---------------------------------------------------------------------------

export type NationalStation = {
  station: string;
  basin: string;
  latitude: number;
  longitude: number;
  /** Site-relative links; basin-less stations can't exist (filtered upstream). */
  href: string;
  basinHref: string;
  /** "ft" | "m" | null (ambiguous: no label should be shown). */
  unit: Unit;
  /** Metres per station unit, for comparing rates across gauges. Heuristic when unit is null. */
  metresPerUnit: number;
  thresholds: Thresholds;
  /** Latest reading that has a valid water level; null = gauge has no data. */
  latest: Reading | null;
  /** Minutes since `latest`; null when no data. */
  ageMin: number | null;
  /** Freshness-aware tier (stale beats everything). */
  tier: Tier;
  /** Tier from the level alone, ignoring freshness (for "last known" displays). */
  levelTier: Tier;
  /** Change per hour in station units / metres, anchored to `latest.ts`. */
  rate1h: number | null;
  rate3h: number | null;
  rate1hM: number | null;
  rate3hM: number | null;
  /** Rain over the 6h ending at `latest.ts`; null = no rain data (not zero). */
  rain6h: number | null;
  /** Last 24h of readings up to `latest.ts`, ascending. */
  trend24h: Reading[];
};

const NATIONAL_HOURS = 26;
const BUCKET_MS = 5 * 60_000;

function fmtArcgisUtc(ms: number): string {
  // ArcGIS TIMESTAMP literals on this service are interpreted as UTC.
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

function buildNational(station: Station, rows: RawGauge[]): NationalStation {
  const readings = rows
    .filter((a) => Number.isFinite(a.CreationDate))
    .map((a) => ({ raw: a, r: toReading(a) }))
    .sort((a, b) => a.r.ts - b.r.ts);

  const withLevel = readings.filter((x) => x.r.water_level != null);
  const latest = withLevel.length ? withLevel[withLevel.length - 1].r : null;
  const newestRaw = readings.length ? readings[readings.length - 1].raw : null;
  const thresholds = newestRaw ? toThresholds(newestRaw) : { alert: null, minor: null, major: null };

  const series = readings.map((x) => x.r);
  const anchor = latest?.ts ?? null;
  const trend24h = anchor != null ? series.filter((r) => r.ts >= anchor - 24 * HOUR_MS && r.ts <= anchor) : [];

  const unit = detectUnit(thresholds, station.station);
  const mpu = metresPerUnit(unit, thresholds);
  // Cadence is ~hourly with some jitter, so the "1h"/"3h" windows get +15min
  // so the reading one cadence back is reliably inside the window.
  const rate1h = anchor != null ? rate(series, { hours: 1.25, anchor }) : null;
  const rate3h = anchor != null ? rate(series, { hours: 3.25, anchor }) : null;

  const status = statusFor(latest?.water_level ?? null, thresholds, latest?.ts ?? null);

  return {
    station: station.station,
    basin: station.basin,
    latitude: station.latitude,
    longitude: station.longitude,
    href: stationPath(station.basin, station.station),
    basinHref: basinPath(station.basin),
    unit,
    metresPerUnit: mpu,
    thresholds,
    latest,
    ageMin: ageMinutes(latest),
    tier: status.tier,
    levelTier: levelTier(latest?.water_level ?? null, thresholds),
    rate1h,
    rate3h,
    rate1hM: rate1h == null ? null : rate1h * mpu,
    rate3hM: rate3h == null ? null : rate3h * mpu,
    rain6h: anchor != null ? rainTotal(series, 6, anchor) : null,
    trend24h,
  };
}

/**
 * Every station (all hydrostations, including ones with no gauge rows, which
 * come back with latest=null / tier "stale") merged with the last ~26h of
 * gauge readings. One paged query (~1040 rows = 2 pages), sanitized, with a 60s
 * data cache (per page) and React.cache de-duplication per request.
 *
 * Order follows fetchStations (basin, station).
 */
export const getNational = cache(async (): Promise<NationalStation[]> => {
  // Bucket the cutoff: a per-second timestamp in the URL would defeat the 60s cache.
  const cutoff = Math.floor((Date.now() - NATIONAL_HOURS * HOUR_MS) / BUCKET_MS) * BUCKET_MS;
  const [stations, features] = await Promise.all([
    fetchStations(),
    arcgis("gauges_2_view/FeatureServer/0/query", {
      where: `CreationDate >= TIMESTAMP '${fmtArcgisUtc(cutoff)}'`,
      outFields: GAUGE_FIELDS,
      orderByFields: "CreationDate DESC, objectid DESC",
      returnGeometry: "false",
    }),
  ]);

  const byGauge = new Map<string, RawGauge[]>();
  for (const f of features) {
    const a = f.attributes as RawGauge;
    const k = cleanName(a.gauge);
    if (!k) continue;
    const list = byGauge.get(k);
    if (list) list.push(a);
    else byGauge.set(k, [a]);
  }

  return stations.map((s) => buildNational(s, byGauge.get(s.station) ?? []));
});

// ---------------------------------------------------------------------------
// Basin snapshot (derived from getNational)
// ---------------------------------------------------------------------------

export type BasinStation = NationalStation & {
  /** Reading ~3h before `latest` (1-5h window), for legacy delta displays. */
  prior: Reading | null;
};

function priorOf(s: NationalStation): Reading | null {
  if (!s.latest) return null;
  const target = s.latest.ts - 3 * HOUR_MS;
  let best: Reading | null = null;
  for (const r of s.trend24h) {
    if (r.water_level == null) continue;
    const dt = s.latest.ts - r.ts;
    if (dt < HOUR_MS || dt > 5 * HOUR_MS) continue;
    if (!best || Math.abs(r.ts - target) < Math.abs(best.ts - target)) best = r;
  }
  return best;
}

/** Stations of one basin (matched on the trimmed name or its slug). */
export async function fetchBasinSnapshot(basinName: string): Promise<BasinStation[]> {
  const national = await getNational();
  const wantSlug = basinSlug(basinName);
  if (!wantSlug) return [];
  return national.filter((s) => basinSlug(s.basin) === wantSlug).map((s) => ({ ...s, prior: priorOf(s) }));
}
