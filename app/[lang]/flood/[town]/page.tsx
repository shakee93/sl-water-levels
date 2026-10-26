import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { LifeBuoy } from "lucide-react";
import { placeBySlug } from "@/lib/places";
import { loadTown, PAGE_BUDGET_MS } from "@/lib/townData";
import { ttFor } from "@/lib/i18n/town";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { riverName } from "@/lib/i18n/format";
import { stationDisplayName } from "@/lib/displayName";
import { formatKm } from "@/lib/nearby";
import { basinPath } from "@/lib/slug";
import { FloodReport } from "@/app/flood/FloodReport";
import { LowSpot } from "@/app/flood/LowSpot";
import { d1Configured } from "@/lib/d1";
import { MyStreetLevel } from "@/app/flood/MyStreetLevel";
import { TownRain } from "@/app/flood/TownRain";
import { TownVerdict } from "@/app/flood/TownVerdict";
import { AnswerLine, JsonLd } from "@/app/Answer";
import { NextHourFaq } from "@/app/NextHour";
import { townAnswer, townFaq } from "@/lib/answers";
import { assessTown } from "@/lib/townRisk";
import { breadcrumbLd, placeLd, webPageLd } from "@/lib/seo";
import { RiverMap } from "@/app/RiverMap";
import { RiverReservoirs } from "@/app/reservoirs/RiverReservoirs";

// Town pages are rendered per request and CDN-cached for 60 s (proxy.ts), never at build time: a build that had
// to fetch rain, gauges and warnings for 135 towns would depend on every upstream being up, and an ISR render
// would wait for every Suspense boundary before the first byte.
const SITE = "https://sl-water-levels.vercel.app";

type Params = { params: Promise<{ lang: string; town: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { lang, town } = await params;
  const place = placeBySlug(town);
  if (!isLocale(lang) || !place) return {};
  const tt = ttFor(lang);
  const alternates = pageAlternates(lang, `/flood/${place.slug}`);
  const gauge = place.stations[0] ? stationDisplayName(place.stations[0]) : null;
  const title = tt("title", { town: place.name });
  const description = gauge ? tt("desc", { town: place.name, gauge }) : tt("descNoGauge", { town: place.name });
  return {
    title: { absolute: title },
    description,
    alternates,
    openGraph: { title, description, url: `${SITE}${alternates.canonical}`, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function TownPage({ params }: Params) {
  await connection();
  const { lang: rawLang, town } = await params;
  if (!isLocale(rawLang)) notFound();
  const lang: Locale = rawLang;
  const place = placeBySlug(town);
  if (!place) notFound();

  const { t, p } = getI18n(lang);
  const tt = ttFor(lang);
  const data = await loadTown(place, undefined, { budgetMs: PAGE_BUDGET_MS });
  const g = data.gauge;
  const canonical = p(`/flood/${place.slug}`);
  const serverNow = data.input.now;

  // One-sentence answer, from the same estimate the verdict card shows (the visitor's own street level is not part of it).
  const risk = assessTown(data.input, null);
  const toneKey = `tone.${risk.tone}` as Parameters<typeof tt>[0];
  const km = g ? formatKm(g.km, t) : "";
  const answer = townAnswer(lang, t, {
    town: place.name,
    tone: tt(toneKey),
    gauge: g ? { name: g.name, basin: g.basin, km, level: g.level, unit: g.unit, ts: g.ts } : null,
  });
  const mt = lang !== "en" ? t("common.machineTranslated") : undefined;

  const ld = [
    webPageLd({
      lang,
      path: `/flood/${place.slug}`,
      name: tt("title", { town: place.name }),
      description: answer,
      modified: g?.ts ?? serverNow,
      speakable: [".answer-line"],
    }),
    breadcrumbLd(
      [
        { name: t("crumb.home"), path: "/" },
        { name: tt("crumb"), path: "/flood" },
        { name: place.name, path: `/flood/${place.slug}` },
      ],
      lang,
    ),
    placeLd({
      name: place.name,
      url: SITE + canonical,
      lat: place.lat,
      lon: place.lon,
      containedIn: `${place.district} District, Sri Lanka`,
    }),
  ];

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <JsonLd graph={ld} />

        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">{t("crumb.home")}</Link>{" "}
          <span aria-hidden>›</span>{" "}
          <Link href={p("/flood")} className="hover:underline inline-block py-3 -my-3">{tt("crumb")}</Link>{" "}
          <span aria-hidden>›</span>{" "}
          <span className="text-slate-700 dark:text-slate-300">{place.name}</span>
        </nav>

        <header className="mb-4 sm:mb-5">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight">{tt("h1", { town: place.name })}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{place.name === place.district ? place.district : tt("h1sub", { town: place.name, district: place.district })}</p>
          <AnswerLine text={answer} note={mt} />
        </header>

        <TownVerdict
          townName={place.name}
          input={data.input}
          gauge={g && { station: g.station, name: g.name, basin: g.basin, km: g.km, unit: g.unit, thresholds: g.thresholds, level: g.level, ts: g.ts, next24: g.next24 }}
          office={data.office}
          serverNow={serverNow}
          href={canonical}
        />

        {g && (
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
            {tt("sec.based")}:{" "}
            <Link href={p(g.href)} className="text-sky-700 dark:text-sky-300 underline underline-offset-2 hover:no-underline">
              {tt("sec.basedLine", { gauge: g.name, river: riverName(g.basin, lang), km: formatKm(g.km, t) })}
            </Link>
          </p>
        )}

        {g && <MyStreetLevel station={g.station} name={g.name} unit={g.unit} level={g.level} />}

        <TownRain lang={lang} town={place.name} rain={data.rain} reason={data.rainReason} sat={data.rainSat} />
        {place.rainZone && data.input.streetRain !== undefined && <LowSpot slug={place.slug} town={place.name} mm={data.input.streetRain ? data.input.streetRain.mm24h : null} level={risk.lowSpot?.level ?? null} />}

        {/* Hidden until the site can save answers (CLOUDFLARE_API_TOKEN set), so nobody sees an error. */}
        {d1Configured() && <FloodReport slug={place.slug} town={place.name} />}

        {g && (
          <div className="mt-4">
            <Suspense fallback={null}>
              <RiverMap lang={lang} basin={g.basin} focusStation={g.station} focusTown={place.name} />
            </Suspense>
          </div>
        )}

        {g && (
          <Suspense fallback={null}>
            <RiverReservoirs lang={lang} basin={g.basin} station={g.station} />
          </Suspense>
        )}

        <p className="mt-8 text-center">
          <Link
            href={p(g ? `/help?station=${encodeURIComponent(g.station)}` : "/help")}
            className="inline-flex items-center gap-1.5 min-h-11 px-2 text-sm text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            <LifeBuoy className="size-4" aria-hidden /> {tt("sec.helpLink")}
          </Link>
        </p>
        <Suspense key={`faq-${place.slug}`} fallback={null}>
          <NextHourFaq
            lang={lang}
            basin={g?.basin ?? null}
            build={(m) =>
              townFaq(lang, place.name, answer, g ? { name: g.name, km } : null, g ? { basin: g.basin, station: g.station, nh: m?.[g.station] ?? null } : null)
            }
            note={mt}
          />
        </Suspense>
        {g && (
          <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400">
            <Link href={p(basinPath(g.basin))} className="hover:underline">{riverName(g.basin, lang)}</Link> · {tt("foot.sources")}
          </p>
        )}
      </div>
    </main>
  );
}
