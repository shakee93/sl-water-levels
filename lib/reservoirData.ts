// Data layer for the reservoir pages (/reservoirs, /reservoirs/<slug>).
//
// Every reservoir that appears in the Irrigation Department sheet (Major + Medium tabs) or in the
// Mahaweli Authority WMS report gets a page. The two are merged by a normalised name. Nothing is
// invented: a blank cell is "no data" (null), never zero; the GO= figure in the sheet remarks is
// gate capacity and is never read as a flow (only the cusec columns are); and a reading older than
// two days is flagged `fresh: false` so the page can grey it out instead of showing it as current.
//
// The sheet is parsed here (not through lib/releases.ts) because the pages also need the district,
// storage %, rain and capacity columns, which the warning code ignores. The parsing helpers are
// shared (parseCsv, parseSheetDay, parseGatesOpen), and scripts/check-reservoirs.mjs compares both
// parsers against the raw sources and the deployed /api/releases.
//
// Rivers: the Irrigation Department's own Survey123 form (river_basin field) names the river basin
// of ~45 reservoirs; the hand-made catalogue (lib/reservoirs.ts) and lib/dams.ts add the rest of
// the Mahaweli/CEB ones. A reservoir with no known river just shows its district.

import { unstable_cache } from "next/cache";
import { cache } from "react";
import { arcgis } from "./arcgis";
import { getReleaseSources, getReleases, parseCsv, parseGatesOpen, parseSheetDay, type Release } from "./releases";
import { RESERVOIRS, matchReservoir, type GaugeLink } from "./reservoirs";
import { RESERVOIR_COORDS } from "./reservoirCoords";
import { slugify } from "./slug";

// ---------------------------------------------------------------- types

export type Status = "spilling" | "releasing" | "holding" | "nodata";

export type SheetFacts = {
  tab: "Major" | "Medium";
  /** Calendar day of the reading, YYYY-MM-DD. */
  day: string;
  fresh: boolean;
  spilling: boolean;
  spillCusecs: number | null;
  sluiceCusecs: number | null;
  depthFt: number | null;
  fsdFt: number | null;
  /** "Effective storage %" column. */
  storagePct: number | null;
  /** Rain in the preceding day, mm; null = not measured. */
  rainMm: number | null;
  capacityAcft: number | null;
  gatesOpen: number | null;
};

export type WmsFacts = {
  day: string;
  fresh: boolean;
  levelMsl: number | null;
  storagePct: number | null;
  rainMm: number | null;
  dischargeCusecs: number | null;
};

export type Flow = {
  kind: "spill" | "downstream" | "outlets";
  cusecs: number;
  source: "Irrigation Department" | "Mahaweli Authority";
  day: string;
};

export type Storage = { pct: number; source: "Irrigation Department" | "Mahaweli Authority"; day: string; fresh: boolean };

export type RV = {
  slug: string;
  name: string;
  si: string | null;
  ta: string | null;
  river: string | null;
  district: string | null;
  kind: "major" | "medium" | "mahaweli";
  catalogueId: string | null;
  gauges: GaugeLink[];
  barrage: boolean;
  sheet: SheetFacts | null;
  wms: WmsFacts | null;
  status: Status;
  flow: Flow | null;
  storage: Storage | null;
  /** Newest reading day across both sources. */
  latestDay: string | null;
};

export type ReservoirsData = {
  items: RV[];
  sheetDate: string | null;
  wmsDate: string | null;
  /** When the sheet was last read by this server (ms). */
  checkedAt: number;
};

// ---------------------------------------------------------------- sources

const SHEET_ID = "2PACX-1vTcSGhi9RESl7CMCl1TQnrKe07Gx5Q696YiSB9jneIHqIP9lifpqSErgI3D5k9KtQXSdW5JpycIIr5e";
const SHEET_BASE = `https://docs.google.com/spreadsheets/d/e/${SHEET_ID}`;
const TABS = [
  { gid: 1212294664, tab: "Major" as const },
  { gid: 562386515, tab: "Medium" as const },
];
const UA = "Mozilla/5.0 (compatible; sl-water-levels; +https://github.com/shakee93/sl-water-levels)";
const COLOMBO_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;
const colomboDay = (ms: number) => new Date(ms + COLOMBO_MS).toISOString().slice(0, 10);
/** A reading older than this many whole days is not shown as current. */
const FRESH_DAYS = 2;

