"use client";

import dynamic from "next/dynamic";
import { MapPin } from "lucide-react";
import type { Station } from "@/lib/arcgis";

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

export function MapClient({
  stations,
  colorForBasin,
}: {
  stations: Station[];
  colorForBasin: Record<string, string>;
}) {
  return (
    <div className="relative w-full h-full min-h-[420px]">
      <MapLeaflet stations={stations} colorForBasin={colorForBasin} />
    </div>
  );
}

function MapSkeleton() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-gradient-to-b from-sky-50/60 to-white dark:from-sky-950/30 dark:to-slate-900">
      <div className="flex flex-col items-center gap-2 text-slate-400 dark:text-slate-500">
        <MapPin className="size-5 animate-pulse" aria-hidden />
        <span className="text-[11px] uppercase tracking-[0.18em]">Loading map…</span>
      </div>
    </div>
  );
}
