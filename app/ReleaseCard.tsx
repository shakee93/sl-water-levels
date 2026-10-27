import Link from "next/link";
import { ArrowRight, ChevronRight, CircleHelp, Clock, Gauge, MapPin, TrendingDown, TrendingUp, Waves } from "lucide-react";
import { getReleases, type Release, type ReportedLine } from "@/lib/releases";
import { reservoirById, type GaugeLink } from "@/lib/reservoirs";
import { reservoirPath } from "@/lib/reservoirData";
import { releaseTrend, type Trend } from "@/lib/releaseTrend";
import { SIZE_STEP, litresPerSecond, releaseSize, roundCusecs } from "@/lib/releaseUi";
import { stationDisplayName } from "@/lib/displayName";
import { basinPath, stationPath } from "@/lib/slug";
import { getI18n } from "@/lib/i18n/server";
import { clock, colomboParts, shortDay, shortStamp } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { swFor } from "@/lib/i18n/spillWatch";
import type { TFn } from "@/lib/i18n/translate";

// Reservoir release warnings, shown as a compact visual row: who is releasing, how big
// (size chip + 3-step meter), where the water goes (reservoir -> gauge -> town) and when it
// should arrive. Official numbers say "Irrigation Department"; a news-only report says
// "reported" and is never presented as official. Fails soft: no data, no card.

const fmt = (n: number) => n.toLocaleString("en-US");

function sourceName(t: TFn, source: string): string {
  if (source === "Irrigation Department") return t("release.src.irrigation");
  if (source === "Mahaweli Authority") return t("release.src.mahaweli");
  return source;
}

/** "23 Oct" for a day-only reading, "6:37 pm" for a time today, "22 Oct, 9:30 am" otherwise. */
function when(t: TFn, iso: string, dayOnly: boolean): string {
  const ms = Date.parse(iso);
  if (dayOnly) return shortDay(iso.slice(0, 10), t);
  const a = colomboParts(ms);
  const b = colomboParts(Date.now());
  return a.y === b.y && a.m === b.m && a.d === b.d ? clock(ms, t) : shortStamp(ms, t);
}

/** "over 15,000 cusecs, 16 gates" (only what the story says). */
function reportedWhat(t: TFn, r: ReportedLine): string {
  const parts: string[] = [];
  if (r.cusecs != null) parts.push(r.atLeast ? t("release.rep.over", { n: fmt(r.cusecs) }) : t("release.cusecs", { n: fmt(r.cusecs) }));
  if (r.gates != null) parts.push(t(r.planned ? "release.rep.gatesPlanned" : "release.rep.gates", { n: r.gates }));
  if (r.openedFt != null) parts.push(t("release.rep.ft", { n: r.openedFt }));
  return parts.join(", ");
}

/**
 * The newest figure reported after the official reading, as a plain link to the story:
 * "Reported 2:52 pm: over 15,000 cusecs, 16 gates (Ada Derana)". A news report, never presented as official.
 */
export function ReportedFigureLine({ t, rep, className = "" }: { t: TFn; rep: ReportedLine; className?: string }) {
  const what = reportedWhat(t, rep);
  if (!what) return null;
  return (
    <p className={className}>
      <a
        href={rep.url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 inline-flex items-center min-h-11 sm:min-h-6"
        title={rep.via === "news" ? t("release.rep.note") : undefined}
      >
        {t(rep.via === "news" ? "release.rep.news" : "release.rep.bulletin", { when: when(t, rep.at, false), what, outlet: rep.via === "news" ? rep.outlet : sourceName(t, rep.outlet) })}
      </a>
    </p>
  );
}

const chip =
  "inline-flex items-center gap-1 rounded-full border border-amber-300/70 dark:border-amber-800 bg-white/60 dark:bg-amber-950/50 px-2 py-0.5 text-xs font-medium whitespace-nowrap";
const linkCls = "underline underline-offset-2 inline-flex items-center min-h-11 sm:min-h-6 whitespace-nowrap";

function SizeMeter({ step }: { step: 1 | 2 | 3 }) {
  return (
    <span className="inline-flex items-end gap-px" aria-hidden>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`w-1 rounded-sm ${i === 1 ? "h-1.5" : i === 2 ? "h-2.5" : "h-3.5"} ${i <= step ? "bg-amber-700 dark:bg-amber-300" : "bg-amber-300/70 dark:bg-amber-800"}`} />
      ))}
    </span>
  );
}

