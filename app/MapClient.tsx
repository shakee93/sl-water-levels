"use client";

import dynamic from "next/dynamic";
import { MapPin } from "lucide-react";
import type { HomeStation } from "./tierUi";
import { useI18n } from "./LocaleProvider";
import { useInView } from "./useInView";

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

export function MapClient({
  stations,
  lakes,
}: {
  stations: HomeStation[];
  lakes: HomeLake[];
}) {
  // The map sits well below the verdict list: fetch Leaflet and the tiles only when it is near the screen.
  const [ref, seen] = useInView<HTMLDivElement>("500px");
  return (
    <div ref={ref} className="relative w-full h-full">
      {seen ? <MapLeaflet stations={stations} lakes={lakes} /> : <MapSkeleton />}
    </div>
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