const num = (s: string | undefined | null): number | null => {
  if (s == null) return null;
  const t = s.replace(/[,%]/g, "").trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

type SheetRaw = Omit<SheetFacts, "fresh"> & { name: string; district: string | null };

const DISTRICT_FIX: Record<string, string> = { anuradapura: "Anuradhapura", anuradhapura: "Anuradhapura", monaragala: "Moneragala", moneragala: "Moneragala" };
function districtName(raw: string): string | null {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s || /^-+$/.test(s)) return null;
  const low = s.toLowerCase();
  return DISTRICT_FIX[low] ?? low.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function parseTab(csv: string, tab: "Major" | "Medium"): { sheetDate: string | null; rows: SheetRaw[] } {
  const grid = parseCsv(csv);
  const hi = grid.slice(0, 12).findIndex((r) => r.some((c) => c.trim().toUpperCase() === "RESERVOIR"));
  if (hi < 0) throw new Error(`${tab}: header row not found`);
  const H = grid[hi].map((h) => h.replace(/\s+/g, " ").trim().toLowerCase());
  const col = (f: (h: string) => boolean) => H.findIndex(f);
  const c = {
    name: col((h) => h === "reservoir"),
    district: col((h) => h === "district") >= 0 ? col((h) => h === "district") : col((h) => h === "range"),
    date: col((h) => h === "date"),
    fsd: col((h) => h.startsWith("fsd")),
    cap: col((h) => h.startsWith("gross capacity")),
    depth: col((h) => h.startsWith("water depth")),
    eff: col((h) => h.startsWith("effective storage %")),
    rain: col((h) => h.startsWith("rain fall")),
    spilling: col((h) => h === "spilling"),
    remarks: col((h) => h === "remarks"),
    sluice: col((h) => h.includes("sluice") && h.includes("cusec")),
    spill: col((h) => h.includes("spilling") && h.includes("cusec")),
  };
  if (c.name < 0 || c.date < 0 || c.spilling < 0 || c.spill < 0) throw new Error(`${tab}: expected columns missing (sheet layout changed?)`);

  let sheetDate: string | null = null;
  for (const r of grid.slice(0, hi)) {
    for (const cell of r) {
      const m = /(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](20\d\d)/.exec(cell);
      if (m) sheetDate = parseSheetDay(`${m[1]}-${m[2]}-${m[3]}`, 0);
    }
  }
  const year = sheetDate ? Number(sheetDate.slice(0, 4)) : new Date().getFullYear();
  const at = (r: string[], i: number) => (i >= 0 ? r[i] : undefined);

  const rows: SheetRaw[] = [];
  for (const r of grid.slice(hi + 1)) {
    const name = (r[c.name] ?? "").replace(/\s+/g, " ").trim();
    const day = parseSheetDay(r[c.date] ?? "", year);
    if (!name || !day) continue;
    rows.push({
      name,
      district: districtName(at(r, c.district) ?? ""),
      tab,
      day,
      spilling: /^y/i.test((r[c.spilling] ?? "").trim()),
      spillCusecs: num(r[c.spill]),
      sluiceCusecs: num(at(r, c.sluice)),
      depthFt: num(at(r, c.depth)),
      fsdFt: num(at(r, c.fsd)),
      storagePct: num(at(r, c.eff)),
      rainMm: num(at(r, c.rain)),
      capacityAcft: num(at(r, c.cap)),
      gatesOpen: parseGatesOpen((at(r, c.remarks) ?? "").replace(/\s+/g, " ").trim()),
    });
  }
  if (rows.length < 20) throw new Error(`${tab}: only ${rows.length} reservoirs found (sheet layout changed?)`);
  return { sheetDate, rows };
}

const sheetCached = unstable_cache(
  async () => {
    const parts = await Promise.all(
      TABS.map(async ({ gid, tab }) => {
        const res = await fetch(`${SHEET_BASE}/pub?gid=${gid}&single=true&output=csv`, { headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`${tab} tab HTTP ${res.status}`);
        return parseTab(await res.text(), tab);
      }),
    );
    return { sheetDate: parts[0].sheetDate, rows: parts.flatMap((p) => p.rows), fetchedAt: Date.now() };
  },
  ["reservoir-pages-sheet-v1"],
  { revalidate: 600 },
);

/** Irrigation Department Survey123 form: reservoir_name -> river_basin (official). Fails soft. */
const riversCached = unstable_cache(
  async (): Promise<Record<string, string>> => {
    const feats = await arcgis("service_957b7ca57de4468f857f2975a1c4c337_form/FeatureServer/0/query", {
      where: "river_basin IS NOT NULL",
      outFields: "reservoir_name,river_basin",
      returnGeometry: "false",
      orderByFields: "objectid ASC",
    });
    const out: Record<string, string> = {};
    for (const f of feats) {
      const a = f.attributes as { reservoir_name?: string | null; river_basin?: string | null };
      if (a.reservoir_name && a.river_basin) out[squash(a.reservoir_name)] = a.river_basin.trim();
    }
    return out;
  },
  ["reservoir-pages-rivers-v1"],
  { revalidate: 12 * 3600 },
);

// ---------------------------------------------------------------- names

/** Letters only, no "tank/reservoir/wewa" ending, no bracketed alternative name. */
function squash(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z]/g, "")
    .replace(/(tank|reservoir)$/, "")
    .replace(/(wewa|wawa|vewa)$/, "");
}

