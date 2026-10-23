"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { MapPin } from "lucide-react";
import { stationDisplayName } from "@/lib/displayName";
import { formatLevel } from "@/lib/units";
import { riverName } from "@/lib/i18n/format";
import { rtFor } from "@/lib/i18n/reservoirs";
import { TIER_HEX, tierLabel, tierRank, type HomeStation } from "./tierUi";
import { useI18n } from "./LocaleProvider";
import { useInView } from "./useInView";
import { KeyList } from "./MapKey";

// Leaflet touches `window` on import, so the map module must not SSR.
// next/dynamic with ssr:false is only allowed inside a Client Component —
// hence this wrapper.
const MapLeaflet = dynamic(
  () => import("./MapLeaflet").then((m) => m.MapLeaflet),
  {
    ssr: false,
    loading: () => <MapSkeleton />,
  },
);

export type HomeLake = { slug: string; name: string; lat: number; lon: number; status: "spilling" | "releasing"; href: string };

const isHot = (s: HomeStation) => s.tier === "watch" || s.tier === "alert" || s.tier === "minor" || s.tier === "major";

export function MapClient({
  stations,
  lakes,
}: {
  stations: HomeStation[];
  lakes: HomeLake[];
}) {
  // The map sits well below the verdict list: fetch Leaflet and the tiles only when it is near the screen.
  const [ref, seen] = useInView<HTMLDivElement>("500px");
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div ref={ref} className="relative h-[520px] w-full sm:mx-auto sm:h-[640px] sm:max-w-[560px] lg:h-[720px] lg:max-w-none">
        {seen ? <MapLeaflet stations={stations} lakes={lakes} hover={hover} /> : <MapSkeleton />}
      </div>
      <SidePanel stations={stations} lakes={lakes} hover={hover} setHover={setHover} />
    </div>
  );
}

/** Wide screens: the key, the gauges that need attention and the reservoirs releasing now. Hovering an item lights its marker. */
function SidePanel({ stations, lakes, hover, setHover }: { stations: HomeStation[]; lakes: HomeLake[]; hover: string | null; setHover: (id: string | null) => void }) {
  const { t, p, lang } = useI18n();
  const rt = rtFor(lang);
  const hot = stations.filter(isHot).sort((a, b) => tierRank(b.tier) - tierRank(a.tier) || (b.level ?? 0) - (a.level ?? 0));
  const row = (id: string, href: string, children: React.ReactNode) => (
    <li key={id}>
      <Link
        href={p(href)}
        onMouseEnter={() => setHover(id)}
        onMouseLeave={() => setHover(null)}
        onFocus={() => setHover(id)}
        onBlur={() => setHover(null)}
        className={`flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition ${hover === id ? "bg-slate-100 dark:bg-slate-800" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"}`}
      >
        {children}
      </Link>
    </li>
  );
  const h = "mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
  return (
    <aside className="hidden max-h-[720px] overflow-y-auto border-l border-slate-200 p-3 dark:border-slate-800 lg:block">
      <h3 className={h}>{t("map.key")}</h3>
      <div className="mb-4 px-2">
        <KeyList hasLakes={lakes.length > 0} hasUser={false} />
      </div>
      {hot.length > 0 && (
        <>
          <h3 className={h}>{t("needs.heading")}</h3>
          <ul className="mb-4">
            {hot.slice(0, 8).map((s) =>
              row(`g:${s.basin}|${s.station}`, s.href, (
                <>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: TIER_HEX[s.tier] }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{stationDisplayName(s.station)}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{riverName(s.basin, lang)} · {tierLabel(t, s.tier)}</span>
                  </span>
                  {s.level != null && <span className="shrink-0 tabular-nums text-slate-600 dark:text-slate-300">{formatLevel(s.level, s.unit)}</span>}
                </>
              )),
            )}
          </ul>
        </>
      )}
      {lakes.length > 0 && (
        <>
          <h3 className={h}>{t("map.releasingNow")}</h3>
          <ul>
            {lakes.map((l) =>
              row(`l:${l.slug}`, l.href, (
                <>
                  <span className={`size-2.5 shrink-0 rounded-[40%] ${l.status === "spilling" ? "bg-amber-500" : "bg-sky-500"}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{l.name}</span>
                  <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{rt(`s.${l.status}` as "s.spilling")}</span>
                </>
              )),
            )}
          </ul>
        </>
      )}
    </aside>
  );
}

function MapSkeleton() {
  const { t } = useI18n();
  return (
    <div className="absolute inset-0 grid place-items-center bg-slate-50 dark:bg-slate-900">
      <div className="flex flex-col items-center gap-2 text-slate-500 dark:text-slate-400">
        <MapPin className="size-5 animate-pulse motion-reduce:animate-none" aria-hidden />
        <span className="text-xs">{t("map.loading")}</span>
      </div>
    </div>
  );
}
