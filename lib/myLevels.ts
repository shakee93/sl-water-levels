// The visitor's own flood level per gauge ("my street starts to flood at 3.5 ft"). Stored in the
// browser only: localStorage "sl_my_levels" = { [station]: number } in the gauge's own unit.
// Shared by the history year table and the station chart.

export const MY_LEVELS_KEY = "sl_my_levels";
/** Dispatch this on window after writing MY_LEVELS_KEY so open pages update in the same tab. */
export const MY_LEVELS_EVENT = "sl_my_levels_change";

export function readMyLevelsRaw(): string | null {
  try {
    return window.localStorage.getItem(MY_LEVELS_KEY);
  } catch {
    return null;
  }
}

export function parseMyLevel(raw: string | null, station: string): number | null {
  if (!raw) return null;
  try {
    const v = (JSON.parse(raw) as Record<string, unknown>)[station];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Save (or, with null, remove) the level for one station. Returns false if storage is unavailable. */
export function writeMyLevel(station: string, level: number | null): boolean {
  try {
    let all: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(window.localStorage.getItem(MY_LEVELS_KEY) ?? "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) all = parsed;
    } catch {}
    if (level == null) delete all[station];
    else all[station] = level;
    window.localStorage.setItem(MY_LEVELS_KEY, JSON.stringify(all));
    window.dispatchEvent(new Event(MY_LEVELS_EVENT));
    return true;
  } catch {
    return false;
  }
}