// Spellings that differ between the sources for the same reservoir (checked against the data).
const SPELLING: Record<string, string> = {
  ambewala: "ambewela", ellawela: "ellewela", vahanery: "vakaneri", mahakanadarawa: "mahakandarawa", tempitiya: "tampitiya", rambaken: "rambakan",
};
// Mahaweli report names -> sheet names. "tissa" is Anuradhapura's Tissa wewa there, not Tissamaharama's.
const WMS_SPELLING: Record<string, string> = {
  tissa: "thissa", basawakkulama: "basavakkulama", thuruvila: "thuruwila", vendrason: "vendrasan", hadapanagala: "handapanagala", pss: "parakramasamudraya",
};
// Sheet names the catalogue does not list.
const SHEET_TO_CATALOGUE: Record<string, string> = { senanayakasam: "senanayake-samudraya" };
// Abbreviations nobody can look up: no page rather than a guess.
const SKIP = new Set(["ndk"]);

const DISPLAY: Record<string, string> = {
  senanayakasam: "Senanayake Samudraya", maduruoya: "Maduru Oya", dambuluoya: "Dambulu Oya", parakramasamudraya: "Parakrama Samudraya",
  thissa: "Thissa Wewa", nuwara: "Nuwara Wewa", basavakkulama: "Basavakkulama", alikotaara: "Alikota Ara", handapanagala: "Handapanagala",
  hurulu: "Huruluwewa", thuruwila: "Thuruwila", vendrasan: "Vendrasan", kimbulwanaoya: "Kimbulwana Oya", kaluganga: "Kaluganga", giants: "Giants Tank", kandiyapitalb: "Kandiyapita (Left Bank)", kandiyapitarb: "Kandiyapita (Right Bank)",
};

// Local names. Only where confident; si/ta pages fall back to the English name otherwise.
// Marked for native review like the rest of the Sinhala/Tamil copy.
const NATIVE: Record<string, { si?: string; ta?: string }> = {
  "cat:rajangana": { si: "රාජාංගනය", ta: "ராஜாங்கனை" },
  "cat:tabbowa": { si: "තබ්බෝව", ta: "தப்போவ" },
  "cat:deduru-oya": { si: "දැදුරු ඔය", ta: "தெதுரு ஓயா" },
  "cat:kotmale": { si: "කොත්මලේ", ta: "கொத்மலை" },
  "cat:upper-kotmale": { si: "ඉහළ කොත්මලේ", ta: "மேல் கொத்மலை" },
  "cat:victoria": { si: "වික්ටෝරියා", ta: "விக்டோரியா" },
  "cat:randenigala": { si: "රන්දෙණිගල", ta: "ரந்தெனிகல" },
  "cat:udawalawe": { si: "උඩවලව", ta: "உடவளவை" },
  "cat:lunugamvehera": { si: "ලූණුගම්වෙහෙර", ta: "லுணுகம்வெஹெர" },
  "cat:senanayake-samudraya": { si: "සේනානායක සමුද්‍රය", ta: "சேனாநாயக்க சமுத்திரம்" },
  "cat:nachchaduwa": { si: "නාච්චදූව", ta: "நாச்சதுவ" },
  "cat:polgolla": { si: "පොල්ගොල්ල", ta: "பொல்கொல்ல" },
  minneriya: { si: "මින්නේරිය", ta: "மின்னேரிய" },
  kaudulla: { si: "කවුඩුල්ල", ta: "கவுடுல்ல" },
  giritale: { si: "ගිරිතලේ", ta: "கிரிதலை" },
  kantale: { si: "කන්තලේ", ta: "கந்தளாய்" },
  parakramasamudraya: { si: "පරාක්‍රම සමුද්‍රය", ta: "பராக்கிரம சமுத்திரம்" },
  kandalama: { si: "කඳලම" },
  kala: { si: "කලා වැව" },
  moragahakanda: { si: "මොරගහකන්ද" },
  bowatenna: { si: "බෝවතැන්න" },
  samanalawewa: { si: "සමනල වැව", ta: "சமனலவௌ" },
  huruluwewa: { si: "හුරුළු වැව" },
  hurulu: { si: "හුරුළු වැව" },
  nalanda: { si: "නාලන්ද" },
  padaviya: { si: "පඩාවිය" },
  castlereagh: { si: "කැසල්රී" },
  maussakele: { si: "මෞසාකැලේ" },
};

