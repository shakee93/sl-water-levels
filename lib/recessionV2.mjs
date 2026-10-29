// recession-v2: falling-limb correction for the 3 / 6 / 12 / 24 h forecast. A SHADOW candidate (lib/shadowForecast.ts): logged beside the live
// forecast, scored on KPIs 4-8, never shown and never read by a verdict, alert or push. Pure and dependency-free except for the glitch filter.
//
// Why (28-29 Oct 2026 review of 4,218 live forecasts): when a river is FALLING (3 h rate below -0.1 ft/h) the live model holds the level too
// high, bias +0.60 ft at 6 h, +1.38 ft at 12 h, +2.25 ft at 24 h, and is barely better than "no change". The cause is that the storm flag
// switches off after the rain stops while the river keeps falling.
//
// The law (per gauge, fitted on 11 months of hourly readings, the Ditwah floods included): with L the current level, B the gauge's base level
// and E = L - B,   level(t+h) = L + w_h * (B + E * exp(-h / tau) - L)   (tau is either fixed, "exp", or read from the current fall rate,
// tau = c * E / fall rate, "expr"), or "rate": the fall rate shrinks by a factor rho every hour. w_h (0.2 to 1, mostly 0.35 to 0.5) shrinks the
// correction: the law matches the fall at high stage but over-predicts it at low and mid stage, in ordinary periods too. Fitted per gauge, or
// pooled (Kelani main stem / fast tributaries / river / all gauges) where a gauge has too few falling limbs; chosen by 5-fold blocked
// cross-validation. Parameters: lib/model/recession-params.json. Base level B is a FIXED per-gauge level (a low quantile of the gauge's own
// history): the live feed keeps only 26 h of readings, so a trailing 7-day base (tested, slightly better) cannot be computed at serving time.
//
// Evidence (study in the private scratchpad, summarised in DOCS.md "Shadow: recession-v2"), law vs "no change" mean absolute error in feet,
// fitted WITHOUT the test period:
//  * Cyclone Ditwah, 24 Nov to 8 Dec 2025 (held out, 3 / 6 / 12 / 24 h): all gauges 0.39|0.69, 0.75|1.21, 1.35|1.90, 1.98|2.93; Kelani main
//    stem (Glencourse, Hanwella) 0.23|0.60, 0.50|1.11, 0.95|1.89, 1.63|3.12; Kalu 0.25|0.59, 0.61|1.15, 1.34|2.02, 2.17|3.07.
//  * Last 60 days (30 Aug to 29 Oct 2026, held out): 0.38|0.57, 0.77|1.02, 1.38|1.54, 1.49|1.62 (the law stays biased about 0.9 ft low in that wet
//    spell, so the gain is real but modest).
//  * Live week 23-29 Oct, falling rows: 12 h 1.83 -> 1.43 ft, 24 h 2.71 -> 1.97 ft (rows where it applied: 1.75 -> 0.74 and 3.18 -> 1.04).
//  * False alarms: 17 runs removed (Dunamale minor and Rathnapura minor 27-28 Oct, Moragaswewa alert 27 Oct); correct warnings 167 -> 167;
//    26 real step crossings, none later or hidden. 26 Oct storm day: unchanged.
//
// GATES (all of them must hold, otherwise the live forecast is copied unchanged):
//  * the live method is the fitted model, the unit is known, the gauge has a law and was not switched off by the guard (a gauge whose law was
//    worse than "no change" on Ditwah or on the last 60 days: Padiyathalawa, Pitabeddara, Thaldena, Norwood, Urawa, Putupaula, Holombuwa,
//    Peradeniya, Nawalapitiya), the readings (glitch-filtered by lib/readingQc.mjs) give a 3 h rate and the latest reading does not look odd;
//  * the 3 h rate is at or below the trigger (-0.1 ft/h; the "slow" variant uses -0.03) and the last hour is not rising (> 0.02 ft/h);
//  * the rain forecast is KNOWN and calm: no storm flag, rain over the next 6 h < RAIN6_MAX_MM, 24 h p90 < RAIN24P90_MAX_MM. Unknown rain means
//    no correction: with the gate off, 26 Oct (a storm not yet forecast) got worse (12 h falling 2.80 -> 3.03 ft) and one real crossing was
//    warned 3 h later.
// The correction only ever LOWERS a level, never below the law; the 1 h step is never touched.
import { cleanReadings } from "./readingQc.mjs";

export const VARIANT = "recession-v2";
export const VARIANT_SLOW = "recession-v2-slow";
export const FT = 0.3048;
const HOUR = 3_600_000;
/** 3 h rate (ft/h) at or below which a gauge counts as falling. Same as the "falling" phase of the forecast review. */
export const TRIGGER_FT_PER_H = -0.1;
/** The slow-fall variant: same law, applied from a gentle fall. Live week: slow-fall 12 h 0.76 -> 0.70, 24 h 1.21 -> 1.10 ft; history: no harm. */
export const TRIGGER_SLOW_FT_PER_H = -0.03;
/** The last hour must not be rising by more than this (ft/h): the river has not turned. */
export const R1_MAX_FT_PER_H = 0.02;
/** Rain gate (mm): next 6 h forecast rain, and the 24 h p90. Run p90 of rain_next6h was 11 mm, of rain_next24h_p90 38 mm. */
export const RAIN6_MAX_MM = 10;
export const RAIN24P90_MAX_MM = 40;
/** Horizons the law may change (the 1 h step stays the live model's). */
export const HORIZONS = [3, 6, 12, 24];
/** Share of the way to the law (1 = the law itself; 0.5 to 2 tried on the live week: 1 is the best MAE). */
export const BETA = 1;
/** The 80% band's LOW edge is moved down by this many extra shifts (the live range held 72% at 12 h in the falling phase, 82% with this). */
export const WIDEN = 1;

