// Pure helpers for the 3D flood test map: the Hanwella -> Nagalagam pairing, and the "chance of water" classes.
// The chance is NEVER shown as a number (owner decision, 27 Oct 2026); only Low / Medium / High, and the exact value is logged.

export type Chance = "none" | "low" | "medium" | "high";
export type Calibration = { a: number; b: number; sd_ft: number };

/** Normal CDF (Abramowitz-Stegun 7.1.26). */
export function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return 0.5 * (1 + (x < 0 ? -y : y));
}

/** Gauge level at a horizon: mean and spread (ft), from the forecast's 80% range when it has one. */
export function gaugeSpread(mu: number, low: number | null, high: number | null, hours: number): { mu: number; sd: number } {
  if (low != null && high != null && high > low) return { mu, sd: (high - low) / (2 * 1.2816) };
  return { mu, sd: 0.15 + 0.12 * hours }; // no calibrated band (trend only): widen with the horizon
}

/** P(river level at the horizon >= this cell's flood level), with the cell's own uncertainty (half-width, ft) as a uniform spread. */
export function pWet(levelFt: number, halfWidthFt: number, g: { mu: number; sd: number }): number {
  const sd = Math.sqrt(g.sd * g.sd + (halfWidthFt * halfWidthFt) / 3);
  return phi((g.mu - levelFt) / sd);
}

/** Recalibrated (leave-one-event-out reliability, scripts/flood3d/prep.py) and classed. Below ~7% raw: no shading. */
export function chanceClass(p: number, cal: Calibration): { cls: Chance; p: number } {
  if (p < 0.07) return { cls: "none", p };
  const q = Math.min(1, cal.a + cal.b * p);
  return { cls: q < 0.2 ? "low" : q < 0.6 ? "medium" : "high", p: q };
}

/** Rough Hanwella (m) -> Nagalagam (ft), table from /api/flood3d (daily pairs). Clamped at both ends. */
export function hanwellaMToNagFt(m: number, table: [number, number][]): number {
  if (m <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) if (m <= table[i][0]) return table[i - 1][1] + ((m - table[i - 1][0]) / (table[i][0] - table[i - 1][0])) * (table[i][1] - table[i - 1][1]);
  return table[table.length - 1][1];
}
export function nagFtToHanwellaM(ft: number, table: [number, number][]): number {
  if (ft <= table[0][1]) return table[0][0];
  for (let i = 1; i < table.length; i++) if (ft <= table[i][1]) return table[i - 1][0] + ((ft - table[i - 1][1]) / (table[i][1] - table[i - 1][1])) * (table[i][0] - table[i - 1][0]);
  return table[table.length - 1][0];
}
