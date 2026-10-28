// Data for the embeddable widgets (/embed/<widget>, /api/embed): the same numbers the pages show (getNational, nextHour, loadTown,
// getReservoirs), turned into display-ready payloads in the widget's language and unit. Server only; cached by the sources
// it reads (60 s gauges, 5 min forecasts and releases). The browser never calls an upstream.
import { fetchStationData, getNational, type NationalStation } from "./arcgis";
import { orderStations } from "./basinOrder";
import { levelRecord } from "./apiData";
import { stationDisplayName } from "./displayName";
import { basinSlug, stationSlug } from "./slug";
import { SITE } from "./seo";
import { FT_IN_M, type Unit } from "./units";
import { localePath, type Locale } from "./i18n/config";
import { getI18n } from "./i18n/server";
import { clock, colomboParts, dayTick, formatAge, riverName } from "./i18n/format";
import { embedT, type EmbedT } from "./i18n/embed";
import { getNextHourForBasins, timeBox, type NextHour } from "./nextHour";
import { placeBySlug } from "./places";
import { loadTown, PAGE_BUDGET_MS } from "./townData";
import { assessTown } from "./townRisk";
import { ttFor, type TKey } from "./i18n/town";
import { formatKm } from "./nearby";
import { getReservoirs, type RV } from "./reservoirData";
import { type Release } from "./releases";
import { rtFor } from "./i18n/reservoirs";
import { shortDay } from "./i18n/format";
import { sanitizeThresholds, type Thresholds } from "./readings";
import type { PillTier } from "@/app/TierPill";
import type { EmbedCfg, Widget } from "./embedConfig";
import { fetchBasinSnapshot } from "./arcgis";
import { loadForecast } from "./forecast";
import { ACTION, TIDE_RISE, forecastFact, smallChanceFact } from "@/app/Forecast";
import { VERDICT, directionFor, STEADY_M_PER_H } from "@/app/verdict";
import { isTidalStation, liftVerdict, riverRising } from "./verdictLift";
import { getReleases, releaseAffectingFrom } from "./releases";
import { officialReleaseAlert } from "./releaseAlert";
import type { VerdictTone } from "@/app/ShareButton";
import type { FChart, ForecastPayload } from "./embedTypes";
import type { Arrow, Chart, Credit, EmbedPayload, EmbedRow, CardPayload, GaugePayload, MarkInfo, NowPayload, ReservoirsPayload, ResRow, RiverPayload, TickerPayload, TownPayload } from "./embedTypes";

const MARKS = ["alert", "minor", "major"] as const;
const TIER_ORDER: Record<string, number> = { major: 5, minor: 4, alert: 3, normal: 2, none: 1, stale: 0 };
const pillOf = (tier: string): PillTier => (tier === "watch" ? "normal" : (tier as PillTier));

type Ctx = { lang: Locale; cfg: EmbedCfg; now: number; t: ReturnType<typeof getI18n>["t"]; e: EmbedT };

// ---- units: levels and the official marks are shown in the unit the embedder chose; a gauge with an unknown unit is never converted ----
function conv(v: number, gu: Unit, want: "ft" | "m"): { v: number; unit: string } {
  if (gu == null) return { v, unit: "" };
  const m = gu === "m" ? v : v * FT_IN_M;
  return want === "m" ? { v: m, unit: "m" } : { v: m / FT_IN_M, unit: "ft" };
}
const digits = (gu: Unit, want: "ft" | "m") => (gu == null || want === "m" ? 2 : 1);
function fmt(v: number | null | undefined, gu: Unit, want: "ft" | "m"): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  const c = conv(v, gu, want);
  return `${c.v.toFixed(digits(gu, want))}${c.unit ? ` ${c.unit}` : ""}`;
}
/** A difference in the gauge's own unit, shown in the chosen unit (never with a minus). */
function fmtDelta(d: number, gu: Unit, want: "ft" | "m"): string {
  const c = conv(Math.abs(d), gu, want);
  return `${c.v.toFixed(digits(gu, want))}${c.unit ? ` ${c.unit}` : ""}`;
}
const ftTo = (ft: number, want: "ft" | "m") => (want === "m" ? ft * FT_IN_M : ft);

function timeOf(ts: number, c: Ctx): string {
  const same = (a: number, b: number) => {
    const x = colomboParts(a), y = colomboParts(b);
    return x.y === y.y && x.m === y.m && x.d === y.d;
  };
  return same(ts, c.now) ? clock(ts, c.t) : `${dayTick(ts, c.t)} ${clock(ts, c.t)}`;
}

