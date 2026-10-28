// The "rise upstream may reach this gauge" note on the river strip (app/BasinFlow.tsx), pure so it can be tested.
// Rules: stations are in main-stem order (lib/basinOrder.ts); only a MAIN-STEM, live gauge with a rising rate counts as the upstream rise;
// RiverNet gauges (no travel time measured) and tributaries are never the source and never the target of the note
// (28 Oct 2026: it said "Magura is rising ... may reach Wey Ganga", a tributary nothing on the main stem feeds).
import type { Tier } from "./arcgis";

export type WaveStation = { station: string; tier: Tier; rate3hM: number | null; source?: "arcgis" | "hmis" | "rivernet"; tributary?: boolean };

export function buildWaveInsight(stations: WaveStation[], selectedStation: string): { upstreamStation: string; rateM: number } | null {
  const selectedIdx = stations.findIndex((s) => s.station === selectedStation);
  if (selectedIdx <= 0) return null;
  const selected = stations[selectedIdx];
  if (selected.tier === "stale" || selected.source === "rivernet" || selected.tributary) return null;
  const upRising = stations
    .slice(0, selectedIdx)
    .filter((s) => s.source !== "rivernet" && !s.tributary && s.tier !== "stale" && s.rate3hM != null && s.rate3hM > 0.05);
  if (upRising.length === 0) return null;
  const fastest = upRising.reduce((a, b) => ((a.rate3hM ?? 0) > (b.rate3hM ?? 0) ? a : b));
  const selRate = selected.rate3hM;
  if (selRate != null && selRate >= (fastest.rate3hM ?? 0) * 0.6) return null;
  return { upstreamStation: fastest.station, rateM: fastest.rate3hM ?? 0 };
}
