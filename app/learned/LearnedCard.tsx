import { lnFor } from "@/lib/i18n/learned";
import type { Locale } from "@/lib/i18n/config";
import type { LearnedParams } from "@/lib/learned";
import { streetLevelOf } from "@/lib/learned";
import { K_MIN, MIN_DAYS } from "@/lib/learnedParams.mjs";

/** About page: "What visitors taught us". Counts and numbers only, in plain words. Renders nothing when the file is unavailable. */
export function LearnedCard({ lang, learned }: { lang: Locale; learned: LearnedParams | null }) {
  if (!learned) return null;
  const ln = lnFor(lang);
  const streets = Object.keys(learned.stations).map((g) => ({ g, s: streetLevelOf(learned, g), raw: learned.stations[g].streetLevel })).filter((x) => x.s && x.raw);
  const rains = Object.values(learned.zones).map((z) => z.streetRain).filter((r): r is NonNullable<typeof r> => !!r);
  const fc = learned.forecast?.horizons?.["1"];
  const date = new Date(learned.asOf + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return (
    <article id="learned" className="mt-4 scroll-mt-20 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight mb-3">{ln("ln.h")}</h2>
      <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed" lang={lang}>
        <p>{ln("ln.intro", { k: K_MIN, d: MIN_DAYS })}</p>
        {streets.length + rains.length === 0 && <p>{ln("ln.none", { people: learned.totals.people, k: K_MIN, d: MIN_DAYS })}</p>}
        {(streets.length > 0 || rains.length > 0) && (
          <ul className="list-disc pl-5 space-y-1">
            {streets.map(({ g, s, raw }) => (
              <li key={g}>{ln("ln.street", { gauge: g, ft: s!.ft.toFixed(1), n: s!.n, days: s!.days, def: raw!.defaultFt.toFixed(1) })}</li>
            ))}
            {rains.map((r, i) => (
              <li key={i}>{ln("ln.rain", { mm: r.possibleMm, n: r.n, days: r.days, def: r.defaultMm })}</li>
            ))}
          </ul>
        )}
        {learned.pending.length > 0 && <p>{ln("ln.building", { n: learned.pending.length })}</p>}
        {fc && fc.n > 0 && learned.forecast && !learned.forecast.wired && !learned.forecast.useful && fc.maeBase != null && fc.maeFit != null && <p>{ln("ln.fc", { base: fc.maeBase.toFixed(2), fit: fc.maeFit.toFixed(2) })}</p>}
        <p className="text-xs text-slate-500 dark:text-slate-400">{ln("ln.counts", { date })}</p>
      </div>
    </article>
  );
}
