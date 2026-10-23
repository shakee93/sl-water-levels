// Draws the iOS launch (splash) images into public/splash/ and a flat 180px apple-touch-icon.
//   node --experimental-strip-types scripts/splash.mjs
// Brand: the app icon centred, "Sri Lanka Water Levels" beneath in Geist, on the site's own page colours
// (white / slate-950). Sizes come from lib/splash.ts; the media queries are checked by scripts/splash-check.mjs.
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// librsvg finds fonts through fontconfig: point it at the bundled Geist file only.
const fonts = join(root, "scripts/fonts");
const conf = join(tmpdir(), "sl-splash-fonts.conf");
writeFileSync(conf, `<?xml version="1.0"?><fontconfig><dir>${fonts}</dir><cachedir>${join(tmpdir(), "sl-splash-fc")}</cachedir></fontconfig>`);
process.env.FONTCONFIG_FILE = conf;
const { default: sharp } = await import("sharp");
const { splashShots } = await import("../lib/splash.ts");

const BG = { light: "#ffffff", dark: "#020617" };
const INK = { light: "#0f172a", dark: "#f1f5f9" };
const NAME = "Sri Lanka Water Levels";

// the app icon (app/icon.svg) without its own tile edge: a rounded square with three waves
const mark = (size) => `<g transform="scale(${size / 32})">
  <rect width="32" height="32" rx="7" fill="#0c4a6e"/>
  <path d="M4 22 Q10 18 16 22 T28 22" stroke="#7dd3fc" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <path d="M4 16 Q10 12 16 16 T28 16" stroke="#38bdf8" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <path d="M4 10 Q10 6 16 10 T28 10" stroke="#0ea5e9" stroke-width="2.2" fill="none" stroke-linecap="round"/></g>`;

function svg(w, h, scheme) {
  const short = Math.min(w, h);
  const m = Math.round(short * 0.2);
  const fs = Math.round(short * 0.042);
  const gap = Math.round(m * 0.28);
  const groupH = m + gap + fs;
  const top = Math.round(h * 0.46 - groupH / 2);
  const ty = top + m + gap + fs * 0.8;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${BG[scheme]}"/>
  <g transform="translate(${Math.round((w - m) / 2)} ${top})">${mark(m)}</g>
  <text x="${w / 2}" y="${ty}" text-anchor="middle" font-family="Geist" font-size="${fs}" font-weight="500" letter-spacing="${(fs * -0.01).toFixed(2)}" fill="${INK[scheme]}">${NAME}</text>
</svg>`;
}

const out = join(root, "public/splash");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
let total = 0;
for (const s of splashShots()) {
  const [w, h] = s.px;
  const buf = await sharp(Buffer.from(svg(w, h, s.scheme))).png({ palette: true, quality: 90, effort: 10, colours: 32 }).toBuffer();
  writeFileSync(join(out, s.file), buf);
  total += buf.length;
}
console.log(`${splashShots().length} images, ${(total / 1024).toFixed(0)} KB`);

// apple-touch-icon: solid tile, no transparency, the icon filling the whole square (iOS rounds the corners itself)
const icon = readFileSync(join(root, "app/icon.svg"), "utf8").replace(/rx="7"/, 'rx="0"').replace('width="32" height="32"', 'width="180" height="180"');
await sharp(Buffer.from(icon)).flatten({ background: "#0c4a6e" }).removeAlpha().png().toFile(join(root, "app/apple-icon.png"));
console.log("apple-icon.png written");
