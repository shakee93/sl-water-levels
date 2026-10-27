// Live ground-gauge rain for a point, for the town page note (app/GroundRainLine.tsx). Server only.
// Reads hmis/rain-live.json from the `data` branch (written every 30 minutes by scripts/hmis-snapshot.mjs: every live HMIS rain gauge,
// [epoch minute, 24 h sum] for the last 4.5 h; same pattern as lib/rainCorrected.ts, so no request to HMIS beyond the existing cache)
// and adds each gauge's newest point from lib/hmis.ts getHmisRain (10-minute cache) when that is newer, so the figure is as fresh as the
// site's own HMIS read. Maths, source hierarchy and assumptions: lib/groundRain.ts. Fails soft: null when anything is missing.
// A NOTE only: no official step, town tone, push or rule reads it (the rule is in shadow, DOCS.md "Ground-gauge street rain").
import { unstable_cache } from "next/cache";
import { getHmisRain } from "./hmis";
import { pickRain, type GaugeState, type RainPick } from "./groundRain";

export const RAIN_LIVE_URL = process.env.RAIN_LIVE_URL ?? "https://raw.githubusercontent.com/shakee93/sl-water-levels/data/hmis/rain-live.json";

type Raw = { updatedAt?: string; devices?: Record<string, { n?: string; i?: string; lat?: number; lon?: number; pts?: [number, number][] }> };

const loadState = unstable_cache(
  async (): Promise<(GaugeState & { device: string })[]> => {
    const res = await fetch(RAIN_LIVE_URL, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`); // not cached
    const j = (await res.json()) as Raw;
    if (!j?.devices || typeof j.devices !== "object") throw new Error("unexpected shape");
    return Object.entries(j.devices)
      .filter(([, e]) => e && Number.isFinite(e.lat) && Number.isFinite(e.lon) && Array.isArray(e.pts))
      .map(([device, e]) => ({ device, n: String(e.n ?? device), i: String(e.i ?? ""), lat: e.lat as number, lon: e.lon as number, pts: e.pts as [number, number][] }));
  },
  ["rain-live-v1"],
  { revalidate: 300 },
);

/** The ground-gauge pick (lib/groundRain.ts pickRain) for a point: live gauges within 5 km, record at most 60 minutes old. null when there is none. */
export async function getGroundRainAt(lat: number, lon: number, now = Date.now()): Promise<RainPick | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let state: (GaugeState & { device: string })[];
  try {
    state = await loadState();
  } catch {
    return null;
  }
  // fold in the newest point the site's own HMIS read has, when newer than the archive's
  const fresh = await getHmisRain(1500).catch(() => null);
  const byDevice = new Map(fresh?.devices.map((d) => [d.device, d]) ?? []);
  const gauges: GaugeState[] = state.map((g) => {
    const d = byDevice.get(g.device);
    const tm = d ? Math.round(d.latestTs / 60_000) : 0;
    const last = g.pts.length ? g.pts[g.pts.length - 1][0] : 0;
    return d && tm > last && d.latestTs <= now + 10 * 60_000 ? { ...g, pts: [...g.pts, [tm, d.mm24h]] } : g;
  });
  const pick = pickRain({ lat, lon }, gauges, now);
  return pick.source === "ground" ? pick : null;
}
