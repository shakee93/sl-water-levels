// "My spot floods in heavy rain" (low ground beside a canal): a PERSONAL, opt-in setting, off for everyone by default.
// Only about 2% of a canal town's streets ever get water, so the heavy-rain rule (lib/townRisk.ts `lowSpot`) is never
// a town warning: it only speaks to the visitor who said their own spot is one of those low places.
// Stored in the browser only: localStorage "sl_low_spots" = ["wellampitiya", ...] (town slugs). Push alerts for it are
// switched on separately in the server-side prefs (lib/pushPrefs.ts `lowSpots`, keyed "t:<slug>") by syncLowSpot().

export const LOW_SPOTS_KEY = "sl_low_spots";
/** Dispatch on window after writing LOW_SPOTS_KEY so open pages update in the same tab. */
export const LOW_SPOTS_EVENT = "sl_low_spots_change";

export function readLowSpotsRaw(): string | null {
  try {
    return window.localStorage.getItem(LOW_SPOTS_KEY);
  } catch {
    return null;
  }
}

export function parseLowSpots(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && /^[a-z0-9-]{1,60}$/.test(x)))].slice(0, 12) : [];
  } catch {
    return [];
  }
}

export const hasLowSpot = (raw: string | null, slug: string): boolean => parseLowSpots(raw).includes(slug);

/** Turn the setting on or off for one town. Returns false if storage is unavailable. */
export function writeLowSpot(slug: string, on: boolean, opts: { sync?: boolean } = {}): boolean {
  try {
    const all = parseLowSpots(window.localStorage.getItem(LOW_SPOTS_KEY)).filter((s) => s !== slug);
    if (on) all.push(slug);
    window.localStorage.setItem(LOW_SPOTS_KEY, JSON.stringify(all));
    window.dispatchEvent(new Event(LOW_SPOTS_EVENT));
    if (opts.sync !== false) void syncLowSpot(slug, on);
    return true;
  } catch {
    return false;
  }
}

/** Best effort: if this browser has push alerts on, record the choice with its other alert settings. Silent when it has not. */
export async function syncLowSpot(slug: string, on: boolean): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration("/");
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return;
    const post = (body: unknown) => fetch("/api/push/prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const cur = (await (await post({ endpoint: sub.endpoint })).json()) as { ok?: boolean; prefs?: { lowSpots?: string[] } };
    if (!cur.ok || !cur.prefs) return;
    const key = `t:${slug}`;
    const next = (cur.prefs.lowSpots ?? []).filter((k) => k !== key);
    if (on) next.push(key);
    await post({ endpoint: sub.endpoint, prefs: { ...cur.prefs, lowSpots: next } });
  } catch {
    /* alerts are optional: the note on the page still works */
  }
}
