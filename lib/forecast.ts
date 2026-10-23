// River-level forecast.
//
// Stations with a fitted model (lib/model/coefficients.json, see DOCS.md) get a
// multi-horizon forecast (1/3/6/12/24 h) from a lagged ridge regression on upstream
// gauges + catchment rain, with an 80% band and threshold-crossing probabilities.
// Every other station falls back to the older one-hour trend extrapolation
// (`trendForecast` below), clearly labelled as trend-only.
//
// SAFETY RULES (these are deliberate; do not loosen them casually):
//  1. EXPERIMENTAL cap. While the training archive spans less than MIN_TRAIN_DAYS
//     (roughly one monsoon season) the forecast is flagged `experimental`: residual
//     spreads are inflated 25%, no probability above MAX_PROB_EXPERIMENTAL is ever
//     shown, and the notes say so. The first fit had 8 days, one rain event and no flood.
//  2. WORDING. "likely" needs probability >= 50%, "possible" 20-50%; below 20% the
//     crossing is "unlikely" and never headlined. Probabilities are rounded to 5%.
//  3. PERSISTENCE. An ETA is only stated when the crossing probability clears the
//     bar at two ADJACENT fitted horizons (e.g. both 6h and 12h), so a one-horizon
//     blip cannot produce a "9 pm" claim.
//  4. NEVER SILENT. A stale station is "unavailable" (no forecast at all). A stale or
//     absent upstream leader, or a failed rain fetch, is named in `notes`, widens the
//     band, caps wording at "possible" and (for the main leader / rain) suppresses the
//     ETA. We never quietly fall back to "no rain".
//  5. GloFAS is an outlook flag ("elevated") only. It never produces or adjusts a level.
//  6. Horizons whose out-of-sample error was no better than "level stays put" (24h so
//     far) ship as persistence with the observed change distribution as the band.

import type { BasinStation } from "./arcgis";
import { normaliseBasin, orderStations } from "./basinOrder";
import { ageMinutes, HOUR_MS, isStale, rainTotal, rate, STALE_MINUTES } from "./readings";
import { formatDelta, formatLevel, type Unit } from "./units";
import { getBasinWeather, getGlofas, hasCatchment, type BasinWeather, type Fetched, type Glofas, type RainSeries } from "./weather";
import coefficientsJson from "./model/coefficients.json";
import {
  evalStation,
  floorSigmaM,
  mixCdf,
  mixQuantile,
  type Comp,
  type StationCfg,
  type StationCoef,
} from "./model/core.mjs";

const COEF_FILE = coefficientsJson as unknown as {
  stations: Record<string, StationCoef>;
  /** Gauges tried by scripts/fit-forecast.mjs that did not ship a model, with the measured reason. */
  unfitted?: Record<string, string>;
};
const COEFFS = COEF_FILE.stations;
const UNFITTED = COEF_FILE.unfitted ?? {};

/** One monsoon season of archive before we drop the "experimental" label. */
export const MIN_TRAIN_DAYS = 150;
export const MAX_PROB_EXPERIMENTAL = 0.9;
const LIKELY = 0.5;
const POSSIBLE = 0.2;
const COLOMBO_MS = 5.5 * HOUR_MS;
/** Scenario weights for the ensemble rain members at the 10th / 50th / 90th percentile of 24h total. */
const SCEN_W = { p10: 0.3, p50: 0.4, p90: 0.3 };
const Z80 = 1.2816;
/** Below this the level is treated as steady: 0.018 m over 3h (the old 0.006 m/h). */
const STEADY_3H_M = 0.018;

export type ThresholdName = "alert" | "minor" | "major";
export type Wording = "likely" | "possible" | "unlikely" | "already";

export type Forecast = {
  station: string;
  unit: Unit;
  /** Level at the latest reading, in the station's unit. */
  currentLevel: number | null;
  /** Timestamp of that reading; horizons and ETAs count from here. */
  asOfTs: number | null;
  /** "model" = fitted lagged regression; "trend" = one-hour trend extrapolation only. */
  method: "model" | "trend" | "none";
  /** "unavailable" = no forecast; "degraded" = produced with missing inputs (see notes). */
  status: "ok" | "degraded" | "unavailable";
  direction: "rising" | "falling" | "steady" | "unknown";
  /** True while the training archive is shorter than one monsoon season. */
  experimental: boolean;
  /** Plain-English list of what this forecast is based on. */
  basis: string[];
  /** low/high = 80% band; null for trend-only forecasts, which have no calibrated band. */
  horizons: { h: number; ts: number; level: number; low: number | null; high: number | null }[];
  crossings: {
    threshold: ThresholdName;
    /** Threshold value in station units. */
    level: number;
    /** Peak probability over the next 24h (0..1, rounded to 5%); 1 when already crossed. */
    probability: number;
    /** Earliest likely time; null when not stated (see rule 3 and 4 above). */
    etaTs: number | null;
    wording: Wording;
  }[];
  /** GloFAS flag. null = no GloFAS for this basin or the feed failed. */
  outlook: "normal" | "elevated" | null;
  headline: string;
  notes: string[];
  /** Raw signals behind the forecast (all stations; what the old panel displayed). */
  signals: {
    localRatePerH: number | null;
    upstreamRatePerH: number | null;
    upstreamLeader: { station: string; ratePerH: number } | null;
    upstreamCount: number;
    rainAtStation6h: number | null;
    rainUpstream6h: number | null;
    rainContributors: string[];
    trendConfidence: "high" | "medium" | "low" | "none";
  };
  /**
   * Area-average rain over the sub-catchment upstream of this gauge (mm), null when the weather fetch failed.
   * `cells` = number of 0.075-0.15 degree grid cells averaged (lib/model/catchments.json).
   */
  rain: {
    cells: number;
    past6hMm: number | null;
    past24hMm: number | null;
    next24hMm: { det: number | null; p10: number | null; p50: number | null; p90: number | null };
  } | null;
};

