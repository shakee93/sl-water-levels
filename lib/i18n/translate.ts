// Dictionary lookup, shared by server and client. No dictionary imports here, so a client
// bundle only carries the one dictionary the server hands it (see LocaleProvider).
import type { Dict, Key } from "./en";
import { localePath, type Locale } from "./config";

export type { Dict, Key };
export type Vars = Record<string, string | number>;
export type TFn = (key: Key, vars?: Vars) => string;

export function makeT(dict: Dict): TFn {
  return (key, vars) => {
    const s = dict[key] ?? key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
  };
}

export type I18n = {
  lang: Locale;
  t: TFn;
  /** Locale-prefix a site path ("/help" -> "/si/help"). */
  p: (path: string) => string;
};

export function makeI18n(lang: Locale, dict: Dict): I18n {
  return { lang, t: makeT(dict), p: (path) => localePath(lang, path) };
}
