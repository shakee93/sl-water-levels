import Link from "next/link";
import { MapPin } from "lucide-react";
import { PLACES } from "@/lib/places";
import { getI18n } from "@/lib/i18n/server";
import { ttFor } from "@/lib/i18n/town";
import type { Locale } from "@/lib/i18n/config";

const MAX = 24;

/** Station page: the towns whose flood estimate is based on this gauge, as links. Nothing to show = nothing rendered. */
export function TownsOnGauge({ lang, station }: { lang: Locale; station: string }) {
  const { p } = getI18n(lang);
  const tt = ttFor(lang);
  const main = PLACES.filter((x) => x.stations[0] === station);
  const list = (main.length ? main : PLACES.filter((x) => x.stations.includes(station))).slice(0, MAX);
  if (list.length === 0) return null;
  return (
    <section className="mt-8" aria-label={tt("sec.towns")}>
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
        <MapPin className="size-4" aria-hidden /> {tt("sec.towns")}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {list.map((x) => (
          <li key={x.slug}>
            <Link
              href={p(`/flood/${x.slug}`)}
              className="inline-flex items-center min-h-11 sm:min-h-9 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm hover:border-sky-300 dark:hover:border-sky-700 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              {x.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
