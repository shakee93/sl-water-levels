"use client";

import dynamic from "next/dynamic";
import { MapPin } from "lucide-react";
import { useI18n } from "../LocaleProvider";
import { useInView } from "../useInView";
import { ccFor } from "@/lib/i18n/colombo";
import type { CanalMapData } from "./canalMapTypes";

// Leaflet touches `window`, so the map chunk is client-only, and it is fetched (with its 60 KB of canal geometry and
// the map tiles) only when the map is near the screen.
const Leaflet = dynamic(() => import("./CanalMapLeaflet").then((m) => m.CanalMapLeaflet), { ssr: false, loading: () => <Skeleton /> });

function Skeleton() {
  const { lang } = useI18n();
  const cc = ccFor(lang);
  return (
    <div className="grid h-[560px] place-items-center rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900 sm:h-[640px]">
      <div className="flex flex-col items-center gap-2 text-slate-500 dark:text-slate-400">
        <MapPin className="size-5 animate-pulse motion-reduce:animate-none" aria-hidden />
        <span className="text-xs">{cc("map.loading")}</span>
      </div>
    </div>
  );
}

export function CanalMap({ data }: { data: CanalMapData }) {
  const [ref, seen] = useInView<HTMLDivElement>("400px");
  return <div ref={ref}>{seen ? <Leaflet data={data} /> : <Skeleton />}</div>;
}