const arrowOf = (trend: string | null): Arrow => (trend == null ? null : trend === "steady" ? "steady" : trend === "falling" ? "down" : "up");

function trendWord(trend: string | null, e: EmbedT): string | null {
  switch (trend) {
    case "steady": return e("w.steady");
    case "falling": return e("w.falling");
    case "rising": return e("w.rising");
    case "rising slowly": return e("w.risingSlowly");
    default: return null;
  }
}

function outcomeOf(s: NationalStation, c: Ctx): string | null {
  const lv = s.latest?.water_level;
  if (lv == null || s.tier === "stale") return null;
  const th = sanitizeThresholds(s.thresholds);
  const u = s.unit;
  const { e } = c;
  if (s.tier === "none") return e("w.noMarks");
  if (th.major != null && lv >= th.major) return e("w.aboveMajor", { amount: fmtDelta(lv - th.major, u, c.cfg.unit) });
  if (th.minor != null && lv >= th.minor) return e("w.aboveMinor", { amount: fmtDelta(lv - th.minor, u, c.cfg.unit) });
  if (th.alert != null && lv >= th.alert) return e("w.aboveAlert", { amount: fmtDelta(lv - th.alert, u, c.cfg.unit) });
  if (th.alert != null) return e("w.belowAlert", { amount: fmtDelta(th.alert - lv, u, c.cfg.unit) });
  return null;
}

function marksLine(th: Thresholds, u: Unit, c: Ctx): string | null {
  const s = sanitizeThresholds(th);
  const parts = MARKS.filter((k) => s[k] != null && s[k]! > 0).map((k) => `${c.t(`mark.${k}` as "mark.alert")} ${fmt(s[k], u, c.cfg.unit)}`);
  return parts.length ? parts.join(" · ") : null;
}

function nextOf(nh: NextHour | null, s: NationalStation, c: Ctx): { next: string | null; arrow: Arrow; cross: string | null } {
  if (!c.cfg.forecast || !nh || s.tier === "stale" || s.unit == null) return { next: null, arrow: null, cross: null };
  // nh.level_ft is feet; format in the chosen unit directly
  const val = `${ftTo(nh.level_ft, c.cfg.unit).toFixed(c.cfg.unit === "m" ? 2 : 1)} ${c.cfg.unit}`;
  const e = c.e;
  const next = `${e("w.nextHour")}: ${e("w.nextHourVal", { level: val })}`;
  const mark = nh.crossing ? (/major/.test(nh.crossing) ? e("w.markMajor") : /minor/.test(nh.crossing) ? e("w.markMinor") : e("w.markAlert")) : null;
  return { next, arrow: nh.direction === "rising" ? "up" : nh.direction === "falling" ? "down" : "steady", cross: mark ? e("w.nextCross", { mark }) : null };
}

function rowOf(s: NationalStation, c: Ctx, nh: NextHour | null, o: { withMarks: boolean; withRiver?: boolean } = { withMarks: false }): EmbedRow {
  const rec = levelRecord(s, c.now);
  const tier = pillOf(s.tier);
  const stale = s.tier === "stale";
  const ts = s.latest?.ts ?? null;
  const n = nextOf(nh, s, c);
  const trend = stale ? null : rec.trend;
  return {
    key: `${basinSlug(s.basin)}/${stationSlug(s.station)}`,
    name: stationDisplayName(s.station),
    river: o.withRiver ? riverName(s.basin, c.lang) : null,
    href: SITE + localePath(c.lang, s.href),
    tier,
    step: c.t(`tier.${tier === "none" ? "none" : tier}` as "tier.normal"),
    level: !stale ? fmt(s.latest?.water_level, s.unit, c.cfg.unit) : null,
    arrow: arrowOf(trend),
    trend: trendWord(trend, c.e),
    time: ts != null ? timeOf(ts, c) : null,
    age: ts != null ? formatAge(ts, c.now, c.t) : null,
    next: n.next,
    nextArrow: n.arrow,
    cross: n.cross,
    marks: o.withMarks ? marksLine(s.thresholds, s.unit, c) : null,
    outcome: outcomeOf(s, c),
    stale,
    rivernet: s.source === "rivernet",
    tributary: !!s.tributary,
    since: stale && s.lastSeenTs ? c.t("gauges.notReportingSince", { when: timeOf(s.lastSeenTs, c) }) : null,
  };
}

