"use client";

import { useEffect } from "react";

export { CARRY_KEYS } from "@/lib/carryKeys";
const MARK = ["sl_favourites", "sl_my_levels", "sl_low_spots", "sl_loc"];

/**
 * Sets the cookie sl_has_data=1 on phones that keep saved places, street levels or a location here, or have alerts on. On the day the site
 * moves to its own domain, the old address sends these visitors (and only these) to a one-time hand-over page that copies
 * their data across; search engines and new visitors get a plain permanent redirect. Renders nothing.
 */
export function SavedDataMarker() {
  useEffect(() => {
    const mark = (has: boolean) => {
      const set = document.cookie.split("; ").some((c) => c.startsWith("sl_has_data="));
      if (has && !set) document.cookie = "sl_has_data=1; max-age=31536000; path=/; SameSite=Lax; Secure";
      if (!has && set) document.cookie = "sl_has_data=; max-age=0; path=/; SameSite=Lax; Secure";
    };
    let saved = false;
    try {
      saved = MARK.some((k) => {
        const v = localStorage.getItem(k);
        return v != null && v !== "" && v !== "[]" && v !== "{}";
      });
    } catch {
      /* storage blocked */
    }
    if (saved || !("serviceWorker" in navigator)) return mark(saved);
    // alerts switched on count too: their subscription is carried across so the phone never gets the same alert twice
    navigator.serviceWorker
      .getRegistration()
      .then((r) => r?.pushManager.getSubscription())
      .then((s) => mark(!!s), () => mark(false));
  }, []);
  return null;
}
