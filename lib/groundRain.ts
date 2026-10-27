// Ground-gauge rain for the street-water rule: pure maths, no imports, no I/O, no clock (the caller passes `now`), so the website
// (lib/groundRainLive.ts), the logging job (scripts/ground-rain-shadow.mjs, plain node with --experimental-strip-types) and the
// tests all load this one file.
//
// 1. WHAT HMIS GIVES US (checked 27 Oct 2026 against getrainfalldevices)
//    Per gauge: `sum_diffval_in_period` = mm over the LAST 24 HOURS, rolling (a 15-minute NBRO gauge shows record_count 96, a 13-minute
//    Met Department gauge about 107, an hourly Irrigation Department gauge 24), and `latest_record_time` (real UTC). `last_value` /
//    `second_last_value` are the sensor's own last two raw readings (some gauges send a running total, some a per-interval value), so
//    they are NOT used. scripts/hmis-snapshot.mjs therefore keeps, per gauge, [epoch minute, 24 h sum] for every snapshot that saw a new
//    record, for the last 4.5 h (data:hmis/rain-live.json). That is all the history there is.
// 2. DERIVING SHORT TOTALS FROM A ROLLING 24 h SUM
//    S(t) = rain in (t-24h, t]. So S(t2) - S(t1) = rain in (t1, t2]  MINUS  rain in (t1-24h, t2-24h] (what left the window).
//    The second term is never negative, so max(0, S(t2) - S(t1)) is a LOWER BOUND of the rain in (t1, t2]: it can only under-read, and only
//    when it also rained at that same hour yesterday. We never add anything: the rule can miss, never invent, rain. Reported as
//    `lowerBound: true` always (the 24 h figure is exact).
//    The window ends at the gauge's newest record. A window of span W minutes uses the older point whose gap dt is nearest W inside
//    [0.75 W, 1.25 W]; a shorter gap is scaled up (x W/dt), a longer one is NOT scaled down, so a burst is never diluted. No older point in
//    range = null (unknown, never zero). Peak hourly intensity = the largest 1 h figure over every such pair in the kept state.
// 3. SOURCE HIERARCHY (pickRain)
//    (a) ground: live gauges within 5 km whose newest record is at most 60 minutes old; the nearest one, or the inverse-distance mean
//        (1/d^2, d floored at 0.5 km) when two or more are in range; (b) gauge-corrected satellite (lib/rainCorrected.ts, 3 h old at most);
//        (c) raw GSMaP. The answer says which one it used.
// 4. THE GROUND STREET-WATER RULE (groundStreetState): its own thresholds, NOT the satellite 60 / 100 mm marks, whose frame is a 24 h sum
//    of a 0.1 degree pixel (see the constants).
//
// A NOTE and a SHADOW test only (DOCS.md "Ground-gauge street rain"): nothing here changes an official step, a town tone or a push.

export const MIN_MS = 60_000;
/** A ground gauge counts at all within this distance of the town (5 km). */
export const GROUND_NEAR_KM = 5;
/** ... and only while its newest record is at most this old (Met 13 min, NBRO 15 min, Irrigation Department hourly cadence). */
export const GROUND_MAX_AGE_MIN = 60;
/** The corrected satellite is used up to this age (lib/rainCorrected.ts RAIN_CORRECTION_MAX_AGE_MS). */
export const CORRECTED_MAX_AGE_MIN = 180;

/** One gauge as scripts/hmis-snapshot.mjs stores it in hmis/rain-live.json: points are [epoch MINUTES UTC, mm in the last 24 h]. */
export type GaugeState = { device?: string; n: string; i: string; lat: number; lon: number; pts: [number, number][] };

