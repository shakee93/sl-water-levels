// Base map for the 3D flood test map: OpenFreeMap "positron" (already muted and without shop/bus POI icons), loaded as JSON so that
// a dark variant can follow the site theme, with our own quiet 3D buildings. Tiles come from OpenFreeMap (free, OSM data, credit in the map).
const POSITRON = "https://tiles.openfreemap.org/styles/positron";

type Json = unknown;
const isColor = (s: string) => /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(s.trim());

let probe: CanvasRenderingContext2D | null = null;
function toRgb(c: string): [number, number, number, number] | null {
  probe ??= document.createElement("canvas").getContext("2d");
  if (!probe) return null;
  probe.fillStyle = "#000"; probe.fillStyle = c; // an unparsable colour keeps the previous (black) value
  const v = probe.fillStyle as string;
  if (v.startsWith("#")) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1];
  const m = v.match(/[\d.]+/g);
  return m ? [+m[0], +m[1], +m[2], m[3] != null ? +m[3] : 1] : null;
}
function hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
/** Light colour -> its dark-theme counterpart: lightness flipped into a narrow dark band, saturation reduced. `kind` picks the band. */
function darken(c: string, kind: "fill" | "line" | "text" | "halo"): string {
  const rgb = toRgb(c);
  if (!rgb) return c;
  const [h, s, l] = hsl(rgb[0], rgb[1], rgb[2]);
  const nl = kind === "text" ? 0.62 + (1 - l) * 0.3 : kind === "halo" ? 0.1 : kind === "line" ? 0.16 + (1 - l) * 0.2 : 0.09 + (1 - l) * 0.2;
  return `hsla(${Math.round(h)}, ${Math.round(s * 45)}%, ${Math.round(nl * 100)}%, ${rgb[3]})`;
}
function mapColors(v: Json, kind: "fill" | "line" | "text" | "halo"): Json {
  if (typeof v === "string") return isColor(v) ? darken(v, kind) : v;
  if (Array.isArray(v)) return v.map((x) => mapColors(x, kind));
  return v;
}
const KIND: Record<string, "fill" | "line" | "text" | "halo"> = {
  "background-color": "fill", "fill-color": "fill", "fill-outline-color": "line", "line-color": "line", "text-color": "text", "text-halo-color": "halo", "icon-color": "text", "icon-halo-color": "halo",
};

type Layer = { id: string; type: string; paint?: Record<string, Json>; layout?: Record<string, Json>; source?: string; "source-layer"?: string };
type Style = { layers: Layer[]; sources: Record<string, unknown>; [k: string]: unknown };

/** The base style for a theme, with our quiet 3D buildings added from zoom 15. */
export async function loadBaseStyle(dark: boolean): Promise<Style> {
  // a rate-limited or blipping style host must not leave the page without a map: up to three tries with a short back-off
  let style: Style | null = null;
  for (let k = 0; k < 3 && !style; k++) {
    try { const r = await fetch(POSITRON); if (r.ok) style = (await r.json()) as Style; } catch { /* try again */ }
    if (!style) await new Promise((res) => setTimeout(res, 800 * (k + 1)));
  }
  if (!style) throw new Error("style");
  if (dark) {
    for (const l of style.layers) {
      if (!l.paint) continue;
      for (const k of Object.keys(l.paint)) if (KIND[k]) l.paint[k] = mapColors(l.paint[k], KIND[k]);
    }
  }
  // fewer labels: keep towns, villages and water names, drop the clutter
  style.layers = style.layers.filter((l) => !["airport", "label_state", "label_country_3", "label_country_2", "label_country_1", "highway-shield-non-us", "highway-shield-us-interstate", "road_shield_us"].includes(l.id));
  // thinner, quieter minor roads
  for (const l of style.layers) if (l.id === "highway_minor" && l.paint) l.paint["line-opacity"] = 0.7;
  // rivers, canals and lakes in the flood map's own blue (its colour at about 1.5 ft deep, same opacity), so water leaving
  // the river looks like the same water; set after the dark pass so both themes composite it the same way as the flood layer
  for (const l of style.layers) {
    if (!l.paint) continue;
    if (l.id === "water") { l.paint["fill-color"] = "rgb(21, 89, 195)"; l.paint["fill-opacity"] = 0.56; }
    if (l.id === "waterway") { l.paint["line-color"] = "rgb(21, 89, 195)"; l.paint["line-opacity"] = 0.56; }
  }
  const firstSymbol = style.layers.find((l) => l.type === "symbol")?.id;
  const b3d: Layer = {
    id: "building-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building",
    paint: {
      "fill-extrusion-color": dark ? "#1f2937" : "#e7e5e1",
      "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": dark ? 0.85 : 0.8,
    },
    layout: {},
    // fill-extrusion needs minzoom through the layer itself
  };
  (b3d as Layer & { minzoom: number }).minzoom = 15;
  const at = style.layers.findIndex((l) => l.id === firstSymbol);
  style.layers.splice(at < 0 ? style.layers.length : at, 0, b3d);
  return style;
}
