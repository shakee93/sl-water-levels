import Link from "next/link";
import { ArrowRight, LifeBuoy, Phone } from "lucide-react";
import { fetchBasinSnapshot } from "@/lib/arcgis";
import { DISTRICT_BY_STATION } from "@/lib/districts";
import { contactsForDistrict, guidanceForTier, telHref } from "@/lib/help";
import { getI18n } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";

/**
 * variant "card": the "Getting ready" card, shown only when the gauge is at alert or above.
 * variant "link": one quiet link to /help, shown for every other state.
 */
export async function StationHelpCard({
  lang,
  basin,
  station,
  variant,
}: {
  lang: Locale;
  basin: string;
  station: string;
  variant: "card" | "link";
}) {
  const { t, p } = getI18n(lang);
  const me = (await fetchBasinSnapshot(basin)).find((s) => s.station === station);
  const tier = me?.tier ?? "stale";
  const elevated = tier === "alert" || tier === "minor" || tier === "major";
  const helpHref = p(`/help?station=${encodeURIComponent(station)}`);

  if (!elevated) {
    if (variant === "card") return null;
    return (
      <p className="mt-8 text-center">
        <Link
          href={helpHref}
          className={`inline-flex items-center gap-1 min-h-11 px-2 text-sm text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 hover:underline rounded ${ring}`}
        >
          {t("common.floodHelpLink")} <ArrowRight className="size-4" aria-hidden />
        </Link>
      </p>
    );
  }
  if (variant === "link") return null;

  const g = guidanceForTier(tier);
  const cardTitle = t(`helpcard.${tier}` as "helpcard.alert");
  const district = DISTRICT_BY_STATION[station] ?? null;
  const dc = contactsForDistrict(district);
  const btn =
    "inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-lg text-sm font-semibold transition";

  return (
    <section
      aria-label={cardTitle}
      className="mt-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4 sm:p-5"
    >
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <LifeBuoy className="size-5 text-sky-600 dark:text-sky-400" aria-hidden />
        {cardTitle}
      </h2>
      <ul className="mt-2 space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
        {g.items.slice(0, 3).map((it) => (
          <li key={it.id} className="flex gap-2">
            <span aria-hidden className="text-slate-400">•</span>
            {t(`g.${it.id}` as "g.b-docs")}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={telHref("117")} className={`${btn} bg-sky-700 text-white hover:bg-sky-800 ${ring}`}>
          <Phone className="size-4" aria-hidden /> {t("common.call117")}
        </a>
        {dc ? (
          <a
            href={dc.tel}
            className={`${btn} border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 ${ring}`}
          >
            <Phone className="size-4" aria-hidden /> {t("common.callDmcOffice", { district: dc.district })}
          </a>
        ) : null}
        <Link
          href={helpHref}
          className={`${btn} font-medium text-slate-700 dark:text-slate-300 hover:underline ${ring}`}
        >
          {t("common.moreHelp")} <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
