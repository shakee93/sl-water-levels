// Checks every launch image: its media query (device-width/height x ratio) must equal the PNG's pixel size, and with a
// URL argument the page must carry a matching <link rel="apple-touch-startup-image"> that returns 200.
//   node --experimental-strip-types scripts/splash-check.mjs [https://waterlevels.lk]
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { splashShots } = await import("../lib/splash.ts");
let bad = 0;
const fail = (m) => (bad++, console.error("FAIL", m));

function expectedPx(media) {
  const n = (re) => Number(re.exec(media)?.[1]);
  const w = n(/device-width: (\d+)px/), h = n(/device-height: (\d+)px/), r = n(/pixel-ratio: (\d+)/);
  const land = /orientation: landscape/.test(media);
  return [(land ? h : w) * r, (land ? w : h) * r];
}
for (const s of splashShots()) {
  const meta = await sharp(readFileSync(join(root, "public/splash", s.file))).metadata();
  const [w, h] = expectedPx(s.media);
  if (meta.width !== w || meta.height !== h) fail(`${s.file}: png ${meta.width}x${meta.height}, media says ${w}x${h}`);
}
console.log(`${splashShots().length} local images checked`);

const url = process.argv[2];
if (url) {
  const html = await (await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1" } })).text();
  const links = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]).filter((l) => l.includes("apple-touch-startup-image"));
  console.log(`${links.length} startup-image links in ${url}`);
  for (const l of links) {
    const href = /href="([^"]+)"/.exec(l)?.[1];
    const media = (/media="([^"]+)"/.exec(l)?.[1] ?? "").replaceAll("&amp;", "&");
    const meta = await sharp(Buffer.from(await (await fetch(new URL(href, url))).arrayBuffer())).metadata().catch(() => null);
    if (!meta) { fail(`${href} did not load as an image`); continue; }
    const [w, h] = expectedPx(media);
    if (meta.width !== w || meta.height !== h) fail(`${href}: ${meta.width}x${meta.height} vs media ${w}x${h}`);
  }
  if (links.length !== splashShots().length) fail(`expected ${splashShots().length} links, found ${links.length}`);
}
console.log(bad ? `${bad} problems` : "all good");
process.exit(bad ? 1 : 0);
