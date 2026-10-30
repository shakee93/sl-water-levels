// Two plain-language NOTES for Colombo-area pages (owner approved 30 Oct 2026, after the visitor answers of 26-30 Oct): the page said
// "Normal" while low streets were wet. They are notes only: they never change the verdict, the tone, the sticky bar, push, an official
// step or the forecast, and nothing reads them back. Pure (no I/O, no clock: the caller passes `now`), so the site
// (app/colombo/StreetNotes.tsx) and scripts/low-street-notes.test.mts load this one file.
//
// EVIDENCE (D1 forecast_feedback / street_flood_reports / flood3d_reports, 26-30 Oct 2026): almost every "worse than shown" answer came from the
// Nagalagam Street page and the Gothatuwa / Colombo / Dematagoda town pages while they read Normal; people describe ankle-to-knee street
// water, not water inside homes.
//   - 28 Oct (09:27, 11:17, 15:42): the Kelani was Normal, but the Kolonnawa canals were still draining the 27 Oct storm (Salalihini Mw 2.1-2.5 m,
//     peak 2.73 m on 27 Oct; daily max 2.56 on 28 Oct, 2.12 on 29 Oct, 1.64 on 30 Oct: about 3 days to come down).
//   - 29 Oct 08:30-12:46 and 30 Oct ~06:30: canals at or below usual. The water came from local showers: the satellite saw ~0.6 mm, the HMIS
//     Met Department gauge "DOM HEAD OFFICE" (5 km from Gothatuwa) showed its rolling 24 h total jump 8.5 -> 17.5 mm by 09:20 (6.5 mm in the
//     hour), NBRO "Colombo - 5" (6 km) saw under 1 mm.
// The replay of both rules over the archive is in the comments below and in the test.

// @ts-ignore node strip-types needs explicit extensions
import { gaugeTotals, haversineKm, MIN_MS, type GaugeState } from "./groundRain.ts";
// @ts-ignore node strip-types needs explicit extensions; type-only imports are erased
import type { BasinId, BasinStateKey } from "./colombo.ts";

/** Official-step tones the notes may sit under: the page reads "Normal" (a "watch" tone also shows as Normal in the pill and sticky bar). */
const CALM = new Set(["normal", "watch"]);
export const isCalm = (tone: string | null | undefined): boolean => !!tone && CALM.has(tone);

// ---------------------------------------------------------------------------------------------------------- A. canals still high

/** Basins whose canals hold water in the Nagalagam Street / Gothatuwa / Dematagoda streets (lib/colombo.ts). Parliament and Wellawatta drain elsewhere. */
export const CANAL_NOTE_BASINS: BasinId[] = ["kolonnawa", "north"];

/**
 * "kolonnawa" | "north" when the page is calm and that basin's canals read "higher" (lib/colombo.ts basinState: at least two live gauges higher
 * than their own usual, or rising). null otherwise. `basins` is the page's candidate list, most relevant first (a town: its own basin;
 * Nagalagam Street: ["kolonnawa", "north"], so Kolonnawa wins when both are high).
 *
 * Replay on the archive (curw_levels, the same assessCanal + basinState the site runs; scripts/low-street-notes.test.mts):
 *   Kolonnawa "higher" at 27 Oct 12:00, 28 Oct 06:00, 09:00, 12:00, 16:00 SLT (both Kalupalama gauges, whose low-tide floor stayed up) and "normal"
 *   from 28 Oct 20:00, 29 Oct 08:30-16:00; "lower" on 30 Oct. North was "higher" on 27 Oct only. So the note shows on the three 28 Oct reports
 *   (09:27, 11:17, 15:42) and not on 29 Oct or 30 Oct. No change to curwStatus was needed ("usual" is the gauge's own 7-day range, and the
 *   tidal Kalupalama gauges are judged by their 13 h low-tide floor against earlier floors, which the storm did not lift into "usual").
 */
export function canalNote(tone: string | null | undefined, states: Partial<Record<BasinId, BasinStateKey>>, basins: BasinId[]): BasinId | null {
  if (!isCalm(tone)) return null;
  for (const b of basins) if (CANAL_NOTE_BASINS.includes(b) && states[b] === "higher") return b;
  return null;
}

// ---------------------------------------------------------------------------------------------------------- B. rain measured nearby

/**
 * A ground gauge counts when it is within 7 km of the page's point and its newest record is at most 60 minutes old.
 *  - 7 km, not the street rule's 5: Nagalagam Street is 6.0 km from the Met Department head office gauge and Gothatuwa 5.1-5.4 km; the
 *    gauge's reading decided the 29 Oct showers, while the next gauge (NBRO Colombo - 5, 6-7 km out) saw almost nothing, so a wider radius
 *    only helps because there is so little else; showers here are patchy at a few km, which is why the wording names the gauge and its distance.
 *  - 60 minutes is the same freshness limit as GROUND_MAX_AGE_MIN (Met 13 min, NBRO 15 min, Irrigation Department hourly).
 */
