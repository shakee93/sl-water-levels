"use client";

import { useSyncExternalStore } from "react";
import { LOW_SPOTS_EVENT, LOW_SPOTS_KEY, hasLowSpot, readLowSpotsRaw } from "@/lib/lowSpots";

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => (e.key === null || e.key === LOW_SPOTS_KEY) && cb();
  window.addEventListener("storage", onStorage);
  window.addEventListener(LOW_SPOTS_EVENT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(LOW_SPOTS_EVENT, cb);
  };
}

/** The raw stored list (null on the server and when unset). */
export function useLowSpotsRaw(): string | null {
  return useSyncExternalStore(subscribe, readLowSpotsRaw, () => null);
}

/** Has the visitor said their own spot in this town floods in heavy rain? (localStorage sl_low_spots; false on the server.) */
export function useLowSpot(slug: string): boolean {
  return hasLowSpot(useLowSpotsRaw(), slug);
}
