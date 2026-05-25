import Link from "next/link";
import type { Station } from "@/lib/arcgis";
import { basinPath } from "@/lib/slug";
import { MapClient } from "./MapClient";

// Distinct, accessible colors (Tailwind v4 500-step values, hex).
// Up to 10 basins get unique colors; smaller basins cycle through —
// Sri Lanka's basins are spatially separated, so a north/south repeat
// doesn't visually collide on the map.
// 20 distinct colors so every basin can have its own (Sri Lanka has ~21
// basins in the feed; the last 1–2 cycle, but they're rare 1-station basins).
// Picked for visual separation on both dark and light tiles.
const PALETTE: ReadonlyArray<string> = [
  "#0ea5e9", // sky-500
  "#10b981", // emerald-500
  "#f59e0b", // amber-500
  "#f43f5e", // rose-500
  "#8b5cf6", // violet-500
  "#d946ef", // fuchsia-500
  "#14b8a6", // teal-500
  "#f97316", // orange-500
  "#84cc16", // lime-500
  "#6366f1", // indigo-500
  "#ec4899", // pink-500
  "#06b6d4", // cyan-500
  "#eab308", // yellow-500
  "#3b82f6", // blue-500
  "#a855f7", // purple-500
  "#22c55e", // green-500
  "#ef4444", // red-500
  "#a16207", // amber-700 (darker)
  "#0d9488", // teal-600 (darker)
  "#7c3aed", // violet-600 (darker)
];

export function SriLankaMap({ stations }: { stations: Station[] }) {
  const counts = new Map<string, number>();
  for (const s of stations) if (s.basin) counts.set(s.basin, (counts.get(s.basin) ?? 0) + 1);

  // Sort by station count desc so the largest basins get the most distinct
  // colors. Ties broken alphabetically for stability across renders.
  const basins = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([b]) => b);

  const colorForBasin: Record<string, string> = {};
  basins.forEach((b, i) => {
    colorForBasin[b] = PALETTE[i % PALETTE.length];
  });

  const valid = stations.filter(
    (s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude),
  );

  return (
    <section className="mb-8">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <div className="px-4 sm:px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Every gauge, on the map
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {valid.length} stations across {basins.length} basins — hover a dot, click for details.
            </p>
          </div>
          <span className="hidden sm:inline text-[10px] uppercase tracking-[0.18em] text-slate-400 font-medium whitespace-nowrap">
            Sri Lanka
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-0">
          <div className="relative h-[440px] sm:h-[560px] lg:h-[720px]">
            <MapClient stations={valid} colorForBasin={colorForBasin} />
          </div>

          <aside className="border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30 p-3 sm:p-4 lg:max-h-[720px] lg:overflow-y-auto">
            <h3 className="text-[10px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 font-medium mb-2">
              Basins · {basins.length}
            </h3>
            <ul className="space-y-0.5">
              {basins.map((b) => {
                const color = colorForBasin[b];
                const count = counts.get(b) ?? 0;
                return (
                  <li key={b}>
                    <Link
                      href={basinPath(b)}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-white dark:hover:bg-slate-800/70 transition group"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          style={{ backgroundColor: color }}
                          className="size-2.5 rounded-full ring-1 ring-black/5 dark:ring-white/10 shrink-0"
                        />
                        <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300 truncate group-hover:text-sky-700 dark:group-hover:text-sky-300 transition">
                          {b}
                        </span>
                      </span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums shrink-0">
                        {count}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>
      </div>
    </section>
  );
}
