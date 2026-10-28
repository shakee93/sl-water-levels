import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createHash } from "node:crypto";
import { d1Configured, d1Query } from "./d1";
import { soft } from "./soft";
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
import { noRainSensor } from "./rainSensors";
import { levelTier, statusFor, type Tier } from "./status";
import { basinPath, basinSlug, stationPath } from "./slug";
import { detectUnit, type Unit } from "./units";
import { getHmisLevels, HMIS_GAUGES, HMIS_GAUGE_BY_STATION, type HmisDevice, type HmisGaugeDef } from "./hmis";
import { getRivernetDevice, getRivernetLevels, RIVERNET_NEW, RIVERNET_TRIBUTARIES, RIVERNET_NEW_BY_STATION, type RivernetDevice, type RnNewDef } from "./rivernet";

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
// Back-off for this server instance: after a quota answer (429) no request goes to ArcGIS for a minute (their quota is per
// minute and shared by everyone using the Irrigation Department's data); pages keep the last good copy meanwhile.
let quotaUntil = 0;
// Who is asking, so the data owner can reach us if our requests ever bother them.
const UA = "sl-water-levels (+https://waterlevels.lk; shakee.zats@gmail.com)";

// Last good answer per query, kept in D1 so it survives deploys and cold servers. When ArcGIS refuses (quota) or fails, the
// page shows this instead of "Latest data unavailable" (26 Oct 2026: a deploy during a quota spell had an empty cache and the
// home page went blank while every other page had data). Written only on a cache miss that succeeded, so at most once per
// query per cache window. The time bucket in a query is ignored in the key: the previous window's answer is the fallback.
const LAST_GOOD_MAX_AGE_MS = 48 * 3_600_000;
const lastGoodKey = (url: string) => {
  let u = url;
  try {
    u = decodeURIComponent(url.replace(/\+/g, " "));
  } catch {
    /* keep raw */
  }
  return createHash("sha1").update(u.replace(/TIMESTAMP '[^']*'/g, "TS")).digest("hex");
};
async function saveLastGood(url: string, page: ArcgisPage): Promise<void> {
  if (!d1Configured()) return;
  const body = JSON.stringify(page);
  if (body.length > 900_000) return;
  await soft(
    d1Query("CREATE TABLE IF NOT EXISTS arcgis_last_good (k TEXT PRIMARY KEY, ts INTEGER NOT NULL, body TEXT NOT NULL)")
      .then(() => d1Query("INSERT INTO arcgis_last_good (k, ts, body) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET ts = excluded.ts, body = excluded.body", [lastGoodKey(url), Date.now(), body]))
      .then(() => undefined)
      .catch(() => undefined),
    2000,
    undefined,
  );
}
async function loadLastGood(url: string): Promise<ArcgisPage | null> {
  if (!d1Configured()) return null;
  const rows = await soft(d1Query("SELECT ts, body FROM arcgis_last_good WHERE k = ?", [lastGoodKey(url)]).catch(() => []), 3000, []);
  const r = rows[0];
  if (!r || Date.now() - Number(r.ts) > LAST_GOOD_MAX_AGE_MS) return null;
  try {
    return JSON.parse(String(r.body)) as ArcgisPage;
  } catch {
    return null;
  }
}

const fetchPageCached = unstable_cache(
  async (url: string): Promise<ArcgisPage> => {
    const fresh = await fetchFresh(url).catch(async (e: unknown) => {
      const lg = await loadLastGood(url);
      if (lg) return { ...lg, stale: true } as ArcgisPage;
      throw e;
    });
    if (!(fresh as ArcgisPage & { stale?: boolean }).stale) await saveLastGood(url, fresh);
    return fresh;
  },
  ["arcgis-page"],
  // 5 minutes (was 60 s until 26 Oct 2026): the Irrigation Department's ArcGIS org allows 3,000 request units a minute for
  // EVERYONE using its data and ran out on a flood afternoon. Gauges report hourly, so 5 min costs little freshness; the
  // background checker (workers/scheduler, every 5 min) still notices a new reading for X and push. Language versions of a
  // page share this cache: it is keyed by the query, not the page.
  { revalidate: 300 },
);

async function fetchFresh(url: string): Promise<ArcgisPage> {
    if (Date.now() < quotaUntil) throw new Error("ArcGIS error 429: backing off after a quota answer");
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 600));
      try {
        const r = await fetch(url, { headers: { "User-Agent": UA } });
        if (!r.ok) throw new Error(`ArcGIS -> HTTP ${r.status}`);
        const json = (await r.json()) as ArcgisPage & { error?: { code?: number; message?: string } };
        if (json.error) {
          const err = new Error(`ArcGIS error ${json.error.code ?? ""}: ${json.error.message ?? "unknown"}`.trim());
          // quota: retrying at once only spends more of the shared per-minute units (see revalidate below)
          if (json.error.code === 429) {
            quotaUntil = Date.now() + 60_000;
            lastErr = err;
            break;
          }
          throw err;
        }
        if (!Array.isArray(json.features)) throw new Error("ArcGIS response had no features");
        return { features: json.features, exceededTransferLimit: json.exceededTransferLimit };
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastErr ?? new Error("ArcGIS request failed");
}

