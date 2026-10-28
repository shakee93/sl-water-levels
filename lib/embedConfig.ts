// Settings shared by every embeddable widget (/embed/<widget>): read from the URL, validated, with defaults. Pure: used by the
// server pages, the JSON route, the builder page and the snippet generator, so they can never disagree.
// The credit line and its link are NOT settings: every widget always carries them.
import { isLocale, type Locale } from "./i18n/config";

export const WIDGETS = ["card", "river", "gauge", "forecast", "town", "now", "reservoirs", "ticker"] as const;
export type Widget = (typeof WIDGETS)[number];
export const isWidget = (v: unknown): v is Widget => typeof v === "string" && (WIDGETS as readonly string[]).includes(v);

export type EmbedCfg = {
  lang: Locale;
  theme: "light" | "dark" | "auto";
  size: "compact" | "full";
  /** Unit the levels and official marks are shown in. Gauges with an unknown unit never convert. */
  unit: "ft" | "m";
  /** Hours of history in the chart; 0 = no chart. */
  hours: 0 | 24 | 72;
  forecast: boolean;
  marks: boolean;
  /** River widget: one row per gauge ("list") or one small card per gauge ("cards"). */
  layout: "list" | "cards";
  /** now / reservoirs / ticker filters: river (basin) slugs, comma separated in the URL. */
  rivers: string[];
  gauge: string | null;
  // ---- publisher style (lib/embedStyle.ts turns these into safe CSS; the official step colours are never styleable) ----
  /** 6-digit hex without "#", or null = default. */
  accent: string | null;
  /** 6-digit hex, "transparent", or null = default. */
  bg: string | null;
  text: string | null;
  font: EmbedFont;
  scale: 90 | 100 | 110 | 120;
  radius: 0 | 4 | 8 | 12 | 16;
  border: boolean;
  shadow: boolean;
  pad: "tight" | "normal";
  /** false hides the widget's own title (river, right now, reservoirs). */
  title: boolean;
};

export const FONTS = ["system", "sans", "serif", "noto-sans", "noto-serif", "inter", "roboto", "merriweather"] as const;
export type EmbedFont = (typeof FONTS)[number];

export const DEFAULTS: EmbedCfg = { lang: "en", theme: "light", size: "full", unit: "ft", hours: 24, forecast: true, marks: true, layout: "list", rivers: [], gauge: null, accent: null, bg: null, text: null, font: "system", scale: 100, radius: 12, border: true, shadow: true, pad: "normal", title: true };

const hex = (v: string | undefined): string | null => {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec((v ?? "").trim());
  if (!m) return null;
  const h = m[1].toLowerCase();
  return h.length === 3 ? [...h].map((c) => c + c).join("") : h;
};

type Sp = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const flag = (v: string | undefined, d: boolean) => (v === "1" || v === "true" || v === "on" ? true : v === "0" || v === "false" || v === "off" ? false : d);
const slugs = (v: string | undefined) => (v ? [...new Set(v.toLowerCase().split(",").map((x) => x.trim().replace(/[^a-z0-9-]/g, "")).filter(Boolean))].slice(0, 12) : []);

export function parseCfg(sp: Sp): EmbedCfg {
  const g = (k: string) => one(sp[k]);
  const lang = g("lang");
  const hours = Number(g("hours") ?? g("chart"));
  return {
    lang: isLocale(lang) ? lang : DEFAULTS.lang,
    theme: g("theme") === "dark" ? "dark" : g("theme") === "auto" ? "auto" : "light",
    size: g("size") === "compact" ? "compact" : "full",
    unit: g("unit") === "m" ? "m" : "ft",
    hours: hours === 0 || hours === 72 ? hours : hours === 24 ? 24 : DEFAULTS.hours,
    forecast: flag(g("forecast"), true),
    marks: flag(g("marks"), true),
    layout: g("layout") === "cards" ? "cards" : "list",
    rivers: slugs(g("river") ?? g("rivers") ?? g("basin")),
    gauge: slugs(g("gauge"))[0] ?? null,
    accent: hex(g("accent")),
    bg: g("bg")?.trim().toLowerCase() === "transparent" ? "transparent" : hex(g("bg")),
    text: hex(g("text")),
    font: (FONTS as readonly string[]).includes(g("font") ?? "") ? (g("font") as EmbedFont) : "system",
    scale: ([90, 110, 120] as const).find((n) => n === Number(g("scale"))) ?? 100,
    radius: ([0, 4, 8, 16] as const).find((n) => n === Number(g("radius"))) ?? 12,
    border: flag(g("border"), true),
    shadow: flag(g("shadow"), true),
    pad: g("pad") === "tight" ? "tight" : "normal",
    title: flag(g("title"), true),
  };
}