/** `rn`: how many of the shown rows are RiverNet gauges. Any -> the RiverNet credit is added; all -> the readings are named as RiverNet's, not the Irrigation Department's. */
function credit(c: Ctx, path: string, resv = false, rn: { any: boolean; all: boolean } = { any: false, all: false }): Credit {
  return {
    live: c.e("w.live"),
    linkText: "waterlevels.lk",
    rest: c.e(resv ? "w.creditResv" : rn.all ? "w.creditRestRn" : "w.creditRest"),
    href: SITE + localePath(c.lang, path),
    ...(rn.any ? { extra: { text: "RiverNet – DMC / Leecom SCADA (rivernet.lk)", href: "https://rivernet.lk" } } : {}),
  };
}
const rnOf = (rows: { rivernet: boolean }[]) => ({ any: rows.some((r) => r.rivernet), all: rows.length > 0 && rows.every((r) => r.rivernet) });

function ctxOf(cfg: EmbedCfg): Ctx {
  const { t } = getI18n(cfg.lang);
  return { lang: cfg.lang, cfg, now: Date.now(), t, e: embedT(cfg.lang) };
}

const base = (c: Ctx, widget: Widget, path: string, label: string, resv = false, rn?: { any: boolean; all: boolean }) => ({
  widget,
  cfg: c.cfg,
  generatedAt: c.now,
  credit: credit(c, path, resv, rn),
  open: { href: SITE + localePath(c.lang, path), label },
});

function barOf(s: NationalStation, nh: NextHour | null): GaugePayload["bar"] {
  const lv = s.latest?.water_level;
  if (lv == null || s.tier === "stale") return null;
  const th = sanitizeThresholds(s.thresholds);
  const present = MARKS.filter((k) => th[k] != null && th[k]! > 0);
  if (!present.length) return null;
  const nextRaw = nh && s.unit ? (s.unit === "m" ? nh.level_ft * FT_IN_M : nh.level_ft) : null;
  const top = Math.max(...present.map((k) => th[k]!), lv, nextRaw ?? lv) * 1.12;
  const bottom = Math.min(0, lv);
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - bottom) / (top - bottom)) * 100));
  return { tier: pillOf(s.tier), now: pct(lv), ahead: nextRaw != null && pct(nextRaw) > pct(lv) ? pct(nextRaw) : null, marks: [] as MarkInfo[] };
}

async function chartOf(s: NationalStation, c: Ctx): Promise<Chart | null> {
  const hours = c.cfg.hours;
  if (!hours) return null;
  let readings = s.trend24h;
  if (hours > 24) {
    try {
      readings = (await fetchStationData(s.station, 4)).readings;
    } catch {
      /* keep the 24 h we have */
    }
  }
  const end = s.latest?.ts ?? c.now;
  const from = end - hours * 3_600_000;
  const pts = readings.filter((r) => r.water_level != null && r.ts >= from).map((r) => [r.ts, conv(r.water_level as number, s.unit, c.cfg.unit).v] as [number, number]);
  if (pts.length < 2) return null;
  const step = Math.max(1, Math.ceil(pts.length / 120));
  const thin = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const vs = thin.map((p) => p[1]);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const span = Math.max(hi - lo, Math.abs(hi) * 0.06, 0.2);
  const th = sanitizeThresholds(s.thresholds);
  const marks = c.cfg.marks
    ? MARKS.filter((k) => th[k] != null && th[k]! > 0)
        .map((k) => ({ key: k, label: c.t(`mark.${k}` as "mark.alert"), v: conv(th[k]!, s.unit, c.cfg.unit).v }))
        // only marks the line is near: a mark far above it would flatten the line (the bar above the chart shows every mark)
        .filter((m) => m.v <= hi + span * 1.2 && m.v >= lo - span)
    : [];
  const unit = conv(0, s.unit, c.cfg.unit).unit;
  const d = digits(s.unit, c.cfg.unit);
  return {
    pts: thin,
    from,
    to: end,
    unit,
    marks,
    hours,
    fromLabel: c.e("w.hoursAgo", { n: hours }),
    toLabel: clock(end, c.t),
    min: `${lo.toFixed(d)}${unit ? ` ${unit}` : ""}`,
    max: `${hi.toFixed(d)}${unit ? ` ${unit}` : ""}`,
  };
}

function riverSummary(list: NationalStation[], c: Ctx): string {
  const live = list.filter((s) => s.tier !== "stale");
  if (!live.length) return c.e("w.noneReporting");
  const above = live.filter((s) => ["alert", "minor", "major"].includes(s.tier));
  if (!above.length) return c.e("w.allNormal", { n: live.length });
  const worst = above.reduce((a, b) => (TIER_ORDER[b.tier] > TIER_ORDER[a.tier] ? b : a));
  return `${c.e("w.someAbove", { n: above.length, m: live.length })} ${c.e("w.worst", { step: c.t(`tier.${worst.tier}` as "tier.alert") })}`;
}

