import { Suspense } from "react";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, ChevronRight, Clock, TriangleAlert } from "lucide-react";
import { fetchBasinSnapshot, fetchStations, type Station, type Tier } from "@/lib/arcgis";
import { getOfficialWarnings, warningsForBasin } from "@/lib/warnings";
import { stationDisplayName } from "@/lib/displayName";
import { orderStations } from "@/lib/basinOrder";
import { basinSlug, resolveBasin, stationPath } from "@/lib/slug";
import { RiverGauges } from "../RiverGauges";
import { TimeAgo } from "../TimeAgo";
import { colomboTime } from "../tierUi";
import { BasinDams } from "../BasinDams";

export const revalidate = 60;

const nowMs = () => Date.now();

const SITE = "https://sl-water-levels.vercel.app";

const TIER_RANK: Record<Tier, number> = {
  major: 6, minor: 5, alert: 4, watch: 3, normal: 2, none: 1, stale: 0,
};
const TIER_PHRASE: Record<Tier, string> = {
  major: "major flood level",
  minor: "minor flood level",
  alert: "alert level",
  watch: "approaching alert level",
  normal: "normal",
  none: "no flood levels published",
  stale: "no recent readings",
};

/** Worst current tier across a basin's gauges, as a short phrase; null if unknown. */
async function worstStatus(basin: string): Promise<string | null> {
  try {
    const snap = await fetchBasinSnapshot(basin);
    if (!snap.length) return null;
    const worst = snap.reduce((a, b) => (TIER_RANK[b.tier] > TIER_RANK[a.tier] ? b : a));
    return TIER_PHRASE[worst.tier];
  } catch {
    return null;
  }
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export async function generateStaticParams() {
  let stations: Station[] = [];
  try {
    stations = await fetchStations();
  } catch {
    return [];
  }
  const slugs = new Set<string>();
  for (const s of stations) {
    const slug = basinSlug(s.basin);
    if (slug) slugs.add(slug);
  }
  return [...slugs].map((river) => ({ river }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ river: string }>;
}): Promise<Metadata> {
  const { river } = await params;

  let stations: Station[] = [];
  try {
    stations = await fetchStations();
  } catch {
    return {};
  }
  const basin = resolveBasin(stations, river);
  if (!basin) return {};

  const onBasin = orderStations(
    basin,
    stations.filter((s) => s.basin === basin),
  );
  const names = onBasin.map((s) => stationDisplayName(s.station));
  const worst = await worstStatus(basin);
  const title = `${basin} Water Level Today – Live Gauges & Flood Alerts`;
  const description = `${basin} water level today: ${joinNames(names)} gauges, upstream to downstream.${
    worst ? ` Now: ${worst}.` : ""
  } Flood thresholds and forecast, updated hourly.`;

  return {
    // absolute: the layout template would push this past ~60 characters.
    title: { absolute: title },
    description,
    alternates: { canonical: `/${river}` },
    openGraph: {
      title,
      description,
      url: `${SITE}/${river}`,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function BasinPage({
  params,
}: {
  params: Promise<{ river: string }>;
}) {
  const { river } = await params;

  let stations: Station[] = [];
  let outage = false;
  try {
    stations = await fetchStations();
  } catch {
    outage = true;
  }

  if (outage) {
    // Don't 404 on an upstream outage: the URL is valid, the data is not.
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
          <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            <Link href="/" className="hover:underline">
              All basins
            </Link>
          </nav>
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-200"
          >
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <p>
              The Department of Irrigation gauge feed is not responding right now, so live
              readings for this river cannot be shown. Please try again in a few minutes.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const basin = resolveBasin(stations, river);
  if (!basin) notFound();

  const onBasin = orderStations(
    basin,
    stations.filter((s) => s.basin === basin),
  );
  const names = onBasin.map((s) => stationDisplayName(s.station));

  // A river with one gauge has nothing to list: the station page is the answer.
  if (onBasin.length === 1) permanentRedirect(stationPath(onBasin[0].basin, onBasin[0].station));

  let snap: Awaited<ReturnType<typeof fetchBasinSnapshot>> = [];
  try {
    snap = orderStations(basin, await fetchBasinSnapshot(basin));
  } catch {
    snap = [];
  }
  const serverNow = nowMs();
  const reporting = snap.filter((s) => s.tier !== "stale" && s.latest);
  const flagged = reporting.filter((s) => ["major", "minor", "alert", "watch"].includes(s.tier));
  const newest = snap.reduce<number | null>((m, s) => (s.latest && (m == null || s.latest.ts > m) ? s.latest.ts : m), null);

  let status: React.ReactNode;
  if (snap.length === 0 || newest == null) {
    status = "No readings available right now";
  } else if (reporting.length === 0) {
    status = (
      <>
        Data delayed — last reading <TimeAgo ts={newest} serverNow={serverNow} />
      </>
    );
  } else {
    const lead =
      flagged.length > 0
        ? `${flagged.length} of ${reporting.length} gauges at or near alert`
        : `All ${reporting.length} gauges normal`;
    status = (
      <>
        {lead}
        {snap.length > reporting.length ? ` · ${snap.length - reporting.length} not reporting` : ""} · updated {colomboTime(newest)}, <TimeAgo ts={newest} serverNow={serverNow} />
      </>
    );
  }
  const worstFlagged = flagged.some((s) => ["major", "minor", "alert"].includes(s.tier));
  const statusTone =
    flagged.length === 0
      ? "text-slate-600 dark:text-slate-300"
      : worstFlagged
        ? "text-amber-800 dark:text-amber-300 font-medium"
        : "text-yellow-800 dark:text-yellow-300 font-medium";

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href="/" className="hover:underline">
            All basins
          </Link>{" "}
          <span aria-hidden>›</span> <span className="text-slate-700 dark:text-slate-300">{basin}</span>
        </nav>

        <header className="mb-4">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{basin}</h1>
          <p className={`mt-1.5 text-sm tabular-nums ${statusTone}`}>{status}</p>
          <p className="sr-only">
            {onBasin.length} river gauges, upstream to downstream: {joinNames(names)}.
          </p>
        </header>

        <Suspense key={`warn-${basin}`} fallback={null}>
          <OfficialWarningLine basin={basin} />
        </Suspense>

        {snap.length > 0 ? (
          <RiverGauges stations={snap} serverNow={serverNow} />
        ) : (
          <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Clock className="size-4" aria-hidden /> Gauge readings are unavailable right now.
          </p>
        )}

        <Suspense key={`dams-${basin}`} fallback={null}>
          <BasinDams basin={basin} />
        </Suspense>

        <Link
          href="/help"
          className="mt-8 inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition"
        >
          Flood help &amp; emergency numbers
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </main>
  );
}

/** One compact amber line when a current official bulletin names this basin. Fails soft. */
async function OfficialWarningLine({ basin }: { basin: string }) {
  const w = warningsForBasin(await getOfficialWarnings(), basin)[0];
  if (!w) return null;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
      <TriangleAlert className="size-4 mt-0.5 shrink-0" aria-hidden />
      <p className="min-w-0">
        {w.summary}{" "}
        <a
          href={w.url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 whitespace-nowrap"
        >
          {w.source}
        </a>
      </p>
    </div>
  );
}