export type ForecastInput = {
  basin: string;
  /** Snapshot of the whole basin (leaders are looked up here). */
  snapshot: BasinStation[];
  station: string;
  /** Result of getBasinWeather(basin, station); null/undefined = not fetched (no rain grid for this gauge) or failed. */
  weather: Fetched<BasinWeather> | null | undefined;
  /** Result of getGlofas; null = basin has no cell. */
  glofas?: Fetched<Glofas> | null;
  now?: number;
};

/** Fetch weather + GloFAS (both fail soft) and build the forecast. */
export async function loadForecast(basin: string, snapshot: BasinStation[], station: string): Promise<Forecast> {
  const key = normaliseBasin(basin);
  const covered = COEFFS[station] && normaliseBasin(COEFFS[station].basin) === key;
  // Rain is fetched for every gauge that has a grid (trend-only gauges show it too); GloFAS only matters to fitted models.
  const [weather, glofas] = hasCatchment(key, station)
    ? await Promise.all([getBasinWeather(key, station), covered ? getGlofas(key) : null])
    : [null, null];
  return makeForecast({ basin, snapshot, station, weather, glofas });
}

const r5 = (p: number) => Math.round(p * 20) / 20;
const nameOf: Record<ThresholdName, string> = { alert: "alert level", minor: "minor flood level", major: "major flood level" };
const SEVERITY: ThresholdName[] = ["alert", "minor", "major"];

function whenPhrase(ts: number, now: number): string {
  // Always pair the clock time with "in about N hours": a bare "8 am today" read
  // just after midnight looks like it already passed. Part of day instead of
  // "today", which is ambiguous late at night.
  const c = new Date(ts + COLOMBO_MS);
  const hr = c.getUTCHours();
  const clock = `${hr % 12 || 12} ${hr < 12 ? "am" : "pm"}`;
  const dd = Math.floor((ts + COLOMBO_MS) / 864e5) - Math.floor((now + COLOMBO_MS) / 864e5);
  const part = hr < 5 ? "tonight" : hr < 12 ? "morning" : hr < 18 ? "afternoon" : "evening";
  const day =
    dd <= 0
      ? part === "tonight" ? "tonight" : `this ${part}`
      : dd === 1
        ? part === "tonight" ? "tonight" : `tomorrow ${part}`
        : "the day after tomorrow";
  const h = Math.max(1, Math.round((ts - now) / 3_600_000));
  return `around ${clock} ${day} (in about ${h} hour${h === 1 ? "" : "s"})`;
}

function emptyResult(station: string, unit: Unit, headline: string, notes: string[], trend: TrendResult | null, level: number | null, asOfTs: number | null): Forecast {
  return {
    station, unit, currentLevel: level, asOfTs,
    method: "none", status: "unavailable", direction: "unknown", experimental: true,
    basis: [], horizons: [], crossings: [], outlook: null, headline, notes,
    signals: signalsOf(trend), rain: null,
  };
}

function signalsOf(t: TrendResult | null, catchment6h: number | null = null): Forecast["signals"] {
  return {
    localRatePerH: t?.localRatePerH ?? null,
    upstreamRatePerH: t?.upstreamRatePerH ?? null,
    upstreamLeader: t?.upstreamLeader ?? null,
    upstreamCount: t?.upstreamCount ?? 0,
    rainAtStation6h: t?.rainAtStation6h ?? null,
    // area average over the sub-catchment above this gauge when the weather fetch worked, else the upstream gauges' own rain
    rainUpstream6h: catchment6h ?? t?.rainUpstream6h ?? null,
    rainContributors: t?.rainContributors ?? [],
    trendConfidence: t?.confidence ?? "none",
  };
}

export function makeForecast(input: ForecastInput): Forecast {
  const { basin, snapshot, station } = input;
  const now = input.now ?? Date.now();
  const me = snapshot.find((s) => s.station === station);
  const w0 = input.weather && input.weather.ok ? input.weather.data : null;
  const trend = trendForecast(basin, snapshot, station, w0?.past6hMm ?? null);
  if (!me) return emptyResult(station, null, "No forecast: this station is not in the basin snapshot.", [], trend, null, null);
  const unit = me.unit;
  if (!me.latest || me.latest.water_level == null) {
    return emptyResult(station, unit, "No forecast: this gauge is not reporting.", ["This gauge is not reporting."], trend, null, null);
  }
  const L0 = me.latest.water_level;
  const anchor = me.latest.ts;
  if (isStale(me.latest, now)) {
    const hrs = Math.round((ageMinutes(me.latest, now) ?? 0) / 60);
    return emptyResult(station, unit, `No forecast: the latest reading is ${hrs} hours old.`, [`Latest reading is ${hrs}h old (limit ${STALE_MINUTES / 60}h), too stale to forecast.`], trend, L0, anchor);
  }

  const coef = COEFFS[station];
  if (!coef || normaliseBasin(coef.basin) !== normaliseBasin(basin)) return fromTrend(station, me, trend, L0, anchor, input.weather);
  return fromModel(input, me, coef, trend, L0, anchor, now);
}