async function nhFor(basins: string[]) {
  return (await timeBox(getNextHourForBasins(basins))) ?? {};
}

// ---- the widgets ----------------------------------------------------------------------------------------------------------------------

async function buildRiver(slug: string, c: Ctx): Promise<RiverPayload | null> {
  const all = await getNational();
  const hit = all.filter((s) => basinSlug(s.basin) === slug);
  if (!hit.length) return null;
  const basin = hit[0].basin;
  const list = orderStations(basin, hit);
  const nh = c.cfg.forecast ? await nhFor([basin]) : {};
  const rn = riverName(basin, c.lang);
  const rows = list.map((s) => rowOf(s, c, nh[s.station] ?? null, { withMarks: c.cfg.marks && c.cfg.size === "full" }));
  return {
    ...base(c, "river", `/${slug}`, c.e("w.openRiver", { river: rn }), false, rnOf(rows)),
    kind: "river",
    title: c.e("w.river", { river: rn }),
    summary: riverSummary(list, c),
    upstream: c.e("w.upstream"),
    downstream: c.e("w.downstream"),
    tributaries: c.t("gauges.tributaries"),
    rows,
  };
}

async function buildGauge(slug: string, c: Ctx): Promise<GaugePayload | null> {
  const all = await getNational();
  const s = all.find((x) => stationSlug(x.station) === slug);
  if (!s) return null;
  const nh = c.cfg.forecast ? (await nhFor([s.basin]))[s.station] ?? null : null;
  const row = rowOf(s, c, nh, { withMarks: false });
  const bar = barOf(s, nh);
  if (bar && c.cfg.marks) {
    const th = sanitizeThresholds(s.thresholds);
    const present = MARKS.filter((k) => th[k] != null && th[k]! > 0);
    const lv = s.latest!.water_level!;
    const nextRaw = nh && s.unit ? (s.unit === "m" ? nh.level_ft * FT_IN_M : nh.level_ft) : null;
    const top = Math.max(...present.map((k) => th[k]!), lv, nextRaw ?? lv) * 1.12;
    const bottom = Math.min(0, lv);
    bar.marks = present.map((k) => ({ key: k, label: c.t(`mark.${k}` as "mark.alert"), value: fmt(th[k], s.unit, c.cfg.unit)!, pct: Math.max(0, Math.min(100, ((th[k]! - bottom) / (top - bottom)) * 100)) }));
  } else if (bar) bar.marks = [];
  const chart = await chartOf(s, c);
  return {
    ...base(c, "gauge", `/${basinSlug(s.basin)}/${slug}`, c.e("w.openGauge", { gauge: stationDisplayName(s.station) }), false, rnOf([row])),
    kind: "gauge",
    title: stationDisplayName(s.station),
    river: riverName(s.basin, c.lang),
    row,
    bar,
    chart,
    chartTitle: c.e("w.lastN", { n: c.cfg.hours || 24 }),
  };
}

/** The simple card: the gauge widget's data, drawn verdict-first. */
async function buildCard(slug: string, c: Ctx): Promise<CardPayload | null> {
  const g = await buildGauge(slug, c);
  return g ? { ...g, widget: "card", kind: "card" } : null;
}

const HOUR_ARROW: Record<string, Arrow> = { "dir.rising": "up", "dir.slow": "up", "dir.falling": "down", "dir.steady": "steady", "dir.tide": "steady" };

