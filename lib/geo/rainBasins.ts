// Official river basin outlines (Irrigation Department `river_basins` layer, built by scripts/build-rain-basins.mjs), for the
// rain map: which basin a pixel or a tap falls in, and the outline drawn around the chosen river. ~13 KB; server and the
// lazily loaded map chunk only.
import json from "./rain-basins.json";

export type LonLat = [lon: number, lat: number];

const decode = (d: number[]): LonLat[] => {
  const out: LonLat[] = [];
  let x = 0, y = 0;
  for (let i = 0; i + 1 < d.length; i += 2) {
    x += d[i];
    y += d[i + 1];
    out.push([x / 1000, y / 1000]);
  }
  return out;
};

export const RAIN_BASINS: Record<string, LonLat[][]> = Object.fromEntries(
  Object.entries((json as { basins: Record<string, { rings: number[][] }> }).basins).map(([k, v]) => [k, v.rings.map(decode)]),
);

/** Even-odd test over all rings of a basin (holes count as outside). */
export function inBasin(rings: LonLat[][], lon: number, lat: number): boolean {
  let inside = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}
