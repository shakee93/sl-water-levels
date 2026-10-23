import { SpillWatchChip } from "@/app/SpillWatchChip";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CalendarDays, Container, CloudRain, DoorOpen, Droplets, Gauge, History, Map as MapIcon, MapPin, Ruler, Waves } from "lucide-react";
import { getNational, fetchStations, type NationalStation } from "@/lib/arcgis";
import { SOURCE_URL, getReportedRelease, getReservoir, getReservoirHistory, getReservoirs, historyKey, riverMatches, type RV } from "@/lib/reservoirData";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { rtFor } from "@/lib/i18n/reservoirs";
import { riverName, shortDay, shortStamp } from "@/lib/i18n/format";
import type { TFn } from "@/lib/i18n/translate";
import { basinPath, stationPath } from "@/lib/slug";
import { historyPath } from "@/lib/history";
import { stationDisplayName } from "@/lib/displayName";
import { litresPerSecond, releaseSize } from "@/lib/releaseUi";
import { TimeAgo } from "@/app/TimeAgo";
import { Basin, SizeMeter, fmt, levelOf } from "@/app/reservoirs/bits";
import { FlowDiagram } from "@/app/reservoirs/FlowDiagram";
import { orderStations } from "@/lib/basinOrder";
import { shapeFor } from "@/lib/riverTopology";
import { HistoryChart } from "@/app/reservoirs/HistoryChart";
import { BasinWarning } from "@/app/reservoirs/BasinWarning";
import { displayName, localName } from "@/app/reservoirs/RvCard";
import { Suspense } from "react";

export const revalidate = 600;

const nowMs = () => Date.now();

const SITE = "https://sl-water-levels.vercel.app";

export async function generateStaticParams() {
  const data = await getReservoirs().catch(() => null);
  return (data?.items ?? []).map((r) => ({ slug: r.slug }));
}

type Src = "Irrigation Department" | "Mahaweli Authority";
const srcName = (t: TFn, s: Src) => t(s === "Irrigation Department" ? "release.src.irrigation" : "release.src.mahaweli");
const dayLabel = (t: TFn, d: string) => shortDay(d, t);