// Rivers for the reservoirs of lib/dams.ts that are not in the Survey123 form (basin spelling as in the gauge feed).
const DAM_RIVER: Record<string, string> = {
  maussakele: "Kelani Ganga", castlereagh: "Kelani Ganga", bowatenna: "Mahaweli Ganga", moragahakanda: "Mahaweli Ganga",
  // squash() drops the "wewa" ending, so these are keyed without it (Samanalawewa was keyed with it and never matched).
  samanala: "Walawe Ganga",
  // Not in the Survey123 river list, but on this river (Kala Wewa is the Kala Oya reservoir).
  kala: "Kala Oya",
};

const titleCase = (s: string) => s.replace(/\s+/g, " ").trim().replace(/\b[a-z]/g, (c) => c.toUpperCase());

type Entry = { key: string; catalogueId: string | null; sheetName?: string; wmsName?: string; sheet?: SheetRaw; wms?: Omit<WmsFacts, "fresh"> };

function keyFor(name: string, from: "sheet" | "wms"): { key: string; catalogueId: string | null; skip: boolean } {
  const sq = squash(name);
  const cat = matchReservoir(name.replace(/\b(tank|wewa|reservoir)\b/gi, ""))?.id ?? matchReservoir(name)?.id ?? (from === "sheet" ? SHEET_TO_CATALOGUE[sq] : undefined) ?? null;
  if (cat) return { key: `cat:${cat}`, catalogueId: cat, skip: false };
  let k = SPELLING[sq] ?? sq;
  if (from === "wms") k = WMS_SPELLING[k] ?? k;
  return { key: k, catalogueId: null, skip: SKIP.has(k) || k.length < 3 };
}

/** Key a name from the data branch archive (same rules as the live pages). */
export const archiveKey = keyFor;

const CAT_SLUG: Record<string, string> = Object.fromEntries(RESERVOIRS.map((r) => [r.id, slugify(r.name)]));
/** URL path of the page for a catalogue reservoir id (lib/reservoirs.ts), e.g. "rajangana" -> "/reservoirs/rajanganaya". */
export const reservoirPath = (catalogueId: string): string | null => (CAT_SLUG[catalogueId] ? `/reservoirs/${CAT_SLUG[catalogueId]}` : null);

// ---------------------------------------------------------------- build

const fresh = (day: string, now: number) => day >= colomboDay(now - FRESH_DAYS * DAY_MS);

