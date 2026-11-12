import type { InputsRecord } from "./record.mjs";
import type { PredictInput, PredictResult } from "./predict.mjs";

export const FT_PER_M: number;
export const HIST_H: number;
export const HIST_EXTRA_OLDER: number;
export const GRID_PAST: number;
export const GRID_FUTURE: number;
export const GRID_LEN: number;
export const COMPLETE_MIN_READINGS: number;
export const COMPLETE_MAX_GAP_H: number;

export function toFeet(level: number, unit: "m" | "ft"): number | null;
export function glitchFlags(series: { ts: number; level: number }[], unit: "m" | "ft"): number[];
export function minimalGrid(rec: InputsRecord, floorHourOfT: number): PredictInput["rain"] & {};

export type RebuildSkip = "no_record" | "decode_error" | "bad_record" | "grid_misaligned" | "unknown_gauge" | "unit_table_mismatch" | "no_obs" | "history_incomplete" | "t_not_newest" | "bad_input";
export type RebuildResult = {
  /** ok | degraded | refused come from predict() unchanged; skipped = the rebuild itself could not make the inputs (reason is a RebuildSkip) */
  verdict: "ok" | "degraded" | "refused" | "skipped";
  reason: string | null;
  detail: string;
  result: PredictResult | null;
  inputs: PredictInput | null;
  nHist: number | null;
  gapH: number | null;
  lagH: number | null;
  historyComplete: boolean | null;
  flags: { own: number[]; partners: Record<string, number[]> } | null;
};
export function rebuild(
  model: unknown,
  a: { gauge: string; t: number; record: string | InputsRecord | null | undefined; rows: Record<string, { ts: number; level: number }[]>; unitTable: Record<string, "m" | "ft"> },
): RebuildResult;
