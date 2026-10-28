// Sinhala / Tamil spellings of a gauge or town name, from the gazetteer aliases (lib/places.ts), the same ones the town pages search on.
// A gauge gets a native name only when a town of the same name lists one; otherwise it stays in Latin letters (never invented).
import { PLACES, placeBySlug } from "@/lib/places";
import { stationDisplayName } from "@/lib/displayName";
import type { Locale } from "@/lib/i18n/config";

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
