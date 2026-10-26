"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ChevronRight, MapPin, Phone } from "lucide-react";
import { contactsForDistrict } from "@/lib/help";
import { townPath } from "@/lib/places";
import { ttFor } from "@/lib/i18n/town";
import { formatKm, matchLocation } from "@/lib/nearby";
import { formatLevel } from "@/lib/units";
import { stationDisplayName } from "@/lib/displayName";
import { LocationPrompt } from "./LocationPrompt";
import { TONE } from "./ShareButton";
import { useI18n } from "./LocaleProvider";
import { useLocation } from "./useLocation";
import { CALL, NEXT_HOUR, VERDICT, directionFor } from "./verdict";
import { TIER_DOT, TIER_TEXT_CLASS, type HomeStation } from "./tierUi";

const ring =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";
const callBtn = `inline-flex items-center justify-center gap-2 h-11 w-full rounded-md px-4 text-sm font-semibold transition-colors ${ring}`;

/** Home page, top: the visitor's nearest river gauge, or the polite location prompt. */
export function NearYou({ stations }: { stations: HomeStation[] }) {
  const { loc, forget, ready } = useLocation();
  const { lang, t, p } = useI18n();
  const byStation = useMemo(() => new Map(stations.map((s) => [s.station, s])), [stations]);
  const near = useMemo(() => (loc ? matchLocation(loc, stations) : null), [loc, stations]);

  // Before the browser has told us anything, hold the prompt card's height so the page below it
  // does not jump when the card (or the nearest-gauge block) appears after hydration.
  if (!ready) return <div aria-hidden className="mb-5 h-[8.5rem] sm:h-[7.75rem] rounded-xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40" />;
  if (!loc || !near) return <LocationPrompt variant="card" />;

  const me = byStation.get(near.primary.station);
  if (!me) return null;
  // same verdict as the gauge page (forecast lift), not only the raw level band
  const tone = me.verdict ?? me.tier;
  const { icon: Icon, text, bar } = TONE[tone];
  const live = tone !== "stale" && tone !== "none";
  const elevated = tone === "alert" || tone === "minor" || tone === "major";
  const dc = elevated ? contactsForDistrict(near.district) : null;
  const next = live && me.rate3hM != null ? directionFor(me.rate3hM) : null;

  return (
    <section className="mb-6" aria-labelledby="near-you-heading">
      <h2
        id="near-you-heading"
        className="mb-2 flex items-center gap-1.5 text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100"
      >
        <MapPin className="size-3.5 text-sky-600 dark:text-sky-400" aria-hidden />
        {near.placeName ? t("near.near", { place: near.placeName }) : t("near.nearYou")}
      </h2>

      <div data-tier={tone} className={`rounded-xl border border-l-4 ${bar} border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm`}>
        <Link
          href={p(me.href)}
          className={`group flex items-center gap-3 p-4 rounded-t-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 transition ${ring}`}
        >
          <span className="min-w-0 flex-1" lang={lang}>
            <span className={`flex items-center gap-2 text-lg font-semibold ${text}`}>
              <Icon className="size-5 shrink-0" aria-hidden />
              {VERDICT[tone][lang]}
            </span>
            {next && (
              <span className="mt-1 block text-sm text-slate-700 dark:text-slate-300">
                <span className="text-slate-500 dark:text-slate-400">{NEXT_HOUR[lang]} </span>
                {next[lang]}
              </span>
            )}
            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400" lang="en">
              {stationDisplayName(me.station)} · {t("near.away", { km: formatKm(near.primary.km, t) })}
              {me.level != null && <> · <span className="tabular-nums">{formatLevel(me.level, me.unit)}</span></>}
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-slate-400 group-hover:text-sky-500 transition" aria-hidden />
        </Link>

        {near.placeName && (
          <Link
            href={p(townPath(near.placeName))}
            className={`group flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800 px-4 min-h-11 text-sm font-medium text-sky-700 dark:text-sky-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition ${ring}`}
          >
            {ttFor(lang)("near.link", { town: near.placeName })}
            <ChevronRight className="size-4 shrink-0 text-slate-400 group-hover:text-sky-500 transition" aria-hidden />
          </Link>
        )}

        {lang !== "en" && <p className="px-4 pb-2 text-xs text-slate-500 dark:text-slate-400">{t("common.machineTranslated")}</p>}

        {elevated && (
          <div className="px-4 pb-4 grid gap-2 sm:grid-cols-2">
            <a
              href="tel:117"
              className={`${callBtn} bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-200`}
            >
              <Phone className="size-4" aria-hidden /> {CALL[lang]}
            </a>
            {dc && (
              <a
                href={dc.tel}
                className={`${callBtn} border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800`}
              >
                <Phone className="size-4" aria-hidden /> {t("common.callDmcOffice", { district: dc.district })}
              </a>
            )}
          </div>
        )}

        {near.others.length > 0 && (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
            {near.others.map((o) => {
              const s = byStation.get(o.station);
              if (!s) return null;
              return (
                <li key={s.href}>
                  <Link href={p(s.href)} className={`group flex items-center gap-2.5 px-4 min-h-11 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition ${ring}`}>
                    <span className={`size-2 shrink-0 rounded-full ${TIER_DOT[s.tier]}`} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-900 dark:text-slate-100">
                      {stationDisplayName(s.station)}
                      <span className="text-xs text-slate-500 dark:text-slate-400"> · {formatKm(o.km, t)}</span>
                    </span>
                    <span className={`text-xs shrink-0 tabular-nums ${TIER_TEXT_CLASS[s.tier]}`}>{formatLevel(s.level, s.unit)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <div className="border-t border-slate-100 dark:border-slate-800 px-3 py-0 sm:py-1 text-right">
          <ForgetLink onClick={forget} />
        </div>
      </div>
    </section>
  );
}

export function ForgetLink({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center min-h-11 sm:min-h-8 px-1 text-xs text-slate-500 dark:text-slate-400 underline underline-offset-2 decoration-slate-300 dark:decoration-slate-600 hover:text-slate-800 dark:hover:text-slate-200 rounded ${ring} ${className}`}
    >
      {t("near.forget")}
    </button>
  );
}
