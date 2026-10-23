import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { ArrowRight, Clock, LifeBuoy } from "lucide-react";
import { getNational, fetchStations, type NationalStation } from "@/lib/arcgis";
import { JsonLd } from "../Answer";
import { publisherLd, siteDatasetLd, webPageLd, websiteLd } from "@/lib/seo";
import { PlaceSearch } from "../PlaceSearch";
import { getSearchStations } from "../PlaceSearchData";
import { SriLankaMap } from "../SriLankaMap";
import { NeedsAttention } from "../NeedsAttention";
import { ReleaseLines } from "../ReleaseCard";
import { SpillWatchLine } from "../SpillWatchLine";
import { HowItWorks } from "../HowItWorks";
import { MyPlaces } from "../MyPlaces";
import { NearYou } from "../NearYou";
import { RiverList } from "../RiverList";
import { LegacyRedirect } from "../LegacyRedirect";
import { TimeAgo } from "../TimeAgo";
import {
  colomboTime,
  type HomeStation,
} from "../tierUi";
import { notFound } from "next/navigation";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import type { TFn } from "@/lib/i18n/translate";

// No cookies()/searchParams on the server, so the page is ISR-cached.
export const revalidate = 60;

const SITE = "https://sl-water-levels.vercel.app";
const nowMs = () => Date.now();
const STALE_MS = 3 * 3_600_000;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const { t } = getI18n(lang);
  const alternates = pageAlternates(lang, "/");
  return {
    title: { absolute: t("home.metaTitle") },
    description: t("home.metaDesc"),
    alternates: { ...alternates, types: { "application/atom+xml": `${SITE}/feed.xml` } },
    openGraph: { title: t("home.metaTitle"), description: t("home.ogDesc"), url: `${SITE}${alternates.canonical}`, type: "website", siteName: t("site.name") },
  };
}

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

export default async function Home({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  if (!isLocale(raw)) notFound();
  const lang: Locale = raw;
  const { t, p } = getI18n(lang);
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
      stationsError = err instanceof Error ? err.message : t("err.stationsTitle");
    }
  }

  const home = national ? national.map(compact) : [];

  const hrefByStation = Object.fromEntries(home.map((s) => [s.station, s.href]));

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <JsonLd
          graph={[
            websiteLd(lang, t("home.ldDesc")),
            publisherLd(),
            webPageLd({ lang, path: "/", name: t("home.metaTitle"), description: t("home.metaDesc"), modified: national?.reduce<number | null>((m, x) => (x.latest && (m == null || x.latest.ts > m) ? x.latest.ts : m), null) }),
            siteDatasetLd(),
          ]}
        />
        <LegacyRedirect hrefByStation={hrefByStation} />

        <header className="mb-5 sm:mb-6">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight">
            {t("home.h1")}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">
            {t("home.subtitle")}
          </p>
        </header>

        {stationsError ? (
          <ErrorBanner t={t} title={t("err.stationsTitle")} detail={stationsError} />
        ) : (
          <>
            <PlaceSearch variant="hero" stations={await getSearchStations()} />

            <div className="mb-5 mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
              <NationalLine t={t} snapshot={national} serverNow={serverNow} />
              <Link
                href={p("/help")}
                className="inline-flex items-center gap-1 text-sm py-2.5 -my-2.5 text-slate-500 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition"
              >
                <LifeBuoy className="size-3.5" aria-hidden />
                {t("common.floodHelpLink")}
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            </div>

            {/* the answer for the places this visitor saved comes first; nothing when none are saved */}
            <MyPlaces stations={home} />

            <NearYou stations={home} />

            <NeedsAttention lang={lang} snapshot={national} serverNow={serverNow} />
            <Suspense fallback={null}><ReleaseLines lang={lang} /></Suspense>
            <Suspense fallback={null}><SpillWatchLine lang={lang} /></Suspense>

            <HowItWorks lang={lang} className="mb-8" />

            <SriLankaMap lang={lang} stations={home} />

            <RiverList lang={lang} stations={home} />
          </>
        )}
        {stationsError && <HowItWorks lang={lang} />}
      </div>
    </main>
  );
}


function NationalLine({
  t,
  snapshot,
  serverNow,
}: {
  t: TFn;
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
          t("nat.delayedNone")
        ) : (
          <>
            {t("nat.delayedLast")}
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
  if (above) bits.push(t(above === 1 ? "nat.aboveOne" : "nat.aboveMany", { n: above }));
  if (near) bits.push(t("nat.nearAlert", { n: near }));
  const lead = bits.length ? bits.join(" · ") : t("nat.allBelow");

  return (
    <p className="text-xs text-slate-600 dark:text-slate-300">
      <span className="font-medium">{lead}</span>
      <span className="text-slate-500 dark:text-slate-400">
        {" "}· {t("nat.updated", { time: colomboTime(newest, t) })} (<TimeAgo ts={newest} serverNow={serverNow} />)
      </span>
    </p>
  );
}

function ErrorBanner({ t, title, detail }: { t: TFn; title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-sm">
      <div className="font-semibold text-red-800 dark:text-red-300">{title}</div>
      <div className="mt-1 text-red-700 dark:text-red-400 font-mono text-xs break-all">
        {detail}
      </div>
      <p className="mt-2 text-red-700/80 dark:text-red-400/80">
        {t("err.stationsHelp")}
      </p>
    </div>
  );
}
