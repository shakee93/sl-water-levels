// "Wet core" rain for the river-level forecast: a HIDDEN SHADOW variant (name `wet-core`), logged beside the live forecast, never shown, never read by a
// verdict, warning, push or the forecast panel (KPI cycle: one fix as a hidden shadow, 7-day trial including rain, then promote). Pure: no network, no clock.
//
// WHY. On 1 Nov 2026 the Kelani storm sat over the middle of the Hanwella catchment: Amanawala, Kalupahana, Kitulgala, Dehiovita and Deraniyagala read 60-77 mm in
// 24 h, but the mean over all 46 gauges inside the catchment was 17 mm. The storm models (lib/model/stormModel.mjs) read CATCHMENT-MEAN rain: their gate is 40 mm
// in 24 h, and even forced on their correction is small, because the 12 h weights sit on the rain that is still to fall (forecast) and on the last hour, not on
// the rain of the last 24 h. Tested in scripts/wet-core-backtest.mts: scaling the gauge-first rain up to the core (arm A, up to the core's own mean) did not move the
// Hanwella 12 h forecast (+-0.03 m) but switched storm models on for 25 false runs at the middle setting. So the shadow does not touch the storm model.
//
// WHAT (a floor on the rise). From the 24 h totals of the live gauges inside the full catchment (GroundRainSeries.used):
//   core24  = mean of the k wettest gauges, k = max(CORE_MIN_K, ceil(CORE_SHARE x n)), n >= CORE_MIN_N gauges
//   recent3 = mean of the k gauges that were wettest in the last 3 h (lower bound from the live 4.5 h points, lib/model/gaugeRain.mjs `mm3`)
//   active  only when core24 >= CORE_MIN_MM AND the k-th wettest gauge alone is >= CORE_EDGE_MM AND recent3 >= RECENT_MIN_MM
//           (k gauges ALL wet, so one glitching gauge cannot switch it on; and the core is raining NOW: on 28 Oct the 24 h totals were still 41-48 mm
//           over the Kelani, left over from the 27 Oct flood, and the river was falling, a rise to come would have been a false alarm)
//   R       = min(RISE_CAP, BETA x (core24 - CORE_EDGE_MM)) x scale        the rise (gauge units) the wet core is expected to deliver; `scale` = the gauge's
//                                                                          own storm-model scale (storm-model-v4.json stations[g].scale: how big a storm moves it)
//   floor_h = base0 + R x min(1, h / PEAK_H)        base0 = the lowest reading of the last 24 h (the level before the event)
//   shadow  = max(live level_h, floor_h); low and high move up by the same amount; never lowered, so a river that already rose past the floor is untouched.
// Only BETA is fitted (scripts/wet-core-backtest.mts, leave-one-gauge-out and leave-one-day-out, 27 Oct - 1 Nov 2026); every other number is a written-down limit.
// Only ELIGIBLE gauges get a shadow (wetCoreScale: the v4 storm model is skilled at one horizon or more); the rest are plain copies. The storm gate, the live bands and every verdict are untouched.

export const VARIANT = "wet-core";
export const CORE_SHARE = 0.2;
export const CORE_MIN_K = 3;
export const CORE_MIN_N = 6;
export const CORE_MIN_MM = 40;
export const CORE_EDGE_MM = 20;
/** The wet core must be raining NOW: the k wettest gauges of the last 3 h average at least this (the storm models' own burst mark, STORM4.burstMm3h = 25 mm). */
export const RECENT_MIN_MM = 25;
/** Metres (gauge units) of rise per mm of core rain above CORE_EDGE_MM, per unit of the gauge's storm scale. FITTED. */
export const BETA = 0.03;
/** Largest expected rise, in units of the gauge's storm scale. */
export const RISE_CAP = 1.5;
/** Hours after the rain by which the expected rise is complete (Hanwella peaked ~11 h after the 1 Nov cloudburst, Glencourse ~5 h, Rathnapura ~10 h). */
export const PEAK_H = 12;

/**
 * The wet core of the live gauges inside a catchment.
 * @param {{ mm24: number }[]} used  GroundRainSeries.used
 * @param {{ share?: number, minMm?: number, edgeMm?: number }} [o]
 * @returns {{ active: boolean, n: number, k: number, core24: number | null, mean24: number | null }}
 */
export function wetCore(used, o = {}) {
  const share = o.share ?? CORE_SHARE, minMm = o.minMm ?? CORE_MIN_MM, edge = o.edgeMm ?? CORE_EDGE_MM;
  const v = (used ?? []).map((u) => u.mm24).filter((x) => Number.isFinite(x)).sort((a, b) => b - a);
  const n = v.length;
  if (n < CORE_MIN_N) return { active: false, n, k: 0, core24: null, mean24: null, recent3: null };
  const mean24 = v.reduce((a, b) => a + b, 0) / n;
  const k = Math.min(n, Math.max(CORE_MIN_K, Math.ceil(share * n)));
  const core24 = v.slice(0, k).reduce((a, b) => a + b, 0) / k;
  const r4 = (used ?? []).map((u) => u.mm3).filter((x) => Number.isFinite(x)).sort((a, b) => b - a);
  const recent3 = r4.length >= k ? r4.slice(0, k).reduce((a, b) => a + b, 0) / k : null;
  return { active: core24 >= minMm && v[k - 1] >= edge && recent3 != null && recent3 >= (o.recentMm ?? RECENT_MIN_MM), n, k, core24, mean24, recent3 };
}

/**
 * The gauge's storm scale when the wet-core floor may be used at it, else 0. ELIGIBLE = the fitted v4 storm model earned its keep at this gauge at one horizon or
 * more (leave-one-storm-out `use`, lib/model/storm-model-v4.json): there the river is known to answer catchment rain. Without it the 28 Oct / 1 Nov replay raised
 * Baddegama and Pitabeddara (Gin / Nilwala) by 25+ cm for rain their rivers did not answer.
 * @param {{ scale?: number, horizons?: Record<string, { use?: boolean }> } | null | undefined} m4  storm-model-v4.json stations[gauge]
 */
export function wetCoreScale(m4) {
  return m4 && m4.scale > 0 && Object.values(m4.horizons ?? {}).some((x) => x?.use) ? m4.scale : 0;
}

/** Expected rise (gauge units) of the wet core for a gauge of storm scale `scale`; 0 when the core is not active. */
export function wetCoreRise(core, scale, o = {}) {
  if (!core?.active || !(scale > 0)) return 0;
  const beta = o.beta ?? BETA, edge = o.edgeMm ?? CORE_EDGE_MM;
  return Math.min(RISE_CAP, Math.max(0, beta * (core.core24 - edge))) * scale;
}

/** The floor level h hours after the forecast hour. */
export function wetCoreFloor(base0, rise, h, peakH = PEAK_H) {
  return base0 + rise * Math.max(0, Math.min(1, h / peakH));
}

/**
 * The live horizons with the wet-core floor applied. Pure; the input is not changed.
 * @param {{ h: number, ts: number, level: number, low: number | null, high: number | null }[]} horizons
 * @param {number | null} base0  lowest reading of the last 24 h, gauge units (null = unknown: copy)
 * @param {number} rise  from wetCoreRise
 */
export function applyWetCore(horizons, base0, rise, peakH = PEAK_H) {
  return horizons.map((p) => {
    if (base0 == null || !(rise > 0)) return { ...p };
    const up = wetCoreFloor(base0, rise, p.h, peakH) - p.level;
    if (!(up > 0)) return { ...p };
    return { ...p, level: p.level + up, low: p.low == null ? null : p.low + up, high: p.high == null ? null : p.high + up };
  });
}
