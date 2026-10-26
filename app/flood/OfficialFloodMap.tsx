import { MapPinned } from "lucide-react";
import { floodEventsFor, FLOOD_MAP_HOME, gnCount, mappedNear, type FloodEvent } from "@/lib/floodMap";
import { ftFor, type FT } from "@/lib/i18n/floodMap";
import { riverName } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";

/** Most divisions listed on a town page; the rest are counted. */
const MAX_GN = 8;
/** Most divisional-secretariat areas named per event on a river page. */
const MAX_DSD = 8;

/** "2016 major flood" (the grade only where the map names one). */
function eventLabel(e: FloodEvent, ft: FT) {
  const year = ft("ev", { year: e.year });
  const g = e.grade ? ft(`grade.${e.grade}` as Parameters<FT>[0]) : null;
  return g && !g.startsWith("grade.") ? `${year} ${g}` : year;
}

/** "Kelani Ganga 2016 major flood, 1989 critical flood" (newest first, one river name per river). */
function eventsLabel(events: FloodEvent[], ft: FT, lang: Locale) {
  const byRiver = new Map<string, FloodEvent[]>();
  for (const e of events) byRiver.set(e.basin, [...(byRiver.get(e.basin) ?? []), e]);
  return [...byRiver].map(([b, evs]) => ft("ev.river", { river: riverName(b, lang), year: evs.map((e) => eventLabel(e, ft)).join(", ") })).join("; ");
}

function Card({ ft, children }: { ft: FT; children: React.ReactNode }) {
  return (
    <section aria-labelledby="flood-map-h" className="mt-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 sm:p-5">
      <h2 id="flood-map-h" className="flex items-center gap-2 font-semibold tracking-tight">
        <MapPinned className="size-4 text-sky-600 dark:text-sky-400" aria-hidden />
        {ft("title")}
      </h2>
      {children}
      <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">{ft("note")}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        <a href={FLOOD_MAP_HOME} className="hover:underline" rel="noopener">{ft("credit")}</a>
      </p>
    </section>
  );
}

/**
 * Town page: the Grama Niladhari divisions around the town that the Irrigation Department mapped as flooded in a past flood.
 * With none nearby, one line saying so, but only when the town's own river has a mapped flood (otherwise nothing is known).
 */
export function TownFloodMap({ lang, town, lat, lon, basin }: { lang: Locale; town: string; lat: number; lon: number; basin: string | null }) {
  const ft = ftFor(lang);
  const near = mappedNear(lat, lon);
  if (!near.length) {
    const evs = basin ? floodEventsFor(basin) : [];
    if (!basin || !evs.length) return null;
    return (
      <Card ft={ft}>
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
          {ft("town.none", { town, river: riverName(basin, lang), events: evs.map((e) => eventLabel(e, ft)).join(", ") })}
        </p>
      </Card>
    );
  }
  const events = [...new Map(near.flatMap((g) => g.events).map((e) => [e.id, e])).values()].sort((a, z) => z.year - a.year);
  const manyRivers = new Set(events.map((e) => e.basin)).size > 1;
  const shown = near.slice(0, MAX_GN);
  return (
    <Card ft={ft}>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
        {ft("town.lead", { town, events: eventsLabel(events, ft, lang) })}
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {shown.map((g) => (
          <li key={`${g.name}|${g.dsd}`} className="inline-flex flex-wrap items-baseline gap-x-1.5 rounded-2xl border border-slate-200 dark:border-slate-700 px-3 py-1 text-sm">
            <span>{g.name}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {g.events.map((e) => (manyRivers ? `${riverName(e.basin, lang)} ${e.year}` : e.year)).join(", ")}
            </span>
          </li>
        ))}
        {near.length > shown.length && (
          <li className="inline-flex items-center px-1 text-sm text-slate-500 dark:text-slate-400">{ft("town.more", { n: near.length - shown.length })}</li>
        )}
      </ul>
    </Card>
  );
}

/** River page: each mapped past flood on this river with the divisional-secretariat areas it reached. */
export function RiverFloodMap({ lang, basin }: { lang: Locale; basin: string }) {
  const evs = floodEventsFor(basin);
  if (!evs.length) return null;
  const ft = ftFor(lang);
  return (
    <Card ft={ft}>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{ft("river.lead", { river: riverName(basin, lang) })}</p>
      <ul className="mt-2 space-y-2">
        {evs.map((e) => {
          const names = e.dsds.slice(0, MAX_DSD).map(([d]) => d);
          const more = e.dsds.length - names.length;
          const dsds = names.join(", ") + (more > 0 ? `, ${ft("river.more", { n: more })}` : "");
          return (
            <li key={e.id} className="text-sm">
              <span className="font-medium">{eventLabel(e, ft)}</span>
              <span className="text-slate-600 dark:text-slate-400">: {ft("river.event", { n: gnCount(e), m: e.dsds.length, dsds })}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