async function buildTown(slug: string, c: Ctx): Promise<TownPayload | null> {
  const place = placeBySlug(slug);
  if (!place) return null;
  const tt = ttFor(c.lang);
  const data = await loadTown(place, c.now, { budgetMs: PAGE_BUDGET_MS });
  const r = assessTown(data.input, null);
  const g = data.gauge && r.gauge && data.gauge.station === r.gauge.station ? data.gauge : null;
  const stale = r.tone === "stale";
  const tier: PillTier = stale ? "stale" : r.tone === "watch" ? "normal" : (r.tone as PillTier);
  const fill = (vars: Record<string, string | number>) => {
    const out: Record<string, string | number> = { ...vars };
    if (typeof out.dir === "string" && out.dir.startsWith("w.")) out.dir = tt(out.dir as TKey);
    if (typeof out.tier === "string" && out.tier.startsWith("t.")) out.tier = tt(out.tier as TKey);
    if (typeof out.river === "string") out.river = riverName(out.river, c.lang);
    if (!("town" in out)) out.town = place.name;
    return out;
  };
  const gg = r.gauge;
  const note = gg
    ? gg.km < 1.5
      ? tt("note.onGauge", { gauge: gg.name })
      : tt("note.experimental", { town: place.name, gauge: gg.name, km: formatKm(gg.km, c.t) })
    : tt("note.experimentalGeneric", { town: place.name });
  return {
    ...base(c, "town", `/flood/${place.slug}`, c.e("w.openTown", { town: place.name })),
    kind: "town",
    title: place.name,
    tier,
    step: tt(`tone.${r.tone}` as TKey),
    level: g && !stale ? fmt(g.level, g.unit, c.cfg.unit) : null,
    gaugeLine: gg ? c.e("w.townGauge", { gauge: gg.name }) : null,
    hourLabel: tt("label.hour"),
    hour: c.cfg.forecast && gg && !stale ? tt(r.hourKey) : null,
    hourArrow: HOUR_ARROW[r.hourKey] ?? null,
    dayLabel: tt("label.day"),
    day: c.cfg.forecast && !(stale && !r.heavyRain) ? tt(r.day.key as TKey, fill(r.day.vars)) : null,
    action: r.actionKey ? tt(r.actionKey) : null,
    note: `${note}${c.lang !== "en" ? ` (${c.t("common.machineTranslated")})` : ""}`,
    time: g?.ts != null ? timeOf(g.ts, c) : null,
    marks: c.cfg.marks && g ? marksLine(g.thresholds, g.unit, c) : null,
  };
}

async function buildNow(c: Ctx): Promise<NowPayload> {
  const all = await getNational();
  const want = new Set(c.cfg.rivers);
  const pool = want.size ? all.filter((s) => want.has(basinSlug(s.basin))) : all;
  const live = pool.filter((s) => s.tier !== "stale");
  const hot = live.filter((s) => ["alert", "minor", "major"].includes(s.tier));
  const by = new Map<string, NationalStation[]>();
  for (const s of hot) by.set(s.basin.trim(), [...(by.get(s.basin.trim()) ?? []), s]);
  const groups = [...by.entries()]
    .map(([basin, list]) => ({
      basin,
      worst: Math.max(...list.map((s) => TIER_ORDER[s.tier])),
      list: list.sort((a, b) => TIER_ORDER[b.tier] - TIER_ORDER[a.tier] || (b.latest?.water_level ?? 0) - (a.latest?.water_level ?? 0)),
    }))
    .sort((a, b) => b.worst - a.worst || a.basin.localeCompare(b.basin));
  const summary = !live.length
    ? c.e("w.nowNone")
    : hot.length === 0
      ? c.e("w.nowAll", { n: live.length })
      : hot.length === 1
        ? c.e("w.nowSome1", { n: 1 })
        : c.e("w.nowSome", { n: hot.length, m: groups.length });
  const nowGroups = groups.map((g) => ({ river: riverName(g.basin, c.lang), href: SITE + localePath(c.lang, `/${basinSlug(g.basin)}`), rows: g.list.map((s) => rowOf(s, c, null, { withMarks: false })) }));
  return {
    ...base(c, "now", want.size === 1 ? `/${[...want][0]}` : "/rivers", c.e("w.openNow"), false, rnOf(nowGroups.flatMap((g) => g.rows))),
    kind: "now",
    title: c.e("w.nowTitle"),
    calm: hot.length === 0,
    summary,
    checked: c.e("w.nowChecked", { time: clock(c.now, c.t) }),
    groups: nowGroups,
  };
}

const cusecs = (n: number) => Math.round(n).toLocaleString("en-US");

function reportedLine(rel: Release, c: Ctx): { text: string; url: string } | null {
  const r = rel.reported;
  if (!r) return null;
  const what = r.cusecs != null ? `${r.atLeast ? c.e("w.resOver", { n: cusecs(r.cusecs) }) : `${cusecs(r.cusecs)} cusecs`}` : r.gates != null ? c.e("w.resGates", { n: r.gates }) : null;
  if (!what) return null;
  const when = timeOf(Date.parse(r.at), c);
  return { text: c.e("w.resReported", { when, what, outlet: r.outlet }), url: r.url };
}

