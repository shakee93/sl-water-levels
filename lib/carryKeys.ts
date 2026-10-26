// Saved data carried from the old address (sl-water-levels.vercel.app) to waterlevels.lk by the hand-over page
// (app/api/move/route.ts) and stored by app/ImportHandover.tsx. A plain module: the server route must not import it from a
// "use client" file, where it becomes a client reference and reads as undefined (26 Oct 2026: the first hand-overs moved nothing).
export const CARRY_KEYS = ["sl_favourites", "sl_my_levels", "sl_low_spots", "sl_loc", "sl_lang", "sl_recent_searches", "sl_station", "sl_theme"] as const;
