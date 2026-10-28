"use client";
// /flood-survey works anywhere in Sri Lanka (28 Oct 2026). With no ?ll, or an ?ll inside the Kelani corridor, it opens the flood map's survey as before
// (Colombo / the town from ?ll; "I'm here now" starts the pin on the visitor's GPS, and a position outside the map is still accepted). With an ?ll
// elsewhere in Sri Lanka there is no map to show, so it opens the small "Mark your spot" survey there: a base map, the town from ?ll and the same questions.
// The "estimate of river flooding, not an official flood map" note belongs to the map, so it is shown only in map mode.
import { useSyncExternalStore } from "react";
import { MarkSpot } from "@/app/feedback/MarkSpot";
import { fbFor } from "@/lib/i18n/feedback";
import { inCorridor, inSriLanka } from "@/lib/flood3dReports";
import type { Locale } from "@/lib/i18n/config";
import Flood3dMap from "../lab/flood-3d/Flood3dMap";

type Item = { n: string; lat: number; lon: number; al?: string[] };
const subscribe = (cb: () => void) => { window.addEventListener("popstate", cb); return () => window.removeEventListener("popstate", cb); };
const search = () => location.search;

/** ll=lon,lat[,zoom...] as the town pages write it; null when absent or not a number pair. */
export function parseLl(q: string): { lat: number; lon: number } | null {
  const m = /[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(q);
  return m ? { lon: Number(m[1]), lat: Number(m[2]) } : null;
}

export function SurveyEntry({ towns, gauges, lang, lead, leadHere, mapNote }: { towns: Item[]; gauges: Item[]; lang: Locale; lead: string; leadHere: string; mapNote: string }) {
  const q = useSyncExternalStore(subscribe, search, () => "");
  const ll = parseLl(q);
  const elsewhere = ll && inSriLanka(ll.lat, ll.lon) && !inCorridor(ll.lat, ll.lon) ? ll : null;
  return (
    <>
      <p className="mx-auto max-w-3xl px-4 pb-2 text-sm text-slate-600 dark:text-slate-400">{elsewhere ? leadHere : `${lead} ${mapNote}`}</p>
      {elsewhere ? (
        <div className="mx-auto max-w-3xl px-4 pb-8" data-testid="survey-anywhere">
          <div className="rounded-xl border-2 border-sky-300 bg-sky-50/70 px-4 pb-4 dark:border-sky-800 dark:bg-sky-950/30 [&>div]:mt-0 [&>div]:border-t-0">
            <MarkSpot ft={fbFor(lang)} lang={lang} lat={elsewhere.lat} lon={elsewhere.lon} page="survey" target="" startOpen />
          </div>
        </div>
      ) : (
        <Flood3dMap towns={towns} gauges={gauges} lang={lang} survey />
      )}
    </>
  );
}
