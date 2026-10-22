// Locale routing helpers. Pure (no "use client"/"server-only"): used by the proxy, server
// components, client components and the sitemap.
//
// English keeps the existing URLs (/, /kelani-ganga, /help ...). Sinhala lives under /si and
// Tamil under /ta, with the same slugs after the prefix.

export const LOCALES = ["en", "si", "ta"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** localStorage key AND cookie name for the visitor's saved language. */
export const LANG_KEY = "sl_lang";
export const LANG_COOKIE_MAX_AGE = 31_536_000; // 1 year

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/** <html lang> value. */
export const HTML_LANG: Record<Locale, string> = { en: "en", si: "si", ta: "ta" };
/** Open Graph locale. */
export const OG_LOCALE: Record<Locale, string> = { en: "en_LK", si: "si_LK", ta: "ta_LK" };

/** Prefix a site path with the locale. English paths are unchanged. Keeps ?query and #hash. */
export function localePath(lang: Locale, path: string): string {
  if (lang === DEFAULT_LOCALE) return path;
  const cut = path.search(/[?#]/);
  const head = cut < 0 ? path : path.slice(0, cut);
  const tail = cut < 0 ? "" : path.slice(cut);
  return `${head === "/" || head === "" ? `/${lang}` : `/${lang}${head}`}${tail}`;
}

/** Split a browser pathname into its locale and the English-shaped path ("/si/help" -> si, "/help"). */
export function splitLocale(pathname: string): { lang: Locale; path: string } {
  const m = /^\/(en|si|ta)(?=\/|$)/.exec(pathname);
  if (!m) return { lang: DEFAULT_LOCALE, path: pathname || "/" };
  return { lang: m[1] as Locale, path: pathname.slice(m[0].length) || "/" };
}

/** Next metadata `alternates` for a page: self-canonical per locale + hreflang for all three. */
export function pageAlternates(lang: Locale, path: string) {
  return {
    canonical: localePath(lang, path),
    languages: {
      en: localePath("en", path),
      si: localePath("si", path),
      ta: localePath("ta", path),
      "x-default": localePath("en", path),
    },
  };
}
