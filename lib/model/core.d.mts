export const H: number;
export const HORIZONS: number[];
export const LAMBDA: number;
export const COLOMBO_MS: number;
export const dayOf: (t: number) => number;

export type SeriesPoint = { ts: number; wl: number };
export type Term =
  | { k: "delta"; g: string[]; hrs: number; label: string; local?: boolean }
  | { k: "rain"; from: number; to: number; label: string; local?: boolean }
  | { k: "level"; label: string; local?: boolean };
export type StationCfg = { target: string; terms: Term[] };
export type Ctx = { level: (gauge: string, t: number) => number | null; rain: (T: number) => number | undefined; rainFor?: (t: number) => (T: number) => number | undefined };

export type RidgeModel = { b0: number; w: number[]; mean: number[] };
export type HorizonCoef = {
  n: number;
  b0: number;
  w: number[];
  mean: number[];
  local: RidgeModel & { cols: number[] };
  resOos: boolean;
  persistence: boolean;
  rmse: number;
  inRmse: number;
  q10: number;
  q50: number;
  q90: number;
  mae: number | null;
  maePersistence: number;
  maeLocal: number | null;
};
export type StationCoef = {
  basin: string;
  mainLeader: string | null;
  terms: Term[];
  trainDays: number;
  trainRange: [number, number];
  levelMin: number;
  levelMax: number;
  horizons: Record<string, HorizonCoef>;
};

export function interp(a: SeriesPoint[], t: number): number | null;
export function rainIn(rain: (T: number) => number | undefined, a: number, b: number): number | null;
export function features(cfg: StationCfg, ctx: Ctx, t: number, h: number): (number | null)[];
export function buildSamples(cfg: StationCfg, ctx: Ctx, times: number[], h: number): { t: number; f: number[]; y: number; day: number }[];
export function fitRidge(X: number[][], y: number[], lam?: number): RidgeModel;
export function predictRidge(m: RidgeModel, x: number[]): number;
export function quantile(sorted: number[], q: number): number;
export function fitStation(
  cfg: StationCfg,
  ctx: Ctx,
  times: number[],
  opts?: object,
): {
  horizons: Record<string, HorizonCoef>;
  oos: Record<string, { t: number; y: number; pred: number; predLocal: number }[]>;
  trainDays: number;
  trainRange: [number, number];
  levelMin: number;
  levelMax: number;
};
export function evalStation(
  coef: { horizons: Record<string, HorizonCoef> },
  cfg: StationCfg,
  ctx: Ctx,
  t: number,
): { h: number; delta: number; deltaLocal: number; missing: string[]; features: (number | null)[]; persistence: boolean }[];
export function Phi(z: number): number;
export function splitCdf(x: number, mu: number, sd: number, su: number): number;
export type Comp = { w: number; mu: number; sd: number; su: number };
export function mixCdf(x: number, comps: Comp[]): number;
export function mixQuantile(q: number, comps: Comp[]): number;
export function floorSigmaM(h: number): number;
