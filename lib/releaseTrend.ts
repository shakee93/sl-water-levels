// Is a release falling or rising compared with yesterday? Read from our own archive (the `data`
// branch, releases/YYYY/YYYY-MM-DD.jsonl, one snapshot per line). Yesterday's highest spill figure
// for the reservoir is compared with today's. Fails soft: no archive, no trend.

import { unstable_cache } from "next/cache";

const RAW = "https://raw.githubusercontent.com/shakee93/sl-water-levels/data/releases";
const COLOMBO_MS = 5.5 * 3_600_000;

const yesterdayDay = (now: number) => new Date(now + COLOMBO_MS - 86_400_000).toISOString().slice(0, 10);

const peaksFor = unstable_cache(
  async (day: string): Promise<Record<string, number>> => {
    const res = await fetch(`${RAW}/${day.slice(0, 4)}/${day}.jsonl`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`); // not cached: a missing file may appear later
    const peaks: Record<string, number> = {};
    for (const line of (await res.text()).split("\n")) {
      if (!line.trim()) continue;
      try {
        const snap = JSON.parse(line) as { sheet?: { rows?: { reservoirId: string | null; spillCusecs: number | null }[] } };
        for (const r of snap.sheet?.rows ?? []) {
          if (r.reservoirId && r.spillCusecs != null) peaks[r.reservoirId] = Math.max(peaks[r.reservoirId] ?? 0, r.spillCusecs);
        }
      } catch {
        /* skip a bad line */
      }
    }
    return peaks;
  },
  ["release-peaks-v1"],
  { revalidate: 3600 },
);

export type Trend = { dir: "down" | "up"; from: number };

/** Needs a 20% change to count; smaller wobble is not a trend. */
export async function releaseTrend(reservoirId: string, cusecs: number | null, now = Date.now()): Promise<Trend | null> {
  if (!cusecs) return null;
  try {
    const before = (await peaksFor(yesterdayDay(now)))[reservoirId];
    if (!before || before < 500) return null;
    if (cusecs <= before * 0.8) return { dir: "down", from: before };
    if (cusecs >= before * 1.2) return { dir: "up", from: before };
  } catch {
    /* no archive for yesterday */
  }
  return null;
}
