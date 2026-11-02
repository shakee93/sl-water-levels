// Gauge-first catchment rain for the river-level forecast (owner decision 2 Nov 2026: "prioritize the live rain gauges and fall back to
// satellite if not available"). Pure: no network, no clock, no repo state beyond the two catchment JSON files. Shared by lib/forecast.ts
// (serving), scripts/gauge-first-rain-backtest.mts and scripts/gauge-first-rain.test.mts.
//
// WHY. On 31 Oct - 1 Nov the Kelani storm was missed upstream: HMIS ground gauges inside the catchment measured 55-77 mm in 24 h while
// JAXA GSMaP read about 1 mm, so the storm models (lib/model/stormModel.mjs) never switched on and Hanwella peaked 1.5 ft above the forecast.
//
// WHAT. For each of the three zones the v4 storm model reads (full catchment, "near" = beside the gauge, "up" = up-channels; the cells of
// lib/model/catchments.json and lib/model/subcatchments.json) and each hour k = -24 ... 0 (k = hour ending k hours after the forecast hour,
// the same convention as stormModel.mjs): if at least one live HMIS rain gauge inside the zone has a value for that hour the zone's rain is the
// MEAN of those gauges (no satellite bias factor: the factor corrects the satellite, not a gauge; the 15 mm/h hourly clip still applies, in
// v4Rain); otherwise the caller falls back to the satellite hour exactly as before. No gauge in a zone = nothing changes, byte for byte.
//
// HOURLY RAIN FROM A ROLLING 24 h SUM. HMIS gives each gauge only S(t) = mm in the last 24 h, and the live state keeps ~4.5 h of
// [minute, S] points (data:hmis/rain-live.json, lib/groundRain.ts). The exact recursion r(t) = S(t) - S(t-1h) + r(t-24h) needs the rain of
// 24 h earlier, which is not kept, so:
//   1. The 24 hours k = -24 ... -1 must add up to the gauge's OWN 24 h figure at the hour mark S(origin - 1 h) (interpolated between its points; at most 45 minutes
//      of extrapolation). That keeps the storm-gate total (past 24 h) equal to what the gauges say, whatever the shape.
//   2. Hours the kept points cover get S(e) - S(e - 1 h), floored at 0 (a LOWER BOUND: it can only under-read, and only when it also rained at that
//      same hour yesterday; lib/groundRain.ts section 2). If these exceed the 24 h total (the floor at 0 can do that) they are scaled down to it.
//   3. The rest of the 24 h total (>= 0 by construction) is spread over the hours the points do NOT cover, in the shape of the satellite's raw
//      hourly series for the zone (70% satellite shape + 30% uniform, so an hour the satellite missed still gets some), or uniformly when the
//      satellite shows less than 2 mm over those hours or is missing. Hour k = 0 (the hour that has just ended) is the lower bound only: null when the points do not cover it.
// A gauge whose record is older than ~1.75 h at the hour mark, or reads a 24 h sum of more than 500 mm (sensor glitch), is not used.

export const HOUR = 3_600_000;
const MIN = 60_000;
/** A gauge 24 h sum above this is a sensor fault, not rain (the 1989-2017 Kelani floods were 300-450 mm at the heaviest point). */
export const MAX_GAUGE_24H_MM = 500;
/** Satellite shape weight vs uniform when spreading the part of the 24 h total the points do not cover. */
export const SHAPE_SAT_WEIGHT = 0.7;
/** Below this many mm of satellite rain over the uncovered hours the shape is uniform. */
export const SHAPE_MIN_SAT_MM = 2;
/** How far past its newest point S(t) may be read at the hour mark of the 24 h total (minutes), and for an hourly increment. */
export const EXTRAPOLATE_TOTAL_MIN = 45;
export const EXTRAPOLATE_INC_MIN = 20;

// ---------------------------------------------------------------------------------------------- zones

