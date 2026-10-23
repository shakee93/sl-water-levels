import Link from "next/link";
import { SpillWatchChip } from "@/app/SpillWatchChip";
import type { RV } from "@/lib/reservoirData";
import { rtFor } from "@/lib/i18n/reservoirs";
import { getI18n } from "@/lib/i18n/server";
import { riverName } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { litresPerSecond } from "@/lib/releaseUi";
import { MiniBar, SizeChip, StatusChip, fmt } from "./bits";

/** Name in the page language when a local name is known. */
export const localName = (rv: RV, lang: Locale) => (lang === "si" ? rv.si : lang === "ta" ? rv.ta : null) ?? rv.name;

/** One reservoir as a compact visual row: name, river, storage bar, status and release size. */
export function RvCard({ rv, lang }: { rv: RV; lang: Locale }) {
  const { t, p } = getI18n(lang);
  const rt = rtFor(lang);
  const st = rv.storage;
  const flow = rv.status === "spilling" || rv.status === "releasing" ? rv.flow : null;
  return (
    <Link
      href={p(`/reservoirs/${rv.slug}`)}
      className="block h-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 hover:border-sky-300 dark:hover:border-sky-700 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block font-medium leading-tight truncate">{localName(rv, lang)}</span>
          <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">
            {[rv.river ? riverName(rv.river, lang) : null, rv.district].filter(Boolean).join(" · ") || rt(`kind.${rv.kind}` as "kind.major")}
          </span>
        </span>
        <StatusChip status={rv.status} rt={rt} />
      </span>
      <span className="mt-3 flex items-center gap-3">
        <span className="flex-1 min-w-0"><MiniBar pct={st?.pct ?? null} stale={st ? !st.fresh : false} /></span>
        <span className={`text-sm tabular-nums shrink-0 whitespace-nowrap text-right ${st && !st.fresh ? "text-slate-400 dark:text-slate-500" : ""}`}>{st ? rt("full", { n: Math.round(st.pct) }) : rt("noData")}</span>
      </span>
      {flow && (
        <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
          {flow.kind !== "outlets" && <SizeChip cusecs={flow.cusecs} t={t} />}
          <span className="tabular-nums">{t("release.cusecs", { n: fmt(flow.cusecs) })} · {rt("lps", { n: fmt(litresPerSecond(flow.cusecs)) })}</span>
        </span>
      )}
      <SpillWatchChip lang={lang} slug={rv.slug} catalogueId={rv.catalogueId} className="mt-2" />
    </Link>
  );
}
