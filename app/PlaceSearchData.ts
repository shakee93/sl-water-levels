import { getNational, type Tier } from "@/lib/arcgis";
import type { Unit } from "@/lib/units";

/** Compact per-gauge payload for the client-side place search. */
export type SearchStation = {
  station: string;
  basin: string;
  latitude: number;
  longitude: number;
  href: string;
  tier: Tier;
  level: number | null;
  unit: Unit;
};

export async function getSearchStations(): Promise<SearchStation[]> {
  try {
    const all = await getNational();
    return all.map((s) => ({
      station: s.station,
      basin: s.basin.trim(),
      latitude: s.latitude,
      longitude: s.longitude,
      href: s.href,
      tier: s.tier,
      level: s.latest?.water_level ?? null,
      unit: s.unit,
    }));
  } catch {
    return [];
  }
}
