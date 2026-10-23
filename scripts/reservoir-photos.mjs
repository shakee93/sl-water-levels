#!/usr/bin/env node
// Finds freely licensed photos of each reservoir on Wikimedia Commons and writes lib/reservoirPhotos.json.
//
//   node scripts/reservoir-photos.mjs            fetch (cached), choose, write lib/reservoirPhotos.json
//   node scripts/reservoir-photos.mjs --report   also print every candidate that was rejected, with the reason
//   node scripts/reservoir-photos.mjs --fresh    ignore the cache
//
// Sources: Commons file search by name (several spellings), Commons categories named after the reservoir,
// and Wikidata P18/P373 for the reservoir's item. Every file's extmetadata is checked:
//  - licence must be CC0, public domain, CC BY or CC BY-SA (any version); NC/ND/GFDL-only/fair-use are refused
//  - the title, description or categories must name the reservoir, and the place must be Sri Lanka
//    (words, or file coordinates inside the island's bounding box); maps, logos, diagrams, drawings and
//    tiny files are refused, and so are files that look like portraits or events
//  - photos taken by the same author on the same reservoir are all kept (up to 4), best first
// scripts/reservoir-photos-overrides.json can force a file in or out per slug (reviewed by eye), and
// give a caption. API results are cached under .cache/reservoir-photos/ and the request rate is 1 per
// 1.1 s, with a User-Agent that names the site and the owner.
//
// Nothing is downloaded from upload.wikimedia.org here and no original is committed: the site hot-links
// Wikimedia's own thumbnails (see app/ReservoirPhoto.tsx).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache", "reservoir-photos");
const OUT = join(ROOT, "lib", "reservoirPhotos.json");
const OVERRIDES = join(ROOT, "scripts", "reservoir-photos-overrides.json");
const SITE = process.env.SITE ?? "https://sl-water-levels.vercel.app";
const UA = `sl-water-levels/1.0 (${SITE}; shakee.zats@gmail.com) reservoir-photos.mjs`;
const REPORT = process.argv.includes("--report");
const FRESH = process.argv.includes("--fresh");
const MAX_PHOTOS = 4;
mkdirSync(CACHE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function get(url) {
  const key = join(CACHE, createHash("sha1").update(url).digest("hex") + ".json");
  if (!FRESH && existsSync(key)) return JSON.parse(readFileSync(key, "utf8"));
  const wait = 1100 - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  for (let attempt = 0; attempt < 4; attempt++) {
    last = Date.now();
    const res = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
    if (res.status === 429 || res.status >= 500) {
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const json = await res.json();
    writeFileSync(key, JSON.stringify(json));
    return json;
  }
  throw new Error(`gave up on ${url}`);
}

const COMMONS = "https://commons.wikimedia.org/w/api.php";
const q = (o) => new URLSearchParams({ format: "json", formatversion: "2", ...o }).toString();
const FILE_PROPS = {
  prop: "imageinfo|categories|coordinates|description",
  iiprop: "url|size|mime|extmetadata",
  iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|ImageDescription|Credit|ObjectName|AttributionRequired|Restrictions|DateTimeOriginal",
  cllimit: "max",
  coprop: "globe",
  colimit: "max",
};

// ------------------------------------------------------------------ the reservoir list
async function reservoirList() {
  const f = join(CACHE, "reservoirs.json");
  if (FRESH || !existsSync(f)) {
    const res = await fetch(`${SITE}/api/reservoirs`, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`reservoir list ${res.status}`);
    writeFileSync(f, JSON.stringify(await res.json()));
  }
  return JSON.parse(readFileSync(f, "utf8")).reservoirs.map((r) => ({ slug: r.id, name: r.name, district: r.district }));
}

// ------------------------------------------------------------------ naming
const norm = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_\-.,:;()/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const GENERIC = new Set(["wewa", "wawa", "tank", "reservoir", "samudraya", "oya", "ara", "dam", "lake", "kulam", "left", "bank", "right", "ela", "ganga", "giants"]);
/** Spelling variants of the first word(s) of a name, lower-case. */
function variants(name) {
  const base = norm(name.replace(/\(.*?\)/g, ""));
  const out = new Set([base]);
  const swap = (s) => {
    const o = new Set([s]);
    for (const [a, b] of [["wewa", "wawa"], ["wewa", "weva"], ["wawa", "wewa"], ["vehera", "wehera"], ["wehera", "vehera"], ["th", "t"], ["kulam", "kulama"], ["samudraya", "samudra"], ["senanayake", "senanayaka"], ["ara", "aru"]])
      if (s.includes(a)) o.add(s.replace(a, b));
    return o;
  };
  for (const v of [...out]) for (const w of swap(v)) out.add(w);
  // "Dambewewa" -> "Dambe wewa", "Kalawewa" -> "Kala wewa"
  for (const v of [...out]) {
    const m = v.match(/^(.{3,})(wewa|wawa)$/);
    if (m) out.add(`${m[1]} ${m[2]}`);
  }
  return [...out];
}
/** The distinctive part: the name minus generic words ("Tissa Wewa" -> "tissa"). */
function core(name) {
  const w = norm(name.replace(/\(.*?\)/g, "")).split(" ").filter((x) => !GENERIC.has(x));
  return w.length ? w.join(" ") : norm(name);
}
function tokens(name) {
  return variants(name);
}

// ------------------------------------------------------------------ file checks
const OK_LICENSE = [
  [/^cc0|public domain|^pd\b|^pd-|no known copyright|^cc[- ]?zero|^copyrighted free use|^attribution$/i, "PD"],
  [/^cc[- ]by[- ]sa/i, "CC BY-SA"],
  [/^cc[- ]by(?![- ]?(nc|nd|sa))/i, "CC BY"],
];
function licenceOf(meta) {
  const short = (meta.LicenseShortName?.value ?? "").trim();
  if (!short) return null;
  if (/nc|nd\b|-nd|gfdl only|fair use|non-?commercial/i.test(short) && !/^cc[- ]by[- ]sa/i.test(short)) return null;
  if (/[- ]nc[- ]|[- ]nd[- ]/i.test(short)) return null;
  for (const [re] of OK_LICENSE) if (re.test(short)) return short;
  return null;
}
const stripHtml = (s) =>
  String(s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const BAD_WORDS = /\b(map|maps|logo|flag|coat of arms|diagram|chart|plan|drawing|sketch|painting|stamp|poster|brochure|screenshot|icon|schematic|locator|location|cropped?_?map|satellite|landsat|sentinel|nasa|cartogram|infographic)\b/i;
const PEOPLE_WORDS = /\b(portrait|wedding|ceremony|festival|procession|minister|president|politician|cricket|parade|protest|rally|meeting|students?|children|boys|girls|woman|women|man|men|family|group|selfie|monk|bride|speech|visit of|inauguration|opening ceremony|foundation stone)\b/i;
const WATER = /\b(reservoir|tank|wewa|wawa|weva|dam|lake|spill|spillway|bund|weir|sluice|barrage|samudra|samudraya|ara|oya|kulam|kulama|hydro|water|irrigation|power station|powerhouse)\b/i;
const SL = /sri lanka|ceylon/i;
const SL_BOX = { s: 5.7, n: 10.0, w: 79.4, e: 82.0 };

function describe(page) {
  const ii = page.imageinfo?.[0];
  if (!ii) return null;
  const meta = ii.extmetadata ?? {};
  const cats = (page.categories ?? []).map((c) => c.title.replace(/^Category:/, ""));
  const desc = stripHtml(meta.ImageDescription?.value);
  const co = page.coordinates?.[0];
  return {
    title: page.title,
    url: ii.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
    original: ii.url,
    width: ii.width,
    height: ii.height,
    mime: ii.mime,
    licence: licenceOf(meta),
    licenceRaw: meta.LicenseShortName?.value ?? "",
    licenceUrl: meta.LicenseUrl?.value ?? "",
    author: stripHtml(meta.Artist?.value) || stripHtml(meta.Credit?.value),
    desc,
    cats,
    lat: co?.lat,
    lon: co?.lon,
    date: stripHtml(meta.DateTimeOriginal?.value),
  };
}

function judge(f, res) {
  const why = [];
  if (!/^image\/(jpeg|png|webp)$/.test(f.mime)) why.push(`mime ${f.mime}`);
  if (!f.licence) why.push(`licence ${f.licenceRaw || "unknown"}`);
  if (Math.min(f.width, f.height) < 500 || f.width < 800) why.push(`small ${f.width}x${f.height}`);
  if (f.height > f.width * 1.6) why.push("very tall");
  if (!f.author) why.push("no author to credit");
  const text = norm(`${f.title} ${f.desc} ${f.cats.join(" ")}`);
  const titleText = norm(f.title.replace(/^File:/, "").replace(/\.\w+$/, ""));
  if (BAD_WORDS.test(titleText) || /^(map|logo)/.test(titleText)) why.push("map/logo/diagram in title");
  if (PEOPLE_WORDS.test(titleText)) why.push("people in title");
  if (/category:(maps|logos)|\bmaps? of\b|\blogos?\b/i.test(f.cats.join(" | "))) why.push("map/logo category");
  // Names the reservoir?
  const vs = tokens(res.name);
  const c = core(res.name);
  const hasWord = (s, v) => new RegExp(`(^| )${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(s);
  const inTitle = vs.some((v) => hasWord(titleText, v)) || hasWord(titleText, c);
  const inCats = f.cats.some((cat) => {
    const n = norm(cat);
    return vs.some((v) => hasWord(n, v)) || hasWord(n, c);
  });
  const inDesc = vs.some((v) => hasWord(norm(f.desc), v)) || hasWord(norm(f.desc), c);
  if (!(inTitle || inCats || inDesc)) why.push("name not in title/categories/description");
  if (!WATER.test(text)) why.push("no water/dam word");
  // In Sri Lanka?
  const inBox = f.lat != null && f.lat >= SL_BOX.s && f.lat <= SL_BOX.n && f.lon >= SL_BOX.w && f.lon <= SL_BOX.e;
  const farAway = f.lat != null && !inBox;
  if (farAway) why.push(`coordinates outside Sri Lanka (${f.lat},${f.lon})`);
  else if (!inBox && !SL.test(text)) why.push("Sri Lanka not mentioned");
  // Score: a title or category hit beats a description hit; bigger and landscape beats small.
  let score = (inTitle ? 5 : 0) + (inCats ? 4 : 0) + (inDesc ? 1 : 0) + (inBox ? 2 : 0);
  score += Math.min(f.width, 4000) / 2000;
  if (f.width >= f.height) score += 1;
  if (/\b(dam|spill|reservoir|lake|tank|wewa|panorama|view)\b/i.test(titleText)) score += 1;
  if (/\b(night|interior|inside|bus|train|hotel room|food|menu|fish|bird|butterfly|flower|plant|insect|spider|snake|frog|lizard|monkey|elephant|buffalo|crocodile|cat|dog|tree|leaf)\b/i.test(titleText)) score -= 4;
  return { ok: why.length === 0, why, score };
}

// ------------------------------------------------------------------ fetchers
async function fileSearch(term) {
  const j = await get(`${COMMONS}?${q({ action: "query", generator: "search", gsrsearch: term, gsrnamespace: "6", gsrlimit: "30", ...FILE_PROPS })}`);
  return (j.query?.pages ?? []).map(describe).filter(Boolean);
}
async function categoryFiles(cat) {
  const out = [];
  let cont = {};
  for (let i = 0; i < 3; i++) {
    const j = await get(`${COMMONS}?${q({ action: "query", generator: "categorymembers", gcmtitle: cat, gcmtype: "file", gcmlimit: "40", ...FILE_PROPS, ...cont })}`);
    out.push(...(j.query?.pages ?? []).map(describe).filter(Boolean));
    if (!j.continue) break;
    cont = j.continue;
  }
  return out;
}
async function categorySearch(term) {
  const j = await get(`${COMMONS}?${q({ action: "query", list: "search", srsearch: term, srnamespace: "14", srlimit: "8" })}`);
  return (j.query?.search ?? []).map((s) => s.title);
}
async function wikidataImages(res) {
  const out = [];
  const s = await get(`https://www.wikidata.org/w/api.php?${q({ action: "wbsearchentities", search: res.name, language: "en", type: "item", limit: "8" })}`);
  const ids = (s.search ?? []).filter((e) => /sri lanka|reservoir|tank|dam|lake|irrigation|hydro/i.test(`${e.description ?? ""} ${e.label ?? ""}`)).map((e) => e.id);
  if (!ids.length) return out;
  const e = await get(`https://www.wikidata.org/w/api.php?${q({ action: "wbgetentities", ids: ids.join("|"), props: "claims|descriptions|labels", languages: "en" })}`);
  for (const id of ids) {
    const ent = e.entities?.[id];
    if (!ent) continue;
    const desc = `${ent.descriptions?.en?.value ?? ""}`;
    const coord = ent.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
    const inSL = coord ? coord.latitude >= SL_BOX.s && coord.latitude <= SL_BOX.n && coord.longitude >= SL_BOX.w && coord.longitude <= SL_BOX.e : /sri lanka/i.test(desc);
    if (!inSL) continue;
    for (const key of ["P18", "P373"]) {
      for (const cl of ent.claims?.[key] ?? []) {
        const v = cl.mainsnak?.datavalue?.value;
        if (!v) continue;
        if (key === "P18") out.push({ file: `File:${v}` });
        else out.push({ cat: `Category:${v}` });
      }
    }
  }
  return out;
}
async function filesByTitle(titles) {
  const out = [];
  for (let i = 0; i < titles.length; i += 20) {
    const j = await get(`${COMMONS}?${q({ action: "query", titles: titles.slice(i, i + 20).join("|"), ...FILE_PROPS })}`);
    out.push(...(j.query?.pages ?? []).map(describe).filter(Boolean));
  }
  return out;
}

// ------------------------------------------------------------------ captions
// Plain and always true: Commons descriptions are free text (typos, other languages), so they are not reused.
function caption(res, f, idx) {
  const kind = /\b(dam|spill|spillway)\b/i.test(f.title) ? "dam" : "reservoir";
  const name = res.name.replace(/\s*\(.*\)/, "");
  const nameIsTank = /\b(wewa|wawa|tank|samudraya|reservoir)\b/i.test(name);
  const subject = nameIsTank ? name : `${name} ${kind === "dam" ? "dam" : "reservoir"}`;
  return idx === 0 ? subject.charAt(0).toUpperCase() + subject.slice(1) : `${subject.charAt(0).toUpperCase() + subject.slice(1)}, view ${idx + 1}`;
}

// ------------------------------------------------------------------ main
const overrides = existsSync(OVERRIDES) ? JSON.parse(readFileSync(OVERRIDES, "utf8")) : {};
const list = await reservoirList();
const result = {};
const rejected = {};
let n = 0;

for (const res of list) {
  n++;
  const cands = new Map();
  const add = (fs) => fs.forEach((f) => cands.has(f.title) || cands.set(f.title, f));
  const names = [...new Set([res.name.replace(/\s*\(.*\)/, ""), ...variants(res.name).slice(0, 3)])];
  const terms = new Set();
  for (const nm of names.slice(0, 3)) {
    const c = core(nm);
    terms.add(`${nm} Sri Lanka`);
    if (!/\b(wewa|wawa|tank|reservoir|samudraya|dam|lake)\b/i.test(nm)) {
      terms.add(`${nm} reservoir`);
      terms.add(`${nm} wewa tank`);
    }
    if (c !== norm(nm)) terms.add(`${c} wewa Sri Lanka`);
  }
  for (const t of [...terms].slice(0, 5)) add(await fileSearch(t));
  // Categories named after it
  const cats = new Set(await categorySearch(`${res.name.replace(/\s*\(.*\)/, "")} Sri Lanka`));
  const wd = await wikidataImages(res);
  const wdFiles = wd.filter((x) => x.file).map((x) => x.file);
  wd.filter((x) => x.cat).forEach((x) => cats.add(x.cat));
  const catOk = [...cats].filter((c) => {
    const n2 = norm(c.replace(/^Category:/, ""));
    return variants(res.name).some((v) => n2.includes(v)) || n2.includes(core(res.name));
  });
  for (const c of catOk.slice(0, 3)) add(await categoryFiles(c));
  if (wdFiles.length) add(await filesByTitle(wdFiles));

  const ov = overrides[res.slug] ?? {};
  const forced = new Set(ov.include ?? []);
  const only = ov.only ? new Set(ov.only) : null;
  if (only) only.forEach((t) => forced.add(t));
  const banned = new Set(ov.exclude ?? []);
  if (forced.size) add(await filesByTitle([...forced].filter((t) => !cands.has(t))));

  const scored = [];
  rejected[res.slug] = [];
  for (const f of cands.values()) {
    if (only && !only.has(f.title)) continue;
    if (banned.has(f.title)) {
      rejected[res.slug].push(`${f.title}: excluded by override`);
      continue;
    }
    const j = judge(f, res);
    const isWd = wdFiles.includes(f.title);
    if (forced.has(f.title)) {
      if (f.licence) scored.push({ f, score: 100 }); // licence is never overridden
      else rejected[res.slug].push(`${f.title}: forced but licence ${f.licenceRaw}`);
    } else if (j.ok) scored.push({ f, score: j.score + (isWd ? 2 : 0) });
    else rejected[res.slug].push(`${f.title}: ${j.why.join("; ")}`);
  }
  scored.sort((a, b) => b.score - a.score);
  // Avoid near-duplicates: files whose names differ only by a trailing number are fine, but cap one author at 3.
  const picked = [];
  const perAuthor = {};
  for (const s of scored) {
    const a = s.f.author || "?";
    if ((perAuthor[a] ?? 0) >= 3) continue;
    perAuthor[a] = (perAuthor[a] ?? 0) + 1;
    picked.push(s.f);
    if (picked.length >= MAX_PHOTOS) break;
  }
  result[res.slug] = picked.map((f, i) => {
    const path = f.original.split("?")[0].replace(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//, "");
    return {
      title: f.title.replace(/^File:/, ""),
      page: f.url.split("?")[0],
      path, // upload.wikimedia.org/wikipedia/commons/<path> is the original; thumbnails are derived from it
      width: f.width,
      height: f.height,
      author: f.author,
      license: f.licence,
      licenseUrl: f.licenceUrl || null,
      caption: ov.captions?.[f.title.replace(/^File:/, "")] ?? caption(res, f, i),
    };
  });
  process.stderr.write(`[${n}/${list.length}] ${res.slug}: ${picked.length} photo(s) of ${cands.size} candidates\n`);
}

const out = {
  generatedAt: new Date().toISOString().slice(0, 10),
  source: "Wikimedia Commons (+ Wikidata P18). Generated by scripts/reservoir-photos.mjs; do not edit by hand, use scripts/reservoir-photos-overrides.json.",
  reservoirs: Object.fromEntries(Object.entries(result).filter(([, v]) => v.length)),
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
const withPhotos = Object.keys(out.reservoirs).length;
console.log(`${withPhotos} of ${list.length} reservoirs have photos`);
console.log("Without:", list.filter((r) => !out.reservoirs[r.slug]).map((r) => r.slug).join(", "));
if (REPORT) for (const [slug, rs] of Object.entries(rejected)) if (rs.length) console.log(`\n# ${slug}\n` + rs.slice(0, 15).join("\n"));
