"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Tier } from "@/lib/arcgis";
import { TIER_HEX, tierLabel } from "./tierUi";
import { useI18n } from "./LocaleProvider";

const TIERS: Tier[] = ["normal", "watch", "alert", "minor", "major", "stale"];

export function KeyList({ hasLakes, hasUser, cols = "grid-cols-2" }: { hasLakes: boolean; hasUser: boolean; cols?: string }) {
  const { t } = useI18n();
  return (
    <ul className={`grid ${cols} gap-x-3 gap-y-1 text-[11px] leading-4 text-slate-700 dark:text-slate-200`}>
      {TIERS.map((k) => (
        <li key={k} className="flex items-center gap-1.5">
          <span className="size-2.5 shrink-0 rounded-full border border-white/70 dark:border-slate-900" style={{ background: TIER_HEX[k] }} aria-hidden />
          {k === "stale" ? t("tier.noData") : tierLabel(t, k)}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="h-0.5 w-3 shrink-0 rounded bg-sky-500 dark:bg-sky-400" aria-hidden />
        {t("map.river")}
      </li>
      {hasLakes && (
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 shrink-0 rounded-[40%] bg-amber-500" aria-hidden />
          {t("map.releasing")}
        </li>
      )}
      {hasUser && (
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 shrink-0 rounded-full bg-blue-600" aria-hidden />
          {t("map.you")}
        </li>
      )}
    </ul>
  );
}

/** Phones: a small "Key" button in a corner of the map, closed until tapped. */
export function KeyOverlay({ hasLakes, hasUser }: { hasLakes: boolean; hasUser: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div data-map-key className="absolute left-2 top-2 z-[1000] max-w-[calc(100%-4rem)] rounded-lg border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 text-[11px] text-slate-700 dark:text-slate-200 shadow-sm backdrop-blur-sm lg:hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-1.5 px-2.5 py-1.5 font-medium">
        {t("map.key")}
        <ChevronDown className={`size-3 transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden />
      </button>
      {open && (
        <div className="px-2.5 pb-2">
          <KeyList hasLakes={hasLakes} hasUser={hasUser} />
        </div>
      )}
    </div>
  );
}
