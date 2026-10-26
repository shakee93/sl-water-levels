import { SpillWarningNote } from "@/app/SpillWarningNote";
import { ClampedText } from "@/app/ClampedText";
import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, ChevronRight, Clock, TriangleAlert } from "lucide-react";
import { fetchBasinSnapshot, fetchStations, type Station, type Tier } from "@/lib/arcgis";
import { getOfficialWarnings, warningsForBasin } from "@/lib/warnings";
import { stationDisplayName } from "@/lib/displayName";
import { orderStations } from "@/lib/basinOrder";
import { resolveBasin, stationPath } from "@/lib/slug";
import { RiverGauges } from "@/app/RiverGauges";
import { RiverRain } from "@/app/RiverRain";
import { RainMapLink } from "@/app/rain/RainMapLink";
import { TimeAgo } from "@/app/TimeAgo";
import { colomboTime, tierLabel, tierRank } from "@/app/tierUi";
import { StickyContext } from "@/app/StickyContext";
import { BasinDams } from "@/app/BasinDams";
import { InTheNews } from "@/app/InTheNews";
import { ReleaseCard } from "@/app/ReleaseCard";
import { RiverMap } from "@/app/RiverMap";
import { RiverReservoirs } from "@/app/reservoirs/RiverReservoirs";
import { FloodHistoryCard } from "@/app/history/FloodHistoryCard";
import { RiverFloodMap } from "@/app/flood/OfficialFloodMap";
import { AnswerLine, JsonLd } from "@/app/Answer";
import { NextHourFaq } from "@/app/NextHour";
import { riverAnswer, riverFaq } from "@/lib/answers";
import { breadcrumbLd, webPageLd } from "@/lib/seo";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { riverName } from "@/lib/i18n/format";
import type { TFn } from "@/lib/i18n/translate";

const nowMs = () => Date.now();

import { SITE } from "@/lib/seo";

const TIER_RANK: Record<Tier, number> = {
  major: 6, minor: 5, alert: 4, watch: 3, normal: 2, none: 1, stale: 0,
};

/** Worst current tier across a basin's gauges, as a short phrase; null if unknown. */
async function worstStatus(basin: string, t: TFn): Promise<string | null> {
  try {
    const snap = await fetchBasinSnapshot(basin);
    if (!snap.length) return null;
    const worst = snap.reduce((a, b) => (TIER_RANK[b.tier] > TIER_RANK[a.tier] ? b : a));
    return t(`phrase.${worst.tier}` as "phrase.alert");
  } catch {
    return null;
  }
}

function joinNames(names: string[], and: string): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} ${and} ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
}

