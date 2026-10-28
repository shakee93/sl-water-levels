// Builders for titles, H1s and meta descriptions per page type. Pure: pages pass live facts in, strings come out.
// Templates live in lib/i18n/seo.ts, spellings in lib/seoNames.ts. See DOCS.md "SEO".
import { OG_LOCALE, type Locale } from "./i18n/config";
import { storyPath, timeBucket, type StoryKind } from "./story/url";
import { getI18n } from "./i18n/server";
import { seoFor } from "./i18n/seo";
import { byGaugeDemand, gaugeAliases, nativeRiver, reservoirAliases, riverNames, siGenitive } from "./seoNames";

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

/** River page: title, description, H1 and the "also called" line. */
export function riverMeta(lang: Locale, basin: string, o: { gauges: string[]; now?: string }) {
  const s = seoFor(lang);
  const n = riverNameParts(basin, lang);
  const vars = { lead: n.lead, alt: n.alt ?? "", native: n.native };
  const full = n.alt ? s("river.title", vars) : s("river.titleNoAlt", vars);
  const title = full.length > TITLE_MAX ? s("river.titleNoAlt", vars) : full;
  const description = s("river.desc", {
    lead: n.lead,
    alt: n.alt ?? n.lead,
    native: n.native,
    gauges: shortList(byGaugeDemand(o.gauges), lang, 3),
    now: o.now ?? "",
    rom: lang === "si" && n.rom[0] ? `${n.rom[0]}.` : "",
  }).replace(` (${n.lead})`, n.alt ? ` (${n.alt})` : "").replace(/\s+/g, " ").trim();
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
  const key = o.oneGauge ? "gauge.titleOne" : "gauge.title";
  const full = s(key, { gauge: o.gauge, river });
  const title = full.length > TITLE_MAX ? full.replace(/ \((Live|සජීවී|நேரடி)\)$/, "") : full;
  const description = o.level
    ? s("gauge.desc", { gauge: o.gauge, river: n.lead, level: o.level, status: o.status ?? "", alert: o.alert ?? "—", minor: o.minor ?? "—", major: o.major ?? "—" })
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
