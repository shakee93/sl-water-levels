import Link from "next/link";
import { Waves, ChevronDown } from "lucide-react";
import { fetchStations, type Station } from "@/lib/arcgis";
import { basinPath } from "@/lib/slug";

export async function Header() {
  let stations: Station[] = [];
  try {
    stations = await fetchStations();
  } catch {
    /* degrade gracefully — brand still shows */
  }

  const basins = (() => {
    const set = new Set<string>();
    for (const s of stations) if (s.basin) set.add(s.basin);
    return [...set].sort();
  })();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/85 dark:bg-slate-950/85 backdrop-blur supports-[backdrop-filter]:bg-white/70 dark:supports-[backdrop-filter]:bg-slate-950/70">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
        <Link
          href="/"
          className="group flex items-center gap-2 min-w-0"
          aria-label="Sri Lanka Water Levels — home"
        >
          <span className="grid place-items-center size-7 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-sm group-hover:shadow transition">
            <Waves className="size-4" aria-hidden />
          </span>
          <span className="flex flex-col leading-tight min-w-0">
            <span className="text-[13px] font-semibold tracking-tight text-slate-900 dark:text-slate-100 truncate">
              Sri Lanka Water Levels
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 -mt-0.5 hidden sm:block">
              Live river-gauge readings
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2 text-sm">
          {basins.length > 0 && (
            <details className="relative group">
              <summary
                className="list-none cursor-pointer select-none inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                Basins
                <ChevronDown className="size-3.5 text-slate-400 group-open:rotate-180 transition" aria-hidden />
              </summary>
              <div className="absolute right-0 mt-1 w-56 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg overflow-hidden">
                <ul className="py-1 max-h-80 overflow-y-auto">
                  {basins.map((b) => (
                    <li key={b}>
                      <Link
                        href={basinPath(b)}
                        className="block px-3 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-sky-700 dark:hover:text-sky-300 transition"
                      >
                        {b}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          )}

          <Link
            href="/about"
            className="rounded-md px-2.5 py-1.5 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            About
          </Link>

          <a
            href="https://github.com/shakee93/sl-water-levels"
            target="_blank"
            rel="noreferrer"
            className="hidden sm:inline-block rounded-md px-2.5 py-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
