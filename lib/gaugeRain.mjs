// Rain-GAUGE wetness for the shadow street-flood rule. Plain JavaScript on purpose: scripts/rain-gauges-snapshot.mjs
// and scripts/street-rain-log.mjs run with plain node in GitHub Actions, and scripts/gauge-rain.test.mts loads it.
//
// Why: research/wellampitiya-flood-rule-backtest.md ("Antecedent wetness and upstream rain", G1 to G5) found that
// floods follow wetter weeks when wetness is measured by rain GAUGES (AUC 0.72), and not when it is measured by the
// satellite (0.50). The candidate "possible" tier needs the gauge index live. Definition, as the backtest computed it
// (scratchpad wf2/g/fixedg.py, lag 2, k 0.9):
//   daily value   = mean over the gauges that reported that day (a day with none = missing)
//   API           = sum over days i = 0.. of k^i * daily[eventDay - lag - i]   (a missing day adds 0)
//   k = 0.9 a day, lag = 2 days (the newest day used ended well before the rain window started, so none of the event's
//   own rain leaks in; lags 1 and 3 gave the same picture)
//   coverage      = at least 70% of the 7 days ending at eventDay - lag have a value, otherwise the index is unknown
//   wet           = API >= 96 mm (the 60th percentile of heavy-rain days, k 0.9)
// Unknown is null, never zero and never "dry".

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

export const API_K = 0.9;
export const API_LAG_DAYS = 2;
export const API_WET_MM = 96;
export const API_COVERAGE_DAYS = 7;
export const API_MIN_COVERAGE = 0.7;
/** The recursion in the backtest started at the series start; k^40 is 1.5%, so 40 days back is the same number to the mm. */
export const API_LOOKBACK_DAYS = 40;

/** Met Dept SYNOP stations the backtest used (WMO block numbers, via OGIMET). */
export const OGIMET_STATIONS = { "43466": "Colombo", "43450": "Katunayake", "43467": "Ratmalana" };

/** Irrigation Dept ArcGIS gauges used when OGIMET has no data: nearest rain-reporting gauges to Colombo, one per side. */
export const ARCGIS_GAUGES = ["Hanwella", "Glencourse", "Dunamale", "Badalgama"];
/** A gauge-day needs this many hourly readings (the feed is about hourly) to count as a day. */
export const ARCGIS_MIN_READINGS = 16;
/** ... and at least this many gauges must have a full day (a single gauge is too noisy to stand for the area). */
export const ARCGIS_MIN_GAUGES = 2;

const DAY = 86_400_000;
const COLOMBO_OFFSET_MS = 5.5 * 3_600_000;

/** Asia/Colombo calendar date (YYYY-MM-DD) of an epoch-ms time. */
export const colomboDay = (ms) => new Date(ms + COLOMBO_OFFSET_MS).toISOString().slice(0, 10);