// generateMetadata, the page and its Suspense children ask for the same URL at the same moment; on a
// cold data cache unstable_cache would run the request once per caller.
const inflight = new Map<string, Promise<ArcgisPage>>();
function fetchPage(url: string): Promise<ArcgisPage> {
  let p = inflight.get(url);
  if (!p) {
    p = fetchPageCached(url).finally(() => inflight.delete(url));
    inflight.set(url, p);
  }
  return p;
}

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
export async function arcgis(path: string, params: Record<string, string>): Promise<ArcgisPage["features"]> {
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
    })
    .concat(hmisStations())
    .concat(rivernetStations());
});

/** The gauges only HMIS has (lib/hmisCalc.ts HMIS_GAUGES): a fixed list, so their pages resolve even while HMIS is slow. */
function hmisStations(): Station[] {
  return HMIS_GAUGES.map((g) => ({ basin: g.basin, station: g.station, latitude: g.lat, longitude: g.lon }));
}

/** The gauges only RiverNet has (lib/rivernetCalc.ts RIVERNET_NEW): a fixed list, so their pages resolve even while RiverNet is slow. */
function rivernetStations(): Station[] {
  return RIVERNET_NEW.map((g) => ({ basin: g.basin, station: g.station, latitude: g.lat, longitude: g.lon }));
}

/** A RiverNet device as the rows the ArcGIS builders take (metres; RiverNet's own marks, none when it publishes none: never invented). */
function rivernetRows(def: RnNewDef, dev: RivernetDevice | undefined): RawGauge[] {
  const m = dev?.marks ?? def.marks;
  return (dev?.series ?? []).map((p) => ({ gauge: def.station, basin: def.basin, water_level: p.m, rain_fall: null, CreationDate: p.ts, alertpull: m?.alert ?? null, minorpull: m?.minor ?? null, majorpull: m?.major ?? null }));
}

