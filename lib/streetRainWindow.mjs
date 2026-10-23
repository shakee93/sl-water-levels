// Plain JavaScript on purpose: scripts/gsmap-snapshot.mjs (run with plain `node` in GitHub Actions) and
// scripts/street-flood.test.mts both load it.
//
// Rain over the past n clock hours for one zone, as the street-flood rule was backtested
// (research/wellampitiya-flood-rule-backtest.md): hour = the mean of its :00 and :30 half-hour GSMaP_NOW files (a lone
// file stands in when the other is missing, e.g. the newest hour has only :00 until :30 is published); the window is
// the n clock hours ending with the hour of the newest file (anchorMs).
//   raw     = sum of the hourly means (display, logging)
//   clipped = the same sum with EACH HOUR capped at capMm first: cuts impossible one-hour GSMaP_NOW spikes (118 mm in
//             one hour). The street rule (60 / 100 mm) compares the CLIPPED 24 h sum.
// Needs 75% of the hours; missing hours scale the sums up proportionally. null = too many hours missing.
export const STREET_HOURLY_CAP_MM = 15;
const HOUR = 3_600_000;

/** @param {(ms: number) => (number | null | undefined)} rateAt  mm/h of the half-hour step starting at ms
 *  @param {number} anchorMs  time of the newest step
 *  @param {number} n  hours in the window
 *  @returns {{ raw: number, clipped: number } | null} */
export function zoneWindow(rateAt, anchorMs, n, capMm = STREET_HOURLY_CAP_MM) {
  const top = anchorMs - (anchorMs % HOUR);
  let raw = 0, clipped = 0, have = 0;
  for (let k = 0; k < n; k++) {
    const base = top - k * HOUR;
    const halves = [rateAt(base), rateAt(base + HOUR / 2)].filter((v) => typeof v === "number");
    if (!halves.length) continue;
    const h = halves.reduce((a, b) => a + b, 0) / halves.length;
    raw += h;
    clipped += Math.min(h, capMm);
    have++;
  }
  if (have === 0 || have < Math.ceil(n * 0.75)) return null;
  const f = n / have;
  return { raw: Math.round(raw * f * 10) / 10, clipped: Math.round(clipped * f * 10) / 10 };
}