function build(sheet: { rows: SheetRaw[] } | null, wms: { rows: ReturnType<typeof wmsRowsOf> } | null, rivers: Record<string, string>, now: number): RV[] {
  const map = new Map<string, Entry>();
  for (const r of sheet?.rows ?? []) {
    const k = keyFor(r.name, "sheet");
    if (k.skip) continue;
    const e = map.get(k.key) ?? { key: k.key, catalogueId: k.catalogueId };
    if (!e.sheet || (e.sheet.tab === "Medium" && r.tab === "Major")) {
      e.sheet = r;
      e.sheetName = r.name;
    }
    map.set(k.key, e);
  }
  for (const r of wms?.rows ?? []) {
    const k = keyFor(r.name, "wms");
    if (k.skip) continue;
    const e = map.get(k.key) ?? { key: k.key, catalogueId: k.catalogueId };
    e.wms = r.facts;
    e.wmsName = r.name;
    map.set(k.key, e);
  }

  const items: RV[] = [];
  for (const e of map.values()) {
    const cat = e.catalogueId ? RESERVOIRS.find((x) => x.id === e.catalogueId) ?? null : null;
    const sq = squash(e.sheetName ?? e.wmsName ?? "");
    const name = cat?.name ?? DISPLAY[sq] ?? titleCase((e.sheetName ?? e.wmsName ?? "").replace(/\s+tank$/i, "").replace(/\(.*?\)/g, ""));
    const native = NATIVE[e.key] ?? NATIVE[sq] ?? {};
    const sf: SheetFacts | null = e.sheet ? { ...e.sheet, fresh: fresh(e.sheet.day, now) } : null;
    const wf: WmsFacts | null = e.wms ? { ...e.wms, fresh: fresh(e.wms.day, now) } : null;
    const riverRaw = cat?.basin ?? rivers[SPELLING[sq] ?? sq] ?? DAM_RIVER[sq] ?? null;

    // Headline release: a fresh spill figure first, then the Mahaweli downstream discharge, then canal/outlet gates.
    let flow: Flow | null = null;
    if (sf?.fresh && sf.spilling && (sf.spillCusecs ?? 0) > 0) flow = { kind: "spill", cusecs: sf.spillCusecs!, source: "Irrigation Department", day: sf.day };
    else if (wf?.fresh && (wf.dischargeCusecs ?? 0) > 0) flow = { kind: "downstream", cusecs: wf.dischargeCusecs!, source: "Mahaweli Authority", day: wf.day };
    else if (sf?.fresh && (sf.sluiceCusecs ?? 0) > 0) flow = { kind: "outlets", cusecs: sf.sluiceCusecs!, source: "Irrigation Department", day: sf.day };

    // A blank discharge in the Mahaweli report is unknown, not zero: only an explicit figure (or a fresh sheet row) says "holding".
    const anyFresh = !!(sf?.fresh || (wf?.fresh && wf.dischargeCusecs != null));
    // Canal outlets alone are routine irrigation supply, not a release into the river: that stays "holding".
    const status: Status = sf?.fresh && sf.spilling ? "spilling" : flow && flow.kind !== "outlets" ? "releasing" : anyFresh ? "holding" : "nodata";

    // Storage: the freshest reading; the sheet first on a tie.
    const cands: Storage[] = [];
    if (sf?.storagePct != null) cands.push({ pct: sf.storagePct, source: "Irrigation Department", day: sf.day, fresh: sf.fresh });
    if (wf?.storagePct != null) cands.push({ pct: wf.storagePct, source: "Mahaweli Authority", day: wf.day, fresh: wf.fresh });
    cands.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
    const storage = cands[0] ?? null;

    const days = [sf?.day, wf?.day].filter((d): d is string => !!d).sort();
    items.push({
      slug: "",
      name,
      si: native.si ?? null,
      ta: native.ta ?? null,
      river: riverRaw,
      district: e.sheet?.district ?? null,
      kind: e.sheet ? (e.sheet.tab === "Major" ? "major" : "medium") : "mahaweli",
      catalogueId: e.catalogueId,
      gauges: cat?.gauges ?? [],
      barrage: !!cat?.barrage,
      sheet: sf,
      wms: wf,
      status,
      flow,
      storage,
      latestDay: days[days.length - 1] ?? null,
    });
  }

  // Slugs: the name; a clash adds the district; a second clash a number.
  const used = new Set<string>();
  for (const it of items.sort((a, b) => a.name.localeCompare(b.name))) {
    let s = it.catalogueId ? (CAT_SLUG[it.catalogueId] ?? slugify(it.name)) : slugify(it.name);
    if (used.has(s) && it.district) s = `${s}-${slugify(it.district)}`;
    for (let n = 2; used.has(s); n++) s = `${s.replace(/-\d+$/, "")}-${n}`;
    used.add(s);
    it.slug = s;
  }
  return items;
}

