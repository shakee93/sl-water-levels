// Builders for titles, H1s and meta descriptions per page type. Pure: pages pass live facts in, strings come out.
// Templates live in lib/i18n/seo.ts, spellings in lib/seoNames.ts. See DOCS.md "SEO".
import { OG_LOCALE, type Locale } from "./i18n/config";
import { storyPath, timeBucket, type StoryKind } from "./story/url";
import { getI18n } from "./i18n/server";
import { seoFor } from "./i18n/seo";
import { byGaugeDemand, gaugeAliases, nativeRiver, representativeGauge, reservoirAliases, riverNames, siGenitive } from "./seoNames";
import { stationDisplayName } from "./displayName";
import { formatLevel } from "./units";
import type { NationalStation } from "./arcgis";

/** A search-result description is cut near this many characters (Search Console, Nov 2026: river pages ran 164-208 and were cut). */
export const DESC_MAX = 155;

/** Phones cut a title near 55-60 characters: past this the optional tail (the "also called" half) is dropped. */
export const TITLE_MAX = 62;

const AND: Record<Locale, string> = { en: "and", si: "සහ", ta: "மற்றும்" };
const MORE: Record<Locale, string> = { en: "{n} more", si: "තවත් {n}", ta: "மேலும் {n}" };

/** "Ellagawa, Ratnapura, Magura and 2 more": a short list for a meta description (never the whole river). */
export function shortList(names: string[], lang: Locale, max = 4): string {
  if (names.length <= max) {
    if (names.length <= 1) return names.join("");
    return `${names.slice(0, -1).join(", ")} ${AND[lang]} ${names[names.length - 1]}`;
  }
  return `${names.slice(0, max).join(", ")} ${AND[lang]} ${MORE[lang].replace("{n}", String(names.length - max))}`;
}

export function riverNameParts(basin: string, lang: Locale) {
  const n = riverNames(basin);
  const nat = nativeRiver(basin, lang);
  // si: "කැලණි ගඟේ" (what people type); ta: the name as is; neither script known: the English lead
  const native = nat ? (lang === "si" ? siGenitive(nat) : nat) : n.lead;
  return { ...n, native };
}

/** What the river description quotes: the worst official step and one well-known gauge, read from the SAME snapshot the page body uses. */
export type RiverFacts = {
  reporting: number;
  flagged: number;
  /** The gauge at the highest official step (Alert or above), e.g. "Kalawellawa 16.7 ft (Alert)". Null when none is flagged. */
  worst: { name: string; level: string; status: string } | null;
  /** The river's best-known reporting gauge (seoNames.representativeGauge). */
  rep: { name: string; level: string } | null;
};

const STEP_RANK: Record<string, number> = { major: 3, minor: 2, alert: 1 };

/** Facts for riverMeta from the page's gauge snapshot (official steps only: near alert is Normal, a stale gauge is not counted). */
export function riverFacts(lang: Locale, basin: string, snap: NationalStation[]): RiverFacts | null {
  const { t } = getI18n(lang);
  const reporting = snap.filter((s) => s.tier !== "stale" && s.latest && s.latest.water_level != null);
  if (!reporting.length) return null;
  // "Kalawellawa (Millakanda)" -> "Kalawellawa": the bracket costs snippet room and nobody types it
  const short = (n: string) => n.replace(/\s*\(.*\)\s*$/, "").trim() || n;
  const lv = (s: NationalStation) => formatLevel(s.latest!.water_level, s.unit, 1);
  const flagged = reporting.filter((s) => STEP_RANK[s.tier]);
  const w = flagged.reduce<NationalStation | null>((a, s) => (!a || STEP_RANK[s.tier] > STEP_RANK[a.tier] ? s : a), null);
  const repName = representativeGauge(basin, reporting.map((s) => stationDisplayName(s.station)));
  const rs = reporting.find((s) => stationDisplayName(s.station) === repName);
  return {
    reporting: reporting.length,
    flagged: flagged.length,
    worst: w ? { name: short(stationDisplayName(w.station)), level: lv(w), status: t(`tier.${w.tier}` as "tier.alert") } : null,
    rep: rs ? { name: short(stationDisplayName(rs.station)), level: lv(rs) } : null,
  };
}