export type GaugeTotals = {
  /** Minutes since the newest record. */
  ageMin: number;
  /** mm in the last hour / 3 hours (LOWER BOUNDS, see 2.); null = no older point in range. */
  mm1h: number | null;
  mm3h: number | null;
  /** Exact: HMIS's own 24 h sum at the newest record. */
  mm24h: number;
  /** Largest 1 h figure in the kept state (same bound); null = no pair of points about an hour apart. */
  peak1h: number | null;
};

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const sorted = (pts: [number, number][]) =>
  pts.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] >= 0).sort((a, b) => a[0] - b[0]);

/** Rain in the `spanMin` minutes up to the point at index `endIdx`; see 2. null when no older point is about that far back. */
export function windowMm(pts: [number, number][], endIdx: number, spanMin: number): number | null {
  const end = pts[endIdx];
  if (!end) return null;
  let best: [number, number] | null = null;
  for (let i = 0; i < endIdx; i++) {
    const dt = end[0] - pts[i][0];
    if (dt < 0.75 * spanMin || dt > 1.25 * spanMin) continue;
    if (!best || Math.abs(dt - spanMin) < Math.abs(end[0] - best[0] - spanMin)) best = pts[i];
  }
  if (!best) return null;
  const dt = end[0] - best[0];
  const d = Math.max(0, end[1] - best[1]);
  return r1(dt < spanMin ? (d * spanMin) / dt : d);
}

/** 1 h, 3 h, 24 h and peak hourly intensity of one gauge at `nowMs`. null when the gauge has no points. */
export function gaugeTotals(pts: [number, number][], nowMs: number): GaugeTotals | null {
  const p = sorted(pts);
  if (!p.length) return null;
  const last = p.length - 1;
  let peak: number | null = null;
  for (let i = 1; i <= last; i++) {
    const w = windowMm(p, i, 60);
    if (w != null && (peak == null || w > peak)) peak = w;
  }
  return { ageMin: Math.max(0, Math.round((nowMs - p[last][0] * MIN_MS) / MIN_MS)), mm1h: windowMm(p, last, 60), mm3h: windowMm(p, last, 180), mm24h: r1(p[last][1]), peak1h: peak };
}

export type GaugeUse = { name: string; institute: string; km: number; ageMin: number; totals: GaugeTotals; weight: number };
export type RainSource = "ground" | "corrected" | "raw" | "none";
export type RainPick = {
  source: RainSource;
  mm1h: number | null;
  mm3h: number | null;
  mm24h: number | null;
  peak1h: number | null;
  /** Ground gauges used (nearest first); empty for the satellite tiers. */
  gauges: GaugeUse[];
  /** True when some short total is unknown (a gauge that has only just appeared, or only the satellite's 24 h figure): a calm answer then means "unknown", not "none". */
  partial: boolean;
};

export type SatIn = { corr24?: number | null; raw24?: number | null; raw1h?: number | null; raw3h?: number | null };

/**
 * The source hierarchy for a point. `gauges` = hmis/rain-live.json devices (or anything shaped like it) as an array.
 * `corrected` / `raw` are the satellite numbers for the point's zone; the caller passes `corr24` only when the correction is at most 3 h old.
 */
