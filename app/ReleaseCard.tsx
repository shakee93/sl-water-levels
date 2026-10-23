import Link from "next/link";
import { ArrowRight, Waves } from "lucide-react";
import { getReleases, type Release } from "@/lib/releases";
import { reservoirById } from "@/lib/reservoirs";
import { stationDisplayName } from "@/lib/displayName";
import { basinPath, stationPath } from "@/lib/slug";
import { getI18n } from "@/lib/i18n/server";
import { clock, colomboParts, riverName, shortDay, shortStamp } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { TFn } from "@/lib/i18n/translate";

// Reservoir release warnings, in plain words: who is releasing, about how much, and when it
// should reach this gauge. Official numbers say "Irrigation Department"; a news-only report says
// "reported" and is never presented as official. Fails soft: no data, no card.

const roundCusecs = (c: number) => Math.round(c / 10) * 10;

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

function Sentences({ t, lang, rel, station, basin }: { t: TFn; lang: Locale; rel: Release; station?: string; basin?: string }) {
  const res = reservoirById(rel.reservoirId);
  const link = station ? res?.gauges.find((g) => g.station === station) : res?.gauges.find((g) => g.basin === basin && g.eta) ?? res?.gauges.find((g) => g.basin === basin);
  const gauge = link ? stationDisplayName(link.station) : null;

  let tail: string;
  if (!res || res.gauges.length === 0) tail = t("release.noGaugeBelow");
  else if (link?.eta && gauge) tail = t("release.etaRange", { gauge, a: link.eta[0], b: link.eta[1] });
  else if (gauge) tail = t("release.mayRise", { gauge });
  else tail = t("release.mayRiseRiver", { river: riverName(rel.basin, lang) });

  const head =
    rel.kind === "confirmed"
      ? t("release.confirmed", {
          name: rel.name,
          cusecs: roundCusecs(rel.cusecs ?? 0).toLocaleString("en-US"),
          source: sourceName(t, rel.source),
          when: when(t, rel.observedAt, rel.dayOnly),
        })
      : t("release.reported", { name: rel.name, outlet: rel.source, when: when(t, rel.observedAt, false) });

  return (
    <>
      {head}
      {rel.kind === "confirmed" && rel.gatesOpen ? ` ${t("release.gatesOpen", { n: rel.gatesOpen })}` : ""}
      {" "}
      {tail}
      {rel.kind === "reported" && ` ${t("release.reportedNote")}`}
      {rel.kind === "confirmed" && rel.news && ` ${t("release.newsLater", { outlet: rel.news.outlet, name: rel.name, when: when(t, rel.news.publishedAt, false) })}`}
    </>
  );
}

const linkCls = "underline underline-offset-2 inline-flex items-center min-h-11 sm:min-h-6 whitespace-nowrap";

/** Amber card on a gauge page (station) or a river page (basin). Several releases stack. */
export async function ReleaseCard({ lang, station, basin }: { lang: Locale; station?: string; basin?: string }) {
  const { t } = getI18n(lang);
  const all = await getReleases().catch(() => null);
  if (!all) return null;
  const b = (basin ?? "").trim();
  const mine = all.releases.filter((r) => {
    const res = reservoirById(r.reservoirId);
    if (!res) return false;
    return station ? res.gauges.some((g) => g.station === station) : r.basin === b;
  });
  if (mine.length === 0) return null;
  return (
    <div className="mb-4 space-y-2" role="status">
      {mine.map((rel) => (
        <div
          key={rel.reservoirId}
          className="flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
        >
          <Waves className="size-4 mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p>
              <Sentences t={t} lang={lang} rel={rel} station={station} basin={b} />
            </p>
            <span className="flex flex-wrap items-center gap-x-4">
              <a href={rel.url} target="_blank" rel="noopener noreferrer" className={linkCls}>
                {rel.kind === "confirmed" ? sourceName(t, rel.source) : t("release.readReport")}
              </a>
              {rel.kind === "confirmed" && rel.news && (
                <a href={rel.news.url} target="_blank" rel="noopener noreferrer" className={linkCls}>
                  {rel.news.outlet}
                </a>
              )}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Home page: one line per active release, next to "Needs attention". */
export async function ReleaseLines({ lang }: { lang: Locale }) {
  const { t, p } = getI18n(lang);
  const all = await getReleases().catch(() => null);
  if (!all || all.releases.length === 0) return null;
  return (
    <ul className="mb-5 space-y-2" aria-label={t("needs.heading")}>
      {all.releases.map((rel) => {
        const first = rel.stations[0];
        const href = first ? stationPath(rel.basin, first) : basinPath(rel.basin);
        return (
          <li
            key={rel.reservoirId}
            className="flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
          >
            <Waves className="size-4 mt-0.5 shrink-0" aria-hidden />
            <p className="min-w-0 flex-1">
              {rel.kind === "confirmed"
                ? t("release.homeConfirmed", { name: rel.name, cusecs: roundCusecs(rel.cusecs ?? 0).toLocaleString("en-US") })
                : t("release.homeReported", { name: rel.name })}{" "}
              <Link href={p(href)} className="font-medium underline underline-offset-2 inline-flex items-center gap-1 min-h-11 sm:min-h-6">
                {first ? t("release.homeView", { gauge: stationDisplayName(first) }) : t("release.homeViewRiver")}
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
