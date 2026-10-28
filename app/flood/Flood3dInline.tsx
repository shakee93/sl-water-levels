"use client";
// Town page: the flood map card. Outcome first: one plain sentence about low ground near the town (precomputed, lib/flood3dTownLevels.ts, so it shows
// before the map loads), then what the map shows for the level on it. Nothing of the map is fetched until the card is about to scroll into view: the
// wrapper is plain markup, and only then is the map component (and, from it, MapLibre, level.webp and the tiles) imported. Two-finger pan on touch and
// Ctrl/Cmd + scroll to zoom keep the page scrollable (MapLibre cooperative gestures, set by the map's compact mode; off in full screen).
// The map itself is always the light map; the card around it follows the site theme. The survey link is the card's footer row.
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronRight, Map as MapIcon } from "lucide-react";
import type { EmbedState } from "@/app/[lang]/lab/flood-3d/Flood3dMap";
import { firstLine, levelLine, townHasLevels } from "./townFloodText";

const Flood3dMap = dynamic(() => import("@/app/[lang]/lab/flood-3d/Flood3dMap"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center bg-white text-sm text-slate-500">…</div>,
});
const MARKS = { alert: 4, minor: 5, major: 7 }; // Nagalagam Street's official steps until the live reading brings them

export function Flood3dInline({ title, lead, mapLabel, lat, lon, lang, survey, slug, town }: { title: string; lead: string; mapLabel: string; lat: number; lon: number; lang: "en" | "si" | "ta"; survey?: { href: string; label: string }; slug?: string; town?: string }) {
  const [near, setNear] = useState(false);
  const [st, setSt] = useState<EmbedState | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { const t = setTimeout(() => setNear(true), 0); return () => clearTimeout(t); }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const has = !!slug && !!town && townHasLevels(slug);
  const first = has ? firstLine(lang, slug!, town!, st?.marks ?? MARKS) : null;
  const second = has && st ? levelLine(lang, slug!, town!, st.scen, st.nowFt, st.shownFt) : null;
  return (
    <section aria-labelledby="f3d-embed-h" className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/60">
      <div className="p-4 sm:p-5">
        <h2 id="f3d-embed-h" className="flex items-center gap-2 font-semibold tracking-tight">
          <MapIcon className="size-4 text-sky-600 dark:text-sky-400" aria-hidden />
          {title}
        </h2>
        {first && (
          <p className="mt-2 text-[15px] leading-snug text-slate-900 dark:text-slate-100" data-testid="f3d-town-line" aria-live="polite">
            {first}{second && <> <strong className="font-semibold">{second}</strong></>}
          </p>
        )}
        <p className={`${first ? "mt-2 text-xs" : "mt-1 text-sm"} text-slate-600 dark:text-slate-400`}>{lead}</p>
      </div>
      <div ref={holder} role="region" aria-label={mapLabel} className="h-[540px] overflow-hidden border-y border-slate-200 bg-slate-100 dark:border-slate-700 md:h-[580px]">
        {near && <Flood3dMap lang={lang} embed view={[lon, lat, 14]} onState={setSt} />}
      </div>
      {survey && (
        <a href={survey.href} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2.5 text-sm font-semibold text-sky-700 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 dark:text-sky-300 dark:hover:bg-sky-950/40 sm:px-5">
          <span>{survey.label}</span>
          <ChevronRight className="size-4 shrink-0" aria-hidden />
        </a>
      )}
    </section>
  );
}