export function pickRain(at: { lat: number; lon: number }, gauges: GaugeState[], nowMs: number, sat: SatIn = {}, opts: { maxKm?: number; maxAgeMin?: number } = {}): RainPick {
  const maxKm = opts.maxKm ?? GROUND_NEAR_KM, maxAge = opts.maxAgeMin ?? GROUND_MAX_AGE_MIN;
  const used: GaugeUse[] = [];
  for (const g of gauges) {
    if (!g || !Number.isFinite(g.lat) || !Number.isFinite(g.lon) || !Array.isArray(g.pts)) continue;
    const km = haversineKm(at, g);
    if (km > maxKm) continue;
    const totals = gaugeTotals(g.pts, nowMs);
    // a record "from the future" (clock skew beyond 10 minutes) is not trusted
    if (!totals || totals.ageMin > maxAge || (g.pts.length && g.pts[g.pts.length - 1][0] * MIN_MS > nowMs + 10 * MIN_MS)) continue;
    used.push({ name: g.n, institute: g.i, km: r1(km), ageMin: totals.ageMin, totals, weight: 1 / Math.max(km, 0.5) ** 2 });
  }
  if (used.length) {
    used.sort((a, b) => a.km - b.km);
    const use = used.length === 1 ? [{ ...used[0], weight: 1 }] : used;
    const mean = (k: keyof GaugeTotals): number | null => {
      let w = 0, s = 0;
      for (const u of use) {
        const v = u.totals[k];
        if (typeof v === "number") { w += u.weight; s += u.weight * v; }
      }
      return w > 0 ? r1(s / w) : null;
    };
    const mm1h = mean("mm1h"), mm3h = mean("mm3h"), peak1h = mean("peak1h");
    return { source: "ground", mm1h, mm3h, mm24h: mean("mm24h"), peak1h, gauges: used, partial: mm1h == null || mm3h == null };
  }
  if (typeof sat.corr24 === "number" && Number.isFinite(sat.corr24)) return { source: "corrected", mm1h: null, mm3h: null, mm24h: r1(sat.corr24), peak1h: null, gauges: [], partial: true };
  if (typeof sat.raw24 === "number" && Number.isFinite(sat.raw24))
    return { source: "raw", mm1h: sat.raw1h ?? null, mm3h: sat.raw3h ?? null, mm24h: r1(sat.raw24), peak1h: null, gauges: [], partial: sat.raw1h == null || sat.raw3h == null };
  return { source: "none", mm1h: null, mm3h: null, mm24h: null, peak1h: null, gauges: [], partial: true };
}

// ------------------------------------------------------------------------------------------------ the rule

export type StreetState = "none" | "possible" | "likely";

/**
 * Thresholds of the GROUND rule (point gauge, mm; "possible" = low streets may get water, "likely" = they probably will). Any one trigger
 * is enough. Sources and the adjustment:
 *  - Drain design. Colombo's storm drains are designed for the 10-year storm, "an accepted norm in Sri Lanka" (ENGINEER, Univ. of Moratuwa,
 *    on the Metro Colombo Urban Development Project (MCUDP) models). MCUDP / SLLDC micro-drainage design storm: 1 h, 100.68 mm for the
 *    10-year return period (CUrW/SLLDC completion report, pub.curwsl.org/dyn/PCR-2023_03-04_19_00_00.pdf, ch. 6). 24 h rain for Metro
 *    Colombo: 2-year 144 mm, 5-year 197 mm, 10-year 256 mm (same report, Table 6.1); JICA Greater Colombo basin mean: 2-year 117 mm,
 *    5-year 176 mm, 10-year 214 mm (JICA Greater Colombo drainage study, supporting report 1, 3.3.3). So a drain is "full" near 100 mm/h
 *    and 150-250 mm/day, far above what floods these streets: the streets in residents' reports flood from blocked and backed-up
 *    drains and a full canal well below design. The thresholds below are therefore set from the evidence, not from the design storm.
 *  - Evidence (research/wellampitiya-flood-rule-backtest.md, V2, 16 floods 2018-2026, Colombo / Katunayake / Ratmalana gauges, daily):
 *    mean of the 3 gauges >= 50 mm: 12 of 16 floods, 4.4 unmatched alarms a year; >= 75 mm: 9 of 16, 1.7 a year; heaviest gauge >= 50 mm on
 *    15 of 16 floods, >= 75 mm on 12, >= 100 mm on 9. In frequency terms the satellite's 60 / 100 mm equal a gauge 42 / 76 mm day, and
 *    on gauge-wet days the satellite read only 0.78 of the gauge. So 24 h: possible 50, likely 75 (a single gauge is noisier than a
 *    3-gauge mean; the shadow run measures how much, see the switch criteria in DOCS.md). The 15 mm hourly clip is NOT applied: it removed
 *    satellite spikes that gauges do not have.
 *  - Intensity. Peak 1 h rain was the best single separator of flood days from other heavy-rain days in the backtest (AUC 0.83). 30 mm/h
 *    possible and 50 mm/h likely are about 30 % and 50 % of the 10-year design hour, a 30-40 mm/h working figure; 3 h: 50 / 75 mm.
 *    The 22 Oct 2026 flood (Wellampitiya, Nagalagam 3.0 ft, river normal) had gauges 125 mm in the day; 12 Oct 2026, 51 mm at Colombo with
 *    no recorded flood, would be "possible" and not "likely".
 *  - Modifiers, applied exactly as the existing rule applies them: the Kelani at its minor flood level (Nagalagam 5 ft / Hanwella's own
 *    minor mark, lib/streetRainLog.ts riverTrigger) alone makes "likely"; a wet week by gauges (antecedent index >= 96 mm, lib/gaugeRain.mjs)
 *    lowers the "possible" 3 h and 24 h marks to 75 % (45 / 60 in the satellite shadow rule), because a wet canal needs less rain.
 */
