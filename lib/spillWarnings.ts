// "Spill warning reported": news that a catalogue reservoir NEARS spill level or MAY open its gates.
// Context only: it is not a release (gates are not open), never official, and it never sets a verdict
// or raises a tier. Shown for 24 hours from the story's time (home "May spill soon" box, the reservoir
// page, and a heads-up on the rivers and gauges below). Matching: lib/spillWarningMatch.ts (unit tested).
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { articleTimeCached, getFeeds, type Outlet } from "./newsFeeds";
import { RESERVOIRS, connectingReservoirs, matchReservoir, type Reservoir } from "./reservoirs";
import { matchSpillWarningWith } from "./spillWarningMatch";

export type SpillWarning = {
  reservoirId: string;
  outlet: Outlet;
  headline: string;
  url: string;
  /** ISO with +05:30. */
  publishedAt: string;
};

const TTL_MS = 24 * 3_600_000;
const COLOMBO_MS = 5.5 * 3_600_000;

const scanCached = unstable_cache(
  async (): Promise<SpillWarning[]> => {
    const out: SpillWarning[] = [];
    const { items } = await getFeeds();
    await Promise.all(
      items.map(async (it) => {
        try {
          const hit = matchSpillWarningWith(matchReservoir, it.title, it.desc);
          if (!hit) return;
          const ms = it.pubMs ?? (await articleTimeCached(it.link).catch(() => null));
          if (ms == null || Date.now() - ms > TTL_MS || ms - Date.now() > 3_600_000) return;
          out.push({ reservoirId: hit.reservoir.id, outlet: it.outlet, headline: it.title, url: it.link, publishedAt: new Date(ms + COLOMBO_MS).toISOString().slice(0, 19) + "+05:30" });
        } catch {
          /* one bad story never drops the rest */
        }
      }),
    );
    return out;
  },
  ["spill-warnings-v1"],
  { revalidate: 600 },
);

// Feeds hold a story for hours only; a warm server instance remembers what it saw for the full 24.
const memo = new Map<string, SpillWarning>();

/** Latest warning per reservoir still inside 24 hours. Never throws. */
async function load(now: number): Promise<Map<string, SpillWarning>> {
  const fresh = await scanCached().catch(() => [] as SpillWarning[]);
  for (const w of fresh) {
    const k = `${w.reservoirId}|${w.url}`;
    if (!memo.has(k)) memo.set(k, w);
  }
  const latest = new Map<string, SpillWarning>();
  for (const [k, w] of memo) {
    const t = Date.parse(w.publishedAt);
    if (now - t > TTL_MS) {
      memo.delete(k);
      continue;
    }
    const prev = latest.get(w.reservoirId);
    if (!prev || Date.parse(prev.publishedAt) < t) latest.set(w.reservoirId, w);
  }
  return latest;
}

/** One lookup per render. */
export const getSpillWarnings = cache(() => load(Date.now()));

export const spillWarningFor = async (reservoirId: string | null | undefined): Promise<SpillWarning | null> =>
  reservoirId ? (await getSpillWarnings()).get(reservoirId) ?? null : null;

/** Warnings that matter for a river page (reservoirs on that basin). */
export async function spillWarningsForBasin(basin: string): Promise<{ res: Reservoir; warning: SpillWarning }[]> {
  const all = await getSpillWarnings();
  return RESERVOIRS.filter((r) => r.basin === basin.trim() && all.has(r.id)).map((res) => ({ res, warning: all.get(res.id)! }));
}

/** Warnings for reservoirs linked to this gauge or to a gauge above it on the same river. */
export async function spillWarningsForStation(basin: string, station: string): Promise<{ res: Reservoir; warning: SpillWarning }[]> {
  const all = await getSpillWarnings();
  return connectingReservoirs(basin, station).filter((c) => all.has(c.res.id)).map((c) => ({ res: c.res, warning: all.get(c.res.id)! }));
}
