// Shared by the story images (lib/story/names.ts re-exports it) and the Instagram captions (lib/igCompose.ts, run by node).
// Sinhala / Tamil spellings of a gauge or town name, from the gazetteer aliases (lib/places.ts), the same ones the town pages search on.
// A gauge gets a native name only when a town of the same name lists one; otherwise it stays in Latin letters (never invented).
// @ts-ignore node strip-types needs explicit extensions
import { PLACES, placeBySlug } from "./places.ts";
// @ts-ignore node strip-types needs explicit extensions
import { stationDisplayName } from "./displayName.ts";
type Locale = "en" | "si" | "ta";

const SCRIPT = { si: /[඀-෿]/, ta: /[஀-௿]/ };
const nativeOf = (aliases: string[], lang: Locale): string | null => {
  if (lang === "en") return null;
  const cands = aliases.filter((a) => SCRIPT[lang].test(a));
  // the shortest is the plain name; longer ones carry a suffix (රත්නපුරය)
  return cands.sort((a, b) => a.length - b.length)[0] ?? null;
};

export function nativeGauge(station: string, lang: Locale): string | null {
  const n = stationDisplayName(station).toLowerCase();
  const p = PLACES.find((x) => x.name.toLowerCase() === n);
  return p ? nativeOf(p.aliases, lang) : null;
}
export function nativeTown(slug: string, lang: Locale): string | null {
  const p = placeBySlug(slug);
  return p ? nativeOf(p.aliases, lang) : null;
}