export const RAIN_NOTE_KM = 7;
export const RAIN_NOTE_MAX_AGE_MIN = 60;
/**
 * "A modest amount": at least 6 mm in the last 3 hours, or at least 5 mm in the last hour. These are LOW on purpose (the street RULE in
 * lib/groundRain.ts GROUND_RULE, a shadow, stays at 30 mm/h, 50 mm/3 h): the note only says what was measured and that low streets can
 * hold water; it is not a warning. The figures are lower bounds derived from a rolling 24 h sum (lib/groundRain.ts section 2), so a hit is real
 * rain and a miss can be a shower that overlapped yesterday's rain. Replay over data:hmis/rain/2026 27-30 Oct (rolling 4.5 h state as the site
 * has it, Met Department head office gauge, towns in the Kolonnawa and North basins plus Nagalagam Street; 30-minute steps):
 *   fires 27 Oct 20:30, 21:00 (storm tail); 28 Oct 11:30, 12:00 (the 11:17 report); 29 Oct 09:30-11:00 (5 steps, the morning reports),
 *   13:30, and 21:00-23:30 (6 steps, the 15 mm evening shower); silent all of 30 Oct and in the 29 Oct 12:00-13:00 and 14:00-20:30 gaps.
 * Why not 8-10 mm / 3 h (the first idea): it would have fired only on the 29 Oct evening and missed the 29 Oct morning showers (6.5 mm in
 * the hour at 09:30) that the visitors reported. No 24 h-only trigger: a rolling 24 h sum cannot say when the rain fell.
 */
export const RAIN_NOTE = { mm3h: 6, mm1h: 5 } as const;

export type RainNote = {
  name: string;
  institute: string;
  km: number;
  /** Whole mm, rounded DOWN (the figure is a lower bound, the text says "at least"). */
  mm: number;
  /** 1 = "in the last hour", 3 = "in the last 3 hours". */
  hours: 1 | 3;
};

/** HMIS gauge names are upper-case station codes; a few get a plain name (checked against HMIS device lists, 30 Oct 2026). */
const PLAIN_NAMES: Record<string, string> = { "DOM HEAD OFFICE": "Met Department head office" };
export function plainGaugeName(raw: string): string {
  const n = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (PLAIN_NAMES[n.toUpperCase()]) return PLAIN_NAMES[n.toUpperCase()];
  return n === n.toUpperCase() && /[A-Z]/.test(n) ? n.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase()) : n;
}

/**
 * The note for a point, or null. Calm pages only. Picks the NEAREST qualifying gauge (not a mean: one gauge that measured the rain is the
 * honest statement; a mean with a dry neighbour would hide it). Says "in the last hour" when the 1 h figure qualifies (the most specific true
 * statement), else "in the last 3 hours" with the larger of the 1 h and 3 h figures (both are lower bounds).
 */
export function rainNote(tone: string | null | undefined, at: { lat: number; lon: number }, gauges: GaugeState[], nowMs: number): RainNote | null {
  if (!isCalm(tone) || !Number.isFinite(at?.lat) || !Number.isFinite(at?.lon)) return null;
  let best: RainNote | null = null;
  for (const g of gauges) {
    if (!g || !Number.isFinite(g.lat) || !Number.isFinite(g.lon) || !Array.isArray(g.pts) || !g.pts.length) continue;
    const km = haversineKm(at, g);
    if (km > RAIN_NOTE_KM || (best && km >= best.km)) continue;
    const t = gaugeTotals(g.pts, nowMs);
    if (!t || t.ageMin > RAIN_NOTE_MAX_AGE_MIN) continue;
    // a record from the future (clock skew beyond 10 minutes) is not trusted, same as pickRain
    if (Math.max(...g.pts.map((p) => p[0])) * MIN_MS > nowMs + 10 * MIN_MS) continue;
    const h3 = Math.max(t.mm3h ?? 0, t.mm1h ?? 0), h1 = t.mm1h ?? 0;
    const note = (hours: 1 | 3, mm: number): RainNote => ({ name: plainGaugeName(g.n), institute: g.i, km: Math.round(km * 10) / 10, mm: Math.floor(mm + 1e-9), hours });
    if (h1 >= RAIN_NOTE.mm1h) best = note(1, h1);
    else if (h3 >= RAIN_NOTE.mm3h) best = note(3, h3);
  }
  return best;
}
