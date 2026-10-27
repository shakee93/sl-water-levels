// Gauge-corrected satellite rain: the maths. Pure, no imports, no clock: scripts/rain-correct.mjs (the hourly job), the site and
// scripts/rain-correction.test.mts all load it with plain node (--experimental-strip-types).
//
// WHY. GSMaP (satellite) over-reads in the dry zone (24 h satellite 76-112 mm against 3-12 mm at the gauges, 26 Oct 2026) and
// under-reads short convective bursts. About 280 HMIS ground gauges report live; pairing each with the 0.1 degree satellite pixel it
// sits in, for the SAME 24 h window, tells us how far off the satellite is here, now.
//
// METHOD (v1, deliberately simple and robust; DOCS.md "Gauge-corrected satellite rain"):
//  1. Pairs: (satellite 24 h mm in the gauge's pixel, gauge 24 h mm). HMIS publishes only a 24 h sum per gauge, so the fit is on 24 h;
//     the 1 / 3 / 6 h figures reuse the factor (a multiplicative bias carries over, a residual in mm does not).
//  2. Factor = MEDIAN of gauge/satellite over pairs with satellite >= MIN_SAT_MM, per intensity class of the SATELLITE value (never of
//     the gauge: binning on the thing we are predicting would bias it) and per region. Classes: light < 10 mm, moderate 10-50, heavy >= 50.
//     Regions: Colombo metro, wet zone, intermediate, dry zone (regionOf: a coarse box rule, good enough because the factor is shrunk).
//  3. Shrinkage toward 1.0 when there are few pairs, in two steps: national class factor = 1 + w(m - 1); region-class factor =
//     national + w(m - national); w = n / (n + SHRINK_K), SHRINK_K = 8 (8 pairs -> half weight); under MIN_PAIRS pairs the parent is used as is.
//     Capped to FACTOR_MIN..FACTOR_MAX (0.1..3).
//  4. Residual interpolation: at each pixel, the gauge-minus-(factor x satellite) residuals of gauges within IDW_RADIUS_KM, Shepard
//     weights ((R-d)/(R d))^2 (d floored at 1.5 km), divided by (sum of weights + IDW_W0) so the correction fades to the factor-only field
//     where there is no gauge close by (about 0.97 of the nearest residual at 2 km, 0.67 at 5 km, 0.1 at 8 km, 0 past 10 km).
//     Applied to the 24 h field only. corrected24 = max(0, factor x satellite24 + residual).
//  5. 6 h (and 1 / 3 h, hourly frames): factor-only, no residual.
// Leave-one-out validation (looValidate) hides each gauge, refits everything from the others and predicts it.

export const MIN_SAT_MM = 1; // pairs with less satellite rain than this say nothing about a ratio
export const SHRINK_K = 8;
export const MIN_PAIRS = 3;
export const FACTOR_MIN = 0.1; // 0.3 would have clipped every class on 27 Oct 2026, when the satellite read 5-10 times the gauges
export const FACTOR_MAX = 3;
export const IDW_RADIUS_KM = 10;
export const IDW_D_FLOOR_KM = 1.5;
export const IDW_W0 = 0.005;
export const CLASS_LIGHT_MAX = 10;
export const CLASS_HEAVY_MIN = 50;

export type Region = "colombo" | "wet" | "intermediate" | "dry";
export type Class = "light" | "moderate" | "heavy";
export const REGIONS: Region[] = ["colombo", "wet", "intermediate", "dry"];
export const CLASSES: Class[] = ["light", "moderate", "heavy"];

export type Pair = { id: string; lat: number; lon: number; sat: number; gauge: number };
export type Cell = { f: number; n: number; med: number | null };
export type Factors = { national: Record<Class, Cell>; region: Record<Region, Record<Class, Cell>> };

/**
 * Climate region of a point by a coarse rule (not an official map): Colombo metro box; the wet zone is the south-west (lon < 80.6, lat < 7.3);
 * the dry zone is the north (lat >= 8.0), the east (lon >= 81.0) and the south-east (lat < 6.6, lon >= 80.6); everything else is intermediate.
 */
export function regionOf(lat: number, lon: number): Region {
  if (lat >= 6.75 && lat <= 7.1 && lon >= 79.8 && lon <= 80.05) return "colombo";
  if (lon < 80.6 && lat < 7.3) return "wet";
  if (lat >= 8.0 || lon >= 81.0 || (lat < 6.6 && lon >= 80.6)) return "dry";
  return "intermediate";
}

export const classOf = (satMm: number): Class => (satMm < CLASS_LIGHT_MAX ? "light" : satMm < CLASS_HEAVY_MIN ? "moderate" : "heavy");

export function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}
export const clampF = (f: number) => Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, f));

/** Pull `med` toward `parent` by n / (n + SHRINK_K); under MIN_PAIRS pairs (or no median) the parent is returned. Result is capped. */
export function shrink(med: number | null, n: number, parent: number): number {
  if (med == null || n < MIN_PAIRS) return clampF(parent);
  const w = n / (n + SHRINK_K);
  return clampF(parent + w * (med - parent));
}

