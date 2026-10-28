// What a story image shows, built from the embed payloads (lib/embedData.ts) so the numbers, steps, trend words and language are exactly
// the ones the pages and widgets show. Server only; reads our own caches, never an upstream directly.
import { buildEmbed } from "@/lib/embedData";
import { parseCfg } from "@/lib/embedConfig";
import { placeBySlug } from "@/lib/places";
import { stationSlug } from "@/lib/slug";
import { colomboParts } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { PillTier } from "@/app/TierPill";
import type { Arrow, EmbedRow, LChart } from "@/lib/embedTypes";
import type { StoryKind } from "./url";
import { STORY_STRINGS } from "./strings";
import { nativeGauge, nativeTown } from "./names";
import { getNational, type NationalStation } from "@/lib/arcgis";
import { basinSlug } from "@/lib/slug";
import { FT_IN_M } from "@/lib/units";
import { sanitizeThresholds } from "@/lib/readings";
import { getRainMap } from "@/lib/rainMap";
import { basinSatellite, correctedTotal, perBasin, satelliteTotal, type RainMapData } from "@/lib/rainMapCalc";
import { COAST } from "@/lib/geo/geo";
import { riverName } from "@/lib/i18n/format";

export type StoryRow = { name: string; sub: string | null; level: string | null; tier: PillTier; step: string; arrow: Arrow };
export type StoryModel = {
  kind: StoryKind;
  lang: Locale;
  title: string;
  subtitle: string | null;
  tier: PillTier;
  step: string;
  level: string | null;
  arrow: Arrow;
  trend: string | null;
  /** "Next hour: about 1.5 ft" */
  next: string | null;
  nextArrow: Arrow;
  /** "Updated 7:00 pm, 28 Oct" */
  updated: string | null;
  chart: LChart | null;
  rows: StoryRow[];
  summary: string | null;
  /** "waterlevels.lk/kalu-ganga/ratnapura" */
  where: string;
  /** kind "rain": the last 24 h of rain (Instagram keep-alive picture). */
  rain?: RainStory;
  /** kind "reservoirs": reservoirs spilling or releasing now. */
  res?: ResStory;
};

export type RainStory = {
  /** The heaviest river areas, mm over the last 24 h, heaviest first; `frac` = share of the heaviest one (bar length). */
  rows: { name: string; mm: number; frac: number }[];
  maxMm: number;
  /** The heaviest ground gauge, if HMIS has one over 5 mm. */
  gauge: { name: string; mm: number } | null;
  corrected: boolean;
  /** Map strip: land pixels with their rain, and the coast as path data in pixel units. */
  map: { nx: number; ny: number; cells: [col: number, row: number, mm: number][]; coast: string };
};
export type ResStory = { rows: { name: string; river: string | null; figure: string | null; when: string | null; source: string }[]; more: number; sheetDay: string | null };

const TIER_ORDER: Record<string, number> = { major: 5, minor: 4, alert: 3, normal: 2, none: 1, stale: 0 };
const MAX_ROWS = 8;

function dateLine(lang: Locale, ts: number): string {
  const loc = lang === "si" ? "si-LK" : lang === "ta" ? "ta-LK" : "en-GB";
  try {
    return new Intl.DateTimeFormat(loc, { timeZone: "Asia/Colombo", day: "numeric", month: "short" }).format(ts);
  } catch {
    const p = colomboParts(ts);
    return `${p.d}/${p.m}`;
  }
}
/** The reading's clock time in Sri Lanka time, with the date (the time already carries a day word when it is not today). */
function stamp(lang: Locale, time: string | null, ts: number): string | null {
  if (!time) return null;
  const s = `${time}, ${dateLine(lang, ts)}`;
  return STORY_STRINGS[lang].updated.replace("{t}", s);
}

