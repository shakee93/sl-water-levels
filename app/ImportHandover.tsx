"use client";

import { useEffect } from "react";
import { CARRY_KEYS } from "@/lib/carryKeys";

/**
 * After the move to waterlevels.lk: the old address's hand-over page (app/api/move/route.ts) opens this site with
 * #sl-import=<data> in the URL fragment. Store each carried key unless this phone already has it here (never overwrite),
 * then remove the fragment from the address bar. Renders nothing.
 */
export function ImportHandover() {
  useEffect(() => {
    const h = location.hash;
    if (!h.startsWith("#sl-import=")) return;
    try {
      const data = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(h.slice("#sl-import=".length)))))) as Record<string, unknown>;
      // sl_push_old: the old address's push endpoint, sent as `replaces` when alerts are turned on here (app/AlertsToggle.tsx)
      const got: string[] = [];
      for (const k of [...CARRY_KEYS, "sl_push_old"]) {
        const v = data[k];
        if (typeof v === "string" && v.length < 20_000 && localStorage.getItem(k) == null) {
          localStorage.setItem(k, v);
          got.push(k);
        }
      }
      // remember that the old address was checked from this browser (app/BringPlacesOver.tsx stops offering it), and what came
      const saved = got.filter((k) => k === "sl_favourites" || k === "sl_my_levels" || k === "sl_low_spots" || k === "sl_push_old");
      localStorage.setItem("sl_moved_checked", JSON.stringify({ at: Date.now(), saved }));
      history.replaceState(null, "", location.pathname + location.search);
      // the stored places and levels are read on load: reload once so every card picks them up (only when something came)
      if (got.length) location.reload();
    } catch {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }, []);
  return null;
}
