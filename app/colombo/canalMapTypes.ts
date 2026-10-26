import type { BasinId, BasinStateKey } from "@/lib/colombo";
import type { CanalState } from "@/lib/curwStatus";

/** What the server hands the map: our own canal data (never fetched by the browser from CUrW), already in feet. */
export type MapGaugeData = { name: string; state: CanalState; ft: number | null; observedMs: number | null; series: { ms: number; ft: number }[] };
export type MapBasinData = { id: BasinId; name: string; drain: string; state: BasinStateKey; towns: { name: string; href: string }[]; gauges: string[] };
export type CanalMapData = {
  basins: MapBasinData[];
  gauges: MapGaugeData[];
  sea: { ft: number; trend: "rising" | "falling" | "steady" | null; observedMs: number | null } | null;
  /** "2:36 pm today and 3:06 am tomorrow", or "" */
  nextHigh: string;
  /** Nagalagam Street river gauge reading, in feet, with its tier word. */
  nag: { level: string; tier: string; observedMs: number | null } | null;
};