/** Why this gauge has no fitted model, in words that name what is missing (never a vague "inputs missing"). */
function noModelReason(station: string, hasGrid: boolean): string {
  const measured = UNFITTED[station];
  if (measured) return measured;
  if (!hasGrid) return "this gauge has no published flood levels or catchment rain grid, so no model was fitted";
  return "no model has been fitted for this gauge yet";
}

const rainBits = (r: NonNullable<Forecast["rain"]>) =>
  `${r.past6hMm != null ? `${r.past6hMm.toFixed(1)} mm in the last 6 hours, ` : ""}${r.past24hMm != null ? `${r.past24hMm.toFixed(0)} mm in the last 24 hours` : ""}${r.next24hMm.det != null ? `, ${r.next24hMm.det.toFixed(0)} mm forecast for the next 24 hours` : ""}`.replace(/^, /, "");

/** Trend-only forecast for stations without a fitted model. */
function fromTrend(station: string, me: BasinStation, t: TrendResult, L0: number, anchor: number, weather: ForecastInput["weather"]): Forecast {
  const pred = t.predictedLevel;
  const dir = t.direction;
  const word = dir === "rising" ? "Rising" : dir === "falling" ? "Falling" : dir === "steady" ? "Steady" : "Unclear";
  const w = weather && weather.ok ? weather.data : null;
  const rain: Forecast["rain"] = w ? { cells: w.cells.det, past6hMm: w.past6hMm, past24hMm: w.past24hMm, next24hMm: w.next24hMm } : null;
  const grid = weather !== undefined && weather !== null;
  const reason = noModelReason(station, grid);
  const headline =
    pred == null
      ? "No forecast: not enough recent readings to see a trend."
      : `${word}: about ${formatLevel(pred, me.unit)} in an hour.`;
  // The headline is user-facing (and feeds the AI line); the method reason is in notes below.
  const notes = t.notes.filter((n) => !(w && n.startsWith("No rain data reported nearby")));
  if (w && rain) {
    notes.unshift(`Catchment rain (area average over ${rain.cells} grid cells above this gauge, Open-Meteo): ${rainBits(rain)}. It is shown for context; this gauge's forecast does not use it.`);
  } else if (weather && !weather.ok) {
    notes.unshift(`Catchment rain unavailable right now (${weather.reason}).`);
  }
  notes.unshift(`Trend only: ${reason}.`);
  return {
    station, unit: me.unit, currentLevel: L0, asOfTs: anchor,
    method: "trend", status: pred == null ? "unavailable" : "degraded", direction: dir, experimental: true,
    basis: [
      "Recent trend at this gauge and the gauges upstream of it (one hour ahead only)." +
        (t.upstreamCount === 0 ? " This is the topmost gauge on its river, so there is no upstream gauge; the catchment rain above is the only upstream signal." : ""),
    ],
    horizons: pred == null ? [] : [{ h: 1, ts: anchor + HOUR_MS, level: pred, low: null, high: null }],
    crossings: [], outlook: null, headline,
    notes,
    signals: signalsOf(t, w?.past6hMm ?? null), rain,
  };
}