/** YYYY-MM-DD plus n days (calendar arithmetic, no time zone involved). */
export function addDays(day, n) {
  return new Date(Date.parse(day + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * OGIMET getsynop text -> [{station, date, mm}] for the 03 UTC report only: its section-3 group 7RRRR is the rain of the
 * 24 h ending 08:30 Colombo time that day (date = the report date). 7999x = trace, stored as 0.05 mm. A report with no
 * readable 7-group gives no row (missing, not zero). Lines are "block,YYYY,MM,DD,HH,mm,AAXX ...".
 * @returns {{station: string, date: string, mm: number}[]}
 */
export function parseSynopRain(text) {
  const out = new Map();
  for (const line of String(text).split("\n")) {
    const p = line.trim().split(",");
    if (p.length < 7) continue;
    const [st, y, m, d, hh] = p;
    if (hh !== "03" || !/^\d{5}$/.test(st)) continue;
    const rep = p.slice(6).join(",");
    const at = rep.indexOf(" 333 ");
    if (at < 0) continue;
    const sec3 = rep.slice(at + 5).split(" 555")[0].replace(/=+$/, "").trim().split(/\s+/);
    let mm = null;
    for (const g of sec3) {
      if (g.length === 5 && g[0] === "7" && /^\d+$/.test(g.slice(1))) {
        const v = Number(g.slice(1)) / 10;
        mm = v >= 999 ? 0.05 : v;
      }
    }
    if (mm == null) continue;
    const date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    out.set(`${st}|${date}`, { station: st, date, mm });
  }
  return [...out.values()];
}

/** OGIMET query URL for one station and an inclusive range of calendar days. */
export function ogimetUrl(block, fromDay, toDay) {
  const c = (day) => day.replace(/-/g, "");
  return `https://ogimet.com/cgi-bin/getsynop?block=${block}&begin=${c(fromDay)}0000&end=${c(toDay)}2359`;
}

/**
 * ArcGIS gauge rows -> per Colombo day and gauge: {mm: sum of the hourly rain_fall values, n: readings}. A null or bad
 * rain_fall (negative, over 2000 mm) is not a reading. Only the listed gauges are kept.
 * @param {{gauge: string, ts: number, rain: number | null | undefined}[]} rows
 * @returns {Record<string, Record<string, {mm: number, n: number}>>}
 */
export function arcgisDailySums(rows, gauges = ARCGIS_GAUGES) {
  const out = {};
  for (const r of rows) {
    if (!gauges.includes(r.gauge) || !isNum(r.ts) || !isNum(r.rain) || r.rain < 0 || r.rain > 2000) continue;
    const day = colomboDay(r.ts);
    const g = ((out[day] ??= {})[r.gauge] ??= { mm: 0, n: 0 });
    g.mm += r.rain;
    g.n += 1;
  }
  for (const d of Object.values(out)) for (const g of Object.values(d)) g.mm = Math.round(g.mm * 10) / 10;
  return out;
}

/** Area daily rain from the Met Dept stations: the mean of the stations that reported (the backtest's definition); null = none did. */
export function ogimetDayMean(og) {
  const v = Object.values(og ?? {}).filter(isNum);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Area daily rain from the ArcGIS gauges: the mean of the gauges with a full day of readings; null if fewer than ARCGIS_MIN_GAUGES. */
export function arcgisDayMean(ag) {
  const v = Object.values(ag ?? {}).filter((g) => g && g.n >= ARCGIS_MIN_READINGS && isNum(g.mm)).map((g) => g.mm);
  return v.length >= ARCGIS_MIN_GAUGES ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/**
 * The antecedent precipitation index for one event day, from a function that gives the area's daily rain (mm or null).
 * Null when too few of the 7 days ending eventDay - lag have a value: the wetness is then unknown.
 * @param {(day: string) => (number | null | undefined)} dailyOf
 * @param {string} eventDay  YYYY-MM-DD (Asia/Colombo)
 */
export function antecedentIndex(dailyOf, eventDay, { k = API_K, lag = API_LAG_DAYS, lookback = API_LOOKBACK_DAYS, window = API_COVERAGE_DAYS, minCoverage = API_MIN_COVERAGE } = {}) {
  const last = addDays(eventDay, -lag);
  let have = 0;
  for (let i = 0; i < window; i++) if (isNum(dailyOf(addDays(last, -i)))) have++;
  if (have < Math.ceil(window * minCoverage - 1e-9)) return null;
  let api = 0;
  for (let i = 0; i < lookback; i++) {
    const v = dailyOf(addDays(last, -i));
    if (isNum(v)) api += Math.pow(k, i) * v;
  }
  return Math.round(api * 10) / 10;
}

/**
 * The wetness for one event day from the archive (day -> {og: {station: mm}, ag: {gauge: {mm, n}}}).
 * Prefers the Met Dept (OGIMET) series, which is what the 96 mm threshold was set on; falls back to the ArcGIS gauges
 * (different network, daily window is the calendar day instead of 08:30 to 08:30). Both are returned so the review can
 * compare them. `source` is "ogimet", "arcgis", or null when neither has enough days.
 * @returns {{apiMm: number | null, source: "ogimet" | "arcgis" | null, ogimetMm: number | null, arcgisMm: number | null}}
 */
export function gaugeWetness(archive, eventDay) {
  const ogimetMm = antecedentIndex((d) => ogimetDayMean(archive[d]?.og), eventDay);
  const arcgisMm = antecedentIndex((d) => arcgisDayMean(archive[d]?.ag), eventDay);
  if (ogimetMm != null) return { apiMm: ogimetMm, source: "ogimet", ogimetMm, arcgisMm };
  if (arcgisMm != null) return { apiMm: arcgisMm, source: "arcgis", ogimetMm, arcgisMm };
  return { apiMm: null, source: null, ogimetMm, arcgisMm };
}

/**
 * Read <dataDir>/rain-gauges/YYYY.jsonl (one line per Colombo day: {d, og?, ag?}) into {day: {og, ag}}.
 * A missing folder is an empty archive; unreadable lines are skipped.
 */
export function readGaugeArchive(dataDir) {
  const dir = path.join(dataDir, "rain-gauges");
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((n) => /^\d{4}\.jsonl$/.test(n)).sort()) {
    for (const line of readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (typeof r.d === "string") out[r.d] = { og: r.og ?? {}, ag: r.ag ?? {} };
      } catch {
        /* skip a damaged line */
      }
    }
  }
  return out;
}
