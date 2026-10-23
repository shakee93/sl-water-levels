// Tells Bing, Yandex and other IndexNow search engines that pages changed, so answer engines built
// on their indexes (Copilot, ChatGPT search, Perplexity, DuckDuckGo) pick the change up in minutes.
//
// Usage:
//   node scripts/indexnow.mjs https://sl-water-levels.vercel.app/ https://sl-water-levels.vercel.app/reservoirs/deduru-oya
//   node scripts/indexnow.mjs --core            home, /flood, /reservoirs, /feed.xml, /llms.txt, /data
//   node scripts/indexnow.mjs --dry-run ...     print what would be sent, send nothing
//
// It refuses to send unless the key file is already live on the site (that is how the engines verify
// ownership). The key is the file name in public/ (32 hex characters). Do not call this for every
// 15-minute snapshot: use it for meaningful changes (a new warning, a reservoir starting to spill).
import { readdirSync } from "node:fs";

const SITE = (process.env.SITE_URL || "https://sl-water-levels.vercel.app").replace(/\/$/, "");
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const urls = args.includes("--core")
  ? ["/", "/flood", "/reservoirs", "/feed.xml", "/llms.txt", "/data"].map((p) => SITE + p)
  : args.filter((a) => a.startsWith("http"));
if (!urls.length) { console.error("No URLs given."); process.exit(2); }
if (urls.some((u) => !u.startsWith(SITE))) { console.error(`Every URL must be on ${SITE}.`); process.exit(2); }

const keyFile = readdirSync(new URL("../public/", import.meta.url)).find((f) => /^[a-f0-9]{32}\.txt$/.test(f));
if (!keyFile) { console.error("No key file in public/."); process.exit(2); }
const key = keyFile.replace(".txt", "");

const live = await fetch(`${SITE}/${keyFile}`).then((r) => (r.ok ? r.text() : "")).catch(() => "");
if (live.trim() !== key) { console.error(`Key file ${SITE}/${keyFile} is not live yet; not sending.`); process.exit(1); }

const body = { host: new URL(SITE).host, key, keyLocation: `${SITE}/${keyFile}`, urlList: urls.slice(0, 10_000) };
if (dry) { console.log(JSON.stringify(body, null, 2)); process.exit(0); }
const r = await fetch("https://api.indexnow.org/indexnow", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
console.log(`IndexNow answered ${r.status} for ${urls.length} URL(s)`);
process.exit(r.status === 200 || r.status === 202 ? 0 : 1);
