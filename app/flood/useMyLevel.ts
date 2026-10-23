"use client";

import { useSyncExternalStore } from "react";
import { MY_LEVELS_EVENT, MY_LEVELS_KEY, parseMyLevel, readMyLevelsRaw } from "@/lib/myLevels";

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => (e.key === null || e.key === MY_LEVELS_KEY) && cb();
  window.addEventListener("storage", onStorage);
  window.addEventListener(MY_LEVELS_EVENT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(MY_LEVELS_EVENT, cb);
  };
}

/** The visitor's saved flood level for one gauge (localStorage sl_my_levels); null on the server and when unset. */
export function useMyLevel(station: string | null): number | null {
  const raw = useSyncExternalStore(subscribe, readMyLevelsRaw, () => null);
  return station ? parseMyLevel(raw, station) : null;
}
