// Pure location matching. Runs in the browser only: coordinates never reach the server.
import { PLACES, type Place } from "@/lib/places";
import { DISTRICT_BY_STATION } from "@/lib/districts";

export type LatLon = { lat: number; lon: number };
export type GaugePoint = { station: string; basin: string; latitude: number; longitude: number; href: string };

/** A place counts as "where you are" within this distance. */
export const PLACE_RADIUS_KM = 8;
/** The station page mentions the distance only inside this radius. */
export const NEAR_GAUGE_KM = 25;
/** Without a close town, the help page still picks a district from the nearest one within this. */
const DISTRICT_RADIUS_KM = 30;

export function distanceKm(a: LatLon, b: LatLon): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export function formatKm(km: number): string {
  if (km < 1) return "under 1 km";
  return `${km < 10 ? Math.round(km * 10) / 10 : Math.round(km)} km`;
}

export function nearestPlace(p: LatLon, maxKm: number): { place: Place; km: number } | null {
  let best: { place: Place; km: number } | null = null;
  for (const place of PLACES) {
    const km = distanceKm(p, { lat: place.lat, lon: place.lon });
    if (km <= maxKm && (!best || km < best.km)) best = { place, km };
  }
  return best;
}

export type Nearby = {
  /** Town name when the visitor is within PLACE_RADIUS_KM of one in the gazetteer. */
  placeName: string | null;
  district: string | null;
  primary: GaugePoint & { km: number };
  others: (GaugePoint & { km: number })[];
  /** Every gauge with its distance, nearest first. */
  ranked: (GaugePoint & { km: number })[];
};

export function matchLocation(p: LatLon, gauges: GaugePoint[]): Nearby | null {
  const ranked = gauges
    .filter((g) => Number.isFinite(g.latitude) && Number.isFinite(g.longitude))
    .map((g) => ({ ...g, km: distanceKm(p, { lat: g.latitude, lon: g.longitude }) }))
    .sort((a, b) => a.km - b.km);
  if (ranked.length === 0) return null;

  const town = nearestPlace(p, PLACE_RADIUS_KM);
  // The town's own river gauge (first listed one we have data for), else the nearest by distance.
  const fromTown = town ? town.place.stations.map((s) => ranked.find((g) => g.station === s)).find(Boolean) : undefined;
  const primary = fromTown ?? ranked[0];
  const others = ranked.filter((g) => g.station !== primary.station).slice(0, 2);
  const district = town?.place.district ?? DISTRICT_BY_STATION[primary.station] ?? null;
  return { placeName: town?.place.name ?? null, district, primary, others, ranked };
}

/** District for the help page, which has no gauge list. */
export function districtNear(p: LatLon): string | null {
  return nearestPlace(p, DISTRICT_RADIUS_KM)?.place.district ?? null;
}
