// Satellite rain (JAXA GSMaP) at one point, read from the SAME national 0.1 degree grid the rain map uses (gsmap/grid.json on the
// `data` branch, rolling ~26 h, one frame per 30 minutes, tenths of mm/h, -1 = missing). Pure: no imports, no I/O, no clock.
// A pixel is about 11 km wide, so this is "rain over the pixel the point is in", not rain at the point: the "about 1 km" location only
// picks the pixel. Used by app/api/feedback/route.ts (stored once, when a "worse" answer gets a location) and tested in scripts/feedback-check.test.mts.
export const GRID = { lat0: 9.95, lon0: 79.55, step: 0.1, nx: 25, ny: 42 };
const HOUR = 3_600_000;

/** Index (row * nx + col) of the pixel the point falls in, or -1 when outside the grid. */
export function pixelIndex(lat, lon, g = GRID) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return -1;
  const r = Math.round((g.lat0 - lat) / g.step), c = Math.round((lon - g.lon0) / g.step);
  return r >= 0 && r < g.ny && c >= 0 && c < g.nx ? r * g.nx + c : -1;
}

/**
 * mm over the last 3 and 24 whole hours at a point. `grid` = {times: ISO strings, frames: number[][]}. Only :00 frames count (each is the
 * rate over the hour starting there, so summing them never double counts). A window with under 75% of its hours is null, never zero.
 * Returns {mm3h, mm24h, endMs} (endMs = end of the newest hour used) or null when the grid has nothing for that pixel.
 */
export function pointRain(grid, lat, lon, g = GRID) {
  const idx = pixelIndex(lat, lon, g);
  if (idx < 0 || !grid || !Array.isArray(grid.times) || !Array.isArray(grid.frames)) return null;
  const hours = grid.times
    .map((iso, i) => ({ start: Date.parse(iso), v: grid.frames[i] }))
    .filter((h) => Number.isFinite(h.start) && h.start % HOUR === 0 && Array.isArray(h.v) && h.v.length === g.nx * g.ny);
  const newest = hours.at(-1);
  if (!newest) return null;
  const total = (n) => {
    const win = hours.filter((h) => h.start > newest.start - n * HOUR);
    const need = Math.ceil(n * 0.75);
    let s = 0, have = 0;
    for (const h of win) if (h.v[idx] >= 0) { s += h.v[idx] / 10; have++; }
    return have >= need ? Math.round(((s * n) / have) * 10) / 10 : null;
  };
  return { mm3h: total(3), mm24h: total(24), endMs: newest.start + HOUR };
}
