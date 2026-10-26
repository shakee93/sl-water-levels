"use client";

import dynamic from "next/dynamic";
import { CloudRain } from "lucide-react";
import { rmFor } from "@/lib/i18n/rainMap";
import { useI18n } from "../LocaleProvider";
import type { RainMapStrings } from "./RainMapView";

// The drawing (geometry + canvas code) is its own chunk, fetched after the page text is on screen.
const RainMapView = dynamic(() => import("./RainMapView").then((m) => m.RainMapView), { ssr: false, loading: () => <Skeleton /> });

function Skeleton() {
  const { lang } = useI18n();
  return (
    <div className="mx-auto grid aspect-[500/848] w-full max-w-[560px] place-items-center rounded-xl bg-slate-100 dark:bg-slate-900 lg:aspect-auto lg:h-[max(560px,75vh)] lg:max-w-none">
      <span className="flex flex-col items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <CloudRain className="size-5 animate-pulse motion-reduce:animate-none" aria-hidden />
        {rmFor(lang)("loading")}
      </span>
    </div>
  );
}

export function RainMap(props: RainMapStrings) {
  return <RainMapView {...props} />;
}
