import Link from "next/link";
import { ArrowRight, Compass, MapPin } from "lucide-react";
import { fetchStations, type Station } from "@/lib/arcgis";
import { basinPath, stationPath } from "@/lib/slug";
import { orderStations } from "@/lib/basinOrder";

export const revalidate = 3600;

export default async function NotFound() {
  let stations: Station[] = [];
  try {
    stations = await fetchStations();
  } catch {
    /* show static fallback */
  }

  const basins = (() => {
    const set = new Set<string>();
    for (const s of stations) if (s.basin) set.add(s.basin);
    return [...set].sort();
  })();

  const popularStations = [
    "Nagalagam Street",
    "Hanwella",
    "Glencourse",
    "Peradeniya",
    "Rathnapura",
    "Pitabeddara",
  ]
    .map((name) => stations.find((s) => s.station === name))
    .filter((s): s is Station => Boolean(s))
    .slice(0, 6);

  const fallback = popularStations.length > 0
    ? popularStations
    : orderStations("Kelani Ganga", stations.filter((s) => s.basin === "Kelani Ganga")).slice(0, 6);

  return (
    <main className="bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-sky-700 dark:text-sky-400 font-medium mb-2">
          <Compass className="size-3.5" />
          404
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
          That river isn&apos;t on our map.
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mt-2 max-w-prose">
          The page you were looking for doesn&apos;t exist — the station may
          have been renamed in the source feed, or the URL was mistyped. Try
          one of the basins or popular stations below.
        </p>

        <section className="mt-8">
          <h2 className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 font-medium">
            Popular stations
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {fallback.map((s) => (
              <li key={`${s.basin}|${s.station}`}>
                <Link
                  href={stationPath(s.basin, s.station)}
                  className="group flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2.5 hover:border-sky-400 dark:hover:border-sky-700 transition"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <MapPin className="size-3.5 text-slate-400 group-hover:text-sky-500 transition shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">
                        {s.station}
                      </span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {s.basin}
                      </span>
                    </span>
                  </span>
                  <ArrowRight className="size-3.5 text-slate-400 group-hover:text-sky-500 transition shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {basins.length > 0 && (
          <section className="mt-6">
            <h2 className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 font-medium">
              All basins
            </h2>
            <div className="flex flex-wrap gap-2">
              {basins.map((b) => (
                <Link
                  key={b}
                  href={basinPath(b)}
                  className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1 text-xs text-slate-700 dark:text-slate-300 hover:border-sky-400 dark:hover:border-sky-700 transition"
                >
                  {b}
                </Link>
              ))}
            </div>
          </section>
        )}

        <div className="mt-10 text-sm">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sky-700 dark:text-sky-300 hover:underline"
          >
            ← Back to all stations
          </Link>
        </div>
      </div>
    </main>
  );
}