/** River page: title, description, H1 and the "also called" line. `facts` (from riverFacts) puts a real level in the description. */
export function riverMeta(lang: Locale, basin: string, o: { gauges: string[]; now?: string; facts?: RiverFacts | null }) {
  const s = seoFor(lang);
  const n = riverNameParts(basin, lang);
  const vars = { lead: n.lead, alt: n.alt ?? "", native: n.native, aka: n.aka ?? "" };
  // Longest wording that fits a phone's title first, then the shorter ones; the last is the title before 5 Nov 2026.
  const base = n.alt || lang === "en" ? "river.title" : "river.titleNoAlt";
  const titles = [...(lang === "en" && n.aka ? [s("river.titleAka", vars)] : []), s(base, vars), s("river.titleNoAlt", vars)];
  const title = titles.find((x) => x.length <= TITLE_MAX) ?? titles[titles.length - 1];
  const f = o.facts;
  const name = lang === "en" && n.aka ? `${n.lead} (${n.aka})` : n.lead;
  let description: string;
  if (f && f.reporting > 0) {
    // Fullest first; the second gauge's level matters more than the closing words, so those are shortened first, the gauge dropped last.
    const tries: [boolean, "river.descTail" | "river.descTailShort"][] = [[true, "river.descTail"], [true, "river.descTailShort"], [false, "river.descTail"], [false, "river.descTailShort"]];
    const build = ([withRep, tail]: (typeof tries)[number]) => {
      const rep = f.rep && withRep && f.rep.name !== f.worst?.name ? f.rep : null;
      const common = { name, native: n.native, m: f.reporting, n: f.flagged, tail: s(tail) };
      return (f.worst
        ? s("river.descFlag", { ...common, worst: `${f.worst.name} ${f.worst.level} (${f.worst.status})`, rep: rep ? ` ${rep.name} ${rep.level}.` : "" })
        : s("river.descCalm", { ...common, rep: rep ? ` (${rep.name} ${rep.level})` : "" })
      ).replace(/\s+/g, " ").replace(/ \./g, ".").trim();
    };
    const all = tries.map(build);
    description = lang === "en" ? (all.find((x) => x.length <= DESC_MAX) ?? all[all.length - 1]) : all[0];
  } else {
    description = s("river.desc", {
      lead: n.lead,
      alt: n.alt ?? n.lead,
      native: n.native,
      gauges: shortList(byGaugeDemand(o.gauges), lang, 3),
      now: o.now ?? "",
      rom: lang === "si" && n.rom[0] ? `${n.rom[0]}.` : "",
    }).replace(` (${n.lead})`, n.alt ? ` (${n.alt})` : "").replace(/\s+/g, " ").trim();
  }
  const names = [n.alt, ...n.also].filter((x): x is string => !!x);
  // The H1 carries the everyday name only; the variants go in the line under it (and, in en, the alt in the title).
  return {
    title,
    description,
    h1: s(n.alt ? "river.h1" : "river.h1NoAlt", vars),
    also: lang === "en" && names.length ? s("river.also", { list: names.join(", ") }) : lang !== "en" && n.alt ? s("river.also", { list: [n.lead, n.alt, ...n.also.slice(0, 2)].join(", ") }) : null,
  };
}

