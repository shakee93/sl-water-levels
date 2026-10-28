// Reports from the 3D flood test map: what is accepted (pure, shared with the route and the tests) and the public area counts.
// Free text is never accepted: only fixed choices, a position and a GPS accuracy.

export const KINDS = ["water_now", "past_wet", "past_dry", "map_check"] as const;
export const DEPTHS = ["ankle", "knee", "waist", "above_waist", "house"] as const;
export const EVENTS = ["ditwah_2025", "may_2016", "jun_2024", "other"] as const;
export const MAP_RIGHT = ["yes", "no", "unsure"] as const;
export type Kind = (typeof KINDS)[number];

/** Flood survey ("pin your spot, how deep did it get"): body-level choices for the street and for inside the house. */
export const SURVEY_LEVELS = ["ankle", "knee", "waist", "chest", "head"] as const;
export const PEAK_PARTS = ["night", "morning", "afternoon", "evening"] as const;
export const SURVEY_INSIDE = ["no", "yes"] as const;
/** Rough metres for each body level (ankle 10 cm ... above head 1.7 m); a number in feet from the visitor replaces it. Used by the owner export. */
export const LEVEL_M: Record<(typeof SURVEY_LEVELS)[number], number> = { ankle: 0.1, knee: 0.45, waist: 0.95, chest: 1.3, head: 1.7 };
/** The old report scale has no chest / head: they count as "above_waist" there, so existing readers of `depth` keep working. */
export const LEVEL_TO_DEPTH: Record<(typeof SURVEY_LEVELS)[number], (typeof DEPTHS)[number]> = { ankle: "ankle", knee: "knee", waist: "waist", chest: "above_waist", head: "above_waist" };
export type Survey = {
  streetLevel: string | null; streetFt: number | null; inside: "no" | "yes" | null; insideLevel: string | null; insideFt: number | null;
  steps: number | null; peakDay: string | null; peakPart: string | null;
};

/** Corridor plus margin (same as the map's covered area); anything else is not a report about this map. */
export const BOUNDS = { south: 6.85, north: 7.05, west: 79.79, east: 80.15 };
export const MAX_PER_PERSON_DAY = 10;
export const MIN_FILL_MS = 2000;

export type Report = {
  kind: Kind; depth: string | null; event: string | null; lat: number; lon: number; acc: number | null; src: "gps" | "pin";
  mapRight: string | null; cellFt: number | null; lang: "en" | "si" | "ta";
  /** A test report (owner checks of the pipeline): stored with status 'test', never counted or used for calibration. */
  test: boolean;
  /** Present when the report came from the flood survey (kind past_wet / past_dry, event set). */
  survey: Survey | null;
};
export type Verdict = { ok: true; report: Report } | { ok: false; reason: "invalid" | "outside" | "bot" };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

