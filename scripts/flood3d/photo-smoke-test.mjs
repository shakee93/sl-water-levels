// Owner check of the 3D map photo pipeline on the live site: makes one TEST report (status 'test': never counted or used for
// calibration), attaches one generated photo, and prints the answers. Usage: node scripts/flood3d/photo-smoke-test.mjs [base-url]
import sharp from "sharp";

const base = process.argv[2] || "https://waterlevels.lk";
const ok = (label, res, body) => console.log(`${res.ok ? "OK  " : "FAIL"} ${label}: ${res.status} ${JSON.stringify(body)}`);

const cfg = await fetch(`${base}/api/flood3d/report`).then((r) => r.json());
console.log(`photosEnabled: ${cfg.photosEnabled}`);
if (!cfg.photosEnabled) process.exit(1);

// A neutral point in Kelaniya (inside the map's bounds), not anyone's home.
const report = { kind: "water_now", depth: "ankle", lat: 6.955, lon: 79.92, acc: 50, src: "pin", lang: "en", consent: true, ms: 5000, test: true };
const r1 = await fetch(`${base}/api/flood3d/report`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(report) });
const b1 = await r1.json();
ok("test report", r1, { ok: b1.ok, id: b1.photo?.id });
if (!b1.photo?.id) process.exit(1);

const jpeg = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 60, g: 120, b: 200 } } }).jpeg({ quality: 70 }).toBuffer();
const r2 = await fetch(`${base}/api/flood3d/photo?report=${b1.photo.id}&tok=${encodeURIComponent(b1.photo.token)}`, {
  method: "POST", headers: { "content-type": "image/jpeg" }, body: jpeg,
});
ok("test photo", r2, await r2.json());
process.exit(r2.ok ? 0 : 1);
