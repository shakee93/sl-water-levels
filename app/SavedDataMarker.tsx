"use client";

import { useEffect } from "react";

// Keys worth carrying to the new address (waterlevels.lk). Device-only conveniences (theme, dismissed banners) are not.
export const CARRY_KEYS = ["sl_favourites", "sl_my_levels", "sl_low_spots", "sl_loc", "sl_lang", "sl_recent_searches", "sl_station", "sl_theme"] as const;
const MARK = ["sl_favourites", "sl_my_levels", "sl_low_spots", "sl_loc"];

/**
 * Sets the cookie sl_has_data=1 on phones that keep saved places, street levels or a location here. On the day the site
 * moves to its own domain, the old address sends these visitors (and only these) to a one-time hand-over page that copies
 * their data across; search engines and new visitors get a plain permanent redirect. Renders nothing.
 */
export function SavedDataMarker() {
  useEffect(() => {
    try {
      const has = MARK.some((k) => {
        const v = localStorage.getItem(k);
        return v != null && v !== "" && v !== "[]" && v !== "{}";
      });
      const set = document.cookie.split("; ").some((c) => c.startsWith("sl_has_data="));
      if (has && !set) document.cookie = "sl_has_data=1; max-age=31536000; path=/; SameSite=Lax; Secure";
      if (!has && set) document.cookie = "sl_has_data=; max-age=0; path=/; SameSite=Lax; Secure";
    } catch {
      /* storage blocked: nothing to carry */
    }
  }, []);
  return null;
}
