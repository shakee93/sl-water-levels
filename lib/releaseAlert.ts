// "A big confirmed release counts as Alert": the one rule shared by the gauge page verdict (app/Forecast.tsx), the home /
// My places / push gauge verdicts (lib/stationVerdict.ts), /api/forecasts and the town verdict (lib/townRisk.ts), so they
// cannot disagree. Pure and dependency-free (node tests import it).
//
// WHY (26 Oct 2026): Moragaswewa (Deduru Oya) read Normal at 14.9 ft while the Deduru Oya reservoir was spilling 10,400
// cusecs through 8 gates, and people downstream (Chilaw side) reported water in their homes. The gauge is far above the
// town and the water had not reached it yet; the Irrigation Department's own sheet already said what was coming. Owner:
// "we need to be in reality".
//
// Rule: the Irrigation Department's own published figure (the daily Reservoir Water Level sheet or its flood-warning
// bulletin, never news, never the Mahaweli PDF whose discharge includes power-station flow) for the reservoir DIRECTLY above
// a gauge (a link curated in lib/reservoirs.ts, not "further down the same river") is at least RELEASE_ALERT_CUSECS
// -> that gauge, and the towns that rest on it, are at least Alert (the Department's first step). Never more than Alert
// from the release alone: Minor flood and Major flood stay with the river gauge and official warnings. Applies from the
// day of the reading (lib/releases.ts only keeps today's and yesterday's readings, so a release that has stopped being
// published drops out), not only once the gauge has started to rise: the travel time (eta in lib/reservoirs.ts) is how
// long the gauge takes to show it, not how long people downstream wait for water.
//
// Threshold: 5,000 cusecs (about 140 m3/s). The sheet's routine spills are 500 cusecs or less (lib/releases.ts
// MIN_NOTABLE_CUSECS is where a release is shown at all); 10,400 cusecs from Deduru Oya on 26 Oct 2026 caused flooding
// downstream. Between 500 and 5,000 the release stays a reason line, not a step. Chosen, not fitted (one measured event):
// revisit against releases/ on the data branch when more events exist.

export const RELEASE_ALERT_CUSECS = 5000;

export type ReleaseFacts = {
  active?: boolean;
  /** Official numbers back it (false = a news report only). */
  confirmed: boolean;
  /** The reservoir is linked to this gauge by hand (false = only further down the same river). Missing = direct. */
  direct?: boolean;
  cusecs: number | null;
  reservoir: string | null;
  /** Who published the figure ("Irrigation Department", "Mahaweli Authority" or a news outlet). */
  source?: string | null;
  gatesOpen?: number | null;
};

export type ReleaseAlert = { reservoir: string; cusecs: number; gates: number | null };

/** The release that makes this gauge/town at least Alert, or null. */
export function officialReleaseAlert(r: ReleaseFacts | null | undefined): ReleaseAlert | null {
  if (!r || r.active === false || !r.confirmed || r.direct === false) return null;
  if (r.source !== "Irrigation Department") return null; // fail safe: an unknown source never lifts
  if (r.cusecs == null || !Number.isFinite(r.cusecs) || r.cusecs < RELEASE_ALERT_CUSECS || !r.reservoir) return null;
  return { reservoir: r.reservoir, cusecs: r.cusecs, gates: r.gatesOpen != null && r.gatesOpen > 0 ? r.gatesOpen : null };
}

/** A calm tier (normal or watch) becomes alert; anything else, including an unknown tier, is left alone. */
export function tierWithRelease<T extends string>(tier: T, r: ReleaseFacts | null | undefined): T | "alert" {
  return (tier === "normal" || tier === "watch") && officialReleaseAlert(r) ? "alert" : tier;
}

/** "Deduru Oya reservoir is releasing 10,400 cusecs through 8 gates" (gates left out when the source gives none). */
export function releaseAlertLine(a: ReleaseAlert, lang: "en" | "si" | "ta" = "en"): string {
  const c = Math.round(a.cusecs).toLocaleString("en-US");
  if (lang === "si") return `${a.reservoir} ජලාශයෙන් ඝන අඩි ${c} ක් මුදා හරියි${a.gates ? ` (දොරටු ${a.gates}ක් හරහා)` : ""}`;
  if (lang === "ta") return `${a.reservoir} நீர்த்தேக்கம் ${a.gates ? `${a.gates} மதகுகள் வழியாக ` : ""}வினாடிக்கு ${c} கன அடி வெளியேற்றுகிறது`;
  return `${a.reservoir} reservoir is releasing ${c} cusecs${a.gates ? ` through ${a.gates} ${a.gates === 1 ? "gate" : "gates"}` : ""}`;
}
