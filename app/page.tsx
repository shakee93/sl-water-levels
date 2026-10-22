import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Clock, LifeBuoy } from "lucide-react";
import { getNational, fetchStations, type NationalStation } from "@/lib/arcgis";
import { basinPath } from "@/lib/slug";
import { stationDisplayName } from "@/lib/displayName";
import { formatLevel } from "@/lib/units";
import { PlaceSearch } from "./PlaceSearch";
import { getSearchStations } from "./PlaceSearchData";
import { SriLankaMap } from "./SriLankaMap";
import { NeedsAttention } from "./NeedsAttention";
import { Favourites } from "./Favourites";
import { NearYou } from "./NearYou";
import { LegacyRedirect } from "./LegacyRedirect";
import { TimeAgo } from "./TimeAgo";
import {
  TIER_DOT,
  TIER_TEXT,
  colomboTime,
  tierRank,
  type HomeStation,
} from "./tierUi";

// No cookies()/searchParams on the server, so the page is ISR-cached.
export const revalidate = 60;

const SITE = "https://sl-water-levels.vercel.app";
const nowMs = () => Date.now();
const STALE_MS = 3 * 3_600_000;

export const metadata: Metadata = {
  title: { absolute: "Sri Lanka Water Levels Today – Live River Gauges & Flood Levels" },
  description:
    "Latest water-level readings for every river gauge in Sri Lanka, grouped by basin. Tap a station for flood thresholds, next-hour forecast, upstream stations, and connected dams.",
  alternates: { canonical: "/" },
};

function compact(s: NationalStation): HomeStation {
  return {
    station: s.station,
    basin: s.basin.trim(),
    latitude: s.latitude,
    longitude: s.longitude,
    href: s.href,
    tier: s.tier,
    level: s.latest?.water_level ?? null,
    unit: s.unit,
    ts: s.latest?.ts ?? null,
    rate3hM: s.rate3hM,
  };
}

export default async function Home() {
  const serverNow = nowMs();
  let national: NationalStation[] | null = null;
  let stationsError: string | null = null;
  try {
    national = await getNational();
  } catch (err) {
    // Fall back to the plain station list so the page still works without levels.
    try {
      await fetchStations();
    } catch {
      stationsError = err instanceof Error ? err.message : "Could not load stations";
    }
  }

  const home = national ? national.map(compact) : [];

  const grouped = (() => {
    const m = new Map<string, HomeStation[]>();
    for (const s of home) {
      const b = s.basin || "(no basin)";
      if (!m.has(b)) m.set(b, []);
      m.get(b)!.push(s);
    }
    return [...m.entries()]
      .map(([basin, list]) => {
        // Worst first, so the gauge that matters leads each river.
        const sorted = [...list].sort(
          (a, b) => tierRank(a.tier) - tierRank(b.tier) || a.station.localeCompare(b.station),
        );
        return [basin, sorted] as const;
      })
      .sort(([a], [b]) => a.localeCompare(b));
  })();

  const hrefByStation = Object.fromEntries(home.map((s) => [s.station, s.href]));

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "Sri Lanka Water Levels",
              url: SITE,
              description:
                "Latest Sri Lanka river-gauge readings + next-hour flood forecast.",
            }),
          }}
        />
        <LegacyRedirect hrefByStation={hrefByStation} />

        <header className="mb-5 sm:mb-6">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight">
            Sri Lanka Water Levels
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">
            River gauges from the Department of Irrigation.
          </p>
        </header>

        {stationsError ? (
          <ErrorBanner title="Could not load stations" detail={stationsError} />
        ) : (
          <>
            <PlaceSearch variant="hero" stations={await getSearchStations()} />

            <div className="mb-5 mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
              <NationalLine snapshot={national} serverNow={serverNow} />
              <Link
                href="/help"
                className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition"
              >
                <LifeBuoy className="size-3.5" aria-hidden />
                Flood help &amp; emergency numbers
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            </div>

            <NearYou stations={home} />

            <Favourites stations={home} serverNow={serverNow} />

            <NeedsAttention snapshot={national} serverNow={serverNow} />

            <SriLankaMap stations={home} />

            <section id="rivers" className="scroll-mt-4">
              <h2 className="sr-only">All rivers</h2>
              <ul className="space-y-6">
                {grouped.map(([basin, list]) => (
                  <li key={basin}>
                    <div className="flex items-baseline justify-between gap-3 mb-2">
                      <Link
                        href={list.length === 1 ? list[0].href : basinPath(basin)}
                        className="group inline-flex items-baseline gap-1.5"
                      >
                        <h3 className="text-base sm:text-lg font-semibold tracking-tight group-hover:text-sky-700 dark:group-hover:text-sky-300 transition">
                          {basin}
                        </h3>
                        <ArrowRight className="size-3.5 self-center text-slate-400 group-hover:text-sky-500 transition" aria-hidden />
                      </Link>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        {list.length}
                      </span>
                    </div>
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {list.map((s) => (
                        <li key={s.href}>
                          <Link
                            href={s.href}
                            className="group flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2.5 hover:border-sky-400 dark:hover:border-sky-700 transition"
                          >
                            <span className="flex items-center gap-2.5 min-w-0">
                              <span
                                className={`size-2.5 shrink-0 rounded-full ${TIER_DOT[s.tier]}`}
                                title={TIER_TEXT[s.tier]}
                                aria-hidden
                              />
                              <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                                {stationDisplayName(s.station)}
                              </span>
                              <span className="sr-only">{TIER_TEXT[s.tier]}</span>
                            </span>
                            <span
                              className={`text-sm tabular-nums shrink-0 ${
                                s.tier === "stale"
                                  ? "text-slate-400 dark:text-slate-500"
                                  : "font-medium text-slate-700 dark:text-slate-200"
                              }`}
                            >
                              {formatLevel(s.level, s.unit)}
                            </span>
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


function NationalLine({
  snapshot,
  serverNow,
}: {
  snapshot: NationalStation[] | null;
  serverNow: number;
}) {
  let newest: number | null = null;
  if (snapshot) {
    for (const s of snapshot) {
      const ts = s.latest?.ts;
      if (ts != null && (newest == null || ts > newest)) newest = ts;
    }
  }
  if (!snapshot || newest == null || serverNow - newest > STALE_MS) {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <Clock className="size-3.5" aria-hidden />
        {newest == null ? (
          "Data delayed — no recent readings"
        ) : (
          <>
            Data delayed — last reading{" "}
            <TimeAgo ts={newest} serverNow={serverNow} />
          </>
        )}
      </p>
    );
  }

  let above = 0;
  let near = 0;
  for (const s of snapshot) {
    if (s.tier === "alert" || s.tier === "minor" || s.tier === "major") above++;
    else if (s.tier === "watch") near++;
  }

  const bits: string[] = [];
  if (above) bits.push(`${above} gauge${above === 1 ? "" : "s"} above alert`);
  if (near) bits.push(`${near} near alert`);
  const lead = bits.length ? bits.join(" · ") : "All gauges below alert";

  return (
    <p className="text-xs text-slate-600 dark:text-slate-300">
      <span className="font-medium">{lead}</span>
      <span className="text-slate-500 dark:text-slate-400">
        {" "}· updated {colomboTime(newest)} (<TimeAgo ts={newest} serverNow={serverNow} />)
      </span>
    </p>
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