/** An HMIS device as the rows the ArcGIS builders take (metres; thresholds from HMIS, else the saved copy). No rain (null, not zero). */
function hmisRows(def: HmisGaugeDef, dev: HmisDevice | undefined): RawGauge[] {
  const live = dev?.thresholds;
  const t = (k: "alert" | "minor" | "major") => live?.[k] ?? def.thresholds[k];
  return (dev?.series ?? []).map((p) => ({ gauge: def.station, basin: def.basin, water_level: p.m, rain_fall: null, CreationDate: p.ts, alertpull: t("alert"), minorpull: t("minor"), majorpull: t("major") }));
}

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
    // A gauge with a dead rain sensor reports a real 0 (lib/rainSensors.ts): that is "not measured", never "dry".
    rain_fall: noRainSensor(a.gauge) ? null : sanitizeRain(a.rain_fall),
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
  const rdef = RIVERNET_NEW_BY_STATION.get(stationName);
  if (rdef) {
    // RiverNet gauge: its last 24 h at 10-minute spacing, metres.
    const dev = await getRivernetDevice(rdef.key, 6000);
    if (!dev) throw new Error(`RiverNet has no reading for ${stationName} right now`);
    const n = buildRivernetNational(rdef, dev);
    return { station: stationName, basin: rdef.basin, thresholds: n.thresholds, readings: rivernetRows(rdef, dev).map(toReading).sort((a, b) => a.ts - b.ts), latest: n.latest };
  }
  const hdef = HMIS_GAUGE_BY_STATION.get(stationName);
  if (hdef) {
    // HMIS gauge: its last 24 h (HMIS keeps no more), metres.
    const hm = await getHmisLevels(4000);
    const dev = hm?.devices.find((d) => d.device === hdef.device);
    if (!dev) throw new Error(`HMIS has no reading for ${stationName} right now`);
    const n = buildHmisNational(hdef, dev);
    return { station: stationName, basin: hdef.basin, thresholds: n.thresholds, readings: hmisRows(hdef, dev).map(toReading).sort((a, b) => a.ts - b.ts), latest: n.latest };
  }
  let features: ArcgisPage["features"];
  try {
    features = await arcgis("gauges_2_view/FeatureServer/0/query", {
      where: `gauge='${stationName.replace(/'/g, "''")}'`,
      outFields: GAUGE_FIELDS,
      orderByFields: "CreationDate DESC, objectid DESC",
      returnGeometry: "false",
    });
  } catch (e) {
    // ArcGIS refused (quota) and this gauge's history has no saved copy yet: fall back to the all-gauges answer (last 26 h),
    // which every page shares and which has its own saved copy, so the page still shows the reading and the last day
    // instead of "Could not load this station" (26 Oct 2026, Dunamale during a quota spell).
    const s = (await getNational().catch(() => [] as NationalStation[])).find((x) => x.station === stationName);
    if (!s) throw e;
    return { station: stationName, basin: s.basin, thresholds: s.thresholds, readings: s.trend24h, latest: s.latest };
  }

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
  /** Where the readings come from. HMIS gauges (hmis.gov.lk, metres) are added beside the ArcGIS ones; absent = ArcGIS. */
  source?: "arcgis" | "hmis" | "rivernet";
  /** HMIS only: who runs the sensor (Irrigation Department / ACCIMT) and how often it reports. */
  institute?: string;
  cadenceMin?: number;
  /** RiverNet only: newest reading time of a gauge that is not reporting (real UTC ms), for "not reporting since". */
  lastSeenTs?: number;
  /** A tributary of this river (RiverNet): listed apart from the main stem, never upstream of it. */
  tributary?: boolean;
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

  const arc = stations.filter((s) => !HMIS_GAUGE_BY_STATION.has(s.station) && !RIVERNET_NEW_BY_STATION.has(s.station)).map((s) => buildNational(s, byGauge.get(s.station) ?? []));
  // HMIS-only gauges, merged as an extra source. Left out entirely while HMIS is slow or down (callers see the ArcGIS gauges, as before).
  const [hmis, rn] = await Promise.all([getHmisLevels(1500), getRivernetLevels(3000)]);
  const extra: NationalStation[] = [];
  if (hmis) {
    for (const def of HMIS_GAUGES) {
      const dev = hmis.devices.find((d) => d.device === def.device);
      if (!dev) continue;
      extra.push(buildHmisNational(def, dev));
    }
  }
  // RiverNet-only gauges (rivernet.lk, credit in the UI), likewise left out while RiverNet is slow, down or switched off.
  if (rn) {
    for (const def of RIVERNET_NEW) {
      const dev = rn.devices.find((d) => d.key === def.key);
      if (!dev) continue;
      extra.push(buildRivernetNational(def, dev));
    }
  }
  return extra.length ? [...arc, ...extra] : arc;
});

export function buildHmisNational(def: HmisGaugeDef, dev: HmisDevice): NationalStation {
  const st = { basin: def.basin, station: def.station, latitude: def.lat, longitude: def.lon };
  const n = buildNational(st, hmisRows(def, dev));
  return { ...n, source: "hmis", institute: def.institute, cadenceMin: def.cadenceMin };
}

export function buildRivernetNational(def: RnNewDef, dev: RivernetDevice): NationalStation {
  const st = { basin: def.basin, station: def.station, latitude: def.lat, longitude: def.lon };
  const n = buildNational(st, rivernetRows(def, dev));
  return { ...n, source: "rivernet", institute: "DMC / Leecom SCADA", cadenceMin: 10, lastSeenTs: Number.isFinite(dev.latestTs) ? dev.latestTs : undefined, tributary: RIVERNET_TRIBUTARIES.has(def.station) || undefined };
}

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
export const fetchBasinSnapshot = cache(async (basinName: string): Promise<BasinStation[]> => {
  const national = await getNational();
  const wantSlug = basinSlug(basinName);
  if (!wantSlug) return [];
  return national.filter((s) => basinSlug(s.basin) === wantSlug).map((s) => ({ ...s, prior: priorOf(s) }));
});
