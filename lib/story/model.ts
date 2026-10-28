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
};

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
const whereOf = (href: string) => href.replace(/^https?:\/\//, "").replace(/\/$/, "");

export async function buildStory(kind: StoryKind, slug: string, lang: Locale, unit: "ft" | "m"): Promise<StoryModel | null> {
  const cfg = parseCfg({ lang, unit, hours: "24" });
  if (kind === "gauge") {
    const [g, f] = await Promise.all([buildEmbed("gauge", slug, cfg), buildEmbed("forecast", slug, cfg).catch(() => null)]);
    if (!g || g.kind !== "gauge") return null;
    const chart = (f && f.kind === "forecast" && f.chart) || g.chart;
    return {
      kind, lang, title: g.title, subtitle: g.river, tier: g.row.tier, step: g.row.step, level: g.row.level, arrow: g.row.arrow, trend: g.row.trend,
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
      kind, lang, title: t.title, subtitle: t.gaugeLine, tier: t.tier, step: t.step, level: t.level, arrow: g && g.kind === "gauge" ? g.row.arrow : t.hourArrow, trend: g && g.kind === "gauge" ? g.row.trend : null,
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
      rows = [...rows].sort((a, b) => (TIER_ORDER[b.tier] ?? 0) - (TIER_ORDER[a.tier] ?? 0) || parseFloat(b.level ?? "0") - parseFloat(a.level ?? "0")).slice(0, MAX_ROWS);
    }
    const latest = r.rows.find((x) => x.time);
    return {
      kind, lang, title: r.title, subtitle: null, tier: worst?.tier ?? "stale", step: worst?.step ?? r.summary, level: null, arrow: null, trend: null, next: null, nextArrow: null,
      updated: latest ? stamp(lang, latest.time, r.generatedAt) : null, chart: null, rows: rows.map((x) => rowOf(x, null)), summary: r.summary, where: whereOf(r.open.href),
    };
  }
  const n = await buildEmbed("now", null, cfg);
  if (!n || n.kind !== "now") return null;
  const all = n.groups.flatMap((g) => g.rows.map((x) => rowOf(x, g.river)));
  const hot = all.length;
  return {
    kind, lang, title: n.title, subtitle: null, tier: hot ? (all.reduce((a, b) => ((TIER_ORDER[b.tier] ?? 0) > (TIER_ORDER[a.tier] ?? 0) ? b : a)).tier) : "normal",
    step: hot ? all.reduce((a, b) => ((TIER_ORDER[b.tier] ?? 0) > (TIER_ORDER[a.tier] ?? 0) ? b : a)).step : n.summary, level: null, arrow: null, trend: null, next: null, nextArrow: null,
    updated: n.checked, chart: null, rows: all.slice(0, MAX_ROWS), summary: n.summary, where: whereOf(n.open.href),
  };
}
