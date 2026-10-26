// River basin outlines for the rain map (/rain), from the Irrigation Department's own ArcGIS `river_basins` layer (same org as
// the gauges). Run by hand when the basin list changes; the layer is static. Writes lib/geo/rain-basins.json:
//   { basins: { "<basin as on the site>": { rings: [delta-encoded 1e-3 degree lon,lat integers ...] } } }
// Simplified on the server side (maxAllowableOffset 0.005 degree, ~500 m), which is plenty for a 0.1 degree rain grid.
// Usage: node scripts/build-rain-basins.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ARC = "https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services";
// site basin name -> river_basins layer Name (the same mapping as scripts/build-catchments.mjs OUTLETS)
const NAMES = {
  "Kelani Ganga": "Kelani Ganga", "Kalu Ganga": "Kalu Ganga", "Gin Ganga": "Gin Ganga", "Nilwala Ganga": "Nilwala Ganga",
  "Aththanagalu Oya": "Attanagalu Oya", "Deduru Oya": "Deduru Oya", "Heda Oya": "Heda Oya", "Kirindi Oya": "Kirindi Oya",
  "Kumbukkan Oya": "Kumbukkan Oya", "Ma Oya": "Ma Oya", "Maduru Oya": "Maduru Oya", "Maha Oya": "Maha Oya",
  "Mahaweli Ganga": "Mahaweli Ganga", "Malwathu Oya": "Aruvi Aru", "Mee Oya": "Mi Oya", "Menik Ganga": "Menik Ganga",
  "Walawe Ganga": "Walawe Ganga", "Yan Oya": "Yan Oya",
};
const out = {};
for (const [site, layer] of Object.entries(NAMES)) {
  const url = `${ARC}/river_basins/FeatureServer/0/query?where=Name%3D%27${encodeURIComponent(layer)}%27&outFields=Name&returnGeometry=true&outSR=4326&maxAllowableOffset=0.005&geometryPrecision=3&f=json`;
  const j = await (await fetch(url)).json();
  if (j.error) throw new Error(`${site}: ${JSON.stringify(j.error)}`);
  const rings = (j.features ?? []).flatMap((f) => f.geometry?.rings ?? []).filter((r) => r.length >= 4);
  if (!rings.length) throw new Error(`${site}: no polygon for "${layer}"`);
  out[site] = {
    rings: rings.map((r) => {
      const d = [];
      let x = 0, y = 0;
      for (const [lon, lat] of r) {
        const X = Math.round(lon * 1000), Y = Math.round(lat * 1000);
        if (X === x && Y === y) continue;
        d.push(X - x, Y - y);
        x = X; y = Y;
      }
      return d;
    }),
  };
  console.log(site, rings.length, "ring(s)", rings.reduce((n, r) => n + r.length, 0), "points");
  await new Promise((ok) => setTimeout(ok, 1200)); // ArcGIS rate limit
}
const file = path.join(here, "../lib/geo/rain-basins.json");
writeFileSync(file, JSON.stringify({ source: "Irrigation Department river_basins (ArcGIS)", basins: out }) + "\n");
console.log("wrote", file);
