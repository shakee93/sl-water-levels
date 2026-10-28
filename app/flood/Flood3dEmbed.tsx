"use client";
// Town page: the 3D flood test map (unlisted /lab/flood-3d) as a click-to-load embed. Nothing of the map is fetched until the visitor taps:
// the card is plain markup (no image, no third-party request), and the iframe (MapLibre, level.webp, tiles) is inserted on tap only.
import { useState } from "react";
import { Map as MapIcon } from "lucide-react";

export function Flood3dEmbed({ title, lead, show, frameTitle, lat, lon, lang }: { title: string; lead: string; show: string; frameTitle: string; lat: number; lon: number; lang: "en" | "si" | "ta" }) {
  const [on, setOn] = useState(false);
  const src = `${lang === "en" ? "" : `/${lang}`}/lab/flood-3d/embed?ll=${lon.toFixed(4)},${lat.toFixed(4)},14`;
  return (
    <section aria-labelledby="f3d-embed-h" className="mt-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 sm:p-5">
      <h2 id="f3d-embed-h" className="flex items-center gap-2 font-semibold tracking-tight">
        <MapIcon className="size-4 text-sky-600 dark:text-sky-400" aria-hidden />
        {title}
      </h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{lead}</p>
      <div className="mt-3 h-[360px] md:h-[440px] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/60">
        {on ? (
          <iframe src={src} title={frameTitle} loading="lazy" className="h-full w-full border-0" referrerPolicy="same-origin" />
        ) : (
          <div className="flex h-full items-center justify-center p-4">
            <button
              type="button"
              onClick={() => setOn(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:ring-offset-slate-900"
            >
              <MapIcon className="size-4" aria-hidden /> {show}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