export function validateReport(body: unknown): Verdict {
  if (!isObj(body)) return { ok: false, reason: "invalid" };
  if (typeof body.hp === "string" && body.hp.length > 0) return { ok: false, reason: "bot" };
  if (typeof body.ms === "number" && body.ms < MIN_FILL_MS) return { ok: false, reason: "bot" };
  if (body.consent !== true) return { ok: false, reason: "invalid" };
  const { kind, depth, event, src, mapRight, lang } = body;
  if (!oneOf(KINDS, kind)) return { ok: false, reason: "invalid" };
  const lat = num(body.lat, -90, 90), lon = num(body.lon, -180, 180);
  if (lat == null || lon == null) return { ok: false, reason: "invalid" };
  if (lat < BOUNDS.south || lat > BOUNDS.north || lon < BOUNDS.west || lon > BOUNDS.east) return { ok: false, reason: "outside" };
  if (!oneOf(["gps", "pin"] as const, src)) return { ok: false, reason: "invalid" };
  const needsDepth = kind === "water_now" || kind === "past_wet";
  const needsEvent = kind === "past_wet" || kind === "past_dry";
  if (needsDepth && body.survey !== true && !oneOf(DEPTHS, depth)) return { ok: false, reason: "invalid" };
  if (needsEvent && !oneOf(EVENTS, event)) return { ok: false, reason: "invalid" };
  if (kind === "map_check" && !oneOf(MAP_RIGHT, mapRight)) return { ok: false, reason: "invalid" };
  if (mapRight != null && !oneOf(MAP_RIGHT, mapRight)) return { ok: false, reason: "invalid" };
  let survey: Survey | null = null;
  let depthOut = needsDepth ? (depth as string) : null;
  if (body.survey === true) {
    // survey: only past floods; "yes, water reached" (past_wet) needs a street level, "no" (past_dry) needs nothing more
    if (kind !== "past_wet" && kind !== "past_dry") return { ok: false, reason: "invalid" };
    const wet = kind === "past_wet";
    if (wet && !oneOf(SURVEY_LEVELS, body.streetLevel)) return { ok: false, reason: "invalid" };
    const opt = <T extends string>(list: readonly T[], v: unknown): T | null | undefined => (v == null || v === "" ? null : oneOf(list, v) ? v : undefined);
    const inside = wet ? opt(SURVEY_INSIDE, body.inside) : null;
    const insideLevel = wet && inside === "yes" ? opt(SURVEY_LEVELS, body.insideLevel) : null;
    const peakPart = opt(PEAK_PARTS, body.peakPart);
    if (inside === undefined || insideLevel === undefined || peakPart === undefined) return { ok: false, reason: "invalid" };
    const optNum = (v: unknown, lo: number, hi: number) => (v == null || v === "" ? null : num(v, lo, hi) ?? undefined);
    const streetFt = wet ? optNum(body.streetFt, 0, 20) : null;
    const insideFt = wet && inside === "yes" ? optNum(body.insideFt, 0, 15) : null;
    const steps = wet ? optNum(body.steps, 0, 30) : null;
    if (streetFt === undefined || insideFt === undefined || steps === undefined) return { ok: false, reason: "invalid" };
    const day = body.peakDay == null || body.peakDay === "" ? null : typeof body.peakDay === "string" && /^20\d\d-[01]\d-[0-3]\d$/.test(body.peakDay) && !Number.isNaN(Date.parse(body.peakDay)) && body.peakDay >= "2016-04-01" && Date.parse(body.peakDay) <= Date.now() + 86_400_000 ? body.peakDay : undefined;
    if (day === undefined) return { ok: false, reason: "invalid" };
    survey = {
      streetLevel: wet ? (body.streetLevel as string) : null, streetFt: streetFt == null ? null : Math.round(streetFt * 10) / 10, inside, insideLevel,
      insideFt: insideFt == null ? null : Math.round(insideFt * 10) / 10, steps: steps == null ? null : Math.round(steps), peakDay: day, peakPart,
    };
    depthOut = wet ? LEVEL_TO_DEPTH[body.streetLevel as (typeof SURVEY_LEVELS)[number]] : null;
  }
  const lg = oneOf(["en", "si", "ta"] as const, lang) ? lang : "en";
  return {
    ok: true,
    report: {
      kind, depth: depthOut, event: needsEvent ? (event as string) : null, lat, lon,
      acc: num(body.acc, 0, 100_000), src, mapRight: typeof mapRight === "string" ? mapRight : null, cellFt: num(body.cellFt, -10, 40), lang: lg, test: body.test === true, survey,
    },
  };
}

/** Rounded to 0.001 degree (about 100 m). */
export const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Named areas for the public counts. Boxes are deliberately coarse. */
export const AREAS: { name: string; south: number; north: number; west: number; east: number }[] = [
  { name: "Kelaniya", south: 6.93, north: 6.995, west: 79.88, east: 79.96 },
  { name: "Wellampitiya and Kolonnawa", south: 6.915, north: 6.95, west: 79.84, east: 79.89 },
  { name: "Biyagama and Kaduwela", south: 6.9, north: 6.97, west: 79.96, east: 80.05 },
  { name: "Hanwella", south: 6.86, north: 6.95, west: 80.05, east: 80.13 },
];
export const MIN_PUBLIC_COUNT = 3; // k-anonymity: smaller counts are not shown
