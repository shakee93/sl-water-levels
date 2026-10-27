// Small NOTES on the town verdict card (owner approved, 27 Oct 2026, after "can we add anything important here for towns?").
// Notes only: they never change the step (Normal -> Alert -> Minor flood -> Major flood), the pill, the sticky bar, push or tone.
// Pure and dependency-free (node tests import it). Levels are in the gauge's own unit; `unit` null = unknown, so nothing is said.
//   1. markGap      "0.8 ft below the alert level" / "1.2 ft above the alert level, 3.3 ft below the minor flood level"
//                   (26 Oct feedback: Badalgama and Pannala visitors asked "will it reach minor flood?")
//   2. dayOutlook   the concrete "Next 24 hours" line when the step is Alert or above: "Peak about 22 ft" / "Back below 21.3 ft by ..."
//                   built only from the forecast central levels the page already has; nothing is invented.
import type { Thresholds } from "./readings";

type Unit = "ft" | "m" | null;
export type Mark = "alert" | "minor" | "major";
const FT_PER_UNIT = (u: Unit) => (u === "m" ? 1 / 0.3048 : 1);
const MARKS: Mark[] = ["alert", "minor", "major"];

/** Only worth a line when the river is within this fraction of the next mark (same 0.85 as the "watch" tier) or already above one. */
export const GAP_NEAR = 0.85;
/** Differences under this (feet) read as "at the mark". */
export const AT_MARK_FT = 0.1;
/** A forecast move smaller than this (feet) over the day is "little change". */
export const FLAT_FT = 0.3;

export type Gap = { above: { mark: Mark; ft: number } | null; below: { mark: Mark; ft: number } | null };

export function markGap(level: number | null, th: Thresholds | null, unit: Unit): Gap | null {
  if (level == null || !th || unit == null || !Number.isFinite(level)) return null;
  const f = FT_PER_UNIT(unit);
  const marks = MARKS.map((m) => ({ mark: m, v: th[m] })).filter((x): x is { mark: Mark; v: number } => x.v != null && x.v > 0);
  if (!marks.length) return null;
  const up = marks.filter((x) => x.v <= level).pop() ?? null;
  const next = marks.find((x) => x.v > level) ?? null;
  if (!up && !(next && level >= next.v * GAP_NEAR)) return null;
  return {
    above: up ? { mark: up.mark, ft: (level - up.v) * f } : null,
    below: next ? { mark: next.mark, ft: (next.v - level) * f } : null,
  };
}

export type Day =
  | { kind: "peak"; level: number; h: number }
  | { kind: "rising"; level: number }
  | { kind: "backBelow"; mark: number; h: number }
  | { kind: "flat"; level: number }
  | { kind: "easing"; level: number };

/** Concrete 24 h outlook from the forecast's central levels (hours ahead). null = not enough to say anything. */
export function dayOutlook(o: { level: number | null; horizons: { h: number; level: number }[] | undefined; alertMark: number | null; unit: Unit }): Day | null {
  const { level, unit } = o;
  if (level == null || unit == null) return null;
  const hs = (o.horizons ?? []).filter((x) => x.h >= 1 && x.h <= 24 && Number.isFinite(x.level)).sort((a, b) => a.h - b.h);
  if (hs.length < 3) return null;
  const flat = FLAT_FT / FT_PER_UNIT(unit);
  const last = hs[hs.length - 1];
  let peak = hs[0];
  for (const x of hs) if (x.level > peak.level) peak = x;
  if (peak.level - level >= flat) return peak.h === last.h && last.h >= 24 ? { kind: "rising", level: last.level } : { kind: "peak", level: peak.level, h: peak.h };
  if (o.alertMark != null && level >= o.alertMark) {
    const below = hs.find((x) => x.level < o.alertMark!);
    if (below) return { kind: "backBelow", mark: o.alertMark, h: below.h };
  }
  if (Math.abs(last.level - level) < flat) return { kind: "flat", level: last.level };
  return last.level < level ? { kind: "easing", level: last.level } : null;
}

export type TownPeople = {
  answers: { n: number; yes: number; worse: number; better: number } | null;
  water: { n: number; hours: number } | null;
};

/** Counts -> what may be shown: nothing below kMin (lib/myPlaces.ts K_MIN), so one neighbour is never identifiable. */
export function shapePeople(f: { n: number; yes: number; worse: number; better: number }, water: number, kMin: number, hours: number): TownPeople | null {
  const answers = f.n >= kMin ? f : null;
  const w = water >= kMin ? { n: water, hours } : null;
  return answers || w ? { answers, water: w } : null;
}