/** Muted cusec figure with a "?" that opens a one-line explanation (no JavaScript needed). */
function CusecFigure({ t, cusecs }: { t: TFn; cusecs: number }) {
  return (
    <details className="group text-xs text-amber-800/80 dark:text-amber-300/80">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 min-h-11 sm:min-h-6 [&::-webkit-details-marker]:hidden">
        <span className="tabular-nums">{t("release.cusecs", { n: fmt(roundCusecs(cusecs)) })}</span>
        <CircleHelp className="size-3.5" aria-hidden />
        <span className="sr-only">{t("release.cusecHelp")}</span>
      </summary>
      <span className="block pb-1">{t("release.cusecExplain")}</span>
    </details>
  );
}

/** The sentence with the reservoir's name turned into a link to its page (the name sits inside a translated string, so split on it). */
function WithLink({ text, name, href }: { text: string; name: string; href: string | null }) {
  const at = text.indexOf(name);
  if (!href || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Link href={href} className="underline decoration-dotted underline-offset-2 hover:decoration-solid">{name}</Link>
      {text.slice(at + name.length)}
    </>
  );
}

function pickLink(res: ReturnType<typeof reservoirById>, station?: string, basin?: string): GaugeLink | undefined {
  if (!res) return undefined;
  if (station) return res.gauges.find((g) => g.station === station);
  return res.gauges.find((g) => g.basin === basin && g.eta) ?? res.gauges.find((g) => g.basin === basin) ?? res.gauges.find((g) => g.eta) ?? res.gauges[0];
}

function RowBody({ t, lang, rel, trend, link, note }: { t: TFn; lang: Locale; rel: Release; trend: Trend | null; link?: GaugeLink; note: boolean }) {
  const sw = swFor(lang);
  const resPath = reservoirPath(rel.reservoirId);
  const resHref = resPath ? getI18n(lang).p(resPath) : null;
  const confirmed = rel.kind === "confirmed";
  const size = confirmed && rel.cusecs ? releaseSize(rel.cusecs) : null;
  const gauge = link ? stationDisplayName(link.station) : null;
  const town = link?.town && link.town !== gauge ? link.town : null;
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold"><WithLink text={rel.watch ? sw("watch.lead", { name: rel.name }) : t(confirmed ? "release.lead" : "release.leadReported", { name: rel.name })} name={rel.name} href={resHref} /></span>
        {size && rel.cusecs && (
          <span className={chip}>
            <SizeMeter step={SIZE_STEP[size]} />
            {t("release.sizeChip", { size: t(`release.size.${size}`), n: fmt(litresPerSecond(rel.cusecs)) })}
          </span>
        )}
        {confirmed && rel.gatesOpen ? <span className={chip}>{t("release.gatesOpen", { n: rel.gatesOpen })}</span> : null}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0">
        {confirmed && rel.cusecs ? <CusecFigure t={t} cusecs={rel.cusecs} /> : null}
        {trend && (
          <span className={chip}>
            {trend.dir === "down" ? <TrendingDown className="size-3" aria-hidden /> : <TrendingUp className="size-3" aria-hidden />}
            {t(trend.dir === "down" ? "release.trendDown" : "release.trendUp", { n: fmt(roundCusecs(trend.from)) })}
          </span>
        )}
      </div>
      {rel.reported && <ReportedFigureLine t={t} rep={rel.reported} className="text-xs text-amber-800/80 dark:text-amber-300/80" />}
      {link && gauge && (
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs" aria-label={t("release.chainLabel", { a: rel.name, b: gauge })}>
          <Waves className="size-3.5 shrink-0" aria-hidden />
          {resHref ? <Link href={resHref} className="underline decoration-dotted underline-offset-2 hover:decoration-solid">{rel.name}</Link> : <span>{rel.name}</span>}
          <ChevronRight className="size-3 shrink-0 opacity-60" aria-hidden />
          <Gauge className="size-3.5 shrink-0" aria-hidden />
          <span>{gauge}</span>
          {town && (
            <>
              <ChevronRight className="size-3 shrink-0 opacity-60" aria-hidden />
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              <span>{town}</span>
            </>
          )}
          <span className={chip}>
            <Clock className="size-3" aria-hidden />
            {link.eta ? t("release.eta", { a: link.eta[0], b: link.eta[1] }) : t("release.etaSoon")}
          </span>
        </p>
      )}
      {note && (
        <p className="mt-1">{rel.watch ? sw("watch.note") : <>{link ? t("release.expect") : t("release.noGaugeBelow")}{rel.kind === "reported" ? ` ${t("release.reportedNote")}` : ""}</>}</p>
      )}
    </>
  );
}

