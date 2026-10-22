"use client";

import { createContext, useContext, useMemo } from "react";
import type { Locale } from "@/lib/i18n/config";
import { makeI18n, type Dict, type I18n } from "@/lib/i18n/translate";

const Ctx = createContext<I18n | null>(null);

/** Hands the page's language and its one dictionary to client components. */
export function LocaleProvider({ lang, dict, children }: { lang: Locale; dict: Dict; children: React.ReactNode }) {
  const value = useMemo(() => makeI18n(lang, dict), [lang, dict]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** { lang, t, p } for client components. */
export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n outside LocaleProvider");
  return v;
}