/** Text for the title/description: status, release and storage in one line, with the source and date. */
function describe(rv: RV, lang: Locale) {
  const { t } = getI18n(lang);
  const rt = rtFor(lang);
  const name = localName(rv, lang);
  const pct = rv.storage && rv.storage.fresh ? rt("d.pct", { n: Math.round(rv.storage.pct) }) : "";
  const used = rv.flow ?? null;
  const when = used?.day ?? rv.storage?.day ?? rv.latestDay;
  const src = !when ? "" : rt("d.src", { source: srcName(t, used?.source ?? rv.storage?.source ?? "Irrigation Department"), date: dayLabel(t, when) });
  const key = `d.${rv.status}` as "d.spilling";
  return {
    title: rt("title", { name }),
    description: rt(key, { name, c: used ? fmt(used.cusecs) : "", p: pct, src }).replace(/\s+\./g, ".").replace(/\.\s*\./g, "."),
  };
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string; slug: string }> }): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLocale(lang)) return {};
  const hit = await getReservoir(slug).catch(() => null);
  if (!hit) return {};
  const { title, description } = describe(hit.rv, lang);
  const alternates = pageAlternates(lang, `/reservoirs/${slug}`);
  return {
    title: { absolute: title },
    description,
    alternates,
    openGraph: { title, description, url: `${SITE}${alternates.canonical}`, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

const card = "rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4";
const muted = "text-slate-500 dark:text-slate-400";
const gone = "text-slate-400 dark:text-slate-500";

export default async function ReservoirPage({ params }: { params: Promise<{ lang: string; slug: string }> }) {
  const { lang: rawLang, slug } = await params;
  if (!isLocale(rawLang)) notFound();
  const lang: Locale = rawLang;
  const { t, p } = getI18n(lang);
  const rt = rtFor(lang);

  const hit = await getReservoir(slug);
  if (!hit) notFound();
  const { rv, data } = hit;
  const now = nowMs();

  const [national, stations, history, reported] = await Promise.all([
    getNational().catch(() => [] as NationalStation[]),
    fetchStations().catch(() => []),
    getReservoirHistory(historyKey(rv), now),
    getReportedRelease(rv).catch(() => null),
  ]);
  const ourBasin = rv.river ? stations.find((s) => s.basin.trim().toLowerCase() === rv.river!.trim().toLowerCase())?.basin.trim() ?? null : null;
  const siblings = data.items.filter((r) => r.slug !== rv.slug && rv.river && riverMatches(r, rv.river));
  const sameRiverGauges = ourBasin ? stations.filter((s) => s.basin.trim() === ourBasin) : [];

  const { description } = describe(rv, lang);
  const canonical = p(`/reservoirs/${slug}`);
  const name = displayName(rv, lang, rt);
  const other = lang === "en" ? [rv.si, rv.ta].filter(Boolean).join(" · ") : rv.name.trim().toLowerCase() === rv.river?.trim().toLowerCase() ? "" : rv.name;

  const sh = rv.sheet;
  const wm = rv.wms;
  const flow = rv.flow;
  const stor = rv.storage;
  const storStale = !!stor && !stor.fresh;
  const lastDay = rv.latestDay;

  // ---- structured data
  const covStart = history.firstDay ?? lastDay ?? new Date(now).toISOString().slice(0, 10);
  const covEnd = lastDay && lastDay > covStart ? lastDay : covStart;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: t("crumb.home"), item: SITE + p("/") },
          { "@type": "ListItem", position: 2, name: rt("crumb"), item: SITE + p("/reservoirs") },
          { "@type": "ListItem", position: 3, name, item: SITE + canonical },
        ],
      },
      {
        "@type": "Place",
        name: `${rv.name} reservoir`,
        url: SITE + canonical,
        containedInPlace: { "@type": "Place", name: [rv.district, "Sri Lanka"].filter(Boolean).join(", ") },
        ...(rv.river ? { additionalProperty: { "@type": "PropertyValue", name: "River basin", value: rv.river } } : {}),
      },
      {
        "@type": "Dataset",
        name: `${rv.name} reservoir storage and spill`,
        description,
        url: SITE + canonical,
        inLanguage: lang,
        isAccessibleForFree: true,
        license: "https://sl-water-levels.vercel.app/about#data-sources",
        creator: { "@type": "Organization", name: sh ? "Irrigation Department, Sri Lanka" : "Mahaweli Authority of Sri Lanka" },
        temporalCoverage: `${covStart}/${covEnd}`,
        variableMeasured: ["Storage (% full)", "Spill (cusecs)", "Outlet discharge (cusecs)"],
        ...(lastDay ? { dateModified: lastDay } : {}),
      },
    ],
  };

  // ---- release panel
  const spillNow = sh?.fresh ? sh.spillCusecs : null;
  const sluiceNow = sh?.fresh ? sh.sluiceCusecs : null;
  const wmsNow = wm?.fresh ? wm.dischargeCusecs : null;
  const otherFlow =
    flow?.source === "Irrigation Department" && wm?.fresh && wm.dischargeCusecs != null && wm.dischargeCusecs !== flow.cusecs
      ? { source: "Mahaweli Authority" as Src, n: wm.dischargeCusecs, day: wm.day }
      : flow?.source === "Mahaweli Authority" && sh?.fresh && sh.spillCusecs != null && sh.spillCusecs !== flow.cusecs
        ? { source: "Irrigation Department" as Src, n: sh.spillCusecs, day: sh.day }
        : null;
  const releasing = rv.status === "spilling" || rv.status === "releasing";
  const size = flow && flow.kind !== "outlets" && !rv.barrage ? releaseSize(flow.cusecs) : null;
  const relSource: Src | null = flow?.source ?? (sh?.fresh ? "Irrigation Department" : wm?.fresh ? "Mahaweli Authority" : null);
  const relDay = flow?.day ?? (sh?.fresh ? sh.day : wm?.fresh ? wm.day : null);
  const staleDay = rv.status === "nodata" && !sh?.fresh && !wm?.fresh ? lastDay : null;

  // ---- storage panel
  const otherStor =
    stor && sh && wm
      ? stor.source === "Irrigation Department"
        ? wm.storagePct != null && Math.round(wm.storagePct) !== Math.round(stor.pct) ? { source: "Mahaweli Authority" as Src, n: wm.storagePct, day: wm.day } : null
        : sh.storagePct != null && Math.round(sh.storagePct) !== Math.round(stor.pct) ? { source: "Irrigation Department" as Src, n: sh.storagePct, day: sh.day } : null
      : null;
  const depthSrc = sh && sh.depthFt != null && sh.fsdFt != null ? sh : null;
  const capMcm = sh?.capacityAcft != null ? (sh.capacityAcft * 1233.4818) / 1e6 : null;
  const rain = sh?.fresh && sh.rainMm != null ? { n: sh.rainMm, src: "Irrigation Department" as Src, day: sh.day } : wm?.fresh && wm.rainMm != null ? { n: wm.rainMm, src: "Mahaweli Authority" as Src, day: wm.day } : null;

  const byStation = new Map(national.map((s) => [s.station, s]));

  // ---- header and panels
  const edge: Record<typeof rv.status, string> = { spilling: "border-l-amber-500", releasing: "border-l-sky-500", holding: "border-l-emerald-500", nodata: "border-l-slate-300 dark:border-l-slate-600" };
  const statusText: Record<typeof rv.status, string> = {
    spilling: "text-amber-800 dark:text-amber-300",
    releasing: "text-sky-800 dark:text-sky-300",
    holding: "text-emerald-800 dark:text-emerald-300",
    nodata: "text-slate-600 dark:text-slate-300",
  };
  const level = levelOf(rv);
  const ftBelow = depthSrc?.fresh ? Math.round(depthSrc.fsdFt! * 10) / 10 - Math.round(depthSrc.depthFt! * 10) / 10 : null;
  const lps = flow ? flow.cusecs * 28.3168 : 0;
  const poolSecs = lps > 0 ? 2_500_000 / lps : 0;
  const pool = !flow || lps <= 0 ? null : poolSecs < 90 ? rt("pool.s", { n: Math.max(1, Math.round(poolSecs)) }) : poolSecs < 5400 ? rt("pool.m", { n: Math.round(poolSecs / 60) }) : rt("pool.h", { n: Math.round(poolSecs / 3600) });
  const stacked = sh?.fresh && spillNow != null && spillNow > 0 && sluiceNow != null && sluiceNow > 0 ? { spill: spillNow, sluice: sluiceNow } : null;
  const gates = sh?.fresh && sh.spilling && sh.gatesOpen != null && sh.gatesOpen > 0 ? sh.gatesOpen : null;
  const chip = "inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200";

  // Does the water reach the sea at the end of the last gauge below this reservoir?
  const lastGauge = [...rv.gauges].sort((a, b) => (a.eta ? a.eta[0] : 1e9) - (b.eta ? b.eta[0] : 1e9)).at(-1);
  const shape = ourBasin ? shapeFor(ourBasin, orderStations(ourBasin, sameRiverGauges).map((x) => x.station)) : null;
  const mainGauges = shape ? shape.main.filter((x) => !x.startsWith("@")) : [];
  const sea = !!(shape?.sea && lastGauge && lastGauge.station === mainGauges[mainGauges.length - 1] && lastGauge.basin.trim() === ourBasin);

  const sizeWord = size ? t(`release.size.${size}`) : null;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <nav className={`text-xs ${muted} mb-3`} aria-label={rt("crumb")}>
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">{t("crumb.home")}</Link> <span aria-hidden>›</span>{" "}
          <Link href={p("/reservoirs")} className="hover:underline inline-block py-3 -my-3">{rt("crumb")}</Link> <span aria-hidden>›</span>{" "}
          <span className="text-slate-700 dark:text-slate-300">{name}</span>
        </nav>

        {/* ---- summary strip */}
        <header className={`mb-3 rounded-xl border border-l-4 border-slate-200 dark:border-slate-800 ${edge[rv.status]} bg-white dark:bg-slate-900 p-4 sm:p-5`}>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{name}</h1>
          <p className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm ${muted}`}>
            {other && <span>{other}</span>}
            {rv.river && (
              <span className="inline-flex items-center gap-1">
                <Waves className="size-4" aria-hidden />
                {ourBasin ? <Link href={p(basinPath(ourBasin))} className="underline underline-offset-2 hover:text-sky-700 dark:hover:text-sky-300 py-2 -my-2">{riverName(rv.river, lang)}</Link> : riverName(rv.river, lang)}
              </span>
            )}
            {rv.district && <span className="inline-flex items-center gap-1"><MapPin className="size-4" aria-hidden />{rv.district}</span>}
            {!other && !rv.river && !rv.district && <span>{rt(`kind.${rv.kind}` as "kind.major")}</span>}
          </p>
          <p className={`mt-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xl sm:text-2xl font-semibold leading-tight ${statusText[rv.status]}`}>
            <span className={`size-3 shrink-0 rounded-full ${rv.status === "spilling" ? "bg-amber-500" : rv.status === "releasing" ? "bg-sky-500" : rv.status === "holding" ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`} aria-hidden />
            <span>{rt(`s.${rv.status}` as "s.spilling")}</span>
            {sizeWord && releasing && <span className="font-medium"><span aria-hidden>· </span>{rt("sizeRelease", { size: sizeWord })}</span>}
          </p>
          <p className={`mt-1 text-xs ${muted} tabular-nums`}>
            {lastDay ? rt("asOfDay", { date: dayLabel(t, lastDay) }) : "—"} · {rt("checked", { ago: "" }).trim()}{" "}
            <TimeAgo ts={data.checkedAt} serverNow={now} />
          </p>
          <Suspense fallback={null}><SpillWatchChip lang={lang} slug={rv.slug} catalogueId={rv.catalogueId} detail className="mt-2" /></Suspense>
        </header>

        {rv.river && (
          <Suspense fallback={null}>
            <BasinWarning basin={rv.river} lang={lang} />
          </Suspense>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {/* ---- storage */}
          <section className={card} aria-label={rt("fullSupply")}>
            <Basin level={level} stale={storStale} spilling={rv.status === "spilling"} rt={rt} />
            <div className="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              {stor ? (
                <div>
                  <p className={`text-4xl font-semibold tabular-nums leading-none ${storStale ? gone : ""}`}>
                    {Math.round(stor.pct)}%<span className="ml-1.5 text-base font-normal">{stor.pct > 100 ? rt("above") : rt("fullWord")}</span>
                  </p>
                  {depthSrc?.fresh ? (
                    <p className={`mt-1.5 text-sm tabular-nums ${muted}`}>{rt("depthOf", { a: depthSrc.depthFt!.toFixed(1), b: depthSrc.fsdFt!.toFixed(1) })}</p>
                  ) : wm?.levelMsl != null ? (
                    <p className={`mt-1.5 text-sm ${muted}`}>{rt("level", { n: wm.levelMsl.toFixed(2) })}</p>
                  ) : null}
                </div>
              ) : (
                <p className={`text-lg ${muted}`}>{rt("noData")}</p>
              )}
              {ftBelow != null && (
                <span className={`${chip} text-sm`}>
                  <Ruler className="size-4" aria-hidden />
                  {Math.abs(ftBelow) < 0.05 ? rt("atFull") : ftBelow > 0 ? rt("belowFull", { n: ftBelow.toFixed(1) }) : rt("aboveFull", { n: Math.abs(ftBelow).toFixed(1) })}
                </span>
              )}
            </div>
            {storStale && stor && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{rt("notUpdated", { date: dayLabel(t, stor.day) })}</p>}
            {otherStor && <p className={`mt-2 text-xs ${muted}`}>{rt("alsoStorage", { source: srcName(t, otherStor.source), n: Math.round(otherStor.n), date: dayLabel(t, otherStor.day) })}</p>}
            {stor && (
              <p className={`mt-2 text-xs ${muted}`}>
                <a href={SOURCE_URL[stor.source]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  {rt("asOf", { source: srcName(t, stor.source), date: dayLabel(t, stor.day) })}
                </a>
              </p>
            )}
          </section>

          {/* ---- release */}
          <section className={card} aria-label={rt("release.title")}>
            <h2 className="text-sm font-medium text-slate-600 dark:text-slate-300">{rt("release.title")}</h2>
            {releasing && flow ? (
              <>
                <div className="mt-2 flex flex-wrap items-end gap-x-5 gap-y-3">
                  <div className="shrink-0">
                    <p className="text-4xl font-semibold tabular-nums leading-none">
                      {fmt(flow.cusecs)} <span className="text-base font-normal whitespace-nowrap">{t("release.cusecs", { n: "" }).trim()}</span>
                    </p>
                    <p className={`mt-1.5 text-xs ${muted}`}>{rt(flow.kind === "downstream" ? "downstream" : "spill")}</p>
                  </div>
                  {size && <div className="min-w-[9rem] flex-1"><SizeMeter size={size} t={t} /></div>}
                </div>
                <p className="mt-3 text-sm tabular-nums text-slate-700 dark:text-slate-300" title={rt("cusecNote")}>
                  {rt("lps", { n: fmt(litresPerSecond(flow.cusecs)) })}
                  {pool && <span className={muted}> · {pool}</span>}
                </p>
                {(gates || stacked) && (
                  <div className="mt-3 space-y-3">
                    {gates && (
                      <span className={chip}><DoorOpen className="size-4" aria-hidden />{t("release.gatesOpen", { n: gates })}</span>
                    )}
                    {stacked && (
                      <div role="img" aria-label={`${rt("spill")} ${t("release.cusecs", { n: fmt(stacked.spill) })}, ${rt("outlets")} ${t("release.cusecs", { n: fmt(stacked.sluice) })}`}>
                        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden>
                          <span className="bg-sky-500 dark:bg-sky-400" style={{ width: `${(stacked.spill / (stacked.spill + stacked.sluice)) * 100}%` }} />
                          <span className="bg-slate-400 dark:bg-slate-500" style={{ width: `${(stacked.sluice / (stacked.spill + stacked.sluice)) * 100}%` }} />
                        </div>
                        <p className="mt-1 flex flex-wrap gap-x-4 text-xs tabular-nums text-slate-600 dark:text-slate-300">
                          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-sky-500 dark:bg-sky-400" aria-hidden />{rt("spill")} {fmt(stacked.spill)}</span>
                          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-slate-400 dark:bg-slate-500" aria-hidden />{rt("outlets")} {fmt(stacked.sluice)}</span>
                        </p>
                      </div>
                    )}
                  </div>
                )}
                <p className={`mt-3 text-xs ${muted}`}>{rt("cusecNote")}</p>
              </>
            ) : rv.status === "holding" ? (
              <p className="mt-2 text-lg">{flow?.kind === "outlets" ? rt("outletsOnly") : rt("notReleasing")}</p>
            ) : rv.status === "spilling" ? (
              <>
                <p className="mt-2 text-lg">{rt("noFigure")}</p>
                {gates && <span className={`${chip} mt-3`}><DoorOpen className="size-4" aria-hidden />{t("release.gatesOpen", { n: gates })}</span>}
              </>
            ) : (
              <>
                <p className={`mt-2 text-lg ${muted}`}>{rt("noData")}</p>
                {staleDay && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{rt("notUpdated", { date: dayLabel(t, staleDay) })}</p>}
              </>
            )}

            {!releasing && (sh?.fresh || wm?.fresh) && (sh?.spillCusecs != null || sluiceNow != null || wmsNow != null) && (
              <p className="mt-2 text-sm tabular-nums text-slate-700 dark:text-slate-300">
                {[
                  sh?.fresh && sluiceNow != null ? `${rt("outlets")} ${t("release.cusecs", { n: fmt(sluiceNow) })}` : null,
                  !sh?.fresh && wmsNow != null ? `${rt("downstream")} ${t("release.cusecs", { n: fmt(wmsNow) })}` : null,
                ].filter(Boolean).join(" · ")}
              </p>
            )}

            {otherFlow && (
              <p className={`mt-2 text-xs ${muted}`}>{rt("alsoReports", { source: srcName(t, otherFlow.source), n: fmt(otherFlow.n), date: dayLabel(t, otherFlow.day) })}</p>
            )}
            {reported && (
              <p className={`mt-1 text-xs ${muted}`}>
                <a href={reported.news?.url ?? reported.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  {rt("reported", { outlet: reported.news?.outlet ?? reported.source })}, {shortStamp(Date.parse(reported.news?.publishedAt ?? reported.observedAt), t)}
                </a>
              </p>
            )}
            {relSource && relDay && (
              <p className={`mt-2 text-xs ${muted}`}>
                <a href={SOURCE_URL[relSource]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  {rt("asOf", { source: srcName(t, relSource), date: dayLabel(t, relDay) })}
                </a>
              </p>
            )}
          </section>
        </div>

        {/* ---- the small facts, in one row */}
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className={`${card} !p-3`}>
            <dt className={`flex items-center gap-1.5 text-xs ${muted}`}><CloudRain className="size-4 text-sky-600 dark:text-sky-400" aria-hidden />{rt("stat.rain")}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{rain ? rt("rain.mm", { n: rain.n }) : <span className={`text-sm font-normal ${muted}`}>{rt("stat.noRain")}</span>}</dd>
            {rain && <dd className={`text-xs ${muted}`}>{srcName(t, rain.src)} · {dayLabel(t, rain.day)}</dd>}
          </div>
          <div className={`${card} !p-3`}>
            <dt className={`flex items-center gap-1.5 text-xs ${muted}`}><Container className="size-4 text-sky-600 dark:text-sky-400" aria-hidden />{rt("stat.capacity")}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{capMcm != null ? rt("stat.cap", { n: capMcm < 10 ? capMcm.toFixed(1) : Math.round(capMcm) }) : <span className={`text-sm font-normal ${muted}`}>{rt("noData")}</span>}</dd>
            {capMcm != null && sh && <dd className={`text-xs ${muted}`}>{srcName(t, "Irrigation Department")} · {dayLabel(t, sh.day)}</dd>}
          </div>
          <div className={`${card} !p-3 col-span-2 sm:col-span-1`}>
            <dt className={`flex items-center gap-1.5 text-xs ${muted}`}><CalendarDays className="size-4 text-sky-600 dark:text-sky-400" aria-hidden />{rt("stat.source")}</dt>
            <dd className="mt-1 space-y-0.5 text-sm">
              {[sh ? ({ src: "Irrigation Department", day: sh.day, fresh: sh.fresh } as const) : null, wm ? ({ src: "Mahaweli Authority", day: wm.day, fresh: wm.fresh } as const) : null]
                .filter((x): x is NonNullable<typeof x> => !!x)
                .map((x) => (
                  <a key={x.src} href={SOURCE_URL[x.src]} target="_blank" rel="noopener noreferrer" className={`block underline underline-offset-2 ${x.fresh ? "" : gone}`}>
                    {srcName(t, x.src)} · {dayLabel(t, x.day)}
                  </a>
                ))}
              {!sh && !wm && <span className={muted}>{rt("noData")}</span>}
            </dd>
          </div>
        </dl>

        {/* ---- history */}
        <section className={`mt-3 ${card}`} aria-label={rt("chart.title")}>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300"><History className="size-4" aria-hidden />{rt("chart.title")}</h2>
          <HistoryChart rv={rv} sheet={history.sheet} wms={history.wms} firstDay={history.firstDay} now={now} rt={rt} t={t} />
        </section>

        {/* ---- downstream: a flow diagram of this reservoir */}
        <section className={`mt-3 ${card}`} aria-label={rt("down.title")}>
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300"><Droplets className="size-4" aria-hidden />{rt("down.title")}</h2>
          {rv.gauges.length === 0 ? (
            <p className={`text-sm ${muted}`}>{rt("down.none")}</p>
          ) : (
            <FlowDiagram rv={rv} byStation={byStation} lang={lang} t={t} rt={rt} p={p} sea={sea} />
          )}
          {ourBasin && (
            <p className="mt-3 text-sm">
              <Link href={`${p(basinPath(ourBasin))}#map`} className="inline-flex items-center gap-1.5 min-h-11 sm:min-h-9 text-sky-700 dark:text-sky-300 hover:underline">
                <MapIcon className="size-4" aria-hidden />{rt("map.link")}
              </Link>
            </p>
          )}
        </section>

        {/* ---- same river */}
        {ourBasin && (
          <section className={`mt-3 ${card}`} aria-label={rt("same.title")}>
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300"><Waves className="size-4" aria-hidden />{rt("same.title")}</h2>
            <ul className="flex flex-wrap gap-2 text-sm">
              <Pill href={p(basinPath(ourBasin))} icon={<Waves className="size-4" aria-hidden />}>{rt("same.river")}: {riverName(ourBasin, lang)}</Pill>
              <Pill href={p(historyPath(ourBasin))} icon={<History className="size-4" aria-hidden />}>{rt("same.history")}</Pill>
            </ul>
            {sameRiverGauges.length > 0 && (
              <>
                <h3 className={`mt-4 mb-1.5 text-xs font-medium ${muted}`}>{rt("same.gauges")}</h3>
                <ul className="flex flex-wrap gap-2 text-sm">
                  {sameRiverGauges.map((s) => (
                    <Pill key={s.station} href={p(stationPath(s.basin, s.station))} icon={<Gauge className="size-4" aria-hidden />}>{stationDisplayName(s.station)}</Pill>
                  ))}
                </ul>
              </>
            )}
            {siblings.length > 0 && (
              <>
                <h3 className={`mt-4 mb-1.5 text-xs font-medium ${muted}`}>{rt("same.reservoirs")}</h3>
                <ul className="flex flex-wrap gap-2 text-sm">
                  {siblings.map((r) => (
                    <Pill key={r.slug} href={p(`/reservoirs/${r.slug}`)} icon={<Droplets className="size-4" aria-hidden />}>{localName(r, lang)}</Pill>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        <p className={`mt-6 text-xs ${muted}`}>{rt("src.note")}</p>
      </div>
    </main>
  );
}

function Pill({ href, icon, children }: { href: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="inline-flex items-center gap-1.5 min-h-11 sm:min-h-9 rounded-full border border-slate-200 dark:border-slate-700 px-3 hover:border-sky-300 dark:hover:border-sky-700 hover:text-sky-700 dark:hover:text-sky-300 transition">
        {icon && <span className="text-slate-500 dark:text-slate-400">{icon}</span>}
        {children}
      </Link>
    </li>
  );
}