/** Build { full, near, up } lists of [lat, lon] cell centres and the half cell size for a gauge name; null when the gauge has no rain grid. */
export function zonesFrom(catchments, subcatchments, station) {
  for (const [basin, b] of Object.entries(catchments?.basins ?? {})) {
    const e = b.stations?.[station];
    if (!e) continue;
    const lats = [...new Set(b.grid.map((g) => g[0]))].sort((x, y) => x - y), lons = [...new Set(b.grid.map((g) => g[1]))].sort((x, y) => x - y);
    const gap = (a) => a.slice(1).map((v, i) => v - a[i]).filter((d) => d > 1e-6);
    const step = Math.min(...gap(lats), ...gap(lons), 0.15);
    const cells = (idx) => (idx ?? []).map((i) => b.grid[i]).filter(Boolean);
    const sub = subcatchments?.[basin]?.[station];
    const near = sub?.near?.length ? cells(sub.near) : null, up = sub?.up?.length ? cells(sub.up) : null;
    return { basin, half: step / 2, full: cells(e.cells), near, up };
  }
  return null;
}

/** Is the point inside one of the (square) cells? */
export function inCells(cells, half, lat, lon) {
  return !!cells && cells.some(([la, lo]) => Math.abs(lat - la) <= half + 1e-9 && Math.abs(lon - lo) <= half + 1e-9);
}

// ---------------------------------------------------------------------------------------------- switch-on guard

/**
 * A storm model may be switched ON by the gauges (when the satellite / weather path would not have switched it on) only when at least
 * GUARD_MIN_GAUGES gauges in the full catchment zone each measured >= GUARD_MIN_MM in the past 24 h. Backtest 27 Oct - 1 Nov: single wet gauges
 * switched models on 47 times on days the river barely moved (Thawalama, Padiyathalawa) and blew the 24 h range out to ~5.7 m. The guard only
 * limits switch-ONs: the gauge-first series still feeds the features, and gauges can still switch a satellite storm OFF.
 */
export const GUARD_MIN_GAUGES = 2;
export const GUARD_MIN_MM = 20;
/** @param {{ mm24: number }[]} used  GroundRainSeries.used */
export function switchOnAllowed(used) {
  return (used ?? []).filter((u) => u.mm24 >= GUARD_MIN_MM).length >= GUARD_MIN_GAUGES;
}

// ---------------------------------------------------------------------------------------------- one gauge

function cleanPts(pts) {
  return (pts ?? [])
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] >= 0)
    .map((p) => [p[0] * MIN, p[1]])
    .sort((a, b) => a[0] - b[0]);
}

/** S(t) by linear interpolation; between the first point and `tolMin` minutes past the last it is clamped; otherwise null. */
function sAt(p, t, tolMin) {
  if (!p.length) return null;
  const first = p[0][0], last = p[p.length - 1][0];
  if (t < first || t > last + tolMin * MIN) return null;
  if (t >= last) return p[p.length - 1][1];
  let i = 0;
  while (i + 1 < p.length && p[i + 1][0] < t) i++;
  const a = p[i], b = p[i + 1];
  if (!b || b[0] === a[0]) return a[1];
  return a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]);
}

/**
 * Hourly rain of one gauge for the hours k = -24 ... 0 before `origin` (ms, the forecast hour; hour k ends at origin + k h).
 * @param pts   [epoch MINUTE, mm in the last 24 h] points (lib/groundRain.ts GaugeState.pts)
 * @param shape (k) => raw satellite mm for that hour, or null; shapes the part of the 24 h total the points do not cover
 * @returns {{ r: Map<number, number>, total24: number, covered: number } | null}  null = gauge unusable at this hour mark
 */
