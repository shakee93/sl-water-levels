import Link from "next/link";
import { SpillWatchChip } from "@/app/SpillWatchChip";
import type { RV } from "@/lib/reservoirData";
import { rtFor, type RT } from "@/lib/i18n/reservoirs";
import { getI18n } from "@/lib/i18n/server";
import { riverName } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { litresPerSecond } from "@/lib/releaseUi";
import { Basin, SizeMeter, StatusChip, fmt, levelOf } from "./bits";
import { KnownChip, NearSpillChip } from "./KnownChip";
import type { KnownStatus } from "@/lib/reservoirStatusCalc";
import { releaseSize } from "@/lib/releaseUi";

/** Name in the page language when a local name is known. */
export const localName = (rv: RV, lang: Locale) => (lang === "si" ? rv.si : lang === "ta" ? rv.ta : null) ?? rv.name;

const HAS_WORD: Record<Locale, RegExp> = {
  en: /\b(reservoir|tank|wewa|wawa|weva|lake|dam|barrage|anicut)\b/i,
  si: /(ජලාශ|වැව|වාන|බැරේජ|ඇල්ල)/,
  ta: /(நீர்த்தேக்க|குளம்|தடுப்பணை|அணை|ஏரி)/,
};
/** Page heading: the name, plus "Reservoir" (or "Barrage") when the name alone is a river or has no tank/wewa/dam word. */
export function displayName(rv: RV, lang: Locale, rt: RT): string {
  const name = localName(rv, lang);
  if (HAS_WORD[lang].test(name)) return name;
  return `${name} ${rt(rv.barrage ? "suffix.barrage" : "suffix.res")}`;
}

/** One reservoir as a compact visual row: name, river, storage bar, status and release size. */
export function RvCard({ rv, lang, known }: { rv: RV; lang: Locale; known?: KnownStatus }) {
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
        {known && rv.status === "nodata" && (known.trend || known.fsl) ? null : <StatusChip status={rv.status} rt={rt} />}
      </span>
      <span className="mt-3 flex items-center gap-3">
        <Basin level={levelOf(rv)} stale={st ? !st.fresh : false} spilling={rv.status === "spilling"} rt={rt} mini label={st ? rt("tank.aria", { n: Math.round(st.pct) }) : rt("tank.none")} />
        <span className="min-w-0 flex-1">
          <span className={`block text-xl font-semibold leading-none tabular-nums whitespace-nowrap ${st && !st.fresh ? "text-slate-400 dark:text-slate-500" : ""}`}>
            {st ? rt("full", { n: Math.round(st.pct) }) : <span className="text-sm font-normal text-slate-500 dark:text-slate-400">{rt("noData")}</span>}
          </span>
          {flow && flow.kind !== "outlets" && !rv.barrage ? (
            <span className="mt-1.5 block"><SizeMeter size={releaseSize(flow.cusecs)} t={t} compact /></span>
          ) : null}
        </span>
      </span>
      {known && rv.status === "nodata" && (known.trend || known.fsl) && (
        <span className="mt-2 flex flex-wrap items-center gap-1.5"><KnownChip st={known} rt={rt} t={t} showPct={false} /></span>
      )}
      {known?.nearSpill && <span className="mt-2 flex"><NearSpillChip rt={rt} /></span>}
      {flow && (
        <span className="mt-2 block text-xs text-slate-600 dark:text-slate-300 tabular-nums">
          {t("release.cusecs", { n: fmt(flow.cusecs) })} · {rt("lps", { n: fmt(litresPerSecond(flow.cusecs)) })}
        </span>
      )}
      <SpillWatchChip lang={lang} slug={rv.slug} catalogueId={rv.catalogueId} className="mt-2" />
    </Link>
  );
}
