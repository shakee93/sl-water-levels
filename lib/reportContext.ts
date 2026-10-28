// Context stamped on every flood-survey row (28 Oct 2026, "start collecting the location on all towns so we can build a map and find patterns"):
// the nearest reporting river gauge to the pinned point (distance, its latest level in its own unit, official step, reading time), the nearest
// live ground rain gauge, and the district. Pure maths on data the route already has from our own caches (getNational, getHmisRain): no extra
// upstream request per report. Owner-side only; none of it is shown publicly. Test: node --experimental-strip-types scripts/report-context.test.mts

type LL = { lat: number; lon: number };
export function distKm(a: LL, b: LL): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** A gauge farther than this from the pin says nothing about it: no gauge stamp. */
export const GAUGE_MAX_KM = 80;
/** A town farther than this from the pin gives no district. */
export const DISTRICT_MAX_KM = 30;

export type GaugeIn = {
  station: string; latitude: number; longitude: number; unit: string | null; levelTier: string; rate3h: number | null; rain6h: number | null;
  latest: { ts: number; water_level: number | null } | null;
};
export type GaugeStamp = { name: string; km: number; level: number | null; unit: string | null; tier: string | null; ts: number | null; rate3h: number | null; rain6h: number | null };

/** The nearest gauge that has a reading (any age: the stamp carries the reading time), within GAUGE_MAX_KM; null when none. */
export function nearestGauge(stations: GaugeIn[], at: LL): GaugeStamp | null {
  let best: { s: GaugeIn; km: number } | null = null;
  for (const s of stations) {
    if (!s.latest || s.latest.water_level == null || !Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) continue;
    const km = distKm(at, { lat: s.latitude, lon: s.longitude });
    if (km <= GAUGE_MAX_KM && (!best || km < best.km)) best = { s, km };
  }
  if (!best) return null;
  const r1 = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
  return { name: best.s.station, km: Math.round(best.km * 10) / 10, level: r1(best.s.latest!.water_level), unit: best.s.unit, tier: best.s.levelTier ?? null, ts: best.s.latest!.ts, rate3h: r1(best.s.rate3h), rain6h: r1(best.s.rain6h) };
}

/** District of the nearest gazetteer town (lib/places.ts), within DISTRICT_MAX_KM; "around <district>" is as exact as it gets. */
export function districtAt(places: { district: string; lat: number; lon: number }[], at: LL): string | null {
  let best: { d: string; km: number } | null = null;
  for (const p of places) {
    const km = distKm(at, p);
    if (km <= DISTRICT_MAX_KM && (!best || km < best.km)) best = { d: p.district, km };
  }
  return best?.d ?? null;
}
