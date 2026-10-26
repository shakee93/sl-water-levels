"use client";

import { useEffect } from "react";
import { CARRY_KEYS } from "./SavedDataMarker";

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
      for (const k of CARRY_KEYS) {
        const v = data[k];
        if (typeof v === "string" && v.length < 20_000 && localStorage.getItem(k) == null) localStorage.setItem(k, v);
      }
      // the stored places and levels are read on load: reload once without the fragment so every card picks them up
      history.replaceState(null, "", location.pathname + location.search);
      location.reload();
    } catch {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }, []);
  return null;
}
