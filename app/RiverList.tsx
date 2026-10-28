import { VERDICT } from "./verdict";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, Minus } from "lucide-react";
import type { Tier } from "@/lib/arcgis";
import { basinPath } from "@/lib/slug";
import { stationDisplayName } from "@/lib/displayName";
import { formatLevel } from "@/lib/units";
import type { Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { riverName } from "@/lib/i18n/format";
import type { TFn } from "@/lib/i18n/translate";
import {
  TIER_DOT,
  TIER_TEXT_CLASS,
  STEADY_M_PER_H,
  tierLabel,
  tierLine,
  tierRank,
  type HomeStation,
} from "./tierUi";

// "All rivers" list on the home page. One card per river; rivers with a gauge that needs
// attention come first. Gauges with no recent reading or no published flood levels say so in
// words instead of showing a dash or a bare 0.00.

// New strings kept here (si/ta are drafts that need native review) so the shared i18n files
// stay untouched.
const COPY = {
  en: { stale: "No recent reading", none: "Level only" },
  si: { stale: "මෑත කියවීමක් නැත", none: "මට්ටම පමණි" },
  ta: { stale: "சமீபத்திய அளவீடு இல்லை", none: "மட்டம் மட்டும்" },
} as const;

const FLAGGED: Tier[] = ["major", "minor", "alert"]; // near alert reads Normal, so no bold

function statusText(t: TFn, lang: Locale, tier: Tier): string {
  if (tier === "stale") return COPY[lang].stale;
  if (tier === "none") return COPY[lang].none;
  return tierLine(t, tier);
}

function Trend({ t, s }: { t: TFn; s: HomeStation }) {
  if (s.tier === "stale" || s.rate3hM == null) return null;
  if (Math.abs(s.rate3hM) < STEADY_M_PER_H) {
    return <Minus className="size-4 text-slate-400" aria-label={t("trend.steady")} role="img" />;
  }
  return s.rate3hM > 0 ? (
    <ArrowUp className="size-4 text-orange-600 dark:text-orange-400" aria-label={t("trend.rising")} role="img" />
  ) : (
    <ArrowDown className="size-4 text-emerald-600 dark:text-emerald-400" aria-label={t("trend.falling")} role="img" />
  );
}

function Row({
  s, t, p, lang, river,
}: {
  s: HomeStation; t: TFn; p: (path: string) => string; lang: Locale;
  /** River name shown as a muted suffix (single-gauge rivers only). */
  river?: string;
}) {
  const flagged = FLAGGED.includes(s.tier);
  const quiet = s.tier === "stale" || s.tier === "none";
  const name = stationDisplayName(s.station);
  const showRiver = river && !name.toLowerCase().includes(s.basin.toLowerCase().split(" ")[0]);
  // Unknown-unit gauges with no flood levels would print a meaningless "0.00".
  const showLevel = s.tier !== "stale" && s.level != null && !(s.unit == null && s.tier === "none");
  return (
    <Link
      href={p(s.href)}
      className="group flex items-center justify-between gap-3 min-h-11 px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
    >
      <span className="flex items-center gap-2.5 min-w-0">
        <span className={`size-2.5 shrink-0 rounded-full ${TIER_DOT[s.tier]}`} aria-hidden />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
            {name}
          </span>
          <span className="block text-xs truncate">
            <span className={`${TIER_TEXT_CLASS[s.tier]} ${flagged ? "font-semibold" : ""}`}>
              {statusText(t, lang, s.tier)}
            </span>
            {/* the gauge page's forecast verdict when it is stronger than the level band (e.g. Normal now, likely alert in ~11 h) */}
            {s.verdict === "alert" && (s.tier === "normal" || s.tier === "watch") && (
              <span className="font-semibold text-amber-700 dark:text-amber-400"> · {VERDICT.alert[lang]}</span>
            )}
            {showRiver && (
              <span className="text-slate-500 dark:text-slate-400"> · {river}</span>
            )}
          </span>
        </span>
      </span>
      <span className="flex items-center gap-1.5 shrink-0">
        {showLevel && (
          <span className={`text-sm tabular-nums ${quiet ? "text-slate-500 dark:text-slate-400" : "font-medium text-slate-700 dark:text-slate-200"}`}>
            {formatLevel(s.level, s.unit)}
          </span>
        )}
        <Trend t={t} s={s} />
      </span>
    </Link>
  );
}

export function RiverList({ lang, stations }: { lang: Locale; stations: HomeStation[] }) {
  const { t, p } = getI18n(lang);
  const byBasin = new Map<string, HomeStation[]>();
  for (const s of stations) {
    const b = s.basin || "(no basin)";
    if (!byBasin.has(b)) byBasin.set(b, []);
    byBasin.get(b)!.push(s);
  }
  const rivers = [...byBasin.entries()]
    .map(([basin, list]) => ({
      basin,
      // Worst gauge first inside each river.
      list: [...list].sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.station.localeCompare(b.station)),
    }))
    // Rivers with the worst gauge first, then A to Z.
    .sort((a, b) => tierRank(a.list[0].tier) - tierRank(b.list[0].tier) || a.basin.localeCompare(b.basin));

  return (
    <section id="rivers" className="scroll-mt-4">
      <h2 className="sr-only">{t("home.allRivers")}</h2>
      <ul className="gap-3 md:columns-2 [&>li]:mb-3">
        {rivers.map(({ basin, list }) => {
          const single = list.length === 1;
          const name = riverName(basin, lang);
          return (
            <li key={basin} className="break-inside-avoid">
              <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
                {!single && (
                  <Link
                    href={p(basinPath(basin))}
                    className="group flex items-center justify-between gap-2 min-h-11 px-3.5 py-2 bg-slate-50/70 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
                  >
                    <h3 className="text-sm font-semibold tracking-tight group-hover:text-sky-700 dark:group-hover:text-sky-300 transition">
                      {name}
                    </h3>
                    <ArrowRight className="size-3.5 text-slate-400 group-hover:text-sky-500 transition" aria-hidden />
                  </Link>
                )}
                {list.map((s) => (
                  <Row key={s.href} s={s} t={t} p={p} lang={lang} river={single ? name.split(" · ")[0] : undefined} />
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