function fromModel(
  input: ForecastInput, me: BasinStation, coef: StationCoef, trend: TrendResult,
  L0: number, anchor: number, now: number,
): Forecast {
  const { snapshot, station } = input;
  const mpu = me.metresPerUnit;
  const unit = me.unit;
  const notes: string[] = [];
  const cfg: StationCfg = { target: station, terms: coef.terms };

  // ---- gauges: stale or absent leaders are dropped (never extrapolated) and named
  const needed = [...new Set(coef.terms.flatMap((t) => (t.k === "delta" ? t.g : [])))].filter((g) => g !== station);
  const byName = new Map(snapshot.map((s) => [s.station, s]));
  const series = new Map<string, { ts: number; wl: number }[]>();
  const missingGauges: string[] = [];
  for (const g of [station, ...needed]) {
    const s = byName.get(g);
    const ok = s && s.latest && !isStale(s.latest, now);
    if (!s || !ok) {
      if (g !== station) missingGauges.push(g);
      continue;
    }
    series.set(g, s.trend24h.filter((r) => r.water_level != null).map((r) => ({ ts: r.ts, wl: r.water_level as number })));
  }
  const mainLeaderMissing = coef.mainLeader != null && missingGauges.includes(coef.mainLeader);
  const otherLeadersMissing = missingGauges.filter((g) => g !== coef.mainLeader);
  for (const g of missingGauges) {
    const s = byName.get(g);
    const why = !s || !s.latest ? "is not reporting" : `last reported ${Math.round((ageMinutes(s.latest, now) ?? 0) / 60)}h ago`;
    notes.push(`${g} ${why}, so it was left out and the range is wider.`);
  }

  // ---- weather
  const w = input.weather && input.weather.ok ? input.weather.data : null;
  const weatherMissing = !w;
  if (!w) notes.push(`Rain forecast unavailable${input.weather && !input.weather.ok ? ` (${input.weather.reason})` : ""}: rain was treated as typical, the range is wider and no arrival time is given.`);
  const ensembleMissing = !!w && !w.scenarios;
  if (w && !w.scenarios) notes.push(`Rain uncertainty unknown (${w.ensembleReason ?? "no ensemble"}): range widened a little.`);

  const scenarioRain: Record<"p10" | "p50" | "p90", RainSeries | null> = {
    p10: w ? (w.scenarios?.p10 ?? w.rain) : null,
    p50: w ? (w.scenarios?.p50 ?? w.rain) : null,
    p90: w ? (w.scenarios?.p90 ?? w.rain) : null,
  };
  const ctxFor = (key: "p10" | "p50" | "p90") => {
    const rain = scenarioRain[key];
    return {
      level: (g: string, t: number) => {
        const s = series.get(g);
        return s ? interpSeries(s, t) : null;
      },
      rain: (T: number) => rain?.[T],
    };
  };
  const evals = {
    p10: evalStation(coef, cfg, ctxFor("p10"), anchor),
    p50: evalStation(coef, cfg, ctxFor("p50"), anchor),
    p90: evalStation(coef, cfg, ctxFor("p90"), anchor),
  };

  // ---- uncertainty
  const trainSpanDays = (coef.trainRange[1] - coef.trainRange[0]) / 864e5;
  const experimental = trainSpanDays < MIN_TRAIN_DAYS;
  let infl = experimental ? 1.25 : 1;
  if (weatherMissing) infl *= 1.5;
  if (mainLeaderMissing) infl *= 1.5;
  if (otherLeadersMissing.length) infl *= 1.2;
  if (ensembleMissing) infl *= 1.15;
  const degraded = weatherMissing || mainLeaderMissing || otherLeadersMissing.length > 0;
  const hardDegraded = weatherMissing || mainLeaderMissing; // suppresses ETA
  const rising = (evals.p50[0]?.features[0] ?? 0) > 0; // own 3h change

  type H = { h: number; mix: Comp[]; level: number; low: number; high: number; persistence: boolean };
  const hs: H[] = evals.p50.map((e50, i) => {
    const m = coef.horizons[e50.h];
    const floor = floorSigmaM(e50.h) / mpu;
    const dis = 0.5 * Math.abs(e50.delta - e50.deltaLocal);
    let sd = Math.max(Math.abs(m.q10) / Z80, floor) * infl;
    let su = Math.max(m.q90 / Z80, floor) * infl;
    // The first fit under-predicted the start of the one rain event by ~1 m, so rising
    // rivers get a fatter upper tail.
    if (rising) su *= 1.2;
    sd = Math.hypot(sd, dis);
    su = Math.hypot(su, dis);
    const mk = (key: "p10" | "p50" | "p90", d: number): Comp => ({ w: SCEN_W[key], mu: L0 + d, sd, su });
    const mix = [mk("p10", evals.p10[i].delta), mk("p50", e50.delta), mk("p90", evals.p90[i].delta)];
    return {
      h: e50.h, mix, persistence: e50.persistence,
      level: mixQuantile(0.5, mix), low: mixQuantile(0.1, mix), high: mixQuantile(0.9, mix),
    };
  });
  // A persistence horizon says "stays where it is", which is wrong right after a rain-driven
  // rise: a river that peaks at 12h is rarely back to normal by 24h. Blend 40% of the previous
  // horizon's distribution into it so a forecast flood does not vanish from the 24h column.
  for (let i = 1; i < hs.length; i++) {
    if (!hs[i].persistence) continue;
    const mix = [...hs[i].mix.map((c) => ({ ...c, w: c.w * 0.6 })), ...hs[i - 1].mix.map((c) => ({ ...c, w: c.w * 0.4 }))];
    hs[i] = { ...hs[i], mix, level: mixQuantile(0.5, mix), low: mixQuantile(0.1, mix), high: mixQuantile(0.9, mix) };
  }
  if (!hs.length) return emptyResult(station, me.unit, "No forecast: the model has no usable horizons.", [], trend, L0, anchor);

  // ---- threshold crossings
  const th: Record<ThresholdName, number | null> = { alert: me.thresholds.alert, minor: me.thresholds.minor, major: me.thresholds.major };
  const capP = (p: number) => r5(experimental ? Math.min(MAX_PROB_EXPERIMENTAL, p) : p);
  const crossings: Forecast["crossings"] = [];
  for (const name of SEVERITY) {
    const T = th[name];
    if (T == null || T <= 0) continue;
    if (L0 >= T) {
      crossings.push({ threshold: name, level: T, probability: 1, etaTs: null, wording: "already" });
      continue;
    }
    const P = hs.map((x) => 1 - mixCdf(T, x.mix));
    const persists = (cut: number) => P.some((p, i) => i + 1 < P.length && p >= cut && P[i + 1] >= cut);
    const maxP = Math.max(...P);
    let wording: Wording = "unlikely";
    if (maxP >= LIKELY && persists(LIKELY)) wording = "likely";
    else if (maxP >= POSSIBLE && persists(POSSIBLE)) wording = "possible";
    if (degraded && wording === "likely") wording = "possible";
    let etaTs: number | null = null;
    if (wording !== "unlikely" && !hardDegraded) {
      const cut = wording === "likely" ? LIKELY : POSSIBLE;
      // interpolate P hourly between fitted horizons (P at h=0 is 0: it is below T now)
      for (let k = 1; k <= 24 && etaTs == null; k++) {
        let j = hs.findIndex((x) => x.h >= k);
        if (j < 0) j = hs.length - 1;
        const a = j === 0 ? { h: 0, p: 0 } : { h: hs[j - 1].h, p: P[j - 1] };
        const b = { h: hs[j].h, p: P[j] };
        const pk = b.h === a.h ? b.p : a.p + ((b.p - a.p) * (k - a.h)) / (b.h - a.h);
        if (pk >= cut) etaTs = anchor + k * HOUR_MS;
      }
    }
    crossings.push({ threshold: name, level: T, probability: capP(maxP), etaTs, wording });
  }

  // ---- direction, outlook
  const h3 = hs.find((x) => x.h === 3) ?? hs[0];
  const d3 = h3.level - L0;
  const steady = (STEADY_3H_M / mpu) * (h3.h / 3);
  const direction: Forecast["direction"] = d3 > steady ? "rising" : d3 < -steady ? "falling" : "steady";

  let outlook: Forecast["outlook"] = null;
  if (input.glofas && input.glofas.ok) {
    const g = input.glofas.data;
    outlook = g.band === "normal" ? "normal" : "elevated";
    if (outlook === "elevated") {
      notes.push(
        `Outlook: the GloFAS global flood model has river flow at ${Math.round(g.max7d)} m3/s in its highest member within 7 days, above the 1-in-20 level (${g.p95} m3/s). This is a heads-up only; it does not change the levels above.`,
      );
    }
  } else if (input.glofas && !input.glofas.ok) {
    notes.push(`Week-ahead outlook unavailable (${input.glofas.reason}).`);
  }

  // ---- notes
  if (experimental) {
    notes.push(
      `Experimental: fitted to ${Math.round(trainSpanDays)} days of gauge data, less than one monsoon season (${MIN_TRAIN_DAYS} days), with no major flood in it. Probabilities are capped at ${Math.round(MAX_PROB_EXPERIMENTAL * 100)}% and ranges are widened.`,
    );
  }
  if (Math.max(...hs.map((x) => x.high)) > coef.levelMax) {
    notes.push(`Part of the range is above the highest level this model has seen (${formatLevel(coef.levelMax, unit)}); treat it as a rough guide.`);
  }
  const noSkill = hs.filter((x) => x.persistence).map((x) => `${x.h} h`);
  if (noSkill.length) notes.push(`In testing the model was no better than 'level stays the same' at ${noSkill.join(", ")}, so those hours blend that with the earlier outlook and carry a wide range.`);
  if (w) {
    const n = w.next24hMm;
    const fmt = (v: number | null) => (v == null ? "n/a" : v.toFixed(0));
    if (n.det != null && n.det >= 20) notes.push(`Heavy rain forecast over the catchment: about ${fmt(n.det)} mm in the next 24 hours${n.p10 != null ? ` (ensemble range ${fmt(n.p10)} to ${fmt(n.p90)} mm)` : ""}.`);
  }

  // ---- headline
  const lowestName = SEVERITY.find((n) => th[n] != null && (th[n] as number) > 0);
  const above = [...crossings].reverse().find((c) => c.wording === "already");
  const nextRank = (c: (typeof crossings)[number]) => (c.wording === "likely" ? 2 : c.wording === "possible" ? 1 : 0);
  const upcoming = crossings
    .filter((c) => c.wording === "likely" || c.wording === "possible")
    .sort((a, b) => nextRank(b) - nextRank(a) || SEVERITY.indexOf(b.threshold) - SEVERITY.indexOf(a.threshold))[0];
  const reach = (c: NonNullable<typeof upcoming>) =>
    `${c.wording === "likely" ? "likely to reach" : "could reach"} ${nameOf[c.threshold]}${c.etaTs ? ` ${whenPhrase(c.etaTs, now)}` : " within the next 24 hours"} (about ${Math.round(c.probability * 100)}% chance)`;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const hLast = hs[hs.length - 1];
  const fmtL = (v: number) => formatLevel(v, unit);
  let headline: string;
  if (above && upcoming) headline = `Above ${nameOf[above.threshold]} now and ${reach(upcoming)}.`;
  else if (above) {
    const stay = 1 - mixCdf(above.level, hLast.mix);
    headline = stay >= LIKELY ? `Above ${nameOf[above.threshold]} now and expected to stay there for the next 24 hours.` : `Above ${nameOf[above.threshold]} now but expected to ease below it within 24 hours.`;
  } else if (upcoming) headline = cap(reach(upcoming)) + ".";
  else if (lowestName) {
    // A crossing that is "unlikely" by the persistence rule can still carry real probability (>= 20% at one horizon): hedge the wording.
    const lowP = crossings.find((c) => c.threshold === lowestName)?.probability ?? 0;
    headline = `${degraded || lowP >= POSSIBLE ? "Probably staying" : "Expected to stay"} below ${nameOf[lowestName]} for the next 24 hours.`;
  }
  else headline = `Expected to be about ${fmtL(hLast.level)} in 24 hours.`;

  // ---- basis
  const basis: string[] = [];
  const leaders = [...new Set(coef.terms.flatMap((t) => (t.k === "delta" ? t.g : [])))].filter((g) => g !== station);
  basis.push(leaders.length ? `Latest level at ${station} and recent change, plus upstream gauges: ${leaders.join(", ")}.` : `Latest level at ${station} and recent change. No gauge sits upstream of it (or none reports in step with it), so the catchment rain is its upstream signal.`);
  if (w) {
    const past = w.past24hMm;
    basis.push(`Catchment rain from Open-Meteo (area average over ${w.cells.det} grid cells above ${station})${past != null ? `: ${past.toFixed(0)} mm in the last 24 hours` : ""}${w.next24hMm.det != null ? `, ${w.next24hMm.det.toFixed(0)} mm forecast for the next 24 hours` : ""}${w.scenarios ? ", with ECMWF ensemble spread" : ""}.`);
  }
  const skilled = hs.filter((x) => !x.persistence).map((x) => `${x.h} h`);
  const m6 = coef.horizons["6"];
  if (m6?.mae != null && !m6.persistence) basis.push(`Fitted to ${coef.trainDays} days of readings; out-of-sample 6-hour error about ${formatDelta(m6.mae, unit)} (a 'no change' guess: ${m6.maePersistence.toFixed(2)}).`);
  else basis.push(`Fitted to ${coef.trainDays} days of readings; it beat a 'no change' guess out-of-sample only at ${skilled.join(", ") || "no horizon"}.`);

  return {
    station, unit, currentLevel: L0, asOfTs: anchor,
    method: "model", status: degraded ? "degraded" : "ok", direction, experimental,
    basis,
    horizons: hs.map((x) => ({ h: x.h, ts: anchor + x.h * HOUR_MS, level: x.level, low: x.low, high: x.high })),
    crossings, outlook, headline, notes,
    signals: signalsOf(trend, w?.past6hMm ?? null),
    rain: w ? { cells: w.cells.det, past6hMm: w.past6hMm, past24hMm: w.past24hMm, next24hMm: w.next24hMm } : null,
  };
}

