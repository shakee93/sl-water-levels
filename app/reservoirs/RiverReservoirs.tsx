import { Suspense } from "react";
import Link from "next/link";
import { Waves } from "lucide-react";
import { getReservoirs, riverMatches, type RV } from "@/lib/reservoirData";
import { connectingReservoirs } from "@/lib/reservoirs";
import { stationDisplayName } from "@/lib/displayName";
import { rtFor } from "@/lib/i18n/reservoirs";
import { getI18n } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";
import { SpillWatchChip } from "@/app/SpillWatchChip";
import { SizeChip, StatusChip } from "./bits";
import { localName } from "./RvCard";

/** "Reservoirs on this river" (basin) or "Reservoirs above this gauge" (station): a small strip of links. Fails soft, empty = nothing. */
export async function RiverReservoirs({ lang, basin, station }: { lang: Locale; basin?: string; station?: string }) {
  // On a gauge page `basin` is the gauge's river too: reservoirs linked to the gauge or to any gauge above it count.
  const data = await getReservoirs().catch(() => null);
  if (!data) return null;
  let list: RV[];
  const via = new Map<string, { steps: number; via: string | null }>();
  if (station && basin) {
    for (const c of connectingReservoirs(basin, station)) via.set(c.res.id, { steps: c.steps, via: c.via });
    list = data.items.filter((r) => r.catalogueId && via.has(r.catalogueId));
  } else {
    list = data.items.filter((r) => basin && riverMatches(r, basin));
  }
  if (list.length === 0) return null;
  const order = { spilling: 0, releasing: 1, holding: 2, nodata: 3 } as const;
  const steps = (r: RV) => (r.catalogueId ? via.get(r.catalogueId)?.steps ?? 0 : 0);
  list = [...list].sort((a, b) => steps(a) - steps(b) || order[a.status] - order[b.status] || a.name.localeCompare(b.name)).slice(0, 12);
  const { t, p } = getI18n(lang);
  const rt = rtFor(lang);
  return (
    <section className="mt-8" aria-label={rt(station ? "strip.station" : "strip.river")}>
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
        <Waves className="size-4" aria-hidden /> {rt(station ? "strip.station" : "strip.river")}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {list.map((r) => {
          const v = r.catalogueId ? via.get(r.catalogueId) : undefined;
          return (
          <li key={r.slug} className="max-w-full">
            <Link
              href={p(`/reservoirs/${r.slug}`)}
              className="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 min-h-11 sm:min-h-9 rounded-2xl py-1 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-3 pr-2 text-sm hover:border-sky-300 dark:hover:border-sky-700 transition"
            >
              {localName(r, lang)}
              <StatusChip status={r.status} rt={rt} />
              {r.flow && r.flow.kind !== "outlets" && !r.barrage && <SizeChip cusecs={r.flow.cusecs} t={t} />}
              <Suspense fallback={null}><SpillWatchChip lang={lang} slug={r.slug} catalogueId={r.catalogueId} /></Suspense>
              {v?.via && (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {rt("strip.via", { n: stationDisplayName(v.via) })} · {rt("strip.far")}
                </span>
              )}
            </Link>
          </li>
          );
        })}
      </ul>
    </section>
  );
}
