"use client";
// Town page: the flood map itself, inline. Nothing of it is fetched until the card is about to scroll into view: the wrapper is plain
// markup, and only then is the map component (and, from it, MapLibre, level.webp and the tiles) imported. Two-finger pan on touch and
// Ctrl/Cmd + scroll to zoom keep the page scrollable (MapLibre cooperative gestures, set by the map's compact mode).
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Map as MapIcon } from "lucide-react";

const Flood3dMap = dynamic(() => import("@/app/[lang]/lab/flood-3d/Flood3dMap"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">…</div>,
});

export function Flood3dInline({ title, lead, mapLabel, lat, lon, lang, survey }: { title: string; lead: string; mapLabel: string; lat: number; lon: number; lang: "en" | "si" | "ta"; survey?: { href: string; label: string } }) {
  const [near, setNear] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { const t = setTimeout(() => setNear(true), 0); return () => clearTimeout(t); }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <section aria-labelledby="f3d-embed-h" className="mt-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 sm:p-5">
      <h2 id="f3d-embed-h" className="flex items-center gap-2 font-semibold tracking-tight">
        <MapIcon className="size-4 text-sky-600 dark:text-sky-400" aria-hidden />
        {title}
      </h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{lead}</p>
      <div ref={holder} role="region" aria-label={mapLabel} className="mt-3 h-[360px] md:h-[440px] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/60">
        {near && <Flood3dMap lang={lang} embed view={[lon, lat, 14]} />}
      </div>
      {survey && (
        <a href={survey.href} className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-sky-600 px-4 text-sm font-semibold text-sky-700 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-sky-300 dark:hover:bg-sky-950/40">{survey.label}</a>
      )}
    </section>
  );
}