// Linear interpolation consistent with lib/model/core.mjs interp (2h hold, 6h max gap).
function interpSeries(a: { ts: number; wl: number }[], t: number): number | null {
  let idx = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i].ts <= t) idx = i;
    else break;
  }
  if (idx < 0) return null;
  const p = a[idx];
  if (p.ts === t) return p.wl;
  const q = a[idx + 1];
  if (!q) return t - p.ts <= 2 * HOUR_MS ? p.wl : null;
  if (q.ts - p.ts > 6 * HOUR_MS) return null;
  return p.wl + ((q.wl - p.wl) * (t - p.ts)) / (q.ts - p.ts);
}

// ===========================================================================
// Trend-only method (the original one-hour forecast). Used for stations without a
// fitted model and for the raw trend/rain signals shown beside every forecast.
// ===========================================================================

export type TrendResult = {
  currentLevel: number | null;
  predictedLevel: number | null;
  predictedDelta: number | null;
  direction: "rising" | "falling" | "steady" | "unknown";
  confidence: "high" | "medium" | "low" | "none";
  localRatePerH: number | null;
  upstreamRatePerH: number | null;
  upstreamLeader: { station: string; ratePerH: number } | null;
  upstreamCount: number;
  rainAtStation6h: number | null;
  rainUpstream6h: number | null;
  rainContributors: string[];
  notes: string[];
};