function wmsRowsOf(rows: { name: string; day: string | null; levelMsl: number | null; storagePct: number | null; rainMm: number | null; dischargeCusecs: number | null }[]) {
  return rows.flatMap((r) => (r.day ? [{ name: r.name, facts: { day: r.day, levelMsl: r.levelMsl, storagePct: r.storagePct, rainMm: r.rainMm, dischargeCusecs: r.dischargeCusecs } }] : []));
}

/** All reservoirs, merged from both reports. Null when neither source can be read. Never throws. */
export const getReservoirs = cache(async (): Promise<ReservoirsData | null> => {
  const now = Date.now();
  const [sheetR, srcR, riversR] = await Promise.allSettled([sheetCached(), getReleaseSources(), riversCached()]);
  const sheet = sheetR.status === "fulfilled" ? sheetR.value : null;
  const wmsSrc = srcR.status === "fulfilled" && srcR.value.wms.ok ? srcR.value.wms.data : null;
  if (!sheet && !wmsSrc) return null;
  const rivers = riversR.status === "fulfilled" ? riversR.value : {};
  const items = build(sheet, wmsSrc ? { rows: wmsRowsOf(wmsSrc.rows) } : null, rivers, now);
  return { items, sheetDate: sheet?.sheetDate ?? null, wmsDate: wmsSrc?.reportDate ?? null, checkedAt: sheet?.fetchedAt ?? wmsSrc?.fetchedAt ?? now };
});

export async function getReservoir(slug: string): Promise<{ rv: RV; data: ReservoirsData } | null> {
  const data = await getReservoirs();
  const rv = data?.items.find((r) => r.slug === slug);
  return data && rv ? { rv, data } : null;
}

/** A news report that gates were opened (catalogue reservoirs only), or null. */
export async function getReportedRelease(rv: RV): Promise<Release | null> {
  if (!rv.catalogueId) return null;
  const all = await getReleases().catch(() => null);
  const rel = all?.releases.find((r) => r.reservoirId === rv.catalogueId);
  return rel && (rel.kind === "reported" || rel.news || rel.reported) ? rel : null;
}

export const riverMatches = (rv: RV, basin: string) => !!rv.river && rv.river.trim().toLowerCase() === basin.trim().toLowerCase();

// ---------------------------------------------------------------- history (our archive)

const RAW = "https://raw.githubusercontent.com/shakee93/sl-water-levels/data/releases";
const HISTORY_DAYS = 7;

export type SheetPt = { t: number; spill: number | null; sluice: number | null; depthPct: number | null };
export type WmsPt = { t: number; storagePct: number | null; discharge: number | null };
export type History = { firstDay: string | null; series: Record<string, { sheet: SheetPt[]; wms: WmsPt[] }> };

const historyCached = unstable_cache(
  async (days: string[]): Promise<History> => {
    const series: History["series"] = {};
    let firstDay: string | null = null;
    const files = await Promise.all(
      days.map(async (day) => {
        try {
          const res = await fetch(`${RAW}/${day.slice(0, 4)}/${day}.jsonl`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
          return res.ok ? { day, text: await res.text() } : null;
        } catch {
          return null;
        }
      }),
    );
    for (const f of files.filter((x): x is { day: string; text: string } => !!x).sort((a, b) => (a.day < b.day ? -1 : 1))) {
      if (!firstDay) firstDay = f.day;
      for (const line of f.text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const snap = JSON.parse(line) as {
            t: string;
            sheet?: { rows?: { name: string; day: string | null; spillCusecs: number | null; sluiceCusecs: number | null; depthFt: number | null; fsdFt: number | null }[] };
            wms?: { rows?: { name: string; day: string | null; storagePct: number | null; dischargeCusecs: number | null }[] };
          };
          const t = Date.parse(snap.t);
          const snapDay = snap.t.slice(0, 10);
          if (!Number.isFinite(t)) continue;
          for (const r of snap.sheet?.rows ?? []) {
            if (r.day !== snapDay) continue; // a carried-over old reading is not a new point
            const k = keyFor(r.name, "sheet");
            if (k.skip) continue;
            const s = (series[k.key] ??= { sheet: [], wms: [] }).sheet;
            const p: SheetPt = { t, spill: r.spillCusecs, sluice: r.sluiceCusecs, depthPct: r.depthFt != null && r.fsdFt ? Math.round((r.depthFt / r.fsdFt) * 1000) / 10 : null };
            const last = s[s.length - 1];
            if (!last || last.spill !== p.spill || last.sluice !== p.sluice || last.depthPct !== p.depthPct) s.push(p);
          }
          for (const r of snap.wms?.rows ?? []) {
            if (r.day !== snapDay) continue;
            const k = keyFor(r.name, "wms");
            if (k.skip) continue;
            const w = (series[k.key] ??= { sheet: [], wms: [] }).wms;
            const p: WmsPt = { t, storagePct: r.storagePct, discharge: r.dischargeCusecs };
            const last = w[w.length - 1];
            if (!last || last.storagePct !== p.storagePct || last.discharge !== p.discharge) w.push(p);
          }
        } catch {
          /* skip a bad line */
        }
      }
    }
    return { firstDay, series };
  },
  ["reservoir-history-v1"],
  { revalidate: 600 },
);

