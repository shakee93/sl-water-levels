import type { Locale } from "@/lib/i18n/config";
import { ccFor } from "@/lib/i18n/colombo";

/**
 * Schematic map of where Colombo's canal water goes (not to scale; positions are approximate, from OpenStreetMap
 * waterways and the MCUDP project report). West is the coast; north is up. Arrows point the way the water drains.
 */
export function ColomboMap({ lang }: { lang: Locale }) {
  const cc = ccFor(lang);
  const river = "stroke-sky-600 dark:stroke-sky-400";
  const canal = "stroke-sky-800 dark:stroke-sky-300";
  const label = "fill-slate-800 dark:fill-slate-200 text-[9px]";
  return (
    <svg viewBox="0 0 360 310" role="img" aria-label={cc("map.title")} className="w-full max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <defs>
        <marker id="cc-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
          <path d="M0 0 L8 4 L0 8 z" className="fill-sky-800 dark:fill-sky-300" />
        </marker>
      </defs>
      {/* sea */}
      <path d="M0 0 H62 C50 60 74 120 60 170 C48 220 70 260 58 310 H0 Z" className="fill-sky-100 dark:fill-sky-950" />
      <text x="12" y="150" className={label}>{cc("map.sea")}</text>
      {/* Kolonnawa basin (shaded) */}
      <ellipse cx="215" cy="118" rx="62" ry="38" className="fill-amber-50 dark:fill-amber-950/40 stroke-amber-300 dark:stroke-amber-800" strokeDasharray="3 3" />
      <text x="168" y="112" className={label}>{cc("basin.kolonnawa")}</text>
      {/* Kelani river along the north, flowing west to the sea */}
      <path d="M355 52 C300 56 250 60 200 62 C150 64 110 66 62 62" fill="none" strokeWidth="4" className={river} markerEnd="url(#cc-arrow)" />
      <text x="296" y="42" className={label}>{cc("map.kelani")}</text>
      {/* North Lock and Gothatuwa gates on the river edge */}
      <circle cx="195" cy="64" r="4" className="fill-slate-700 dark:fill-slate-200" />
      <text x="120" y="52" className={label}>{cc("map.northlock")}</text>
      <circle cx="268" cy="60" r="4" className="fill-slate-700 dark:fill-slate-200" />
      <text x="262" y="84" className={label}>{cc("map.gothatuwa")}</text>
      {/* Kolonnawa canal from the lake north to the river */}
      <path d="M235 168 C232 140 215 110 196 70" fill="none" strokeWidth="2.5" className={canal} markerEnd="url(#cc-arrow)" />
      <text x="244" y="140" className={label}>{cc("map.kolonnawa")}</text>
      {/* north canals: Beira Lake to Mutwal tunnel to the river mouth */}
      <ellipse cx="128" cy="124" rx="17" ry="9" className="fill-sky-200 dark:fill-sky-900 stroke-sky-600 dark:stroke-sky-400" />
      <path d="M118 118 C100 100 86 82 66 66" fill="none" strokeWidth="2.5" className={canal} markerEnd="url(#cc-arrow)" />
      <text x="82" y="144" className={label}>{cc("map.mutwal")}</text>
      {/* Parliament Lake */}
      <ellipse cx="248" cy="192" rx="30" ry="16" className="fill-sky-200 dark:fill-sky-900 stroke-sky-600 dark:stroke-sky-400" />
      <text x="222" y="196" className={label}>{cc("map.lake")}</text>
      {/* Kotte canals south to the sea */}
      <path d="M222 200 C190 222 140 236 66 250" fill="none" strokeWidth="2.5" className={canal} markerEnd="url(#cc-arrow)" />
      <path d="M232 206 C200 250 140 276 66 284" fill="none" strokeWidth="2.5" className={canal} markerEnd="url(#cc-arrow)" />
      <text x="150" y="226" className={label}>{cc("map.kotte")}</text>
      <text x="70" y="236" className={label}>{cc("map.wellawatta")}</text>
      <text x="72" y="300" className={label}>{cc("map.dehiwala")}</text>
      <text x="340" y="16" className={label}>{cc("map.north")}</text>
      <path d="M344 40 V22" stroke="currentColor" strokeWidth="1.5" markerEnd="url(#cc-arrow)" className="text-slate-600 dark:text-slate-300" />
    </svg>
  );
}