// Great-circle distance in km between two lat/lon points.
function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Smoothly decaying proximity weight by distance.
// 0 km → 1.0, 10 km → 0.5, 30 km → 0.25, 100 km → ~0.09.
function proximityWeight(distKm: number): number {
  return 10 / (10 + Math.max(0, distKm));
}

// Rates here are blended and converted to METRES per hour so that upstream
// gauges reporting in a different unit (Norwood is metres on a feet river) are
// comparable, and so the heuristics below mean the same on every gauge.
// Thresholds were calibrated by eye on feet gauges; the metre values keep that
// intent (0.02 ft/h ~ 0.006 m/h, 0.05 ft/h ~ 0.015 m/h, 0.1 ft/h ~ 0.03 m/h,
// 0.5 ft ~ 0.15 m).
const STEADY_M_PER_H = 0.006;
const CONFIDENT_M_PER_H = 0.015;
const LEADER_NOTE_M_PER_H = 0.03;
const MIN_CLAMP_M = 0.15;

// Blend of the 3h least-squares slope (smooth) and the ~2h reading-to-reading
// momentum (catches post-peak descents and sudden rises a regression smooths
// away). Both windows are anchored to the gauge's own latest reading, and a
// gauge that hasn't reported for >3h yields null instead of a stale trend.
function blendedRateM(s: BasinStation): number | null {
  if (!s.latest || isStale(s.latest)) return null;
  const anchor = s.latest.ts;
  const slope = rate(s.trend24h, { hours: 3.25, anchor, method: "slope" });
  const momentum = rate(s.trend24h, { hours: 2.5, anchor });
  const blended =
    slope != null && momentum != null ? momentum * 0.6 + slope * 0.4 : (momentum ?? slope);
  return blended == null ? null : blended * s.metresPerUnit;
}

