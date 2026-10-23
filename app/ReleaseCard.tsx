import Link from "next/link";
import { ArrowRight, ChevronRight, CircleHelp, Clock, Gauge, MapPin, TrendingDown, TrendingUp, Waves } from "lucide-react";
import { getReleases, type Release } from "@/lib/releases";
import { reservoirById, type GaugeLink } from "@/lib/reservoirs";
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

function pickLink(res: ReturnType<typeof reservoirById>, station?: string, basin?: string): GaugeLink | undefined {
  if (!res) return undefined;
  if (station) return res.gauges.find((g) => g.station === station);
  return res.gauges.find((g) => g.basin === basin && g.eta) ?? res.gauges.find((g) => g.basin === basin) ?? res.gauges.find((g) => g.eta) ?? res.gauges[0];
}

function RowBody({ t, lang, rel, trend, link, note }: { t: TFn; lang: Locale; rel: Release; trend: Trend | null; link?: GaugeLink; note: boolean }) {
  const sw = swFor(lang);
  const confirmed = rel.kind === "confirmed";
  const size = confirmed && rel.cusecs ? releaseSize(rel.cusecs) : null;
  const gauge = link ? stationDisplayName(link.station) : null;
  const town = link?.town && link.town !== gauge ? link.town : null;
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold">{rel.watch ? sw("watch.lead", { name: rel.name }) : t(confirmed ? "release.lead" : "release.leadReported", { name: rel.name })}</span>
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
      {link && gauge && (
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs" aria-label={t("release.chainLabel", { a: rel.name, b: gauge })}>
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
              {rel.kind === "confirmed" && rel.news && (
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

/** Home page: one compact visual row per active release, next to "Needs attention". */
export async function ReleaseLines({ lang }: { lang: Locale }) {
  const { t, p } = getI18n(lang);
  const all = await getReleases().catch(() => null);
  if (!all || all.releases.length === 0) return null;
  const trends = await Promise.all(all.releases.map((r) => releaseTrend(r.reservoirId, r.cusecs)));
  return (
    <ul className="mb-5 space-y-2" aria-label={t("needs.heading")}>
      {all.releases.map((rel, i) => {
        const link = pickLink(reservoirById(rel.reservoirId));
        const first = link?.station ?? rel.stations[0];
        const href = first ? stationPath(rel.basin, first) : basinPath(rel.basin);
        return (
          <li key={rel.reservoirId} className={shell}>
            <Waves className="size-4 mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <RowBody t={t} lang={lang} rel={rel} trend={trends[i]} link={link} note={false} />
              <span className="flex flex-wrap items-center gap-x-4">
                <Link href={p(href)} className="font-medium underline underline-offset-2 inline-flex items-center gap-1 min-h-11 sm:min-h-6">
                  {first ? t("release.homeView", { gauge: stationDisplayName(first) }) : t("release.homeViewRiver")}
                  <ArrowRight className="size-3" aria-hidden />
                </Link>
                <a href="#how-it-works" className={`${linkCls} text-xs`}>
                  {t("release.howLink")}
                </a>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
