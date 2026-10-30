import { CloudRain, Waves } from "lucide-react";
import type { Locale } from "@/lib/i18n/config";
import { ccFor } from "@/lib/i18n/colombo";
import { hmisT } from "@/lib/i18n/hmis";
import { BASINS, basinOfTown, basinState, type BasinId, type BasinStateKey } from "@/lib/colombo";
import { getCanals } from "@/lib/curw";
import { CURW_URL } from "@/lib/curwStatus";
import { getGroundGauges } from "@/lib/groundRainLive";
import { HMIS_CREDIT } from "@/lib/hmisCalc";
import { canalNote, CANAL_NOTE_BASINS, isCalm, rainNote } from "@/lib/lowStreetNotes";
import { soft } from "@/lib/soft";

/**
 * Two short notes under the verdict of a Colombo-area page, so a visitor is not told only "Normal" when the street is wet
 * (decision logic, evidence and thresholds: lib/lowStreetNotes.ts):
 *  - canals around Kolonnawa / north Colombo are higher than usual (our D1 archive of CUrW / SLLDC canal levels, credited with a plain link);
 *  - a live HMIS rain gauge within 7 km measured a modest amount in the last 1-3 hours (credited as everywhere else).
 * NOTES ONLY: they never change the verdict, tone, sticky bar, push, an official step or the forecast. Server only, existing caches only (getCanals,
 * getGroundGauges), time-boxed, fail soft: missing data = no note. `tone` is the OFFICIAL tone the page already shows; only normal / watch show notes.
 * Where: the Nagalagam Street gauge page and town pages of the four Colombo canal basins (the canal note only for the Kolonnawa and North basins).
 */
export async function StreetNotes({ lang, tone, lat, lon, slug, station }: { lang: Locale; tone: string | null | undefined; lat: number; lon: number; slug?: string; station?: string }) {
  if (!isCalm(tone)) return null;
  // which basins this page belongs to (Nagalagam Street is the Kelani outfall of the north canals and sits next to the Kolonnawa basin)
  const basins: BasinId[] = station === "Nagalagam Street" ? ["kolonnawa", "north"] : slug ? ([basinOfTown(slug)?.id].filter(Boolean) as BasinId[]) : [];
  if (!basins.length) return null;
  const wantCanal = basins.some((b) => CANAL_NOTE_BASINS.includes(b));
  const now = Date.now();
  const [canals, gauges] = await Promise.all([
    wantCanal ? getCanals() : Promise.resolve(null),
    soft(getGroundGauges(now), 2000, []),
  ]);
  const states: Partial<Record<BasinId, BasinStateKey>> = {};
  if (canals) for (const b of BASINS) if (basins.includes(b.id)) states[b.id] = basinState(b, canals.gauges);
  const canal = canalNote(tone, states, basins);
  const rain = rainNote(tone, { lat, lon }, gauges, now);
  if (!canal && !rain) return null;
  const cc = ccFor(lang);
  const h = hmisT(lang);
  const draft = lang !== "en" ? (lang === "si" ? " (කෙටුම්පත් පරිවර්තනය)" : " (வரைவு மொழிபெயர்ப்பு)") : "";
  return (
    <section lang={lang} aria-label={lang === "en" ? "Low streets" : undefined} data-testid="street-notes" className="mt-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-3 text-sm text-slate-700 dark:text-slate-300">
      {canal && (
        <p className="flex items-start gap-2" data-testid="canal-note">
          <Waves className="size-4 mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
          <span>
            <span className="font-medium text-slate-900 dark:text-slate-100">{cc(canal === "kolonnawa" ? "note.canalKolonnawa" : "note.canalNorth")}</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              {cc("canal.credit")} · <a href={CURW_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:no-underline">{cc("canal.chart")}</a>
            </span>
          </span>
        </p>
      )}
      {rain && (
        <p className={`flex items-start gap-2 ${canal ? "mt-2" : ""}`} data-testid="rain-note">
          <CloudRain className="size-4 mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
          <span>
            <span className="font-medium text-slate-900 dark:text-slate-100">{cc(rain.hours === 3 ? "note.rain3" : "note.rain1", { name: rain.name, km: rain.km.toString(), mm: rain.mm })}</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">{rain.institute ? h("creditWith", { inst: rain.institute }) : HMIS_CREDIT}.</span>
          </span>
        </p>
      )}
      {draft && <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{draft.trim()}</span>}
    </section>
  );
}
