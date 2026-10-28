// Settings shared by every embeddable widget (/embed/<widget>): read from the URL, validated, with defaults. Pure: used by the
// server pages, the JSON route, the builder page and the snippet generator, so they can never disagree.
// The credit line and its link are NOT settings: every widget always carries them.
import { isLocale, type Locale } from "./i18n/config";

export const WIDGETS = ["river", "gauge", "forecast", "town", "now", "reservoirs", "ticker"] as const;
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
  /** now / reservoirs / ticker filters: river (basin) slugs, comma separated in the URL. */
  rivers: string[];
  gauge: string | null;
};

export const DEFAULTS: EmbedCfg = { lang: "en", theme: "auto", size: "full", unit: "ft", hours: 24, forecast: true, marks: true, rivers: [], gauge: null };

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
    theme: g("theme") === "light" || g("theme") === "dark" ? (g("theme") as "light" | "dark") : "auto",
    size: g("size") === "compact" ? "compact" : "full",
    unit: g("unit") === "m" ? "m" : "ft",
    hours: hours === 0 || hours === 72 ? hours : hours === 24 ? 24 : DEFAULTS.hours,
    forecast: flag(g("forecast"), true),
    marks: flag(g("marks"), true),
    rivers: slugs(g("river") ?? g("rivers") ?? g("basin")),
    gauge: slugs(g("gauge"))[0] ?? null,
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
  if (c.rivers?.length) q.set(w === "reservoirs" ? "basin" : "river", c.rivers.join(","));
  if (w === "ticker" && c.gauge) q.set("gauge", c.gauge);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Which settings a widget uses (the builder only shows these). */
export const USES: Record<Widget, { unit: boolean; hours: boolean; forecast: boolean; marks: boolean; filter: "none" | "rivers" | "river-or-gauge" }> = {
  river: { unit: true, hours: false, forecast: true, marks: true, filter: "none" },
  gauge: { unit: true, hours: true, forecast: true, marks: true, filter: "none" },
  forecast: { unit: true, hours: true, forecast: false, marks: true, filter: "none" },
  town: { unit: true, hours: false, forecast: true, marks: true, filter: "none" },
  now: { unit: true, hours: false, forecast: false, marks: false, filter: "rivers" },
  reservoirs: { unit: false, hours: false, forecast: false, marks: false, filter: "rivers" },
  ticker: { unit: true, hours: false, forecast: false, marks: false, filter: "river-or-gauge" },
};

/** A fixed iframe height that fits the widget when the resize script is not used. */
export function fixedHeight(w: Widget, size: "compact" | "full", n = 4): number {
  const full = size === "full";
  switch (w) {
    case "river": return (full ? 150 : 108) + n * (full ? 64 : 44);
    case "gauge": return full ? 470 : 250;
    case "forecast": return full ? 640 : 330;
    case "town": return full ? 400 : 260;
    case "now": return 130 + n * (full ? 70 : 46);
    case "reservoirs": return 130 + n * (full ? 78 : 50);
    case "ticker": return 44;
  }
}