async function buildReservoirs(c: Ctx): Promise<ReservoirsPayload> {
  const [data, rel] = await Promise.all([getReservoirs().catch(() => null), getReleases().catch(() => null)]);
  const rt = rtFor(c.lang);
  const want = new Set(c.cfg.rivers);
  const inRiver = (river: string | null) => !want.size || (river != null && want.has(basinSlug(river)));
  const byId = new Map((rel?.releases ?? []).map((r) => [r.reservoirId, r]));
  const items: ResRow[] = [];
  const seen = new Set<string>();
  for (const r of data?.items ?? []) {
    if (!(r.status === "spilling" || r.status === "releasing") || !inRiver(r.river)) continue;
    const f = (r as RV).flow;
    const rl = r.catalogueId ? byId.get(r.catalogueId) : undefined;
    if (r.catalogueId) seen.add(r.catalogueId);
    const rep = rl ? reportedLine(rl, c) : null;
    items.push({
      key: r.slug,
      name: (c.lang === "si" ? r.si : c.lang === "ta" ? r.ta : null) ?? r.name,
      river: r.river ? riverName(r.river, c.lang) : null,
      href: SITE + localePath(c.lang, `/reservoirs/${r.slug}`),
      status: rt(r.status === "spilling" ? "s.spilling" : "s.releasing"),
      official: true,
      figure: f ? c.t("release.cusecs", { n: cusecs(f.cusecs) }) : null,
      source: f?.source ?? "Irrigation Department",
      when: f ? shortDay(f.day, c.t) : r.latestDay ? shortDay(r.latestDay, c.t) : null,
      reported: rep?.text ?? null,
      reportedUrl: rep?.url ?? null,
    });
  }
  // gates reported open by the news with no official figure yet: listed apart, labelled "not official" (same rule as the site)
  for (const rl of rel?.releases ?? []) {
    if (rl.kind !== "reported" || rl.watch || seen.has(rl.reservoirId) || !inRiver(rl.basin)) continue;
    items.push({
      key: `rep-${rl.reservoirId}`,
      name: rl.name,
      river: rl.basin ? riverName(rl.basin, c.lang) : null,
      href: SITE + localePath(c.lang, "/reservoirs/spilling"),
      status: c.e("w.resGatesReported"),
      official: false,
      figure: null,
      source: rl.source,
      when: timeOf(Date.parse(rl.observedAt), c),
      reported: c.e("w.resReportedOnly"),
      reportedUrl: rl.url,
    });
  }
  items.sort((a, b) => Number(b.official) - Number(a.official) || Number((b.figure ?? "0").replace(/\D/g, "")) - Number((a.figure ?? "0").replace(/\D/g, "")));
  const n = items.filter((i) => i.official).length;
  const out: ReservoirsPayload = {
    ...base(c, "reservoirs", "/reservoirs/spilling", c.e("w.openRes"), true),
    kind: "reservoirs",
    title: c.e("w.resTitle"),
    summary: !data && !rel ? c.e("w.unavailable") : items.length === 0 ? c.e("w.resNone") : n === 1 ? c.e("w.resSome1") : n === 0 ? c.e("w.resReportedOnly") : c.e("w.resSome", { n }),
    items: items.slice(0, c.cfg.size === "compact" ? 4 : 8),
    officialNote: "",
  };
  if (!data && !rel) out.unavailable = c.e("w.unavailable");
  return out;
}

async function buildTicker(c: Ctx): Promise<TickerPayload | null> {
  const all = await getNational();
  let pool = all.filter((s) => s.tier !== "stale");
  if (c.cfg.gauge) pool = all.filter((s) => stationSlug(s.station) === c.cfg.gauge);
  else if (c.cfg.rivers.length) pool = pool.filter((s) => c.cfg.rivers.includes(basinSlug(s.basin)));
  if (c.cfg.gauge && !pool.length) return null;
  if (!pool.length) pool = all.filter((s) => !c.cfg.rivers.length || c.cfg.rivers.includes(basinSlug(s.basin)));
  if (!pool.length) return null;
  const s = pool.reduce((a, b) => (TIER_ORDER[b.tier] > TIER_ORDER[a.tier] || (TIER_ORDER[b.tier] === TIER_ORDER[a.tier] && (b.rate3hM ?? 0) > (a.rate3hM ?? 0)) ? b : a));
  const row = rowOf(s, c, null);
  const segments = [
    `${c.e("w.tickerAt", { river: riverName(s.basin, c.lang), gauge: row.name })}${row.level ? ` ${row.level}` : ""}`,
    row.step,
    ...(row.trend ? [row.trend.toLowerCase()] : []),
    ...(row.time ? [row.time] : []),
  ];
  return { ...base(c, "ticker", `/${basinSlug(s.basin)}/${stationSlug(s.station)}`, c.e("w.openGauge", { gauge: row.name }), false, rnOf([row])), kind: "ticker", segments, tier: row.tier, href: row.href, label: segments.join(" · ") };
}

// ---- forecast: the gauge page's prediction box and forecasting chart ---------------------------------------------------------------------
// The tone, "Next hour" and "Next 24 hours" use the same rules and wording as app/Forecast.tsx (its forecastFact, smallChanceFact, ACTION,
// the verdict lift, the release alert); only the unit-aware figures are made here, because the site's reason line quotes feet.