export const GROUND_RULE = {
  possible: { mm1h: 30, mm3h: 50, mm24h: 50 },
  likely: { mm1h: 50, mm3h: 75, mm24h: 75 },
  /** Multiplier on the possible 3 h and 24 h marks after a wet week (same 45 / 60 ratio as the satellite shadow rule). */
  wetFactor: 0.75,
} as const;

export type GroundMetrics = { mm1h?: number | null; mm3h?: number | null; mm24h?: number | null; peak1h?: number | null; partial?: boolean };
export type GroundVerdict = { state: StreetState | null; /** which trigger fired, e.g. "1 h 42 mm"; "" for none / unknown */ why: string };

const has = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * "none" | "possible" | "likely", or null = unknown. Unknown (never "none") when there is no rain figure at all and no river trigger, or when
 * nothing fired but a short total is unknown (`partial`): a gauge that cannot say what fell in the last hour does not get to say "calm".
 */
export function groundStreetState(m: GroundMetrics, opts: { river?: boolean; wet?: boolean } = {}): GroundVerdict {
  if (opts.river) return { state: "likely", why: "river at minor level" };
  const h1 = has(m.mm1h) || has(m.peak1h) ? Math.max(m.mm1h ?? 0, m.peak1h ?? 0) : null;
  const h3 = has(m.mm3h) ? m.mm3h : null, h24 = has(m.mm24h) ? m.mm24h : null;
  if (h1 == null && h3 == null && h24 == null) return { state: null, why: "" };
  const L = GROUND_RULE.likely, P = GROUND_RULE.possible;
  const wf = opts.wet ? GROUND_RULE.wetFactor : 1;
  const fired = (t: { mm1h: number; mm3h: number; mm24h: number }, f: number): string => {
    if (h1 != null && h1 >= t.mm1h) return `1 h ${Math.round(h1)} mm`;
    if (h3 != null && h3 >= t.mm3h * f) return `3 h ${Math.round(h3)} mm`;
    if (h24 != null && h24 >= t.mm24h * f) return `24 h ${Math.round(h24)} mm`;
    return "";
  };
  const l = fired(L, 1);
  if (l) return { state: "likely", why: l };
  const p = fired(P, wf);
  if (p) return { state: "possible", why: p };
  return m.partial ? { state: null, why: "" } : { state: "none", why: "" };
}

/** Plain-language list of the gauges used, for logs and Slack: "Kolonnawa Met gauge (4.4 km)". */
export function gaugeLabel(g: Pick<GaugeUse, "name" | "institute" | "km">): string {
  const inst = g.institute === "Met Department" ? "Met" : g.institute;
  const n = g.name.replace(/\s+/g, " ").trim();
  return `${n} ${inst} gauge (${g.km} km)`;
}
