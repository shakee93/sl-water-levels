import Link from "next/link";
import { Waves } from "lucide-react";
import { getReservoirs, riverMatches, type RV } from "@/lib/reservoirData";
import { reservoirsForStation } from "@/lib/reservoirs";
import { rtFor } from "@/lib/i18n/reservoirs";
import { getI18n } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";
import { StatusChip } from "./bits";
import { localName } from "./RvCard";

/** "Reservoirs on this river" (basin) or "Reservoirs above this gauge" (station): a small strip of links. Fails soft, empty = nothing. */
export async function RiverReservoirs({ lang, basin, station }: { lang: Locale; basin?: string; station?: string }) {
  const data = await getReservoirs().catch(() => null);
  if (!data) return null;
  let list: RV[];
  if (station) {
    const ids = new Set(reservoirsForStation(station).map((x) => x.res.id));
    list = data.items.filter((r) => r.catalogueId && ids.has(r.catalogueId));
  } else {
    list = data.items.filter((r) => basin && riverMatches(r, basin));
  }
  if (list.length === 0) return null;
  const order = { spilling: 0, releasing: 1, holding: 2, nodata: 3 } as const;
  list = [...list].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name)).slice(0, 12);
  const { p } = getI18n(lang);
  const rt = rtFor(lang);
  return (
    <section className="mt-8" aria-label={rt(station ? "strip.station" : "strip.river")}>
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
        <Waves className="size-4" aria-hidden /> {rt(station ? "strip.station" : "strip.river")}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {list.map((r) => (
          <li key={r.slug}>
            <Link
              href={p(`/reservoirs/${r.slug}`)}
              className="inline-flex items-center gap-2 min-h-11 sm:min-h-9 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-3 pr-2 text-sm hover:border-sky-300 dark:hover:border-sky-700 transition"
            >
              {localName(r, lang)}
              <StatusChip status={r.status} rt={rt} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
