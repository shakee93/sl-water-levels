// Cross-check of a "No, it's worse" answer that has a location: is the person near the gauge the page showed, did that gauge rise in
// the next 3 hours, and was there heavy satellite rain over their pixel? Pure (no imports, no I/O, no clock), shared by the learning job
// (scripts/feedback-learn.mjs), the owner's export (scripts/feedback-export.mjs) and scripts/feedback-check.test.mts.
// Coordinates are the 0.01 degree rounded ones from forecast_feedback.lat_r / lon_r; nothing here ever needs more.
// The verdict is for the owner's review and for choosing which answers may teach a gauge's street level. It never touches the
// official step, and the answer itself is always kept.
export const FAR_KM = 5;
/** The gauge rose at least this much (feet) in the next 3 hours: "river confirms". */
export const RISE_FT = 0.2;
/** Satellite rain over the pixel that makes local rain a likely cause: 10 mm in 3 h, or 60 mm in 24 h (the street-rain rule's "possible"). */
export const RAIN_3H_MM = 10, RAIN_24H_MM = 60;
const HOUR = 3_600_000;
export const CHECKS = ["river confirms", "local rain likely", "far from gauge / wrong gauge", "unexplained"];
export const FAR = "far from gauge / wrong gauge";

/** Great-circle distance in km, one decimal. */
export function distKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}

/** Nearest gauge of a station list ({station, latitude, longitude, basin}) to a point: {station, km, basin} or null. */
export function nearestGauge(pt, stations) {
  let best = null;
  for (const s of stations ?? []) {
    if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) continue;
    const km = distKm(pt, { lat: s.latitude, lon: s.longitude });
    if (!best || km < best.km) best = { station: s.station, km, basin: (s.basin ?? "").trim() };
  }
  return best;
}

/**
 * What the gauge did in the 3 hours after the answer. `obs` = [{ts, v}] in feet (any order); `base` = the level the page showed (feet) or null;
 * `marks` = {alertFt, minorFt} (feet, either may be missing). Returns null when no reading fell in the window.
 * nextMark = the lowest official mark still above the starting level (the one the river was heading for), toMarkFt = how far the highest reading came from it (negative = past it).
 */
export function gaugeNext3h(obs, createdMs, base, marks = {}) {
  const win = (obs ?? []).filter((o) => o.ts > createdMs && o.ts <= createdMs + 3 * HOUR && Number.isFinite(o.v));
  if (!win.length) return null;
  let start = base;
  if (start == null) {
    const before = (obs ?? []).filter((o) => o.ts <= createdMs && createdMs - o.ts <= 90 * 60_000 && Number.isFinite(o.v)).sort((a, b) => b.ts - a.ts)[0];
    start = before ? before.v : win.slice().sort((a, b) => a.ts - b.ts)[0].v;
  }
  const max = Math.max(...win.map((o) => o.v));
  const last = win.slice().sort((a, b) => b.ts - a.ts)[0].v;
  const rise = Math.round((max - start) * 100) / 100;
  const marksAbove = [["alert", marks.alertFt], ["minor", marks.minorFt]].filter(([, ft]) => ft != null && ft > start).sort((a, b) => a[1] - b[1]);
  const next = marksAbove[0] ?? null;
  return {
    n: win.length, startFt: Math.round(start * 100) / 100, maxFt: Math.round(max * 100) / 100, riseFt: rise,
    dir: rise >= RISE_FT ? "rose" : last <= start - RISE_FT ? "fell" : "steady",
    nextMark: next ? { name: next[0], ft: next[1] } : null,
    toMarkFt: next ? Math.round((next[1] - max) * 100) / 100 : null,
  };
}

/**
 * The check for one "worse" answer. Input:
 *   loc {lat, lon}          rounded point (null = no location -> check null)
 *   shown {station, latitude, longitude, basin}   the gauge the page showed
 *   stations []             all gauges (to find the nearest)
 *   rain {mm3h, mm24h}      stored satellite rain over the person's pixel (null = unknown)
 *   obs, createdMs, base, marks, now   see gaugeNext3h; `now` decides "pending" (answer less than 3 h old, gauge not heard yet)
 * Output: {check, distShownKm, nearest, nearestKm, nearestBasin, reasons[], next3h} where check is one of CHECKS, "pending" (too new), or null (no location).
 * Order matters: a person far from the gauge cannot confirm it, so that comes first; then the river; then local rain; then "unexplained".
 */
