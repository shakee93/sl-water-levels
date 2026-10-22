"use client";

// The chart (Recharts) is the heaviest script on a station page and sits below the verdict.
// Load it only when it is about to scroll into view; the placeholder has the chart's exact height,
// so nothing shifts when it arrives.
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { useInView } from "./useInView";
import type { LevelChart as LevelChartType } from "./LevelChart";

const CHART_BOX = "h-72 sm:h-80 w-full";

const LevelChart = dynamic(() => import("./LevelChart").then((m) => m.LevelChart), {
  ssr: false,
  loading: () => <div className={`${CHART_BOX} rounded-md bg-slate-100 dark:bg-slate-800/60 animate-pulse motion-reduce:animate-none`} aria-hidden />,
});

export function LevelChartLazy(props: ComponentProps<typeof LevelChartType>) {
  const [ref, seen] = useInView<HTMLDivElement>("400px");
  return (
    <div ref={ref} className={CHART_BOX}>
      {seen ? <LevelChart {...props} /> : <div className="h-full w-full rounded-md bg-slate-100 dark:bg-slate-800/60" aria-hidden />}
    </div>
  );
}
