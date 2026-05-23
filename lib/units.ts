// Heuristic unit detector. The SL Dept of Irrigation publishes
// alertpull / minorpull / majorpull thresholds per gauge but no unit
// metadata. Empirically (39 gauges across 21 basins):
//
//   alert ≥ 4   → feet  (28 gauges, e.g. Hanwella 7, Glencourse 15)
//   alert ≤ 1.5 → meters (2 gauges, e.g. Norwood 1.5, Thalgahagoda 1.4)
//   1.5 < alert < 4 → ambiguous (8 gauges)
//
// We only surface a unit label when confident. The ambiguous middle
// gets no label — better to be silent than wrong.

export type Unit = "ft" | "m" | null;

export function detectUnit(thresholds: {
  alert: number | null;
  minor: number | null;
  major: number | null;
}): Unit {
  const alert = thresholds.alert;
  if (alert == null || !Number.isFinite(alert)) return null;
  if (alert >= 4) return "ft";
  if (alert <= 1.5) return "m";
  return null;
}

export function formatLevel(
  v: number | null | undefined,
  unit: Unit,
  digits = 2,
): string {
  if (v == null) return "—";
  const s = v.toFixed(digits);
  return unit ? `${s} ${unit}` : s;
}