const shell =
  "flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-200";

/** Amber card on a gauge page (station) or a river page (basin). Several releases stack. */
export async function ReleaseCard({ lang, station, basin }: { lang: Locale; station?: string; basin?: string }) {
  const { t, p } = getI18n(lang);
  const all = await getReleases().catch(() => null);
  if (!all) return null;
  const b = (basin ?? "").trim();
  const mine = all.releases.filter((r) => {
    const res = reservoirById(r.reservoirId);
    if (!res) return false;
    return station ? res.gauges.some((g) => g.station === station) : r.basin === b;
  });
  if (mine.length === 0) return null;
  const trends = await Promise.all(mine.map((r) => releaseTrend(r.reservoirId, r.cusecs)));
  return (
    <div className="mb-4 space-y-2" role="status">
      {mine.map((rel, i) => (
        <div key={rel.reservoirId} className={shell}>
          <Waves className="size-4 mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <RowBody t={t} lang={lang} rel={rel} trend={trends[i]} link={pickLink(reservoirById(rel.reservoirId), station, b)} note />
            <span className="flex flex-wrap items-center gap-x-4 text-xs">
              <a href={rel.url} target="_blank" rel="noopener noreferrer" className={linkCls}>
                {rel.kind === "confirmed"
                  ? t("release.asOf", { source: sourceName(t, rel.source), when: when(t, rel.observedAt, rel.dayOnly) })
                  : t("release.readReport", { outlet: rel.source })}
              </a>
              {rel.kind === "confirmed" && rel.news && !rel.reported && (
                <a href={rel.news.url} target="_blank" rel="noopener noreferrer" className={linkCls}>
                  {t("release.newsLater", { outlet: rel.news.outlet, when: when(t, rel.news.publishedAt, false) })}
                </a>
              )}
              <Link href={`${p("/")}#how-it-works`} className={linkCls}>
                {t("release.howLink")}
              </Link>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Three-step size bar under the flow figure: filled steps = how big the release is. */
function SizeBar({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex gap-1" aria-hidden>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-gradient-to-r from-amber-300 to-amber-500 dark:from-amber-700 dark:to-amber-400" : "bg-slate-200 dark:bg-slate-800"}`} />
      ))}
    </div>
  );
}

const tileChip = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

/** Home: one compact card per active release, in a grid inside one amber container (same look as "Forecast to reach alert level"). */
function ReleaseTile({ t, lang, p, rel, trend }: { t: TFn; lang: Locale; p: (path: string) => string; rel: Release; trend: Trend | null }) {
  const sw = swFor(lang);
  const link = pickLink(reservoirById(rel.reservoirId));
  const first = link?.station ?? rel.stations[0];
  const href = first ? stationPath(rel.basin, first) : basinPath(rel.basin);
  const resPath = reservoirPath(rel.reservoirId);
  const resHref = resPath ? p(resPath) : null;
  const confirmed = rel.kind === "confirmed";
  const size = confirmed && rel.cusecs ? releaseSize(rel.cusecs) : null;
  const gauge = link ? stationDisplayName(link.station) : null;
  const town = link?.town && link.town !== gauge ? link.town : null;
  const status = rel.watch ? sw("watch.tag") : t(confirmed ? "release.tile.releasing" : "release.tile.reported");
  const nameCls = "block font-medium text-slate-900 dark:text-slate-100";
  return (
    <li className="flex h-full flex-col gap-2 rounded-lg border border-amber-200/80 dark:border-amber-900/50 bg-white/80 dark:bg-slate-900/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          {resHref ? <Link href={resHref} className={`${nameCls} hover:underline underline-offset-2`}>{rel.name}</Link> : <span className={nameCls}>{rel.name}</span>}
          <span className="block text-xs text-amber-800 dark:text-amber-300">{status}</span>
        </span>
        {size && <span className={`${tileChip} shrink-0 bg-amber-100 dark:bg-amber-900/50 font-semibold text-amber-900 dark:text-amber-100`}>{t(`release.size.${size}`)}</span>}
      </div>
      {size && rel.cusecs ? (
        <div className="space-y-1.5">
          <p className="text-lg font-semibold leading-tight tabular-nums text-slate-900 dark:text-slate-100">{t("release.flow", { n: fmt(litresPerSecond(rel.cusecs)) })}</p>
          <SizeBar step={SIZE_STEP[size]} />
        </div>
      ) : null}
      {(trend || (confirmed && rel.gatesOpen)) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {trend && (
            <span className={`${tileChip} ${trend.dir === "down" ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200"}`}>
              {trend.dir === "down" ? <TrendingDown className="size-3.5" aria-hidden /> : <TrendingUp className="size-3.5" aria-hidden />}
              {t(trend.dir === "down" ? "release.trendDown" : "release.trendUp", { n: fmt(roundCusecs(trend.from)) })}
            </span>
          )}
          {confirmed && rel.gatesOpen ? <span className={`${tileChip} bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300`}>{t("release.gatesOpen", { n: rel.gatesOpen })}</span> : null}
        </div>
      )}
      {confirmed && rel.cusecs ? <CusecFigure t={t} cusecs={rel.cusecs} /> : null}
      {rel.watch && <p className="text-xs text-slate-600 dark:text-slate-300">{sw("watch.note")}</p>}
      {rel.reported && <ReportedFigureLine t={t} rep={rel.reported} className="text-xs text-amber-800 dark:text-amber-300" />}
      {link && gauge && (
        <div className="mt-auto rounded-md bg-amber-50 dark:bg-amber-950/30 px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300">
          <p className="flex flex-wrap items-center gap-x-1 gap-y-0.5" aria-label={t("release.chainLabel", { a: rel.name, b: gauge })}>
            <Waves className="size-3.5 shrink-0" aria-hidden />
            <span>{rel.name}</span>
            <ChevronRight className="size-3 shrink-0 opacity-60" aria-hidden />
            <Gauge className="size-3.5 shrink-0" aria-hidden />
            <span>{gauge}</span>
            {town && (
              <>
                <ChevronRight className="size-3 shrink-0 opacity-60" aria-hidden />
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <span>{town}</span>
              </>
            )}
          </p>
          <span className={`${tileChip} mt-1 bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100`}>
            <Clock className="size-3" aria-hidden />
            {link.eta ? t("release.eta", { a: link.eta[0], b: link.eta[1] }) : t("release.etaSoon")}
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs">
        <Link href={p(href)} className="inline-flex items-center gap-1 min-h-11 sm:min-h-6 font-medium text-amber-900 dark:text-amber-200 hover:underline underline-offset-2">
          {first ? t("release.homeView", { gauge: stationDisplayName(first) }) : t("release.homeViewRiver")}
          <ArrowRight className="size-3" aria-hidden />
        </Link>
        <a href="#how-it-works" className="inline-flex items-center min-h-11 sm:min-h-6 text-slate-500 dark:text-slate-400 hover:underline underline-offset-2">
          {t("release.howLink")}
        </a>
      </div>
    </li>
  );
}

/** Home page: one compact card per active release, in a grid, next to "Needs attention". */
export async function ReleaseLines({ lang }: { lang: Locale }) {
  const { t, p } = getI18n(lang);
  const all = await getReleases().catch(() => null);
  if (!all || all.releases.length === 0) return null;
  const trends = await Promise.all(all.releases.map((r) => releaseTrend(r.reservoirId, r.cusecs)));
  return (
    <section className="mb-5 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 sm:p-4" aria-label={t("needs.heading")} lang={lang}>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
        <Waves className="size-4" aria-hidden /> {t("release.tile.title")}
        <span className="ml-auto rounded-full bg-amber-200/70 dark:bg-amber-900/60 px-2 py-0.5 text-xs font-medium tabular-nums">{all.releases.length}</span>
      </h3>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {all.releases.map((rel, i) => (
          <ReleaseTile key={rel.reservoirId} t={t} lang={lang} p={p} rel={rel} trend={trends[i]} />
        ))}
      </ul>
    </section>
  );
}