/** Gauge page. `oneGauge`: the river has only this gauge (its own page redirects here), so the river's query leads. */
export function gaugeMeta(
  lang: Locale,
  o: { gauge: string; basin: string; oneGauge: boolean; level?: string; status?: string; alert?: string; minor?: string; major?: string },
) {
  const s = seoFor(lang);
  const n = riverNameParts(o.basin, lang);
  const river = lang === "en" ? n.lead : n.native;
  // Hanwella keeps its old title: it already earns 2.3% (Search Console, Nov 2026). Everything else leads with "flood level".
  const keep = o.gauge === "Hanwella" && !o.oneGauge;
  const titles = keep
    ? [s("gauge.titleLegacy", { gauge: o.gauge, river })]
    : o.oneGauge
      ? [s("gauge.titleOne", { gauge: o.gauge, river }), s("gauge.titleOneLegacy", { gauge: o.gauge, river })]
      : [s("gauge.title", { gauge: o.gauge, river }), s("gauge.titleShort", { gauge: o.gauge }), s("gauge.titleLegacy", { gauge: o.gauge, river })];
  const legacy = titles[titles.length - 1];
  // the last resort is the old title, without its "(Live)" tail when that is still too long
  const title = titles.find((x) => x.length <= TITLE_MAX) ?? (legacy.length > TITLE_MAX ? legacy.replace(/ \((Live|සජීවී|நேரடி)\)$/, "") : legacy);
  const w = (key: "gauge.markAlert" | "gauge.markMinor" | "gauge.markMajor", v?: string) => (v && v !== "—" ? [s(key, { v })] : []);
  const marks = [...w("gauge.markAlert", o.alert), ...w("gauge.markMinor", o.minor), ...w("gauge.markMajor", o.major)].join(", ");
  const description = o.level
    ? s(marks ? "gauge.desc" : "gauge.descNoMarks", { gauge: o.gauge, river: lang === "en" ? n.lead : n.native, level: o.level, sp: o.status ? ` (${o.status})` : "", marks })
    : s("gauge.descNone", { gauge: o.gauge, river: n.lead });
  return {
    title,
    description,
    h1: s(o.oneGauge ? "gauge.h1One" : "gauge.h1", { gauge: o.gauge, river }),
    sub: o.oneGauge ? null : s("gauge.sub", { gauge: o.gauge }),
    /** Anchor text of the link up to the river page ("Kelani River water level"). */
    alias: lang === "en" && gaugeAliases(o.gauge).length ? s("gauge.alias", { list: gaugeAliases(o.gauge).join(", ") }) : null,
    riverLink: o.oneGauge ? null : s("rivers.link", { river }),
  };
}

/** Reservoir page: the title/H1 plus the "also searched as" spellings (English pages). */
export function reservoirMeta(lang: Locale, o: { name: string; shown: string; catalogueId: string | null }) {
  const s = seoFor(lang);
  const aliases = lang === "en" ? reservoirAliases(o.catalogueId, o.name) : [];
  return {
    title: s("rsv.title", { name: o.name }),
    h1: s("rsv.h1", { name: o.shown }),
    also: aliases.length ? s("rsv.also", { list: aliases.join(", ") }) : null,
  };
}

/**
 * og:site_name and og:locale. A page's own `openGraph` replaces the layout's whole object (Next does not deep-merge), so
 * without this spread every page lost both. Use: `openGraph: { ...ogBase(lang), title, description, url, type: "website" }`.
 */
export const ogBase = (lang: Locale) => ({ siteName: getI18n(lang).t("site.name"), locale: OG_LOCALE[lang], images: ogImages("home", "now", lang, false) });

/**
 * The link-preview picture (1200x630) for a page: the live level and official step, drawn by /api/story (the same picture as the share
 * image). `fresh` adds a 10-minute bucket to the address: WhatsApp and Facebook keep previews per address, so without it a shared link
 * would show the first level it ever saw. Pages that are not about one gauge use the national picture at a fixed address.
 */
export function ogImages(kind: StoryKind, slug: string, lang: Locale, fresh = true) {
  return [{ url: storyPath(kind, slug, { format: "og", lang, t: fresh ? timeBucket() : undefined }), width: 1200, height: 630, alt: getI18n(lang).t("site.name") }];
}
