// What the embed widgets draw. Built on the server (lib/embedData.ts) with every string already in the widget's language, so the
// browser needs no dictionaries: the page renders it, and the 5-minute refresh just swaps in a new one from /api/embed.
import type { PillTier } from "@/app/TierPill";
import type { EmbedCfg, Widget } from "./embedConfig";

export type Arrow = "up" | "down" | "steady" | null;
export type MarkInfo = { key: "alert" | "minor" | "major"; label: string; value: string; pct: number };

export type EmbedRow = {
  key: string;
  name: string;
  river: string | null;
  href: string;
  tier: PillTier;
  step: string;
  level: string | null;
  arrow: Arrow;
  trend: string | null;
  /** "7:00 pm" in Sri Lanka time, with the day when it is not today. */
  time: string | null;
  age: string | null;
  next: string | null;
  nextArrow: Arrow;
  cross: string | null;
  /** "Alert 5.2 m · Minor flood 7.5 m · Major flood 9.5 m" */
  marks: string | null;
  /** "3.2 ft below the alert level" */
  outcome: string | null;
  stale: boolean;
  /** Reading comes from RiverNet (DMC / Leecom SCADA), not the Irrigation Department feed. */
  rivernet: boolean;
};

export type Chart = {
  pts: [number, number][];
  /** ms */
  from: number;
  to: number;
  unit: string;
  marks: { key: "alert" | "minor" | "major"; label: string; v: number }[];
  hours: number;
  fromLabel: string;
  toLabel: string;
  min: string;
  max: string;
};

export type Credit = { live: string; linkText: string; rest: string; href: string; /** Extra source credit (RiverNet) with a plain link. */ extra?: { text: string; href: string } };

type Base = {
  widget: Widget;
  cfg: EmbedCfg;
  generatedAt: number;
  credit: Credit;
  /** The matching page on waterlevels.lk, and the words for the link. */
  open: { href: string; label: string };
  /** Shown when the sources could not be read. */
  unavailable?: string;
};

export type RiverPayload = Base & { kind: "river"; title: string; summary: string; rows: EmbedRow[]; upstream: string; downstream: string };
export type GaugePayload = Base & {
  kind: "gauge";
  title: string;
  river: string;
  row: EmbedRow;
  bar: { tier: PillTier; now: number; ahead: number | null; marks: MarkInfo[] } | null;
  chart: Chart | null;
  chartTitle: string;
};
export type TownPayload = Base & {
  kind: "town";
  title: string;
  tier: PillTier;
  step: string;
  level: string | null;
  gaugeLine: string | null;
  hourLabel: string;
  hour: string | null;
  hourArrow: Arrow;
  dayLabel: string;
  day: string | null;
  action: string | null;
  note: string;
  time: string | null;
  marks: string | null;
};
export type FChart = {
  /** Observed readings, then the forecast line from "now"; the band is the 80% range. All in the shown unit. */
  observed: [number, number][];
  forecast: [number, number][];
  band: [number, number, number][];
  now: number;
  from: number;
  to: number;
  unit: string;
  marks: { key: "alert" | "minor" | "major"; label: string; v: number }[];
  /** axis words */
  axis: { from: string; now: string; to: string };
  yMin: string;
  yMax: string;
  legend: { observed: string; forecast: string; band: string; now: string };
};
export type ForecastPayload = Base & {
  kind: "forecast";
  title: string;
  river: string;
  row: EmbedRow;
  verdict: string;
  tone: PillTier;
  hour: { label: string; title: string; sub: string | null; arrow: Arrow } | null;
  day: { label: string; text: string; ok: boolean } | null;
  action: string | null;
  note: string | null;
  chart: FChart | null;
  chartTitle: string;
  /** "Forecast, not an official warning" label, or "No forecast for this gauge". */
  forecastLabel: string;
  noForecast: boolean;
};
export type NowGroup = { river: string; href: string; rows: EmbedRow[] };
export type NowPayload = Base & { kind: "now"; title: string; calm: boolean; summary: string; groups: NowGroup[]; checked: string };
export type ResRow = { key: string; name: string; river: string | null; href: string; status: string; official: boolean; figure: string | null; source: string; when: string | null; reported: string | null; reportedUrl: string | null };
export type ReservoirsPayload = Base & { kind: "reservoirs"; title: string; summary: string; items: ResRow[]; officialNote: string };
export type TickerPayload = Base & { kind: "ticker"; segments: string[]; tier: PillTier; href: string; label: string };

export type EmbedPayload = RiverPayload | GaugePayload | ForecastPayload | TownPayload | NowPayload | ReservoirsPayload | TickerPayload;
