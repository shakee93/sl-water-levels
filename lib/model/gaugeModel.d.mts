export const H: number;
export const GM_HORIZONS: number[];
export const OWN_DELTAS: number[];
export const UP_DELTAS: number[];
export const TIDE_PERIODS_H: number[];
export function tideCols(t: number): number[];
export type GaugeCtx = { level: (gauge: string, t: number) => number | null };
export type GaugeHorizonModel = {
  /** false = ships "level stays put" (no clear out-of-sample skill); the band is still empirical. */
  skilled: boolean;
  tide: boolean;
  b0: number;
  w: number[];
  /** Volatility bin edges (mean absolute hourly change of the last 3 h, native units) and the signed 10% / 90% residuals per bin. */
  edges: number[];
  q10: number[];
  q90: number[];
  n: number;
  /** Backtest numbers (blocked CV and the untouched last-60-days holdout), native units. */
  backtest: Record<string, number | null>;
};
export type GaugeStationModel = { unit: string; up: string[]; horizons: Record<string, GaugeHorizonModel> };
export function gaugeFeatures(target: string, up: string[], tide: boolean, ctx: GaugeCtx, t: number, h: number): { x: number[]; vol: number; missing: string[] } | null;
export function predictGauge(hm: GaugeHorizonModel | undefined, x: number[]): number;
export function bandFor(hm: GaugeHorizonModel, vol: number): { q10: number; q90: number };
export function fitWeightedRidge(X: number[][], y: ArrayLike<number>, wt: ArrayLike<number>, lam?: number): { b0: number; w: number[] };
export function predictLinear(m: { b0: number; w: number[] }, x: number[]): number;
export function fitL1(X: number[][], y: ArrayLike<number>, lam?: number, iters?: number): { b0: number; w: number[] };
