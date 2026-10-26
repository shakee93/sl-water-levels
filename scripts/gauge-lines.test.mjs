// Every river gauge must sit on a drawn river line on the maps (home: lib/geo/home-rivers.json,
// river pages: lib/geo/rivers.json). Fails if one is farther than LIMIT_M, except the listed reasons.
//   node scripts/gauge-lines.test.mjs
// Gauge positions: scripts/data/gauges.json (copy of /api/levels latitude/longitude, from the
// Irrigation Department's hydrostations layer).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIMIT_M = 500;
// gauge id -> reason it may sit off the drawn lines
const EXCEPTIONS = {
  "gal-oya/ampara": { maxM: 1200, why: "the gauge point is Ampara town: both the Irrigation Department's rivers layer and OpenStreetMap put the nearest river/canal 1.0-1.1 km away" },
};

const gauges = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/data/gauges.json"), "utf8"));
const decode = (d) => { const o = []; let x = 0, y = 0; for (let i = 0; i + 1 < d.length; i += 2) { x += d[i]; y += d[i + 1]; o.push([x / 1e4, y / 1e4]); } return o; };
const KX = Math.cos((7.8 * Math.PI) / 180);
function distM(p, lines) {
  let best = Infinity;
  for (const pts of lines) for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], ay = pts[i - 1][1];
    const dx = (pts[i][0] - ax) * KX, dy = pts[i][1] - ay, px = (p.lon - ax) * KX, py = p.lat - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(px - t * dx, py - t * dy) * 111200);
  }
  return best;
}
let fail = 0;
for (const [file, onlyBasin] of [["home-rivers.json", true], ["rivers.json", false]]) {
  const lines = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/geo", file), "utf8")).rivers.filter((r) => !onlyBasin || r.b).map((r) => decode(r.d));
  let worst = 0;
  for (const g of gauges) {
    const d = distM(g, lines);
    worst = Math.max(worst, d);
    if (d > LIMIT_M) {
      const ex = EXCEPTIONS[g.id];
      if (ex && d <= ex.maxM) console.log(`  ${file}: ${g.station} ${(d / 1000).toFixed(2)} km (allowed: ${ex.why})`);
      else { fail++; console.log(`FAIL ${file}: ${g.station} (${g.river}) is ${(d / 1000).toFixed(2)} km from a drawn line`); }
    }
  }
  console.log(`${file}: ${gauges.length} gauges, worst ${(worst / 1000).toFixed(2)} km`);
}
if (fail) { console.log(`${fail} failures`); process.exit(1); }
console.log("ok");
