"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { writeLowSpot } from "@/lib/lowSpots";
import { ttFor } from "@/lib/i18n/town";
import { ccFor } from "@/lib/i18n/colombo";
import { highTideWithin } from "@/lib/tide";
import { clock } from "@/lib/i18n/format";
import { useI18n } from "../LocaleProvider";
import { useLowSpot } from "./useLowSpot";
import { StreetResearchLink } from "./StreetResearchLink";

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";
const btn = `inline-flex min-h-11 items-center rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`;

/**
 * "Low ground near the canals": a small, neutral info panel on canal towns (never a verdict, badge or colour state, and not
 * on the index, the social image, the APIs or X). Heavy rain is stated as a plain fact with how past events went; the
 * visitor whose own spot is low can switch on a personal, quiet note (lib/lowSpots.ts), off for everyone by default.
 */
export function LowSpot({ slug, town, mm, level, canalHigh = false }: { slug: string; town: string; /** clipped 24 h satellite rain, null = no data */ mm: number | null; level: "possible" | "likely" | null; /** the basin's canal is higher than usual (CUrW / SLLDC levels); only spoken to people who opted in */ canalHigh?: boolean }) {
  const { lang, t } = useI18n();
  const cc = ccFor(lang);
  const tt = ttFor(lang);
  const on = useLowSpot(slug);
  const heavy = mm != null && level != null;
  // below the heavy-rain mark and not opted in: one muted line, nothing else
  if (!heavy && !on) {
    return (
      <section aria-label={tt("low.title")} className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-sm text-slate-500 dark:text-slate-400" lang={lang}>
        <span>{tt("low.invite")}</span>
        <button type="button" onClick={() => writeLowSpot(slug, true)} className={`min-h-11 rounded-md px-2 font-medium text-sky-700 dark:text-sky-300 underline underline-offset-2 hover:no-underline ${ring}`}>
          {tt("low.tell")}
        </button>
      </section>
    );
  }
  return (
    <section aria-label={tt("low.title")} className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-4 sm:p-5" lang={lang}>
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
        <Info className="size-4" aria-hidden /> {tt("low.title")}
      </h2>
      {heavy && <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-300">{tt("low.info", { mm: Math.round(mm!) })}</p>}
      {on ? (
        <div className="mt-2.5" role="status">
          <p className="text-sm text-slate-700 dark:text-slate-300">{tt("low.on")}</p>
          {heavy ? (
            <p className="mt-1.5 text-sm font-medium text-slate-900 dark:text-slate-100">{tt(level === "likely" ? "low.likely" : "low.possible")}</p>
          ) : mm == null ? (
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{tt("low.noData")}</p>
          ) : (
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{tt("low.none", { mm: Math.round(mm) })}</p>
          )}
          <TideNote lang={lang} t={t} cc={cc} />
          {canalHigh && <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-300">{cc("canal.highLow")}</p>}
          <button type="button" onClick={() => writeLowSpot(slug, false)} className={`mt-2 ${btn}`}>{tt("low.off")}</button>
        </div>
      ) : (
        <div className="mt-2.5">
          <button type="button" onClick={() => writeLowSpot(slug, true)} className={btn}>{tt("low.tell")}</button>
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{tt("low.help", { town })}</p>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{tt("low.honest")}</p>
      <div className="text-xs text-slate-600 dark:text-slate-400"><StreetResearchLink /></div>
    </section>
  );
}

/** Opt-in only: a high tide in the next 6 hours makes heavy rain more likely to leave water in low spots. Computed in the browser from the tide model. */
function TideNote({ t, cc }: { lang: string; t: ReturnType<typeof useI18n>["t"]; cc: ReturnType<typeof ccFor> }) {
  const [now, setNow] = useState<number | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only state (the clock), read after hydration
  useEffect(() => setNow(Date.now()), []);
  const h = now == null ? null : highTideWithin(now, 6);
  if (!h) return null;
  return <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-300">{cc("low.tideSoon", { time: clock(h.t, t) })}</p>;
}
