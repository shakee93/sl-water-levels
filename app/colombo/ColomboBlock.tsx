import Link from "next/link";
import { Waves } from "lucide-react";
import type { Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { ccFor } from "@/lib/i18n/colombo";
import { basinOfTown, SEA_DRAINING } from "@/lib/colombo";
import type { Canals } from "@/lib/curw";
import { TideLine } from "./TideLine";
import { CanalLevels } from "./CanalLevels";

/** Is the basin's canal "higher than usual" now? Judged on the gauges that matter for the town's own water. */
export function basinCanalHigh(slug: string, canals: Canals | null): boolean {
  const b = basinOfTown(slug);
  if (!b || !canals) return false;
  const gs = canals.gauges.filter((g) => b.gauges.includes(g.name) && g.state !== "offline" && g.state !== "learning");
  return gs.some((g) => g.state === "higher" || g.state === "rising") && gs.filter((g) => g.state === "higher" || g.state === "rising").length >= Math.min(2, gs.length);
}

/**
 * Canal-area context for a town page: how water drains here, the tide line, the basin's canal gauges, and (only when the
 * canal really is high) one reason line. Context only: it never changes the town's flood verdict.
 */
export function ColomboBlock({ lang, slug, now, canals }: { lang: Locale; slug: string; now: number; canals: Canals | null }) {
  const b = basinOfTown(slug);
  if (!b) return null;
  const { p } = getI18n(lang);
  const cc = ccFor(lang);
  const high = basinCanalHigh(slug, canals);
  return (
    <div lang={lang}>
      <TideLine lang={lang} now={now} sea={canals?.sea ?? null} />
      <section aria-label={cc("drain.title")} className="mt-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300"><Waves className="size-4" aria-hidden /> {cc("drain.title")}</h2>
        <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-300">{cc(b.drainKey)}</p>
        {SEA_DRAINING.has(slug) && <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-300">{cc("nogauge")}</p>}
        {high && <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">{cc("canal.high")}</p>}
        <p className="mt-2 text-sm"><Link href={p("/colombo-canals")} className="text-sky-700 dark:text-sky-300 underline underline-offset-2 hover:no-underline">{cc("drain.more")}</Link></p>
      </section>
      {canals && <CanalLevels lang={lang} canals={canals} names={b.gauges} title={`${cc("canal.title")} · ${cc(b.nameKey)}`} showSea={b.tidal} />}
    </div>
  );
}