export function gaugeHourly(pts, origin, shape = () => null) {
  const p = cleanPts(pts);
  const S1 = sAt(p, origin - HOUR, EXTRAPOLATE_TOTAL_MIN);
  if (S1 == null || S1 > MAX_GAUGE_24H_MM) return null;
  const inc = (k) => {
    const e = origin + k * HOUR;
    const a = sAt(p, e - HOUR, EXTRAPOLATE_INC_MIN), b = sAt(p, e, EXTRAPOLATE_INC_MIN);
    return a == null || b == null ? null : Math.max(0, b - a);
  };
  const r = new Map();
  const lb = new Map();
  for (let k = -1; k >= -24; k--) {
    const v = inc(k);
    if (v == null) break; // covered hours are contiguous from k = -1 downwards
    lb.set(k, v);
  }
  let L = 0;
  for (const v of lb.values()) L += v;
  const scale = L > S1 && L > 0 ? S1 / L : 1;
  for (const [k, v] of lb) r.set(k, v * scale);
  const rest = Math.max(0, S1 - L * scale);
  const U = [];
  for (let k = -24; k <= -1; k++) if (!lb.has(k)) U.push(k);
  if (U.length) {
    const sat = U.map((k) => { const v = shape(k); return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0; });
    const sumSat = sat.reduce((a, b) => a + b, 0);
    for (let i = 0; i < U.length; i++) {
      const w = sumSat >= SHAPE_MIN_SAT_MM ? SHAPE_SAT_WEIGHT * (sat[i] / sumSat) + (1 - SHAPE_SAT_WEIGHT) / U.length : 1 / U.length;
      r.set(U[i], rest * w);
    }
  }
  const v0 = inc(0);
  if (v0 != null) r.set(0, v0);
  return { r, total24: S1, covered: lb.size };
}

// ---------------------------------------------------------------------------------------------- the zones

/**
 * Gauge-first rain for one gauge station at one forecast hour.
 * @param {{ station: string, gauges: { n: string, i?: string, lat: number, lon: number, pts: [number, number][] }[], origin: number,
 *   sat?: { full?: (k:number)=>number|null, near?: (k:number)=>number|null, up?: (k:number)=>number|null } | null, zones: ReturnType<typeof zonesFrom> }} a
 * @returns {null | { full: (k:number)=>number|null, near: (k:number)=>number|null, up: ((k:number)=>number|null) | null, past24Full: number|null,
 *   used: { name: string, institute: string, zones: string[], mm24: number }[] }}  null = no usable gauge in the catchment (satellite as before)
 *   Each function returns the zone's gauge mean for that hour, raw (no bias factor, no clip), or null where no gauge has the hour.
 */
export function groundRainSeries({ gauges, origin, sat, zones }) {
  if (!zones || !Array.isArray(gauges) || !gauges.length) return null;
  const inFull = (g) => inCells(zones.full, zones.half, g.lat, g.lon);
  const nearCells = zones.near ?? zones.full;
  const rows = [];
  for (const g of gauges) {
    if (!g || !Number.isFinite(g.lat) || !Number.isFinite(g.lon) || !inFull(g)) continue;
    const inNear = inCells(nearCells, zones.half, g.lat, g.lon);
    const inUp = !!zones.up && inCells(zones.up, zones.half, g.lat, g.lon);
    // shape from the zone the gauge sits in (near beside the gauge, else up, else the whole catchment)
    const sh = (inNear ? sat?.near : inUp ? sat?.up : null) ?? sat?.full ?? (() => null);
    const h = gaugeHourly(g.pts, origin, sh);
    if (!h) continue;
    rows.push({ g, h, inNear, inUp });
  }
  if (!rows.length) return null;
  const zoneFn = (pick) => {
    const rs = rows.filter(pick);
    if (!rs.length) return null;
    return (k) => {
      let s = 0, n = 0;
      for (const x of rs) { const v = x.h.r.get(k); if (typeof v === "number") { s += v; n++; } }
      return n ? s / n : null;
    };
  };
  const full = zoneFn(() => true);
  let past24Full = 0;
  for (let k = -24; k <= -1; k++) { const v = full(k); if (v == null) { past24Full = null; break; } past24Full += v; }
  const near = zoneFn((x) => x.inNear) ?? (() => null);
  return {
    full,
    near,
    up: zoneFn((x) => x.inUp),
    past24Full,
    used: rows.map((x) => ({ name: String(x.g.n ?? ""), institute: String(x.g.i ?? ""), zones: ["full", ...(x.inNear ? ["near"] : []), ...(x.inUp ? ["up"] : [])], mm24: Math.round(x.h.total24 * 10) / 10 })),
  };
}