/** Level (ft) the law gives for horizon h. g = one gauge entry of recession-params.json. */
export function lawLevelFt(g, L, r3, h) {
  const p = g.params, w = typeof p.w === "number" ? p.w : (p.w?.[h] ?? 1), B = p.B;
  let raw = L;
  if (g.law === "exp") raw = L <= B ? L : B + (L - B) * Math.exp(-h / p.tau);
  else if (g.law === "expr") {
    if (L > B) {
      const tau = Math.min(300, Math.max(3, (p.c * (L - B)) / Math.max(-r3, 0.02)));
      raw = B + (L - B) * Math.exp(-h / tau);
    }
  } else if (g.law === "rate") {
    if (r3 < 0) { let tot = 0, q = 1; for (let j = 1; j <= h; j++) { q *= p.rho; tot += q; } raw = Math.max(L + r3 * tot, Math.min(L, B)); }
  }
  return L + w * (raw - L);
}

/**
 * Fall rates in ft/h from READINGS ALREADY CLEANED: r3 over the reading nearest to 3 h back (within 40 min), r1 over the one nearest to
 * 1 h back (within 30 min; null when none). null when there is no reading about 3 h back.
 */
export function ratesFt(unit, currentLevel, asOfTs, observations) {
  if (unit == null || currentLevel == null || asOfTs == null) return null;
  const k = unit === "m" ? 1 / FT : 1;
  const valid = observations.filter((o) => o.level != null && Number.isFinite(o.level) && o.ts <= asOfTs + 10 * 60_000);
  const near = (back, tol) => valid.filter((o) => Math.abs(o.ts - (asOfTs - back * HOUR)) <= tol).sort((a, b) => Math.abs(a.ts - (asOfTs - back * HOUR)) - Math.abs(b.ts - (asOfTs - back * HOUR)))[0];
  const b3 = near(3, 40 * 60_000);
  if (!b3) return null;
  const b1 = near(1, 30 * 60_000);
  return { r3: ((currentLevel - b3.level) * k) / ((asOfTs - b3.ts) / HOUR), r1: b1 ? ((currentLevel - b1.level) * k) / ((asOfTs - b1.ts) / HOUR) : null };
}

/**
 * The candidate for one gauge.
 * @param f   { station, unit: "ft"|"m"|null, currentLevel, asOfTs, method, horizons: [{h, ts, level, low, high}] } (native unit)
 * @param observations  [{ts, level}] raw recent readings in the gauge's unit (glitches are removed here with lib/readingQc.mjs)
 * @param rain  { storm: boolean|null, next6hMm: number|null, next24hP90Mm: number|null }; null / undefined = unknown (no correction)
 * @param params  lib/model/recession-params.json
 * @param opt  { trigger } ft/h (default TRIGGER_FT_PER_H); { beta, widen }
 * @returns { horizons, applied, reason }  horizons has the same shape as f.horizons, copied (f is never mutated)
 */
export function recessionV2(f, observations, rain, params, opt = {}) {
  const trig = opt.trigger ?? TRIGGER_FT_PER_H, beta = opt.beta ?? BETA, widen = opt.widen ?? WIDEN;
  const copy = f.horizons.map((p) => ({ ...p }));
  const none = (reason) => ({ horizons: copy, applied: false, reason });
  if (!f.horizons.length) return none("no-horizons");
  if (f.method !== "model") return none("not-model");
  if (f.unit !== "ft" && f.unit !== "m") return none("unit-unknown");
  const g = params?.gauges?.[f.station];
  if (!g || g.law === "persist" || !g.hOn?.length) return none(g?.disabledByGuard ? "guard-off" : "no-law");
  // readings: same glitch filter as the live forecast inputs; a latest reading that jumped like a glitch is not trusted
  const c = cleanReadings((observations ?? []).filter((o) => o.level != null).map((o) => ({ ts: o.ts, water_level: o.level })), { unit: f.unit });
  if (c.odd) return none("latest-odd");
  const rt = ratesFt(f.unit, f.currentLevel, f.asOfTs, c.readings.map((r) => ({ ts: r.ts, level: r.water_level })));
  if (!rt) return none("no-rate");
  if (!(rt.r3 <= trig)) return none("not-falling");
  if (rt.r1 != null && rt.r1 > R1_MAX_FT_PER_H) return none("turning-up");
  const r6 = rain?.next6hMm ?? null, r24 = rain?.next24hP90Mm ?? null;
  if (rain == null || rain.storm == null || (r6 == null && r24 == null)) return none("rain-unknown");
  if (rain.storm) return none("storm");
  if ((r6 ?? 0) >= RAIN6_MAX_MM || (r24 ?? 0) >= RAIN24P90_MAX_MM) return none("heavy-rain");
  const k = f.unit === "m" ? 1 / FT : 1, back = f.unit === "m" ? FT : 1;
  const L = f.currentLevel * k;
  let any = false;
  const horizons = f.horizons.map((p) => {
    if (!HORIZONS.includes(p.h) || !g.hOn.includes(p.h)) return { ...p };
    const d = Math.max(0, p.level * k - lawLevelFt(g, L, rt.r3, p.h)) * beta; // feet to lower: never raise
    if (d <= 0) return { ...p };
    any = true;
    const dn = d * back;
    return { ...p, level: p.level - dn, low: p.low == null ? null : p.low - dn - widen * dn, high: p.high == null ? null : p.high - dn };
  });
  return { horizons, applied: any, reason: any ? "applied" : "law-not-lower" };
}
