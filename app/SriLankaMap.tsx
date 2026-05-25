import Link from "next/link";
import type { Station } from "@/lib/arcgis";
import { basinPath, stationPath } from "@/lib/slug";

const W = 600;
const H = 800;
const LON_MIN = 79.5;
const LON_MAX = 82.0;
const LAT_MIN = 5.7;
const LAT_MAX = 10.0;

function proj(lon: number, lat: number) {
  const x = ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * W;
  const y = ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * H;
  return { x, y };
}

// Hand-traced simplified coastline of Sri Lanka, clockwise from Point Pedro.
// Coordinates are (lon, lat) of recognisable coastal features.
const OUTLINE_LL: ReadonlyArray<readonly [number, number]> = [
  [80.23, 9.83], [80.81, 9.27], [81.06, 8.85], [81.22, 8.59],
  [81.42, 8.13], [81.69, 7.71], [81.83, 7.41], [81.83, 6.87],
  [81.45, 6.40], [81.13, 6.12], [80.79, 6.02], [80.55, 5.95],
  [80.22, 6.03], [79.99, 6.42], [79.96, 6.59], [79.85, 6.93],
  [79.83, 7.21], [79.79, 7.58], [79.83, 8.03], [79.76, 8.25],
  [79.91, 8.97], [79.74, 9.10], [79.85, 9.30], [80.07, 9.81],
];

function outlinePath(): string {
  return (
    OUTLINE_LL.map(([lon, lat], i) => {
      const { x, y } = proj(lon, lat);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ") + " Z"
  );
}

// Distinct, accessible Tailwind colors. Up to 10 basins get their own
// color; additional basins cycle through the same palette — that's fine
// because Sri Lanka's basins are spatially separated, so a repeat in the
// north and south doesn't visually collide on the map.
type Color = { dot: string; ring: string; swatch: string };
const PALETTE: ReadonlyArray<Color> = [
  { dot: "fill-sky-500",     ring: "stroke-sky-700",     swatch: "bg-sky-500" },
  { dot: "fill-emerald-500", ring: "stroke-emerald-700", swatch: "bg-emerald-500" },
  { dot: "fill-amber-500",   ring: "stroke-amber-700",   swatch: "bg-amber-500" },
  { dot: "fill-rose-500",    ring: "stroke-rose-700",    swatch: "bg-rose-500" },
  { dot: "fill-violet-500",  ring: "stroke-violet-700",  swatch: "bg-violet-500" },
  { dot: "fill-fuchsia-500", ring: "stroke-fuchsia-700", swatch: "bg-fuchsia-500" },
  { dot: "fill-teal-500",    ring: "stroke-teal-700",    swatch: "bg-teal-500" },
  { dot: "fill-orange-500",  ring: "stroke-orange-700",  swatch: "bg-orange-500" },
  { dot: "fill-lime-500",    ring: "stroke-lime-700",    swatch: "bg-lime-500" },
  { dot: "fill-indigo-500",  ring: "stroke-indigo-700",  swatch: "bg-indigo-500" },
];

function colorFor(basins: string[], basin: string): Color {
  const idx = basins.indexOf(basin);
  return PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length];
}

export function SriLankaMap({ stations }: { stations: Station[] }) {
  const counts = new Map<string, number>();
  for (const s of stations) if (s.basin) counts.set(s.basin, (counts.get(s.basin) ?? 0) + 1);

  // Sort basins by station count desc so the biggest basins get the most
  // distinct colors. Ties broken alphabetically for stability across renders.
  const basins = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([b]) => b);

  const valid = stations.filter(
    (s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude),
  );

  return (
    <section className="mb-8">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <div className="px-4 sm:px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-baseline justify-between">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Every gauge, on the island
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {valid.length} stations across {basins.length} basins — colored by basin, click any dot.
            </p>
          </div>
          <span className="hidden sm:inline text-[10px] uppercase tracking-[0.18em] text-slate-400 font-medium">
            Sri Lanka
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-0">
          <div className="bg-gradient-to-b from-sky-50/60 to-white dark:from-sky-950/30 dark:to-slate-900 p-3 sm:p-5">
            <svg
              viewBox={`-10 -10 ${W + 20} ${H + 20}`}
              role="img"
              aria-label={`Map of Sri Lanka with ${valid.length} river-gauge stations`}
              className="w-full h-auto max-h-[68vh] mx-auto block"
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <filter id="dotShadow" x="-50%" y="-50%" width="200%" height="200%">
                  <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodOpacity="0.25" />
                </filter>
              </defs>

              <path
                d={outlinePath()}
                className="fill-slate-50 dark:fill-slate-800/70 stroke-slate-300 dark:stroke-slate-700"
                strokeWidth={1.5}
                strokeLinejoin="round"
              />

              <g filter="url(#dotShadow)">
                {valid.map((s) => {
                  const { x, y } = proj(s.longitude, s.latitude);
                  const c = colorFor(basins, s.basin);
                  return (
                    <a key={`${s.basin}|${s.station}`} href={stationPath(s.basin, s.station)}>
                      <title>{s.station} — {s.basin}</title>
                      <circle
                        cx={x}
                        cy={y}
                        r={5.5}
                        className={`${c.dot} ${c.ring} transition-[stroke-width] hover:stroke-[3]`}
                        strokeWidth={1.5}
                      />
                    </a>
                  );
                })}
              </g>
            </svg>
          </div>

          <aside className="border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30 p-3 sm:p-4 max-h-[68vh] overflow-y-auto">
            <h3 className="text-[10px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 font-medium mb-2">
              Basins · {basins.length}
            </h3>
            <ul className="space-y-0.5">
              {basins.map((b) => {
                const c = colorFor(basins, b);
                const count = counts.get(b) ?? 0;
                return (
                  <li key={b}>
                    <Link
                      href={basinPath(b)}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-white dark:hover:bg-slate-800/70 transition group"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className={`size-2.5 rounded-full ${c.swatch} ring-1 ring-black/5 dark:ring-white/10 shrink-0`} />
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