// Rendered per request (see `await connection()` in the page) and cached by the CDN for 60 s with a
// 5 min stale window (proxy.ts sets the header), not prerendered and not ISR: an ISR render waits for
// every Suspense boundary before sending a byte, while a dynamic render sends the heading and the
// answer as soon as the station list and gauge snapshot are in and streams the rest. Nothing is
// prerendered at build, so a deploy never depends on ArcGIS, Google Sheets or the Mahaweli/DMC servers.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; river: string }>;
}): Promise<Metadata> {
  const { lang, river } = await params;
  if (!isLocale(lang)) return {};
  const { t } = getI18n(lang);

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
  const worst = await worstStatus(basin, t);
  const rn = riverName(basin, lang);
  const title = t("river.metaTitle", { river: rn });
  const description = t("river.metaDesc", {
    river: rn,
    names: joinNames(names, t("list.and")),
    now: worst ? t("river.metaNow", { phrase: worst }) : "",
  });
  const alternates = pageAlternates(lang, `/${river}`);

  return {
    // absolute: the layout template would push this past ~60 characters.
    title: { absolute: title },
    description,
    alternates,
    openGraph: {
      title,
      description,
      url: `${SITE}${alternates.canonical}`,
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
  params: Promise<{ lang: string; river: string }>;
}) {
  await connection();
  const { lang: rawLang, river } = await params;
  if (!isLocale(rawLang)) notFound();
  const lang: Locale = rawLang;
  const { t, p } = getI18n(lang);

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
            <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">
              {t("crumb.allBasins")}
            </Link>
          </nav>
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-200"
          >
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <p>
              {t("river.outage")}
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
  if (onBasin.length === 1) permanentRedirect(p(stationPath(onBasin[0].basin, onBasin[0].station)));

  let snap: Awaited<ReturnType<typeof fetchBasinSnapshot>> = [];
  try {
    snap = orderStations(basin, await fetchBasinSnapshot(basin));
  } catch {
    snap = [];
  }
  const serverNow = nowMs();
  const reporting = snap.filter((s) => s.tier !== "stale" && s.latest);
  // near alert (tier "watch") is Normal: only Alert and above are flagged (owner, 26 Oct 2026)
  const flagged = reporting.filter((s) => ["major", "minor", "alert"].includes(s.tier));
  const worst = reporting.length ? reporting.reduce((a, s) => (tierRank(s.tier) < tierRank(a) ? s.tier : a), reporting[0].tier) : null;
  const newest = snap.reduce<number | null>((m, s) => (s.latest && (m == null || s.latest.ts > m) ? s.latest.ts : m), null);

  let status: React.ReactNode;
  if (snap.length === 0 || newest == null) {
    status = t("river.noReadings");
  } else if (reporting.length === 0) {
    status = (
      <>
        {t("river.delayed")}<TimeAgo ts={newest} serverNow={serverNow} />
      </>
    );
  } else {
    const lead =
      flagged.length > 0
        ? t("river.flagged", { n: flagged.length, m: reporting.length })
        : t("river.allNormal", { n: reporting.length });
    status = (
      <>
        {lead}
        {snap.length > reporting.length ? ` · ${t("river.notReporting", { n: snap.length - reporting.length })}` : ""} · {t("river.updated", { time: colomboTime(newest, t) })}<TimeAgo ts={newest} serverNow={serverNow} />
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

  const answer = snap.length ? riverAnswer(lang, t, basin, snap) : null;
  const mt = lang !== "en" ? t("common.machineTranslated") : undefined;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <JsonLd
          graph={[
            webPageLd({
              lang,
              path: `/${river}`,
              name: t("river.metaTitle", { river: riverName(basin, lang) }),
              description: answer ?? riverName(basin, lang),
              modified: newest,
              speakable: [".answer-line"],
              type: "CollectionPage",
            }),
            breadcrumbLd(
              [
                { name: t("crumb.allBasins"), path: "/" },
                { name: riverName(basin, lang), path: `/${river}` },
              ],
              lang,
            ),
          ]}
        />
        {worst && (
          <StickyContext
            label={t("sticky.label")}
            backLabel={t("sticky.back")}
            crumbs={[{ label: t("crumb.allBasins"), href: p("/") }, { label: riverName(basin, lang) }]}
            pill={{ label: tierLabel(t, worst === "watch" ? "normal" : worst), tier: worst === "watch" ? "normal" : worst }}
            bits={[flagged.length > 0 ? t("sticky.gauges", { n: flagged.length, m: reporting.length }) : t("river.allNormal", { n: reporting.length })]}
          />
        )}
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">
            {t("crumb.allBasins")}
          </Link>{" "}
          <span aria-hidden>›</span> <span className="text-slate-700 dark:text-slate-300">{riverName(basin, lang)}</span>
        </nav>

        <header className="mb-4">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{riverName(basin, lang)}</h1>
          <p className={`mt-1.5 text-sm tabular-nums ${statusTone}`}>{status}</p>
          <p className="sr-only">
            {t("river.srGauges", { n: onBasin.length, names: joinNames(names, t("list.and")) })}
          </p>
          {answer && <AnswerLine text={answer} note={mt} />}
        </header>

        <Suspense key={`warn-${basin}`} fallback={null}>
          <OfficialWarningLine basin={basin} lang={lang} stations={onBasin.map((s) => s.station)} />
        </Suspense>

        <Suspense key={`release-${basin}`} fallback={null}><ReleaseCard lang={lang} basin={basin} /></Suspense>
        <Suspense key={`spillwarn-${basin}`} fallback={null}><SpillWarningNote lang={lang} basin={basin} /></Suspense>

        <Suspense key={`map-${basin}`} fallback={null}><RiverMap lang={lang} basin={basin} jsonLd /></Suspense>

        {snap.length > 0 ? (
          <RiverGauges lang={lang} stations={snap} serverNow={serverNow} />
        ) : (
          <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Clock className="size-4" aria-hidden /> {t("river.unavailable")}
          </p>
        )}

        <Suspense key={`rain-${basin}`} fallback={null}><RiverRain lang={lang} basin={basin} /></Suspense>
        <p className="mt-2"><RainMapLink lang={lang} /></p>

        <Suspense key={`history-${basin}`} fallback={null}>
          <FloodHistoryCard basin={basin} lang={lang} />
        </Suspense>

        <RiverFloodMap lang={lang} basin={basin} />

        <Suspense key={`reservoirs-${basin}`} fallback={null}><RiverReservoirs lang={lang} basin={basin} /></Suspense>

        <Suspense key={`dams-${basin}`} fallback={null}>
          <BasinDams basin={basin} lang={lang} />
        </Suspense>

        <Suspense key={`news-${basin}`} fallback={null}><InTheNews lang={lang} basin={basin} /></Suspense>

        <Link
          href={p("/help")}
          className="mt-8 inline-flex items-center gap-1 min-h-11 text-sm text-slate-500 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 transition"
        >
          {t("common.floodHelpLink")}
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>

        {answer && (
          <Suspense key={`faq-${basin}`} fallback={null}>
            <NextHourFaq
              lang={lang}
              basin={basin}
              build={(m) =>
                riverFaq(lang, basin, answer, names, snap.filter((s) => s.tier !== "stale").map((s) => ({ station: s.station, nh: m?.[s.station] ?? null })))
              }
              note={mt}
            />
          </Suspense>
        )}
      </div>
    </main>
  );
}

/** One compact amber line when a current official bulletin names this basin. Fails soft. */
async function OfficialWarningLine({ basin, lang, stations }: { basin: string; lang: Locale; stations: string[] }) {
  const { t } = getI18n(lang);
  const w = warningsForBasin(await getOfficialWarnings(), basin, stations)[0];
  if (!w) return null;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
      <TriangleAlert className="size-4 mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <ClampedText
          footer={
            <a
              href={w.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 inline-flex items-center min-h-11 sm:min-h-6 whitespace-nowrap"
            >
              {w.source}
            </a>
          }
        >
          {w.summary}{lang !== "en" && <span className="text-amber-800/80 dark:text-amber-300/80"> {t("common.englishNote")}</span>}
        </ClampedText>
      </div>
    </div>
  );
}