/** Median gauge/satellite ratio over the pairs the predicate keeps; n = how many. */
function cellStat(pairs: Pair[], keep: (p: Pair) => boolean): { med: number | null; n: number } {
  const r = pairs.filter((p) => p.sat >= MIN_SAT_MM && keep(p)).map((p) => p.gauge / p.sat);
  return { med: r.length ? median(r) : null, n: r.length };
}

export function fitFactors(pairs: Pair[]): Factors {
  const national = {} as Record<Class, Cell>;
  for (const c of CLASSES) {
    const { med, n } = cellStat(pairs, (p) => classOf(p.sat) === c);
    national[c] = { f: shrink(med, n, 1), n, med };
  }
  const region = {} as Record<Region, Record<Class, Cell>>;
  for (const r of REGIONS) {
    region[r] = {} as Record<Class, Cell>;
    for (const c of CLASSES) {
      const { med, n } = cellStat(pairs, (p) => classOf(p.sat) === c && regionOf(p.lat, p.lon) === r);
      region[r][c] = { f: shrink(med, n, national[c].f), n, med };
    }
  }
  return { national, region };
}

export const factorFor = (fx: Factors, lat: number, lon: number, satMm: number): number => fx.region[regionOf(lat, lon)][classOf(satMm)].f;

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export type Resid = { lat: number; lon: number; r: number };

/** Residual of each pair against the factor-only prediction. */
export const residualsOf = (pairs: Pair[], fx: Factors): Resid[] => pairs.map((p) => ({ lat: p.lat, lon: p.lon, r: p.gauge - factorFor(fx, p.lat, p.lon, p.sat) * p.sat }));

/** Faded inverse-distance residual at a point (mm) and how many residual gauges lie within the radius. See header, step 4. */
export function idwResidual(res: Resid[], lat: number, lon: number): { r: number; near: number } {
  let sw = 0, swr = 0, near = 0;
  for (const g of res) {
    const d = haversineKm(lat, lon, g.lat, g.lon);
    if (d >= IDW_RADIUS_KM) continue;
    const dd = Math.max(d, IDW_D_FLOOR_KM);
    const w = ((IDW_RADIUS_KM - dd) / (IDW_RADIUS_KM * dd)) ** 2;
    sw += w;
    swr += w * g.r;
    near++;
  }
  return { r: near ? swr / (sw + IDW_W0) : 0, near };
}

/** Corrected 24 h rain at a point from its satellite 24 h value. */
export function correct24(fx: Factors, res: Resid[], lat: number, lon: number, sat24: number): { corr: number; factor: number; resid: number; near: number } {
  const factor = factorFor(fx, lat, lon, sat24);
  const { r, near } = idwResidual(res, lat, lon);
  return { corr: Math.max(0, factor * sat24 + r), factor, resid: r, near };
}
/** Corrected 1 / 3 / 6 h rain: factor-only (class taken from the 24 h satellite value of the same pixel). */
export const correctShort = (fx: Factors, lat: number, lon: number, sat24: number, satWindow: number): number => Math.max(0, factorFor(fx, lat, lon, sat24) * satWindow);

// ---------------------------------------------------------------- leave-one-out validation

export type Score = { n: number; maeRaw: number; maeFactor: number; maeCorrected: number; biasRawMm: number; meanGauge: number };
export type Loo = { all: Score | null; byRegion: Partial<Record<Region, Score>>; byClass: Partial<Record<Class, Score>> };
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Hide each gauge, refit factors and residuals from the others, predict it from its satellite pixel. Scored over pairs where either
 * the gauge or the satellite reads >= 1 mm (pairs where both are ~0 would only dilute the error). Classes are the satellite's.
 */
export function looValidate(pairs: Pair[]): Loo {
  const rows: { region: Region; cls: Class; raw: number; fac: number; cor: number; gauge: number; sat: number }[] = [];
  for (let j = 0; j < pairs.length; j++) {
    const p = pairs[j];
    if (Math.max(p.sat, p.gauge) < 1) continue;
    const rest = pairs.filter((_, i) => i !== j);
    const fx = fitFactors(rest);
    const res = residualsOf(rest, fx);
    const c = correct24(fx, res, p.lat, p.lon, p.sat);
    rows.push({ region: regionOf(p.lat, p.lon), cls: classOf(p.sat), raw: Math.abs(p.sat - p.gauge), fac: Math.abs(c.factor * p.sat - p.gauge), cor: Math.abs(c.corr - p.gauge), gauge: p.gauge, sat: p.sat });
  }
  const score = (rs: typeof rows): Score | null => {
    if (!rs.length) return null;
    const m = (f: (x: (typeof rows)[number]) => number) => rs.reduce((a, x) => a + f(x), 0) / rs.length;
    return { n: rs.length, maeRaw: r2(m((x) => x.raw)), maeFactor: r2(m((x) => x.fac)), maeCorrected: r2(m((x) => x.cor)), biasRawMm: r2(m((x) => x.sat - x.gauge)), meanGauge: r2(m((x) => x.gauge)) };
  };
  const byRegion: Loo["byRegion"] = {}, byClass: Loo["byClass"] = {};
  for (const r of REGIONS) { const s = score(rows.filter((x) => x.region === r)); if (s) byRegion[r] = s; }
  for (const c of CLASSES) { const s = score(rows.filter((x) => x.cls === c)); if (s) byClass[c] = s; }
  return { all: score(rows), byRegion, byClass };
}
