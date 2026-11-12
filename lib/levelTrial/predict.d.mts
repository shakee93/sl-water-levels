export const HOUR: number;
export const VERSION: string;
export const MODEL_SCHEMA: string;
export const MAX_AGE_MS: number;
export const UNIT_HEADROOM: number;
export const UNIT_REF_REL: number;
export const UNIT_REF_ABS_FT: number;
export const RAIN_MAX_MM_H: number;
export const MEAN_CELLS_ABS_MM: number;
export const MEAN_CELLS_REL: number;
export const RAIN_WINDOWS: { id: string; part: string; cols: string[]; storm: boolean; sev: "refuse" | "degrade" }[];
export const OWN_TREND_LAGS: number[];

/** a readings series: ascending ts (epoch ms), v in the gauge's native unit, bad[i] = time (ms) the glitch filter had flagged reading i, or null */
export type Series = { ts: number[]; v: (number | null)[]; bad?: (number | null)[] | null };
export type RainInput = {
  /** epoch ms of the END of element 0, a whole hour */
  origin: number;
  obs: { mean: (number | null)[] | null; up?: (number | null)[] | null; cells?: (number | null)[][] | null };
  fc: { mean: (number | null)[] | null; cells?: (number | null)[][] | null };
};
export type PredictInput = { gauge: string; t: number; own: Series; partners?: Record<string, Series>; rain: RainInput | null; unitRefFt?: number | null };
export type Verdict = "ok" | "degraded" | "refused";
export type Flag = { code: string; items: string[] };
export type PredictResult = {
  verdict: Verdict;
  /** the first refusal code, null unless refused */
  reason: string | null;
  detail: string;
  degraded: Flag[];
  refusals: Flag[];
  gauge: string | null;
  t: number | null;
  unit: "m" | "ft" | null;
  ageMs: number | null;
  ageH: number | null;
  c: number | null;
  complete: boolean;
  /** [horizon h, level, low, high] in the gauge's native unit; null when refused */
  hz: [number, number, number, number][] | null;
  /** [horizon h, change, low change, high change] in feet from the newest level; null when refused */
  hzFt: [number, number, number, number][] | null;
  regime: number | null;
  cell: number | null;
  diag: Record<string, any>;
};
export function predict(model: unknown, inp: PredictInput): PredictResult;
export function prepare(model: unknown): unknown;
export function labRound(x: number): number;
