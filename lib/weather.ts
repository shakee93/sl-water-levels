// Open-Meteo rain and GloFAS river-discharge feeds for the forecast.
//
// All of these fail SOFT: every function returns { ok: false, reason } instead of
// throwing, because a flaky weather API must degrade the forecast (wider bands, a
// note saying why), never break the page. Callers must surface `reason`; do not
// quietly substitute "no rain".
//
// Sources (keyless):
//   api.open-meteo.com            deterministic hourly precipitation, past + forecast
//   ensemble-api.open-meteo.com   ECMWF IFS 51-member ensemble, for spread
//   flood-api.open-meteo.com      GloFAS river discharge (daily, ensemble)
//
// Rain is the plain mean over the grid cells of a gauge's upstream sub-catchment (area average;
// lib/model/catchments.json, built by scripts/build-catchments.mjs), keyed by the END of each
// hour in epoch ms (Open-Meteo reports the sum over the preceding hour), the same convention
// the fitting script uses. One deterministic request (<= ~30 locations) plus one ensemble request
// per gauge, each cached 30 minutes by Next's fetch cache. The deterministic call reads 4 past days: the storm correction
// (lib/model/stormModel.mjs) needs the last 72 h as its wet-ground signal.

import catchments from "./model/catchments.json";
import { normaliseBasin } from "./basinOrder";

const HOUR_MS = 3_600_000;
const RAIN_REVALIDATE_S = 1800;
const GLOFAS_REVALIDATE_S = 6 * 3600;
const TIMEOUT_MS = 8000;

export type Fetched<T> = { ok: true; data: T } | { ok: false; reason: string };

/** Hourly catchment-mean rain in mm, keyed by the epoch-ms end of each hour. */
export type RainSeries = Record<number, number>;

export type BasinWeather = {
  basin: string;
  /** Gauge whose upstream sub-catchment the rain is averaged over. */
  station: string;
  /** Number of grid cells averaged (deterministic / ensemble). */
  cells: { det: number; ens: number };
  /** Hour boundary treated as "now": earlier bins are past rain, later ones forecast. */
  nowHour: number;
  /** Deterministic past + forecast. */
  rain: RainSeries;
  /** Past from `rain`; the future from the ensemble members ranked by next-24h total. null = ensemble unavailable. */
  scenarios: { p10: RainSeries; p50: RainSeries; p90: RainSeries } | null;
  ensembleReason: string | null;
  past6hMm: number | null;
  past24hMm: number | null;
  /** Catchment-mean rain over the next 24h (mm): deterministic and ensemble percentiles. */
  next24hMm: { det: number | null; p10: number | null; p50: number | null; p90: number | null };
};

export type Glofas = {
  /** Highest river discharge (m3/s) in any ensemble member over the next 7 days. */
  max7d: number;
  maxDay: string | null;
  /** Median-member discharge on the same day-by-day grid, for display. */
  daily: { date: string; median: number; max: number }[];
  p95: number;
  p99: number;
  /** "high" = above p99. Either way the forecast only raises an outlook flag; GloFAS never sets a level. */
  band: "normal" | "elevated" | "high";
};

type BasinCfg = {
  grid: [number, number][];
  ens: [number, number][];
  stations: Record<string, { cells: number[]; ensCells: number[] }>;
  glofas?: { lat: number; lon: number; p95: number; p99: number };
};
const BASINS = (catchments as unknown as { basins: Record<string, BasinCfg> }).basins;

export function hasCatchment(basin: string, station: string): boolean {
  return !!BASINS[normaliseBasin(basin)]?.stations[station];
}