async function buildForecast(slug: string, c: Ctx): Promise<ForecastPayload | null> {
  const all = await getNational();
  const nat = all.find((x) => stationSlug(x.station) === slug);
  if (!nat) return null;
  const station = nat.station;
  const basin = nat.basin;
  const L = c.lang;
  const t = c.t;
  const snap = await fetchBasinSnapshot(basin).catch(() => []);
  const me = snap.find((x) => x.station === station) ?? null;
  const f = me && me.latest ? await loadForecast(basin, snap, station).catch(() => null) : null;
  const row = rowOf(nat, c, null, { withMarks: false });
  const stale = nat.tier === "stale";
  const model = !!f && f.method === "model" && f.status !== "unavailable" && f.horizons.length > 0;
  // RiverNet gauges are 1-minute extras with no fitted model: no forecast is claimed for them
  const hasForecast = !!f && f.method !== "none" && f.status !== "unavailable" && nat.source !== "rivernet";
  const unit = nat.unit;
  const want = c.cfg.unit;
  const rel = await getReleases().catch(() => null);
  const release = rel ? releaseAffectingFrom(rel, station) : null;

  let tone: VerdictTone = nat.tier as VerdictTone;
  let hour: ForecastPayload["hour"] = null;
  let day: ForecastPayload["day"] = null;
  let action: string | null = null;
  let note: string | null = null;
  if (f && me && hasForecast && !stale) {
    const now = f.asOfTs ?? me.latest?.ts ?? 0;
    const mpu = me.metresPerUnit ?? 1;
    const h1 = f.horizons.find((h) => h.h === 1);
    const r = h1 && f.currentLevel != null ? (h1.level - f.currentLevel) * mpu : (me.rate3hM ?? null);
    const rising = riverRising(station, me.trend24h, mpu, me.rate3hM ?? null);
    const tideOnly = isTidalStation(station) && r != null && r > STEADY_M_PER_H && !rising;
    const lift = liftVerdict({ tier: nat.tier, crossings: f.crossings, horizons: f.horizons, currentLevel: f.currentLevel, rising, now });
    const relAlert = nat.tier === "normal" || nat.tier === "watch" ? officialReleaseAlert(release) : null;
    const alertLvl = me.thresholds.alert;
    const lvlNow = me.latest?.water_level ?? null;
    const gapM = alertLvl != null && lvlNow != null ? (alertLvl - lvlNow) * mpu : null;
    const nearAlert = gapM != null && gapM > 0 && (gapM <= 1 || gapM <= alertLvl! * mpu * 0.2);
    const releaseLift = rising && nearAlert && !!release?.active && !!release?.confirmed;
    tone = relAlert ? "alert" : lift.verdict === "alert" && (nat.tier === "normal" || nat.tier === "watch") ? "alert" : (lift.verdict === "watch" || releaseLift) && nat.tier === "normal" ? "watch" : (nat.tier as VerdictTone);
    const heavier = f.rainRisk != null || f.stormHorizons.length > 0;
    const { fact } = forecastFact(f, nat.tier, now);
    const day24 = lift.why === "small" && lift.crossing ? smallChanceFact(lift.crossing, lift.etaHours, heavier) : (fact ?? { en: "No estimate yet", si: "තවම ඇස්තමේන්තුවක් නැත", ta: "இன்னும் மதிப்பீடு இல்லை" });
    day = { label: c.e("w.fcDayLabel"), text: day24[L], ok: day24.en === "No flooding expected today" };
    const word = r == null ? null : tideOnly ? TIDE_RISE : directionFor(r);
    if (word) {
      const lvl = h1 ? fmt(h1.level, f.unit, want) : null;
      const lo = h1?.low != null ? fmt(h1.low, f.unit, want) : null;
      const hi = h1?.high != null ? fmt(h1.high, f.unit, want) : null;
      const time = h1 ? clock(h1.ts, t) : "";
      hour = {
        label: c.e("w.fcHourLabel"),
        title: word[L],
        sub: lvl && f.unit != null ? (lo && hi && lo !== hi ? c.e("w.fcHourSub", { level: lvl, lo, hi, time }) : c.e("w.fcHourSub1", { level: lvl, time })) : null,
        arrow: tideOnly || r == null || Math.abs(r) < STEADY_M_PER_H ? "steady" : r < 0 ? "down" : "up",
      };
    }
    if (tone === "alert" || tone === "minor" || tone === "major") action = (ACTION[tone]?.[L] ?? null);
    note = c.e("w.fcNote");
  } else if (!stale && ["alert", "minor", "major"].includes(nat.tier)) {
    action = ACTION[nat.tier as VerdictTone]?.[L] ?? null;
  }

  // the forecasting chart: observed readings, the forecast line and its 80% band, the official marks, "now"
  let chart: FChart | null = null;
  const hours = c.cfg.hours === 72 ? 72 : 24;
  if (f && me && model && !stale && f.asOfTs != null) {
    let readings = me.trend24h;
    if (hours > 24) {
      try {
        readings = (await fetchStationData(station, 4)).readings;
      } catch {
        /* the 24 h we have */
      }
    }
    const nowTs = f.asOfTs;
    const from = nowTs - hours * 3_600_000;
    const cv = (v: number) => conv(v, unit, want).v;
    const obs = readings.filter((r) => r.water_level != null && r.ts >= from && r.ts <= nowTs).map((r) => [r.ts, cv(r.water_level as number)] as [number, number]);
    const step = Math.max(1, Math.ceil(obs.length / 120));
    const observed = obs.filter((_, i) => i % step === 0 || i === obs.length - 1);
    const fc: [number, number][] = [[nowTs, cv(f.currentLevel as number)], ...f.horizons.map((h) => [h.ts, cv(h.level)] as [number, number])];
    const band = f.horizons.map((h) => [h.ts, cv(h.low ?? h.level), cv(h.high ?? h.level)] as [number, number, number]);
    const to = f.horizons[f.horizons.length - 1].ts;
    const vals = [...observed.map((p) => p[1]), ...fc.map((p) => p[1]), ...band.flatMap((b) => [b[1], b[2]])];
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const th = sanitizeThresholds(nat.thresholds);
    const all3 = c.cfg.marks ? MARKS.filter((k) => th[k] != null && th[k]! > 0).map((k) => ({ key: k, label: t(`mark.${k}` as "mark.alert"), v: cv(th[k]!) })) : [];
    // marks the chart reaches, plus the next one above it: how far the river is from the next official step
    const below = all3.filter((m) => m.v <= hi);
    const nextAbove = all3.filter((m) => m.v > hi).sort((a, b) => a.v - b.v)[0];
    const marks = nextAbove ? [...below, nextAbove] : below;
    const d = digits(unit, want);
    const u = conv(0, unit, want).unit;
    const yHi = Math.max(hi, ...marks.map((m) => m.v));
    const yLo = Math.min(lo, ...marks.map((m) => m.v));
    chart = {
      observed,
      forecast: fc,
      band,
      now: nowTs,
      from,
      to,
      unit: u,
      marks,
      axis: { from: c.e("w.hoursAgo", { n: hours }), now: `${c.e("w.fcNow")} ${clock(nowTs, t)}`, to: c.e("w.hoursAhead", { n: 24 }) },
      yMin: `${yLo.toFixed(d)}${u ? ` ${u}` : ""}`,
      yMax: `${yHi.toFixed(d)}${u ? ` ${u}` : ""}`,
      legend: { observed: c.e("w.fcObserved"), forecast: c.e("w.fcForecast"), band: c.e("w.fcBand"), now: c.e("w.fcNow") },
    };
  }

  const pill: PillTier = stale ? "stale" : tone === "watch" ? "normal" : (tone as PillTier);
  return {
    ...base(c, "forecast", `/${basinSlug(basin)}/${slug}`, c.e("w.openForecast", { gauge: stationDisplayName(station) }), false, rnOf([row])),
    kind: "forecast",
    title: stationDisplayName(station),
    river: riverName(basin, L),
    row,
    verdict: stale ? row.step : VERDICT[tone === "watch" ? "normal" : tone][L],
    tone: pill,
    hour,
    day,
    action,
    note,
    chart,
    chartTitle: c.e("w.fcTitle", { n: hours }),
    forecastLabel: hasForecast ? c.e("w.fcLabel") : c.e("w.fcNone"),
    noForecast: !hasForecast,
  };
}

/** The payload for one widget, or null when the river / gauge / town does not exist. Throws only when a source is down (callers show "unavailable"). */
export async function buildEmbed(widget: Widget, id: string | null, cfg: EmbedCfg): Promise<EmbedPayload | null> {
  const c = ctxOf(cfg);
  switch (widget) {
    case "river": return id ? buildRiver(id, c) : null;
    case "gauge": return id ? buildGauge(id, c) : null;
    case "card": return id ? buildCard(id, c) : null;
    case "forecast": return id ? buildForecast(id, c) : null;
    case "town": return id ? buildTown(id, c) : null;
    case "now": return buildNow(c);
    case "reservoirs": return buildReservoirs(c);
    case "ticker": return buildTicker(c);
  }
}