// 1-hour ahead prediction: local persistence + weighted upstream momentum,
// modulated by recent rainfall.
//
// Trend math:
//   localRate gets 70% weight when upstream exists, 100% otherwise.
//   upstream gets 30% weight, averaged across upstream stations,
//   nearer-upstream weighted higher via 1/(1+rank).
//
// Rain modulation:
//   - rainAtStation6h: rain in the gauge's own catchment in the last 6h.
//     Reinforces a near-term rise (small magnitude boost).
//   - rainUpstream6h: rain at upstream stations, weighted by the same
//     proximity weights. Already showing up in upstream water-level
//     trends, but reinforces confidence that the current trend has
//     fuel behind it.
//   - When the predicted direction is rising AND rain agrees, magnitude
//     gets up to +30%. When rising but no rain anywhere, magnitude
//     gets ×0.8 (rise will plateau soon).
function trendForecast(
  basin: string,
  snapshot: BasinStation[],
  selectedStation: string,
  /** Area-average catchment rain over the last 6 h (mm), used when no upstream gauge reports rain. */
  catchRain6h: number | null = null,
): TrendResult {
  const ordered = orderStations(basin, snapshot);
  const myIdx = ordered.findIndex((s) => s.station === selectedStation);
  if (myIdx < 0) {
    return emptyForecast(["Selected station not in basin snapshot."]);
  }
  const me = ordered[myIdx];
  const upstream = ordered.slice(0, myIdx);
  const mpu = me.metresPerUnit;

  if (!me.latest) return emptyForecast(["This gauge is not reporting."]);
  if (isStale(me.latest)) {
    const h = Math.round((ageMinutes(me.latest) ?? 0) / 60);
    return emptyForecast([`Latest reading is ${h}h old, too stale to forecast.`]);
  }
  const anchor = me.latest.ts;

  // all rates below are metres/hour until the final conversion back to me's unit
  const localRateM = blendedRateM(me);
  const currentLevel = me.latest.water_level;

  // rain at THIS station over the 6h to its latest reading (often null at downstream/urban gauges)
  const rainAtStation6h = rainTotal(me.trend24h, 6, anchor);

  // upstream rate + upstream rain, weighted by straight-line distance to
  // the selected station (closer upstream gauges count for more).
  type UpSignal = {
    station: string;
    rateM: number | null;
    rain: number | null;
    weight: number;
    distKm: number;
  };
  const upSignals: UpSignal[] = upstream.map((s) => {
    const distKm = haversineKm(me, s);
    return {
      station: s.station,
      rateM: blendedRateM(s),
      rain: s.latest && !isStale(s.latest) ? rainTotal(s.trend24h, 6, s.latest.ts) : null,
      weight: proximityWeight(distKm),
      distKm,
    };
  });

  const upRateSignals = upSignals.filter(
    (s): s is UpSignal & { rateM: number } => s.rateM != null,
  );
  const upRateWeightSum = upRateSignals.reduce((a, b) => a + b.weight, 0);
  const upstreamRateM =
    upRateWeightSum > 0
      ? upRateSignals.reduce((a, b) => a + b.rateM * b.weight, 0) / upRateWeightSum
      : null;
  const leaderRaw =
    upRateSignals.length > 0
      ? upRateSignals.reduce((a, b) => (Math.abs(a.rateM) > Math.abs(b.rateM) ? a : b))
      : null;
  const upstreamLeader: { station: string; ratePerH: number } | null = leaderRaw
    ? { station: leaderRaw.station, ratePerH: leaderRaw.rateM / mpu }
    : null;

  const upRainSignals = upSignals.filter(
    (s): s is UpSignal & { rain: number } => s.rain != null,
  );
  const upRainWeightSum = upRainSignals.reduce((a, b) => a + b.weight, 0);
  const rainUpstream6h =
    upRainWeightSum > 0
      ? upRainSignals.reduce((a, b) => a + b.rain * b.weight, 0) / upRainWeightSum
      : catchRain6h;
  const rainContributors = upRainSignals
    .filter((s) => s.rain > 1)
    .map((s) => `${s.station} ${s.rain.toFixed(1)}mm`);

  if (localRateM == null && upstreamRateM == null) {
    return emptyForecast(["Not enough recent readings to predict."]);
  }

  const localWeight = upstreamRateM != null ? 0.7 : 1;
  const upWeight = upstreamRateM != null ? 0.3 : 0;
  const baseDeltaM =
    (localRateM ?? upstreamRateM ?? 0) * localWeight +
    (upstreamRateM ?? 0) * upWeight;

  const notes: string[] = [];
  // Rain modulation. Unknown rain (null everywhere) contributes nothing and is
  // never treated as "dry": isDry needs at least one real zero-ish reading.
  const rainTotalMm = (rainAtStation6h ?? 0) + (rainUpstream6h ?? 0);
  // 0 mm => 1.0, 30 mm => 1.15, 80 mm => 1.3 (cap)
  const rainBoost = Math.min(0.3, rainTotalMm / 200);
  const rainKnown = rainAtStation6h != null || rainUpstream6h != null;
  // dry-and-rising means the rise will plateau soon → dampen
  const isRising = baseDeltaM > STEADY_M_PER_H;
  const isDry = rainKnown && (rainAtStation6h ?? 0) < 1 && (rainUpstream6h ?? 0) < 1;

  let magnitudeFactor = 1;
  if (isRising) {
    if (rainTotalMm > 1) magnitudeFactor = 1 + rainBoost;
    else if (isDry) magnitudeFactor = 0.8;
  }
  // Safety clamp: regression noise + tiny time windows can yield absurd
  // rates. Cap |delta| to the greater of 0.15 m or 30% of the current level
  // (so dam levels in the 100s aren't forced into a tiny window, but a 0.05
  // reading can't be predicted to jump by 50).
  const rawDeltaM = baseDeltaM * magnitudeFactor;
  const capM = currentLevel != null
    ? Math.max(MIN_CLAMP_M, Math.abs(currentLevel * mpu) * 0.3)
    : 0.3;
  const clampedM = Math.max(-capM, Math.min(capM, rawDeltaM));
  const predictedDelta = clampedM / mpu;
  if (clampedM !== rawDeltaM) {
    notes.push(
      `Trend slope (${(rawDeltaM / mpu).toFixed(2)}/h) was clamped to ±${(capM / mpu).toFixed(2)} as a sanity bound.`,
    );
  }
  const predictedLevel =
    currentLevel != null ? currentLevel + predictedDelta : null;

  const direction: TrendResult["direction"] =
    clampedM > STEADY_M_PER_H
      ? "rising"
      : clampedM < -STEADY_M_PER_H
        ? "falling"
        : "steady";

  // confidence
  let confidence: TrendResult["confidence"];
  if (localRateM == null) {
    confidence = "low";
    notes.push("No recent local readings — relying on upstream only.");
  } else if (upstreamRateM == null) {
    confidence = upstream.length === 0 ? "medium" : "low";
    if (upstream.length === 0)
      notes.push("Topmost gauge on its river: no gauge upstream, so only its own trend (plus catchment rain) is available.");
    else notes.push("Upstream readings missing; using local trend only.");
  } else {
    const sameDir = Math.sign(localRateM) === Math.sign(upstreamRateM);
    const magnitude = Math.max(Math.abs(localRateM), Math.abs(upstreamRateM));
    if (sameDir && magnitude >= CONFIDENT_M_PER_H) confidence = "high";
    else if (sameDir) confidence = "medium";
    else {
      confidence = "low";
      notes.push("Upstream and local trends disagree — direction is uncertain.");
    }
  }

  // rain-based confidence/note overlays
  if (direction === "rising") {
    if (rainTotalMm > 30) {
      if (confidence === "medium") confidence = "high";
      notes.push(
        `Recent rain (${rainTotalMm.toFixed(0)}mm/6h) reinforces the rising trend.`,
      );
    } else if (isDry) {
      if (confidence === "high") confidence = "medium";
      notes.push("No recent rain — rise is likely to plateau soon.");
    }
  } else if (direction === "falling" && rainTotalMm > 30) {
    if (confidence === "high") confidence = "medium";
    notes.push(
      `Recent rain (${rainTotalMm.toFixed(0)}mm/6h) may slow the decline.`,
    );
  }
  if (!rainKnown) notes.push("No rain data reported nearby; rain effects not factored in.");

  if (leaderRaw && Math.abs(leaderRaw.rateM) >= LEADER_NOTE_M_PER_H) {
    const lr = leaderRaw.rateM / mpu;
    notes.push(
      `${leaderRaw.station} ${lr > 0 ? "rising" : "falling"} at ${lr.toFixed(2)}/h.`,
    );
  }

  return {
    currentLevel,
    predictedLevel,
    predictedDelta,
    direction,
    confidence,
    localRatePerH: localRateM == null ? null : localRateM / mpu,
    upstreamRatePerH: upstreamRateM == null ? null : upstreamRateM / mpu,
    upstreamLeader,
    upstreamCount: upstream.length,
    rainAtStation6h,
    rainUpstream6h,
    rainContributors,
    notes,
  };
}

function emptyForecast(notes: string[]): TrendResult {
  return {
    currentLevel: null,
    predictedLevel: null,
    predictedDelta: null,
    direction: "unknown",
    confidence: "none",
    localRatePerH: null,
    upstreamRatePerH: null,
    upstreamLeader: null,
    upstreamCount: 0,
    rainAtStation6h: null,
    rainUpstream6h: null,
    rainContributors: [],
    notes,
  };
}
