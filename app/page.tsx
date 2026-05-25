import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight, MapPin } from "lucide-react";
import { fetchStations, type Station } from "@/lib/arcgis";
import { basinPath, stationPath } from "@/lib/slug";
import { orderStations } from "@/lib/basinOrder";
import { StationFinder } from "./StationFinder";
import { SriLankaMap } from "./SriLankaMap";

export const revalidate = 300;

const STATION_COOKIE = "sl_station";
const SITE = "https://sl-water-levels.vercel.app";

export const metadata: Metadata = {
  title: "Sri Lanka Water Levels — Every River Gauge, Live",
  description:
    "Live water-level readings for every river gauge in Sri Lanka, grouped by basin. Tap a station for thresholds, next-hour forecast, upstream stations, and connected dams.",
  alternates: { canonical: "/" },
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ station?: string; days?: string }>;
}) {
  const { station: legacyStation, days: legacyDays } = await searchParams;

  let stations: Station[] = [];
  let stationsError: string | null = null;
  try {
    stations = await fetchStations();
  } catch (err) {
    stationsError = err instanceof Error ? err.message : "Could not load stations";
  }

  // Backwards compat: redirect /?station=X[&days=Y] to /:river/:station[?days=Y].
  if (legacyStation && !stationsError) {
    const hit = stations.find((s) => s.station === legacyStation);
    if (hit) {
      const qs = legacyDays ? `?days=${encodeURIComponent(legacyDays)}` : "";
      redirect(`${stationPath(hit.basin, hit.station)}${qs}`);
    }
  }

  const cookieStore = await cookies();
  const lastStationName = cookieStore.get(STATION_COOKIE)?.value;
  const resume = lastStationName
    ? stations.find((s) => s.station === lastStationName) ?? null
    : null;

  const grouped = (() => {
    const m = new Map<string, Station[]>();
    for (const s of stations) {
      const b = s.basin || "(no basin)";
      if (!m.has(b)) m.set(b, []);
      m.get(b)!.push(s);
    }
    return [...m.entries()]
      .map(([basin, list]) => [basin, orderStations(basin, list)] as const)
      .sort(([a], [b]) => a.localeCompare(b));
  })();

  const basinCount = grouped.length;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "Sri Lanka Water Levels",
              url: SITE,
              description:
                "Live Sri Lanka river-gauge readings + next-hour flood forecast.",
            }),
          }}
        />

        <header className="mb-6 sm:mb-8">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-sky-700 dark:text-sky-400 font-medium mb-2">
            <span className="size-1.5 rounded-full bg-sky-500 animate-pulse" />
            Realtime
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight">
            Sri Lanka Water Levels
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-prose">
            Live river-gauge readings from the Department of Irrigation, updated every minute.
            Pick a station to see thresholds, next-hour forecast, upstream basin view and connected dams.
          </p>
        </header>

        {stationsError ? (
          <ErrorBanner title="Could not load stations" detail={stationsError} />
        ) : (
          <>
            {resume && (
              <section className="mb-5">
                <Link
                  href={stationPath(resume.basin, resume.station)}
                  className="flex items-center justify-between gap-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/30 px-4 py-3 hover:border-sky-400 dark:hover:border-sky-700 transition"
                >
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-sky-700 dark:text-sky-400 font-medium">
                      Resume
                    </div>
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {resume.station}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {resume.basin}
                    </div>
                  </div>
                  <ArrowRight className="size-4 text-sky-500 shrink-0" />
                </Link>
              </section>
            )}

            <section className="mb-5 flex flex-wrap items-center gap-3 text-xs">
              <StationFinder stations={stations} />
            </section>

            <SriLankaMap stations={stations} />

            <section>
              <h2 className="sr-only">River basins</h2>
              <ul className="space-y-6">
                {grouped.map(([basin, list]) => (
                  <li key={basin}>
                    <div className="flex items-baseline justify-between gap-3 mb-2">
                      <Link
                        href={basinPath(basin)}
                        className="group inline-flex items-baseline gap-1.5"
                      >
                        <h3 className="text-base sm:text-lg font-semibold tracking-tight group-hover:text-sky-700 dark:group-hover:text-sky-300 transition">
                          {basin}
                        </h3>
                        <span className="text-[10px] uppercase tracking-wider text-slate-400 group-hover:text-sky-500 transition">
                          overview →
                        </span>
                      </Link>
                      <span className="text-[11px] text-slate-400 tabular-nums">
                        {list.length} station{list.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {list.map((s) => (
                        <li key={`${s.basin}|${s.station}`}>
                          <Link
                            href={stationPath(s.basin, s.station)}
                            className="group flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2.5 hover:border-sky-400 dark:hover:border-sky-700 transition"
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <MapPin className="size-3.5 text-slate-400 group-hover:text-sky-500 transition shrink-0" />
                              <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                                {s.station}
                              </span>
                            </span>
                            <ArrowRight className="size-3.5 text-slate-400 group-hover:text-sky-500 transition shrink-0" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function ErrorBanner({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-sm">
      <div className="font-semibold text-red-800 dark:text-red-300">{title}</div>
      <div className="mt-1 text-red-700 dark:text-red-400 font-mono text-xs break-all">
        {detail}
      </div>
      <p className="mt-2 text-red-700/80 dark:text-red-400/80">
        The source feature service may be rate-limited or temporarily down. Refresh in a minute.
      </p>
    </div>
  );
}
