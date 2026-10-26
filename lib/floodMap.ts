// The Irrigation Department's official maps of past floods (Flood_Map FeatureServer on the same ArcGIS org as our gauges),
// read from lib/model/flood-map.json (built once by scripts/build-flood-map.mjs; the service is static, last edited Dec 2025).
// Each event is one mapped flood ("Kelani Ganga 2016 major", "Kalu Ganga 2017" ...); a GN division is listed when any part of it
// was inside that flood's mapped extent. This is where a past flood reached, never a statement about today: the page says so.
// Server only (no polygons, but 170 KB of names): imported by server components, never sent to the browser.
import data from "./model/flood-map.json";

export type FloodEvent = { id: string; basin: string; year: number; grade: string | null; km2: number; dsds: [dsd: string, district: string][] };
type GnRow = [name: string, dsd: string, district: string, lat: number, lon: number, rKm: number, events: number[]];
export type MappedGn = { name: string; dsd: string; district: string; km: number; inside: boolean; events: FloodEvent[] };

const EVENTS = data.events as FloodEvent[];
const GN = data.gn as GnRow[];
export const FLOOD_MAP_EDITED = data.edited as string | null;
/** Where people can look at the maps themselves (a link, never fetched by the browser). */
export const FLOOD_MAP_HOME = "https://www.irrigation.gov.lk";

function km(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

/** Mapped past floods of one river (our basin name, trimmed), newest first. */
export function floodEventsFor(basin: string): FloodEvent[] {
  const b = basin.trim();
  return EVENTS.filter((e) => e.basin === b).sort((a, z) => z.year - a.year);
}

/**
 * GN divisions in a mapped flood extent near a point, nearest first. "Near" = centroid within 2 km, or within the division's own
 * size + 0.5 km (rural divisions are several km across, so a town centre can sit inside one whose centroid is 3 km off).
 * `inside` = the point is probably inside the division (centroid closer than the radius of a circle of the same area).
 * Town coordinates are good to ~2 km, so this is "around the town", not a street-level answer.
 */
export function mappedNear(lat: number, lon: number): MappedGn[] {
  const out: MappedGn[] = [];
  for (const g of GN) {
    const d = km(lat, lon, g[3], g[4]);
    if (d > Math.max(2, g[5] + 0.5)) continue;
    out.push({ name: g[0], dsd: g[1], district: g[2], km: d, inside: d <= g[5], events: g[6].map((i) => EVENTS[i]).sort((a, z) => z.year - a.year) });
  }
  return out.sort((a, b) => a.km - b.km);
}

/** Number of GN divisions an event's mapped extent touches. */
export function gnCount(ev: FloodEvent): number {
  const i = EVENTS.indexOf(ev);
  return GN.filter((g) => g[6].includes(i)).length;
}
