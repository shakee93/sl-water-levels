import Link from "next/link";
import { fetchStations, type Station } from "@/lib/arcgis";
import { basinPath } from "@/lib/slug";

export async function Footer() {
  let stations: Station[] = [];
  try {
    stations = await fetchStations();
  } catch {
    /* degrade gracefully */
  }

  const basins = (() => {
    const set = new Set<string>();
    for (const s of stations) if (s.basin) set.add(s.basin);
    return [...set].sort();
  })();

  const year = new Date().getFullYear();

  return (
    <footer className="mt-12 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <div className="space-y-2">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">
            Sri Lanka Water Levels
          </h3>
          <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
            Live river-gauge readings and next-hour flood forecasts for every
            basin in Sri Lanka, updated every minute.
          </p>
        </div>

        <div className="space-y-2">
          <h4 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 font-medium">
            Basins
          </h4>
          <ul className="space-y-1 max-h-44 overflow-y-auto pr-2">
            {basins.length === 0 ? (
              <li className="text-slate-400 dark:text-slate-500 text-xs">
                Loading…
              </li>
            ) : (
              basins.map((b) => (
                <li key={b}>
                  <Link
                    href={basinPath(b)}
                    className="text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition"
                  >
                    {b}
                  </Link>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="space-y-2">
          <h4 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 font-medium">
            Site
          </h4>
          <ul className="space-y-1">
            <li>
              <Link
                href="/"
                className="text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition"
              >
                All basins & stations
              </Link>
            </li>
            <li>
              <Link
                href="/about"
                className="text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition"
              >
                About & methodology
              </Link>
            </li>
            <li>
              <a
                href="https://github.com/shakee93/sl-water-levels"
                target="_blank"
                rel="noreferrer"
                className="text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition"
              >
                Source on GitHub
              </a>
            </li>
          </ul>
        </div>

        <div className="space-y-2">
          <h4 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 font-medium">
            Data
          </h4>
          <p className="text-slate-500 dark:text-slate-400 leading-relaxed text-xs">
            Readings sourced from the{" "}
            <a
              className="underline decoration-slate-400/40 hover:text-slate-700 dark:hover:text-slate-200"
              href="https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services/gauges_2_view/FeatureServer/0"
              target="_blank"
              rel="noreferrer"
            >
              Sri Lanka Department of Irrigation
            </a>{" "}
            ArcGIS feature service.
          </p>
          <p className="text-slate-500 dark:text-slate-400 leading-relaxed text-xs">
            Not an official flood-warning service — use for situational
            awareness only.
          </p>
        </div>
      </div>

      <div className="border-t border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <p>© {year} Sri Lanka Water Levels. Built in Sri Lanka.</p>
          <p className="tabular-nums">
            Auto-refreshes every 60s · cached server-side
          </p>
        </div>
      </div>
    </footer>
  );
}