/** Archived points for one reservoir over the last week; empty (never throws) when the archive is unreachable. */
export async function getReservoirHistory(key: string, now = Date.now()): Promise<{ firstDay: string | null; sheet: SheetPt[]; wms: WmsPt[] }> {
  const days = Array.from({ length: HISTORY_DAYS }, (_, i) => colomboDay(now - i * DAY_MS)).reverse();
  try {
    const h = await historyCached(days);
    const s = h.series[key];
    return { firstDay: h.firstDay, sheet: s?.sheet ?? [], wms: s?.wms ?? [] };
  } catch {
    return { firstDay: null, sheet: [], wms: [] };
  }
}

/** The key a page's history is stored under. */
export const historyKey = (rv: RV): string =>
  rv.catalogueId ? `cat:${rv.catalogueId}` : keyFor(rv.sheet ? rv.name : rv.name, rv.sheet ? "sheet" : "wms").key;

// ---------------------------------------------------------------- helpers for other pages (river hubs, maps, town pages)

export type ReservoirMeta = {
  slug: string;
  name: string;
  /** River basin as in the gauge feed (trimmed), or null when not known. */
  basin: string | null;
  /** From lib/reservoirCoords.ts (public references, each checked); null when none could be verified. The ArcGIS layers carry none. */
  lat: number | null;
  lon: number | null;
  /** Catalogue id (lib/reservoirs.ts) when it is one of the hand-linked reservoirs. */
  catalogueId: string | null;
  /** A diversion barrage: always passes water, never a warning. */
  barrage: boolean;
  /** Release now in cusecs when it is going into the river (not routine canal outlets), else null. */
  releaseCusecs: number | null;
  /** Gauges of ours downstream of it (exact station names), with the measured travel time if any. */
  linkedGauges: { station: string; basin: string; eta: [number, number] | null }[];
  /** Hand-picked towns below it (lib/places.ts names). */
  downstreamTowns: string[];
  status: Status;
};

export const toMeta = (rv: RV): ReservoirMeta => ({
  slug: rv.slug,
  name: rv.name,
  basin: rv.river ? rv.river.trim() : null,
  lat: RESERVOIR_COORDS[rv.slug]?.lat ?? null,
  lon: RESERVOIR_COORDS[rv.slug]?.lon ?? null,
  catalogueId: rv.catalogueId,
  barrage: rv.barrage,
  releaseCusecs: rv.flow && rv.flow.kind !== "outlets" ? rv.flow.cusecs : null,
  linkedGauges: rv.gauges.map((g) => ({ station: g.station, basin: g.basin, eta: g.eta })),
  downstreamTowns: [...new Set(rv.gauges.map((g) => g.town).filter((t): t is string => !!t))],
  status: rv.status,
});

/** Reservoirs on a river (basin name, any spelling of whitespace/case), as light metadata. Never throws. */
export async function reservoirsByBasin(basin: string): Promise<ReservoirMeta[]> {
  const data = await getReservoirs();
  return (data?.items ?? []).filter((r) => riverMatches(r, basin)).map(toMeta);
}

export async function reservoirMeta(slug: string): Promise<ReservoirMeta | null> {
  const hit = await getReservoir(slug);
  return hit ? toMeta(hit.rv) : null;
}

/** Where a reader can see the original report. */
export const SOURCE_URL = {
  "Irrigation Department": `${SHEET_BASE}/pubhtml?gid=${TABS[0].gid}&single=true`,
  "Mahaweli Authority": "https://mahaweli.gov.lk/wms.html",
} as const;
