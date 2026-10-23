// The places a visitor saved with the star on a gauge or town page, kept in this browser only (localStorage
// "sl_favourites", the key the star has always written). Towns are saved as their page path (/flood/<slug>, with or
// without a language prefix), gauges as their page path (/kelani-ganga/hanwella). "Your places" on the home page turns
// them into place keys (lib/myPlaces.ts). Pure helpers; the storage calls guard every access (private mode, blocked).
export const PINS_KEY = "sl_favourites";
export const PINS_EVENT = "sl:favourites";
export type Pin = { href: string; name: string };

export function parsePins(raw: string | null | undefined): Pin[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((f): f is Pin => !!f && typeof f === "object" && typeof (f as Pin).href === "string").map((f) => ({ href: f.href, name: typeof f.name === "string" ? f.name : "" }));
  } catch {
    return [];
  }
}

/** "/si/flood/wellampitiya" -> "wellampitiya"; anything else -> null. */
export function townSlugOfHref(href: string): string | null {
  const path = href.replace(/^\/(en|si|ta)(?=\/)/, "").split(/[?#]/)[0];
  const m = /^\/flood\/([a-z0-9-]+)\/?$/.exec(path);
  return m ? m[1] : null;
}

/** The place key for a saved page: t:<slug> for a town, s:<gauge> for a gauge we know by href, else null. */
export function keyOfPin(href: string, stationByHref: ReadonlyMap<string, string>): string | null {
  const slug = townSlugOfHref(href);
  if (slug) return `t:${slug}`;
  const st = stationByHref.get(href.replace(/^\/(en|si|ta)(?=\/)/, ""));
  return st ? `s:${st}` : null;
}

export function readPinsRaw(): string {
  try {
    return window.localStorage.getItem(PINS_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

/** Adds or removes a saved page. Returns false when storage is unavailable. */
export function togglePin(href: string, name: string): boolean {
  try {
    const list = parsePins(readPinsRaw());
    const norm = (h: string) => h.replace(/^\/(en|si|ta)(?=\/)/, "");
    const has = list.some((p) => norm(p.href) === norm(href));
    const next = has ? list.filter((p) => norm(p.href) !== norm(href)) : [...list, { href, name }];
    window.localStorage.setItem(PINS_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(PINS_EVENT));
    return true;
  } catch {
    return false;
  }
}
