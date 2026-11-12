export const FMT: number;
export const HOUR: number;
export const ZN: number;
export const ZPAST: number;
export const CN: number;
export const CPAST: number;
export const MISSING: number;
export const MAX_TENTHS: number;
export const RAIN_MAX_MM_H: number;
export const MAX_BLOB_CHARS: number;

export type InputsRecord = {
  fmt: 1;
  /** epoch ms of the hour END that is "now" for the run */
  grid: number;
  /** age of the weather data in whole minutes, null = unknown */
  ageMin: number | null;
  /** per zone 124 sums over the zone's cells (tenths of mm) of the hours ending N-75 h ... N+48 h; null = missing hour or no such zone */
  zones: { full: (number | null)[]; near: (number | null)[] | null; up: (number | null)[] | null };
  /** per cell of the full zone, 52 tenths of mm for the hours ending N-27 h ... N+24 h; null = missing */
  cells: (number | null)[][];
  /** cell counts [full, near, up] */
  nz: [number, number, number];
};
export type OmPoint = { hourly?: Record<string, (number | null)[] | string[]> };
export function encode(rec: InputsRecord): string;
export function decode(text: string): InputsRecord;
export function tryDecode(text: string): { ok: true; rec: InputsRecord } | { ok: false; reason: "decode_error"; detail: string };
export function zonePositions(stationCells: number[], ids: number[] | undefined | null): number[] | null;
export function buildRecord(a: { points: OmPoint[]; near?: number[] | null; up?: number[] | null; nowHour: number; ageMin?: number | null }):
  | { ok: true; rec: InputsRecord }
  | { ok: false; reason: "no_points" | "no_times" | "bad_now_hour" | "no_data"; detail?: string };
export function inputsOf(a: { points: OmPoint[]; near?: number[] | null; up?: number[] | null; nowHour: number; ageMin?: number | null }):
  | { ok: true; blob: string; rec: InputsRecord; nCells: number; gridMs: number; ageMin: number | null }
  | { ok: false; skip: "no_points" | "no_times" | "bad_now_hour" | "no_data" | "encode" | "too_large" };
export function zoneMean(rec: InputsRecord, zone: "full" | "near" | "up", ts: number): number | null;
