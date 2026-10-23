import { SpillWatchChip } from "@/app/SpillWatchChip";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ChevronRight, CloudRain, Gauge, MapPin, Waves, Clock } from "lucide-react";
import { getNational, fetchStations, type NationalStation } from "@/lib/arcgis";
import { SOURCE_URL, getReportedRelease, getReservoir, getReservoirHistory, getReservoirs, historyKey, riverMatches, type RV } from "@/lib/reservoirData";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { rtFor, type RT } from "@/lib/i18n/reservoirs";
import { riverName, shortDay, shortStamp } from "@/lib/i18n/format";
import type { TFn } from "@/lib/i18n/translate";
import { basinPath, stationPath } from "@/lib/slug";
import { historyPath } from "@/lib/history";
import { stationDisplayName } from "@/lib/displayName";
import { formatLevel } from "@/lib/units";
import { litresPerSecond, releaseSize, SIZE_STEP } from "@/lib/releaseUi";
import { TIER_DOT, tierLabel } from "@/app/tierUi";
import { TimeAgo } from "@/app/TimeAgo";
import { StatusChip, SizeBars, Tank, fmt } from "@/app/reservoirs/bits";
import { HistoryChart } from "@/app/reservoirs/HistoryChart";
import { BasinWarning } from "@/app/reservoirs/BasinWarning";
import { localName } from "@/app/reservoirs/RvCard";
import { Suspense } from "react";
import { RiverMap } from "@/app/RiverMap";
import { RESERVOIR_COORDS } from "@/lib/reservoirCoords";

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
  const name = localName(rv, lang);
  const other = lang === "en" ? [rv.si, rv.ta].filter(Boolean).join(" · ") : rv.name;

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
          ...(ourBasin ? [{ "@type": "ListItem", position: 2, name: riverName(ourBasin, lang), item: SITE + p(basinPath(ourBasin)) }] : []),
          { "@type": "ListItem", position: ourBasin ? 3 : 2, name: rt("crumb"), item: SITE + p("/reservoirs") },
          { "@type": "ListItem", position: ourBasin ? 4 : 3, name, item: SITE + canonical },
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

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <nav className={`text-xs ${muted} mb-3`}>
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">{t("crumb.home")}</Link> <span aria-hidden>›</span>{" "}
          {ourBasin && (
            <>
              <Link href={p(basinPath(ourBasin))} className="hover:underline inline-block py-3 -my-3">{riverName(ourBasin, lang)}</Link> <span aria-hidden>›</span>{" "}
            </>
          )}
          <Link href={p("/reservoirs")} className="hover:underline inline-block py-3 -my-3">{rt("crumb")}</Link> <span aria-hidden>›</span>{" "}
          <span className="text-slate-700 dark:text-slate-300">{name}</span>
        </nav>

        <header className="mb-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{name}</h1>
            <StatusChip status={rv.status} rt={rt} />
          </div>
          <Suspense fallback={null}><SpillWatchChip lang={lang} slug={rv.slug} catalogueId={rv.catalogueId} detail className="mt-2" /></Suspense>
          <p className={`mt-1 text-sm ${muted}`}>
            {[other || null, rv.river ? riverName(rv.river, lang) : null, rv.district].filter(Boolean).join(" · ") || rt(`kind.${rv.kind}` as "kind.major")}
          </p>
          <p className={`mt-1 text-xs ${muted} tabular-nums`}>
            {lastDay ? dayLabel(t, lastDay) : "—"} · {rt("checked", { ago: "" }).trim()}{" "}
            <TimeAgo ts={data.checkedAt} serverNow={now} />
          </p>
        </header>

        {rv.river && (
          <Suspense fallback={null}>
            <BasinWarning basin={rv.river} lang={lang} />
          </Suspense>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {/* ---- storage */}
          <section className={card} aria-label={rt("fullSupply")}>
            <div className="flex items-center gap-4">
              <Tank pct={stor?.pct ?? null} stale={storStale} rt={rt} />
              <div className="min-w-0">
                {stor ? (
                  <>
                    <p className={`text-4xl font-semibold tabular-nums leading-none ${storStale ? gone : ""}`}>{Math.round(stor.pct)}%</p>
                    <p className={`mt-1 text-sm ${storStale ? gone : ""}`}>{stor.pct > 100 ? rt("above") : rt("fullWord")}</p>
                    {storStale && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{rt("notUpdated", { date: dayLabel(t, stor.day) })}</p>}
                  </>
                ) : (
                  <p className={`text-lg ${muted}`}>{rt("noData")}</p>
                )}
              </div>
            </div>
            <dl className={`mt-3 space-y-1 text-sm ${storStale ? gone : "text-slate-700 dark:text-slate-300"}`}>
              {depthSrc && <dd>{rt("depth", { a: depthSrc.depthFt!.toFixed(1), b: depthSrc.fsdFt!.toFixed(1) })}</dd>}
              {!depthSrc && wm?.levelMsl != null && <dd>{rt("level", { n: wm.levelMsl.toFixed(2) })}</dd>}
              {capMcm != null && <dd className={muted}>{rt("capacity", { n: capMcm < 10 ? capMcm.toFixed(1) : Math.round(capMcm) })}</dd>}
              {otherStor && <dd className={muted}>{rt("alsoStorage", { source: srcName(t, otherStor.source), n: Math.round(otherStor.n), date: dayLabel(t, otherStor.day) })}</dd>}
            </dl>
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
                <p className="mt-1 text-4xl font-semibold tabular-nums leading-none">
                  {fmt(flow.cusecs)} <span className="text-base font-normal">{t("release.cusecs", { n: "" }).trim()}</span>
                </p>
                <p className={`mt-1 text-sm ${muted} tabular-nums`} title={rt("cusecNote")}>{rt("lps", { n: fmt(litresPerSecond(flow.cusecs)) })}</p>
                {size && (
                  <div className="mt-3 grid grid-cols-3 gap-1.5" role="img" aria-label={t(`release.size.${size}`)}>
                    {(["small", "large", "veryLarge"] as const).map((s) => (
                      <div key={s} className={`rounded-md border px-2 py-1.5 text-center text-xs ${s === size ? "border-amber-400 bg-amber-100 dark:border-amber-700 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 font-medium" : "border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500"}`}>
                        <span className="flex justify-center mb-0.5"><SizeBars step={SIZE_STEP[s]} /></span>
                        {t(`release.size.${s}`)}
                      </div>
                    ))}
                  </div>
                )}
                <p className={`mt-2 text-xs ${muted}`}>{rt("cusecNote")}</p>
              </>
            ) : rv.status === "holding" ? (
              <p className="mt-2 text-lg">{flow?.kind === "outlets" ? rt("outletsOnly") : rt("notReleasing")}</p>
            ) : rv.status === "spilling" ? (
              <p className="mt-2 text-lg">{rt("noFigure")}</p>
            ) : (
              <>
                <p className={`mt-2 text-lg ${muted}`}>{rt("noData")}</p>
                {staleDay && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{rt("notUpdated", { date: dayLabel(t, staleDay) })}</p>}
              </>
            )}

            {(sh?.fresh || wm?.fresh) && (
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                {sh?.fresh && (sh.spilling || sh.spillCusecs != null) && (
                  <>
                    <dt className={muted}>{rt("spill")}</dt>
                    <dd className="tabular-nums text-right">{spillNow != null ? t("release.cusecs", { n: fmt(spillNow) }) : rt("noData")}</dd>
                  </>
                )}
                {sh?.fresh && sluiceNow != null && (
                  <>
                    <dt className={muted}>{rt("outlets")}</dt>
                    <dd className="tabular-nums text-right">{t("release.cusecs", { n: fmt(sluiceNow) })}</dd>
                  </>
                )}
                {!sh?.fresh && wm?.fresh && (
                  <>
                    <dt className={muted}>{rt("downstream")}</dt>
                    <dd className="tabular-nums text-right">{wmsNow != null ? t("release.cusecs", { n: fmt(wmsNow) }) : rt("noData")}</dd>
                  </>
                )}
                {sh?.fresh && sh.spilling && sh.gatesOpen != null && sh.gatesOpen > 0 && (
                  <>
                    <dd className="col-span-2">{t("release.gatesOpen", { n: sh.gatesOpen })}</dd>
                  </>
                )}
              </dl>
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

        {rain && (
          <p className={`mt-3 flex items-center gap-2 text-sm ${card}`}>
            <CloudRain className="size-4 text-sky-600 dark:text-sky-400" aria-hidden />
            <span>{rt("rain.title")}: <span className="font-medium tabular-nums">{rt("rain.mm", { n: rain.n })}</span></span>
            <span className={`text-xs ${muted}`}>{srcName(t, rain.src)} · {dayLabel(t, rain.day)}</span>
          </p>
        )}

        {/* ---- history */}
        <section className={`mt-3 ${card}`} aria-label={rt("chart.title")}>
          <h2 className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">{rt("chart.title")}</h2>
          <HistoryChart rv={rv} sheet={history.sheet} wms={history.wms} firstDay={history.firstDay} now={now} rt={rt} t={t} />
        </section>

        {/* ---- downstream */}
        <section className={`mt-3 ${card}`} aria-label={rt("down.title")}>
          <h2 className="mb-3 text-sm font-medium text-slate-600 dark:text-slate-300">{rt("down.title")}</h2>
          {rv.gauges.length === 0 ? (
            <p className={`text-sm ${muted}`}>{rt("down.none")}</p>
          ) : (
            <ul className="space-y-3">
              {rv.gauges.map((g) => (
                <li key={g.station}>
                  <Chain rv={rv} g={g} s={byStation.get(g.station) ?? null} lang={lang} t={t} rt={rt} p={p} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- the river on a map, this reservoir marked */}
        {ourBasin && RESERVOIR_COORDS[rv.slug] && (
          <div className="mt-3">
            <Suspense fallback={null}><RiverMap lang={lang} basin={ourBasin} highlight={rv.slug} /></Suspense>
          </div>
        )}

        {/* ---- same river */}
        {ourBasin && (
          <section className={`mt-3 ${card}`} aria-label={rt("same.title")}>
            <h2 className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">{rt("same.title")}</h2>
            <ul className="flex flex-wrap gap-2 text-sm">
              <Pill href={p(basinPath(ourBasin))}>{rt("same.river")}: {riverName(ourBasin, lang)}</Pill>
              <Pill href={p(historyPath(ourBasin))}>{rt("same.history")}</Pill>
            </ul>
            {sameRiverGauges.length > 0 && (
              <>
                <h3 className={`mt-3 mb-1 text-xs ${muted}`}>{rt("same.gauges")}</h3>
                <ul className="flex flex-wrap gap-2 text-sm">
                  {sameRiverGauges.map((s) => (
                    <Pill key={s.station} href={p(stationPath(s.basin, s.station))}>{stationDisplayName(s.station)}</Pill>
                  ))}
                </ul>
              </>
            )}
            {siblings.length > 0 && (
              <>
                <h3 className={`mt-3 mb-1 text-xs ${muted}`}>{rt("same.reservoirs")}</h3>
                <ul className="flex flex-wrap gap-2 text-sm">
                  {siblings.map((r) => (
                    <Pill key={r.slug} href={p(`/reservoirs/${r.slug}`)}>{localName(r, lang)}</Pill>
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

function Pill({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="inline-flex items-center min-h-11 sm:min-h-9 rounded-full border border-slate-200 dark:border-slate-700 px-3 hover:border-sky-300 dark:hover:border-sky-700 hover:text-sky-700 dark:hover:text-sky-300 transition">
        {children}
      </Link>
    </li>
  );
}

const node = "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1.5 text-sm";

/** reservoir -> gauge (live tier and level) -> town, with the measured travel time on the arrow. */
function Chain({ rv, g, s, lang, t, rt, p }: { rv: RV; g: RV["gauges"][number]; s: NationalStation | null; lang: Locale; t: TFn; rt: RT; p: (x: string) => string }) {
  const station = stationDisplayName(g.station);
  const town = g.town && g.town !== station ? g.town : null;
  const arrow = (label?: string) => (
    <span className={`inline-flex items-center gap-1 text-xs ${muted}`} aria-hidden={!label}>
      <ChevronRight className="size-4" aria-hidden />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={node}><Waves className="size-4 text-sky-600 dark:text-sky-400" aria-hidden />{localName(rv, lang)}</span>
      <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
        <ChevronRight className="size-4" aria-hidden />
        <Clock className="size-3" aria-hidden />
        {g.eta ? t("release.eta", { a: g.eta[0], b: g.eta[1] }) : rt("down.etaUnknown")}
      </span>
      <Link href={p(stationPath(g.basin, g.station))} className={`${node} hover:border-sky-300 dark:hover:border-sky-700`}>
        <Gauge className="size-4" aria-hidden />
        <span>{station}</span>
        {s ? (
          <>
            <span className={`size-2 rounded-full ${TIER_DOT[s.tier]}`} aria-hidden />
            <span className={muted}>{tierLabel(t, s.tier)}{s.latest?.water_level != null && s.tier !== "stale" ? ` · ${formatLevel(s.latest.water_level, s.unit)}` : ""}</span>
          </>
        ) : (
          <span className={muted}>{rt("down.noReading")}</span>
        )}
      </Link>
      {town && (
        <>
          {arrow()}
          <span className={node}><MapPin className="size-4" aria-hidden />{town}</span>
        </>
      )}
    </div>
  );
}
