// Server-side entry: loads the dictionaries. Pages and server components call getI18n(lang).
import { en } from "./en";
import { si } from "./si";
import { ta } from "./ta";
import type { Locale } from "./config";
import { makeI18n, type Dict, type I18n } from "./translate";

export const DICTS: Record<Locale, Dict> = { en, si, ta };

export function getI18n(lang: Locale): I18n {
  return makeI18n(lang, DICTS[lang]);
}