export function checkWorse({ loc, shown, stations, rain, obs, createdMs, base, marks, now }) {
  if (!loc || !shown) return { check: null, distShownKm: null, nearest: null, nearestKm: null, nearestBasin: null, reasons: [], next3h: null };
  const distShownKm = distKm(loc, { lat: shown.latitude, lon: shown.longitude });
  const near = nearestGauge(loc, stations);
  const reasons = [];
  if (distShownKm > FAR_KM) reasons.push(`${distShownKm} km from the gauge shown`);
  if (near && near.station !== shown.station && near.km <= distShownKm / 2 && distShownKm - near.km >= 2) reasons.push(`${near.station} is much closer (${near.km} km)`);
  if (near && near.station !== shown.station && near.basin && (shown.basin ?? "").trim() && near.basin !== (shown.basin ?? "").trim() && near.km < distShownKm) reasons.push(`nearest gauge is on ${near.basin}, not ${(shown.basin ?? "").trim()}`);
  const next3h = gaugeNext3h(obs, createdMs, base, marks);
  let check;
  if (reasons.length) check = FAR;
  else if (next3h && (next3h.riseFt >= RISE_FT || (marks?.alertFt != null && next3h.maxFt >= marks.alertFt))) check = "river confirms";
  else if ((rain?.mm3h ?? 0) >= RAIN_3H_MM || (rain?.mm24h ?? 0) >= RAIN_24H_MM) check = "local rain likely";
  else if (!next3h && now != null && now - createdMs < 3 * HOUR) check = "pending";
  else check = "unexplained";
  return { check, distShownKm, nearest: near?.station ?? null, nearestKm: near?.km ?? null, nearestBasin: near?.basin ?? null, reasons, next3h };
}

/** One entry of stations.json (the `data` branch copy of the gauge list): coordinates, basin and the alert / minor marks in feet. */
export function stationInfo(s) {
  const f = s.Unit === "m" ? 1 / 0.3048 : 1;
  const ft = (v) => (typeof v === "number" && v > 0 ? Math.round(v * f * 100) / 100 : null);
  return { station: s.station, latitude: s.latitude, longitude: s.longitude, basin: (s.basin ?? "").trim(), factor: f, alertFt: ft(s.Alert_Level), minorFt: ft(s.Minor_Flood_Level) };
}

/** Flat, export-ready columns for one answer: `null` fields for answers that are not "worse"; "no location" for a worse answer without a point. */
export function exportColumns(row, c) {
  const blank = { place_pick: null, lat_r: null, lon_r: null, nearest_gauge: null, nearest_km: null, rain_3h_mm: null, rain_24h_mm: null, gauge_next3h_dir: null, gauge_next3h_max: null, gauge_next_mark: null, gauge_to_mark_ft: null, check: null, check_reasons: null };
  if (row.answer !== "worse") return blank;
  const n = c?.next3h;
  return {
    place_pick: row.place_pick ?? null, lat_r: row.lat_r ?? null, lon_r: row.lon_r ?? null,
    nearest_gauge: c?.nearest ?? null, nearest_km: c?.nearestKm ?? null, rain_3h_mm: row.rain_3h_mm ?? null, rain_24h_mm: row.rain_24h_mm ?? null,
    gauge_next3h_dir: n?.dir ?? null, gauge_next3h_max: n?.maxFt ?? null, gauge_next_mark: n?.nextMark ? `${n.nextMark.name} ${n.nextMark.ft} ft` : null, gauge_to_mark_ft: n?.toMarkFt ?? null,
    check: row.lat_r == null ? "no location" : c?.check ?? null, check_reasons: c?.reasons?.length ? c.reasons.join("; ") : null,
  };
}