const rowOf = (r: EmbedRow, sub: string | null): StoryRow => {
  const m = /^(.+?) \((.+)\)$/.exec(r.name);
  return rowOf2(r, m ? m[1] : r.name, sub ?? (m ? m[2] : null));
};
const rowOf2 = (r: EmbedRow, name: string, sub: string | null): StoryRow => ({ name, sub, level: r.level, tier: r.tier, step: r.step, arrow: r.arrow });
/** Strictly worst first: step, then how far above its own mark (metres), then rising before falling, then the river's name. */
function worstFirst(rows: EmbedRow[], nat: NationalStation[]): EmbedRow[] {
  const by = new Map(nat.map((n) => [`${basinSlug(n.basin)}/${stationSlug(n.station)}`, n]));
  const key = (r: EmbedRow) => {
    const n = by.get(r.key);
    const lv = n?.latest?.water_level;
    const th = n ? sanitizeThresholds(n.thresholds) : { alert: null, minor: null, major: null };
    const mark = r.tier === "major" ? th.major : r.tier === "minor" ? th.minor : r.tier === "alert" ? th.alert : null;
    const k = n?.unit === "m" ? 1 : FT_IN_M;
    return { above: lv != null && mark != null ? (lv - mark) * k : -Infinity, rate: n?.rate3hM ?? 0, river: n?.basin.trim() ?? "" };
  };
  return [...rows].sort((a, b) => {
    const ka = key(a), kb = key(b);
    return (TIER_ORDER[b.tier] ?? 0) - (TIER_ORDER[a.tier] ?? 0) || kb.above - ka.above || kb.rate - ka.rate || ka.river.localeCompare(kb.river);
  });
}
/** A row with the gauge's native name when we have one (English name kept small beneath). */
function localRow(r: EmbedRow, sub: string | null, lang: Locale): StoryRow {
  const row = rowOf(r, sub);
  const nat = nativeGauge(r.name.replace(/ \(.*\)$/, ""), lang);
  return nat ? { ...row, name: nat, sub: row.sub ?? row.name } : row;
}
/** Title in the page's language when we know the native name, with the English name and the second line small beneath. */
const localTitle = (en: string, sub: string | null, nat: string | null) => (nat ? { title: nat, subtitle: [en, sub].filter(Boolean).join(" · ") } : { title: en, subtitle: sub });
const whereOf = (href: string) => href.replace(/^https?:\/\//, "").replace(/\/$/, "");

// ---- rain (last 24 h) ----
const inRing = (x: number, y: number, ring: [number, number][]) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
/** Pure: the rain story from the rain-map payload (tests feed it a small fake). */
export function rainStoryFrom(d: RainMapData, lang: Locale): RainStory | null {
  const corr = correctedTotal(d, 24);
  const px = corr ?? satelliteTotal(d, 24);
  if (!px) return null;
  const per = corr ? perBasin(d, (i) => px[i]) : basinSatellite(d, 24);
  const ranked = d.basins
    .map((b, i) => ({ name: riverName(b.basin, lang), mm: per[i] }))
    .filter((r): r is { name: string; mm: number } => r.mm != null && r.mm >= 1)
    .sort((a, b) => b.mm - a.mm)
    .slice(0, 6);
  const maxMm = Math.max(1, ...ranked.map((r) => r.mm));
  const top = (d.ground ?? []).slice().sort((a, b) => b[4] - a[4])[0];
  const g = d.grid;
  // land pixels only: a pixel counts when its centre is inside a coast ring
  const cells: RainStory["map"]["cells"] = [];
  for (let i = 0; i < g.nx * g.ny; i++) {
    const v = px[i];
    if (v == null) continue;
    const col = i % g.nx, row = Math.floor(i / g.nx);
    const lon = g.lon0 + col * g.step, lat = g.lat0 - row * g.step;
    if (COAST.some((ring) => inRing(lon, lat, ring))) cells.push([col, row, Math.round(v * 10) / 10]);
  }
  const X = (lon: number) => Math.round(((lon - g.lon0) / g.step + 0.5) * 100) / 100;
  const Y = (lat: number) => Math.round(((g.lat0 - lat) / g.step + 0.5) * 100) / 100;
  const coast = COAST.filter((r) => r.some(([lon, lat]) => lon > g.lon0 - 0.2 && lon < g.lon0 + g.nx * g.step && lat < g.lat0 + 0.2 && lat > g.lat0 - g.ny * g.step))
    .map((ring) => ring.map(([lon, lat], k) => `${k ? "L" : "M"}${X(lon)} ${Y(lat)}`).join("") + "Z")
    .join("");
  return {
    rows: ranked.map((r) => ({ name: r.name, mm: Math.round(r.mm), frac: r.mm / maxMm })),
    maxMm: Math.round(maxMm),
    gauge: top ? { name: top[0], mm: Math.round(top[4]) } : null,
    corrected: !!corr,
    map: { nx: g.nx, ny: g.ny, cells, coast },
  };
}

async function buildRain(lang: Locale): Promise<StoryModel | null> {
  const d = await getRainMap().catch(() => null);
  const r = d ? rainStoryFrom(d, lang) : null;
  if (!d || !r) return null;
  const s = STORY_STRINGS[lang];
  return {
    kind: "rain", lang, title: s.rainTitle, subtitle: s.rainSub, tier: "normal", step: "", level: null, arrow: null, trend: null, next: null, nextArrow: null,
    updated: stamp(lang, new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", hour: "numeric", minute: "2-digit", hour12: true }).format(d.generatedAt).replace(/\s?([ap]m)/i, (_, m) => ` ${m.toLowerCase()}`), d.generatedAt),
    chart: null, rows: [], summary: null, where: "waterlevels.lk/rain", rain: r,
  };
}

async function buildReservoirsStory(lang: Locale, unit: "ft" | "m"): Promise<StoryModel | null> {
  const p = await buildEmbed("reservoirs", null, parseCfg({ lang, unit, hours: "24" }));
  if (!p || p.kind !== "reservoirs" || p.unavailable) return null;
  const items = p.items.filter((i) => i.official);
  const MAX = 8;
  const s = STORY_STRINGS[lang];
  return {
    kind: "reservoirs", lang, title: p.title, subtitle: s.resSub, tier: "none", step: "", level: null, arrow: null, trend: null, next: null, nextArrow: null,
    updated: null, chart: null, rows: [], summary: p.summary, where: "waterlevels.lk/reservoirs/spilling",
    res: { rows: items.slice(0, MAX).map((i) => ({ name: i.name, river: i.river, figure: i.figure, when: i.when, source: i.source })), more: p.more + Math.max(0, items.length - MAX), sheetDay: null },
  };
}

export async function buildStory(kind: StoryKind, slug: string, lang: Locale, unit: "ft" | "m"): Promise<StoryModel | null> {
  if (kind === "rain") return buildRain(lang);
  if (kind === "reservoirs") return buildReservoirsStory(lang, unit);
  const cfg = parseCfg({ lang, unit, hours: "24" });
  if (kind === "gauge") {
    const [g, f] = await Promise.all([buildEmbed("gauge", slug, cfg), buildEmbed("forecast", slug, cfg).catch(() => null)]);
    if (!g || g.kind !== "gauge") return null;
    const chart = (f && f.kind === "forecast" && f.chart) || g.chart;
    return {
      kind, lang, ...localTitle(g.title, g.river, nativeGauge(g.title, lang)), tier: g.row.tier, step: g.row.step, level: g.row.level, arrow: g.row.arrow, trend: g.row.trend,
      next: g.row.next, nextArrow: g.row.nextArrow, updated: stamp(lang, g.row.time, g.generatedAt), chart, rows: [], summary: g.row.since, where: whereOf(g.open.href),
    };
  }
  if (kind === "town") {
    const t = await buildEmbed("town", slug, cfg);
    if (!t || t.kind !== "town") return null;
    const place = placeBySlug(slug);
    const gs = place?.stations[0] ? stationSlug(place.stations[0]) : null;
    const g = gs && t.level ? await buildEmbed("gauge", gs, cfg).catch(() => null) : null;
    return {
      kind, lang, ...localTitle(t.title, t.gaugeLine, nativeTown(slug, lang)), tier: t.tier, step: t.step, level: t.level, arrow: g && g.kind === "gauge" ? g.row.arrow : t.hourArrow, trend: g && g.kind === "gauge" ? g.row.trend : null,
      next: t.hour ? `${t.hourLabel}: ${t.hour}` : null, nextArrow: t.hourArrow, updated: t.time ? stamp(lang, t.time, t.generatedAt) : null,
      chart: g && g.kind === "gauge" ? g.chart : null, rows: [], summary: null, where: whereOf(t.open.href),
    };
  }
  if (kind === "river") {
    const r = await buildEmbed("river", slug, cfg);
    if (!r || r.kind !== "river") return null;
    let rows = r.rows;
    const live = rows.filter((x) => !x.stale);
    const worst = live.reduce<EmbedRow | null>((a, b) => (!a || (TIER_ORDER[b.tier] ?? 0) > (TIER_ORDER[a.tier] ?? 0) ? b : a), null);
    if (rows.length > MAX_ROWS) {
      rows = worstFirst(rows, await getNational().catch(() => [])).slice(0, MAX_ROWS);
    }
    const latest = r.rows.find((x) => x.time);
    return {
      kind, lang, title: r.title, subtitle: null, tier: worst?.tier ?? "stale", step: worst?.step ?? r.summary, level: null, arrow: null, trend: null, next: null, nextArrow: null,
      updated: latest ? stamp(lang, latest.time, r.generatedAt) : null, chart: null, rows: rows.map((x) => localRow(x, null, lang)), summary: r.summary, where: whereOf(r.open.href),
    };
  }
  const n = await buildEmbed("now", null, cfg);
  if (!n || n.kind !== "now") return null;
  const riverOf = new Map(n.groups.flatMap((g) => g.rows.map((x) => [x.key, g.river] as const)));
  const sorted = worstFirst(n.groups.flatMap((g) => g.rows), await getNational().catch(() => []));
  const all = sorted.map((x) => localRow(x, riverOf.get(x.key) ?? null, lang));
  const hot = all.length;
  return {
    kind, lang, title: n.title, subtitle: null, tier: hot ? (all.reduce((a, b) => ((TIER_ORDER[b.tier] ?? 0) > (TIER_ORDER[a.tier] ?? 0) ? b : a)).tier) : "normal",
    step: hot ? all.reduce((a, b) => ((TIER_ORDER[b.tier] ?? 0) > (TIER_ORDER[a.tier] ?? 0) ? b : a)).step : n.summary, level: null, arrow: null, trend: null, next: null, nextArrow: null,
    updated: n.checked, chart: null, rows: all.slice(0, MAX_ROWS), summary: n.summary, where: whereOf(n.open.href),
  };
}