/** Query string with only what differs from the defaults (keeps embed addresses short). */
export function cfgQuery(c: Partial<EmbedCfg>, w: Widget): string {
  const q = new URLSearchParams();
  if (c.lang && c.lang !== DEFAULTS.lang) q.set("lang", c.lang);
  if (c.theme && c.theme !== DEFAULTS.theme) q.set("theme", c.theme);
  if (c.size && c.size !== DEFAULTS.size) q.set("size", c.size);
  if (c.unit && c.unit !== DEFAULTS.unit) q.set("unit", c.unit);
  if ((w === "gauge" || w === "forecast") && c.hours != null && c.hours !== DEFAULTS.hours) q.set("hours", String(c.hours));
  if (c.forecast === false) q.set("forecast", "0");
  if (c.marks === false) q.set("marks", "0");
  if (w === "river" && c.layout === "cards") q.set("layout", "cards");
  if (c.rivers?.length) q.set(w === "reservoirs" ? "basin" : "river", c.rivers.join(","));
  if (w === "ticker" && c.gauge) q.set("gauge", c.gauge);
  if (c.accent) q.set("accent", c.accent);
  if (c.bg) q.set("bg", c.bg);
  if (c.text) q.set("text", c.text);
  if (c.font && c.font !== "system") q.set("font", c.font);
  if (c.scale && c.scale !== 100) q.set("scale", String(c.scale));
  if (c.radius != null && c.radius !== 12) q.set("radius", String(c.radius));
  if (c.border === false) q.set("border", "0");
  if (c.shadow === false) q.set("shadow", "0");
  if (c.pad === "tight") q.set("pad", "tight");
  if (c.title === false) q.set("title", "0");
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Which settings a widget uses (the builder only shows these). */
export const USES: Record<Widget, { unit: boolean; hours: boolean; forecast: boolean; marks: boolean; filter: "none" | "rivers" | "river-or-gauge" }> = {
  card: { unit: true, hours: false, forecast: true, marks: true, filter: "none" },
  river: { unit: true, hours: false, forecast: true, marks: true, filter: "none" },
  gauge: { unit: true, hours: true, forecast: true, marks: true, filter: "none" },
  forecast: { unit: true, hours: true, forecast: false, marks: true, filter: "none" },
  town: { unit: true, hours: false, forecast: true, marks: true, filter: "none" },
  now: { unit: true, hours: false, forecast: false, marks: false, filter: "rivers" },
  reservoirs: { unit: false, hours: false, forecast: false, marks: false, filter: "rivers" },
  ticker: { unit: true, hours: false, forecast: false, marks: false, filter: "river-or-gauge" },
};

/** A fixed iframe height that fits the widget when the resize script is not used. */
export function fixedHeight(w: Widget, size: "compact" | "full", n = 4, cfgLayoutCards = false): number {
  const full = size === "full";
  switch (w) {
    case "card": return full ? 300 : 190;
    case "river": return cfgLayoutCards ? 150 + Math.ceil(n / 2) * (full ? 190 : 120) : (full ? 150 : 108) + n * (full ? 64 : 44);
    case "gauge": return full ? 470 : 250;
    case "forecast": return full ? 640 : 330;
    case "town": return full ? 400 : 260;
    case "now": return 130 + n * (full ? 70 : 46);
    case "reservoirs": return 130 + n * (full ? 78 : 50);
    case "ticker": return 44;
  }
}