export async function getJson(url: string, revalidate: number): Promise<Fetched<unknown>> {
  try {
    const res = await fetch(url, { next: { revalidate }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      let why = "";
      try {
        why = ((await res.json()) as { reason?: string }).reason ?? "";
      } catch {}
      return { ok: false, reason: `HTTP ${res.status}${why ? `: ${why}` : ""}` };
    }
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

type OmPoint = { hourly?: Record<string, (number | null)[] | string[]> };
const asList = (j: unknown): OmPoint[] => (Array.isArray(j) ? (j as OmPoint[]) : [j as OmPoint]);
const binTs = (t: string) => Date.parse(`${t}Z`); // timezone=UTC, so strings carry no zone

/** Mean over points of the given column, hour by hour. Any point missing a value => the hour is dropped. */
function catchmentSeries(list: OmPoint[], col: string): RainSeries | null {
  const out: RainSeries = {};
  const first = list[0]?.hourly;
  const times = first?.time as string[] | undefined;
  if (!times) return null;
  for (let i = 0; i < times.length; i++) {
    let s = 0;
    let ok = true;
    for (const p of list) {
      const v = (p.hourly?.[col] as (number | null)[] | undefined)?.[i];
      if (v == null || !Number.isFinite(v)) {
        ok = false;
        break;
      }
      s += v;
    }
    if (ok) out[binTs(times[i])] = s / list.length;
  }
  return Object.keys(out).length ? out : null;
}

const sumWindow = (r: RainSeries, fromExcl: number, toIncl: number): number | null => {
  let s = 0;
  for (let T = fromExcl + HOUR_MS; T <= toIncl; T += HOUR_MS) {
    const v = r[T];
    if (v == null) return null;
    s += v;
  }
  return s;
};

/** Catchment-mean rain (area average over the gauge's upstream sub-catchment) with forecast and ensemble scenarios. */
export async function getBasinWeather(basin: string, station: string, now = Date.now()): Promise<Fetched<BasinWeather>> {
  const key = normaliseBasin(basin);
  const cfg = BASINS[key];
  const sc = cfg?.stations[station];
  if (!cfg || !sc) return { ok: false, reason: `no rain grid defined for ${station} (${key || "unknown basin"})` };
  const det = sc.cells.map((i) => cfg.grid[i]);
  const ensPts = sc.ensCells.map((i) => cfg.ens[i]);
  const lat = det.map((p) => p[0]).join(",");
  const lon = det.map((p) => p[1]).join(",");
  const eLat = ensPts.map((p) => p[0]).join(",");
  const eLon = ensPts.map((p) => p[1]).join(",");
  const nowHour = Math.floor(now / HOUR_MS) * HOUR_MS;

  const [detR, ens] = await Promise.all([
    getJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation&past_days=4&forecast_days=3&timezone=UTC`,
      RAIN_REVALIDATE_S,
    ),
    getJson(
      `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${eLat}&longitude=${eLon}&hourly=precipitation&models=ecmwf_ifs025&past_days=0&forecast_days=3&timezone=UTC`,
      RAIN_REVALIDATE_S,
    ),
  ]);
  if (!detR.ok) return { ok: false, reason: `rain forecast unavailable (${detR.reason})` };
  const rain = catchmentSeries(asList(detR.data), "precipitation");
  if (!rain) return { ok: false, reason: "rain forecast response was empty" };

  const horizonEnd = nowHour + 24 * HOUR_MS;
  const detNext = sumWindow(rain, nowHour, horizonEnd);
  const past24 = sumWindow(rain, nowHour - 24 * HOUR_MS, nowHour);
  const past6 = sumWindow(rain, nowHour - 6 * HOUR_MS, nowHour);

  let scenarios: BasinWeather["scenarios"] = null;
  let ensembleReason: string | null = null;
  let p10: number | null = null;
  let p50: number | null = null;
  let p90: number | null = null;
  if (!ens.ok) {
    ensembleReason = `ensemble unavailable (${ens.reason})`;
  } else {
    const list = asList(ens.data);
    const cols = Object.keys(list[0]?.hourly ?? {}).filter((k) => k === "precipitation" || k.startsWith("precipitation_member"));
    const members: { series: RainSeries; total: number }[] = [];
    for (const c of cols) {
      const series = catchmentSeries(list, c);
      const total = series ? sumWindow(series, nowHour, horizonEnd) : null;
      if (series && total != null) members.push({ series, total });
    }
    if (members.length < 10) {
      ensembleReason = `ensemble incomplete (${members.length} usable members)`;
    } else {
      members.sort((a, b) => a.total - b.total);
      const pick = (q: number) => members[Math.round(q * (members.length - 1))];
      // Past hours come from the deterministic analysis (what the model was trained on); only
      // the future is swapped for the member.
      const scen = (m: { series: RainSeries }): RainSeries => {
        const o: RainSeries = {};
        for (const [k, v] of Object.entries(rain)) if (+k <= nowHour) o[+k] = v;
        for (const [k, v] of Object.entries(m.series)) if (+k > nowHour) o[+k] = v;
        return o;
      };
      const a = pick(0.1), b = pick(0.5), c = pick(0.9);
      scenarios = { p10: scen(a), p50: scen(b), p90: scen(c) };
      p10 = a.total;
      p50 = b.total;
      p90 = c.total;
    }
  }

  return {
    ok: true,
    data: {
      basin: key,
      station,
      cells: { det: det.length, ens: ensPts.length },
      nowHour,
      rain,
      scenarios,
      ensembleReason,
      past6hMm: past6,
      past24hMm: past24,
      next24hMm: { det: detNext, p10, p50, p90 },
    },
  };
}

/** GloFAS outlook for the basin's main-stem cell. null = this basin has no cell configured. */
export async function getGlofas(basin: string): Promise<Fetched<Glofas> | null> {
  const cfg = BASINS[normaliseBasin(basin)]?.glofas;
  if (!cfg) return null;
  const r = await getJson(
    `https://flood-api.open-meteo.com/v1/flood?latitude=${cfg.lat}&longitude=${cfg.lon}&daily=river_discharge&past_days=0&forecast_days=7&ensemble=true`,
    GLOFAS_REVALIDATE_S,
  );
  if (!r.ok) return { ok: false, reason: `GloFAS unavailable (${r.reason})` };
  const d = (r.data as { daily?: Record<string, (number | null)[] | string[]> }).daily;
  const times = d?.time as string[] | undefined;
  if (!d || !times?.length) return { ok: false, reason: "GloFAS response was empty" };
  const cols = Object.keys(d).filter((k) => k.startsWith("river_discharge"));
  const daily: Glofas["daily"] = [];
  let max7d = -Infinity;
  let maxDay: string | null = null;
  times.forEach((date, i) => {
    const vals = cols
      .map((c) => (d[c] as (number | null)[])[i])
      .filter((v): v is number => v != null && Number.isFinite(v))
      .sort((a, b) => a - b);
    if (!vals.length) return;
    const max = vals[vals.length - 1];
    daily.push({ date, median: vals[Math.floor((vals.length - 1) / 2)], max });
    if (max > max7d) {
      max7d = max;
      maxDay = date;
    }
  });
  if (!daily.length) return { ok: false, reason: "GloFAS had no discharge values" };
  const band = max7d > cfg.p99 ? "high" : max7d > cfg.p95 ? "elevated" : "normal";
  return { ok: true, data: { max7d, maxDay, daily, p95: cfg.p95, p99: cfg.p99, band } };
}
