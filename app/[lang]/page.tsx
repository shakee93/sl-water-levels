import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Clock, LifeBuoy } from "lucide-react";
import { getNational, fetchStations, type NationalStation } from "@/lib/arcgis";
import { basinPath } from "@/lib/slug";
import { stationDisplayName } from "@/lib/displayName";
import { formatLevel } from "@/lib/units";
import { PlaceSearch } from "../PlaceSearch";
import { getSearchStations } from "../PlaceSearchData";
import { SriLankaMap } from "../SriLankaMap";
import { NeedsAttention } from "../NeedsAttention";
import { Favourites } from "../Favourites";
import { NearYou } from "../NearYou";
import { LegacyRedirect } from "../LegacyRedirect";
import { TimeAgo } from "../TimeAgo";
import {
  TIER_DOT,
  tierLabel,
  colomboTime,
  tierRank,
  type HomeStation,
} from "../tierUi";
import { notFound } from "next/navigation";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { riverName } from "@/lib/i18n/format";
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
    alternates,
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
              name: t("site.name"),
              url: `${SITE}${p("/")}`,
              inLanguage: lang,
              description: t("home.ldDesc"),
            }),
          }}
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
                className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition"
              >
                <LifeBuoy className="size-3.5" aria-hidden />
                {t("common.floodHelpLink")}
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            </div>

            <NearYou stations={home} />

            <Favourites stations={home} serverNow={serverNow} />

            <NeedsAttention lang={lang} snapshot={national} serverNow={serverNow} />

            <SriLankaMap lang={lang} stations={home} />

            <section id="rivers" className="scroll-mt-4">
              <h2 className="sr-only">{t("home.allRivers")}</h2>
              <ul className="space-y-6">
                {grouped.map(([basin, list]) => (
                  <li key={basin}>
                    <div className="flex items-baseline justify-between gap-3 mb-2">
                      <Link
                        href={p(list.length === 1 ? list[0].href : basinPath(basin))}
                        className="group inline-flex items-baseline gap-1.5"
                      >
                        <h3 className="text-base sm:text-lg font-semibold tracking-tight group-hover:text-sky-700 dark:group-hover:text-sky-300 transition">
                          {riverName(basin, lang)}
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
                            href={p(s.href)}
                            className="group flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2.5 hover:border-sky-400 dark:hover:border-sky-700 transition"
                          >
                            <span className="flex items-center gap-2.5 min-w-0">
                              <span
                                className={`size-2.5 shrink-0 rounded-full ${TIER_DOT[s.tier]}`}
                                title={tierLabel(t, s.tier)}
                                aria-hidden
                              />
                              <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                                {stationDisplayName(s.station)}
                              </span>
                              <span className="sr-only">{tierLabel(t, s.tier)}</span>
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
