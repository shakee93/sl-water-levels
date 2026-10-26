// Which river gauges have a working rain sensor, and how to spot a dead one.
//
// Why: Nagalagam Street (Kelani) reported 0 mm in every one of 243 readings over 12 days, 165 over the last 7, while the
// gauges around it measured 50 to 270 mm (research/rain-audit.md). The feed gives it a real 0, not a blank, so the app treated
// it as "dry": the station card said "Rain here 0.0 mm", the release detector counted it in the basin's "no rain" sum and
// the measured heavy-rain rule got nothing from its own gauge. A dead sensor must read as "not measured" (null), never 0.
//
// `lib/arcgis.ts` calls noRainSensor() once, where a feed row becomes a Reading, so every consumer (station card, anomaly
// detector, forecast rain features, measured-rain trigger, API, D1 log) sees null for these gauges without each one knowing.
// The archive scripts keep the raw feed on purpose.
//
// Pure (no imports), so scripts and tests can load it with plain node.

/** Gauges whose rain sensor is known to be dead: rain is null, not 0. Add a name here when the check below flags one for good. */
export const NO_RAIN_SENSOR: ReadonlySet<string> = new Set(["Nagalagam Street"]);

/**
 * Reviewed and left OUT of the list above, with the reason, so nobody adds them by reflex:
 *  - Katharagama (Menik Ganga): 16.3 mm in 7 days (9.7 mm in 12). Its neighbours in the dry zone are not much wetter
 *    (Wellawaya 37 mm, Thanamalwila 63 mm in the same 7 days), so it reads as a dry catchment, not a dead sensor.
 */
export const REVIEWED_NOT_DEAD: readonly string[] = ["Katharagama"];

export const norm = (s: string | null | undefined): string => String(s ?? "").replace(/\s+/g, " ").trim();

/** True when this gauge has no working rain sensor (its rain figure must be treated as not measured). */
export const noRainSensor = (station: string | null | undefined): boolean => NO_RAIN_SENSOR.has(norm(station));

// ---- automatic detection ---------------------------------------------------------------------------------------------

/** A sensor is suspect when it read (almost) nothing over at least this many days ... */
export const DEAD_MIN_DAYS = 7;
/** ... "almost nothing" = under this many mm in total ... */
export const DEAD_MAX_MM = 0.5;
/** ... while the median of its nearest neighbours that do report rain measured at least this many mm. */
export const DEAD_NEIGHBOUR_MM = 50;
/** Neighbours: the nearest rain-reporting gauges within this distance (km), at most this many. */
export const DEAD_NEIGHBOUR_KM = 60;
export const DEAD_NEIGHBOURS = 3;
/** Need this many readings with a value over the window before a total means anything (the feed is about hourly). */
export const DEAD_MIN_READINGS = 100;

export type RainWindowStat = { station: string; lat: number; lon: number; readings: number; totalMm: number; spanDays: number };

export type SuspectSensor = { station: string; totalMm: number; readings: number; neighbourMedianMm: number; neighbours: string[] };

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/**
 * Gauges whose rain total over the window is ~0 while the nearby gauges that do report measured plenty. Input is one row per
 * gauge (total mm, number of readings with a value, days the readings span). Gauges without enough history are not judged.
 * A neighbour that is itself ~0 does not count as evidence either way (a dry week everywhere is not a dead sensor).
 */
export function suspectDeadSensors(stats: RainWindowStat[]): SuspectSensor[] {
  const judged = stats.filter((s) => s.readings >= DEAD_MIN_READINGS && s.spanDays >= DEAD_MIN_DAYS - 0.5);
  const out: SuspectSensor[] = [];
  for (const s of judged) {
    if (s.totalMm > DEAD_MAX_MM) continue;
    const near = judged
      .filter((n) => n.station !== s.station && n.totalMm > DEAD_MAX_MM)
      .map((n) => ({ n, d: km(s, n) }))
      .filter((x) => x.d <= DEAD_NEIGHBOUR_KM)
      .sort((a, b) => a.d - b.d)
      .slice(0, DEAD_NEIGHBOURS)
      .map((x) => x.n);
    if (near.length < 2) continue;
    const t = near.map((n) => n.totalMm).sort((a, b) => a - b);
    const median = t.length % 2 ? t[(t.length - 1) / 2] : (t[t.length / 2 - 1] + t[t.length / 2]) / 2;
    if (median >= DEAD_NEIGHBOUR_MM) out.push({ station: s.station, totalMm: s.totalMm, readings: s.readings, neighbourMedianMm: Math.round(median), neighbours: near.map((n) => n.station) });
  }
  return out;
}
