import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { spillWarningFor, spillWarningsForBasin, spillWarningsForStation, type SpillWarning } from "@/lib/spillWarnings";
import { reservoirPath } from "@/lib/reservoirData";
import { swFor } from "@/lib/i18n/spillWatch";
import { getI18n } from "@/lib/i18n/server";
import { clock, colomboParts, shortStamp } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { TFn } from "@/lib/i18n/translate";

// "Spill warning reported": news that a reservoir nears spill level or may open its gates. Context
// only. It is not a release and not official, and nothing here feeds a verdict or a tier.

/** "3:00 pm" for a time today, "22 Oct, 9:30 am" otherwise. */
export function warnWhen(t: TFn, iso: string): string {
  const ms = Date.parse(iso);
  const a = colomboParts(ms);
  const b = colomboParts(Date.now());
  return a.y === b.y && a.m === b.m && a.d === b.d ? clock(ms, t) : shortStamp(ms, t);
}

const box = "mb-4 flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 px-3 py-2 text-sm text-amber-900 dark:text-amber-200";
const linkCls = "underline underline-offset-2 inline-flex items-center min-h-11 sm:min-h-6";

/** River page (basin) or gauge page (station + basin): one heads-up per reservoir with a warning. */
export async function SpillWarningNote({ lang, basin, station }: { lang: Locale; basin: string; station?: string }) {
  const hits = await (station ? spillWarningsForStation(basin, station) : spillWarningsForBasin(basin)).catch(() => []);
  if (hits.length === 0) return null;
  const { t, p } = getI18n(lang);
  const sw = swFor(lang);
  return (
    <div className="mb-4 space-y-2" role="status">
      {hits.map(({ res, warning }) => {
        const path = reservoirPath(res.id);
        return (
          <div key={res.id} className={box.replace("mb-4 ", "")}>
            <TriangleAlert className="size-4 mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p>{sw("warn.river", { outlet: warning.outlet, when: warnWhen(t, warning.publishedAt), name: res.name })}</p>
              <span className="flex flex-wrap gap-x-4 text-xs">
                <a href={warning.url} target="_blank" rel="noopener noreferrer" className={linkCls}>{warning.headline}</a>
                {path && <Link href={p(path)} className={linkCls}>{res.name}</Link>}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Reservoir page: one line under the spill-window chip. */
export async function SpillWarningLine({ lang, catalogueId, className = "" }: { lang: Locale; catalogueId: string | null; className?: string }) {
  const w: SpillWarning | null = await spillWarningFor(catalogueId).catch(() => null);
  if (!w) return null;
  const { t } = getI18n(lang);
  const sw = swFor(lang);
  return (
    <p className={`text-sm text-amber-900 dark:text-amber-200 ${className}`} role="status">
      {sw("warn.page", { when: warnWhen(t, w.publishedAt), outlet: w.outlet })}{" "}
      <a href={w.url} target="_blank" rel="noopener noreferrer" className={linkCls}>{w.headline}</a>
    </p>
  );
}
