// Reports from the 3D flood test map: what is accepted (pure, shared with the route and the tests) and the public area counts.
// Free text is never accepted: only fixed choices, a position and a GPS accuracy.

export const KINDS = ["water_now", "past_wet", "past_dry", "map_check", "dry_now"] as const; // dry_now: survey "no water here right now"
export const DEPTHS = ["ankle", "knee", "waist", "above_waist", "house"] as const;
export const EVENTS = ["ditwah_2025", "may_2016", "jun_2024", "other"] as const;
export const MAP_RIGHT = ["yes", "no", "unsure"] as const;
export type Kind = (typeof KINDS)[number];

/** Flood survey ("pin your spot, how deep did it get"): body-level choices for the street and for inside the house. */
export const SURVEY_LEVELS = ["ankle", "knee", "waist", "chest", "head"] as const;
export const PEAK_PARTS = ["night", "morning", "afternoon", "evening"] as const;
export const SURVEY_INSIDE = ["no", "yes"] as const;
/** Months a named flood can be in; "other" may be any month from 2010 to now. Stops answers about an old flood being filed under the wrong one. */
export const EVENT_MONTHS: Record<string, string[]> = { ditwah_2025: ["2025-11", "2025-12"], may_2016: ["2016-05"], jun_2024: ["2024-06"] };
/** Current month in Colombo, "YYYY-MM". */
export const colomboMonth = (ms = Date.now()) => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 7);
/** Rough metres for each body level (ankle 10 cm ... above head 1.7 m); a number in feet from the visitor replaces it. Used by the owner export. */
export const LEVEL_M: Record<(typeof SURVEY_LEVELS)[number], number> = { ankle: 0.1, knee: 0.45, waist: 0.95, chest: 1.3, head: 1.7 };
/** The old report scale has no chest / head: they count as "above_waist" there, so existing readers of `depth` keep working. */
export const LEVEL_TO_DEPTH: Record<(typeof SURVEY_LEVELS)[number], (typeof DEPTHS)[number]> = { ankle: "ankle", knee: "knee", waist: "waist", chest: "above_waist", head: "above_waist" };
export type Survey = {
  streetLevel: string | null; streetFt: number | null; inside: "no" | "yes" | null; insideLevel: string | null; insideFt: number | null;
  steps: number | null; peakDay: string | null; peakPart: string | null;
  /** Month of the flood, "YYYY-MM" (required): answers are grouped and checked by it. */
  floodMonth: string;
};

/** Corridor plus margin (same as the map's covered area); anything else is not a report about this map. */
export const BOUNDS = { south: 6.82, north: 7.12, west: 79.79, east: 80.33 };   // the extended picture (28 Oct 2026): mouth to Ruwanwella; keep in step with accuracy.json png + 0.02
/** The Kelani corridor, by its role: the only reports the 3D flood map is fitted and learned on (prep.py, reports-export.mjs, learn-all.mjs). */
export const CORRIDOR_BOUNDS = BOUNDS;
/** Sri Lanka with a small margin (28 Oct 2026): where a survey answer (now / past flood) is accepted from, on any town or gauge page. */
export const SL_BOUNDS = { south: 5.85, north: 9.9, west: 79.5, east: 81.95 };
export const inCorridor = (lat: number, lon: number): boolean => lat >= BOUNDS.south && lat <= BOUNDS.north && lon >= BOUNDS.west && lon <= BOUNDS.east;
export const inSriLanka = (lat: number, lon: number): boolean => lat >= SL_BOUNDS.south && lat <= SL_BOUNDS.north && lon >= SL_BOUNDS.west && lon <= SL_BOUNDS.east;
/** Rows (with lat / lon) that count for anything about the flood map: non-corridor rows are kept for pattern analysis only. */
export const corridorOnly = <T extends { lat: number; lon: number }>(rows: T[]): T[] => rows.filter((r) => inCorridor(r.lat, r.lon));
/** Pages a report can come from, and the shape of the page's target (town slug or gauge name): context for pattern analysis, never trusted for anything else. */
export const PAGES = ["town", "station", "survey", "lab"] as const;
const TARGET_RE = /^[A-Za-z0-9][A-Za-z0-9 .()'-]{0,63}$/;
export const MAX_PER_PERSON_DAY = 10;
export const MIN_FILL_MS = 2000;

export type Report = {
  kind: Kind; depth: string | null; event: string | null; lat: number; lon: number; acc: number | null; src: "gps" | "pin";
  mapRight: string | null; cellFt: number | null; lang: "en" | "si" | "ta";
  /** A test report (owner checks of the pipeline): stored with status 'test', never counted or used for calibration. */
  test: boolean;
  /** Present when the report came from the flood survey (kind past_wet / past_dry, event set). */
  survey: Survey | null;
  /** The page the survey was opened on ("town" | "station" | "survey" | "lab") and its target (town slug / gauge name); null when absent or not in the expected shape. */
  page: string | null; target: string | null;
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
  // survey answers ("water here now", a past flood) are welcome anywhere in Sri Lanka; the map's own reports stay inside the corridor
  if (body.survey === true ? !inSriLanka(lat, lon) : !inCorridor(lat, lon)) return { ok: false, reason: "outside" };
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
    // survey: "is your area flooded now?" (water_now / dry_now, the main question) or a past flood (past_wet / past_dry).
    // Wet answers need a street level; dry answers need nothing more. A "now" answer is about this month and has no event or day.
    if (kind !== "past_wet" && kind !== "past_dry" && kind !== "water_now" && kind !== "dry_now") return { ok: false, reason: "invalid" };
    const now = kind === "water_now" || kind === "dry_now";
    if (now && event != null) return { ok: false, reason: "invalid" };
    const wet = kind === "past_wet" || kind === "water_now";
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
    // the month of the flood is required and must fit the named flood; a "deepest day" must fall in that month
    const fm = now ? colomboMonth() : typeof body.floodMonth === "string" && /^20\d\d-(0[1-9]|1[0-2])$/.test(body.floodMonth) ? body.floodMonth : null;
    if (!fm || fm < "2010-01" || fm > colomboMonth()) return { ok: false, reason: "invalid" };
    const allowed = EVENT_MONTHS[event as string];
    if (allowed && !allowed.includes(fm)) return { ok: false, reason: "invalid" };
    if (day && !day.startsWith(fm)) return { ok: false, reason: "invalid" };
    if (now && (day || peakPart)) return { ok: false, reason: "invalid" };
    survey = {
      streetLevel: wet ? (body.streetLevel as string) : null, streetFt: streetFt == null ? null : Math.round(streetFt * 10) / 10, inside, insideLevel,
      insideFt: insideFt == null ? null : Math.round(insideFt * 10) / 10, steps: steps == null ? null : Math.round(steps), peakDay: day, peakPart, floodMonth: fm,
    };
    depthOut = wet ? LEVEL_TO_DEPTH[body.streetLevel as (typeof SURVEY_LEVELS)[number]] : null;
  }
  const lg = oneOf(["en", "si", "ta"] as const, lang) ? lang : "en";
  const page = oneOf(PAGES, body.page) ? body.page : null;
  const target = page && typeof body.target === "string" && TARGET_RE.test(body.target) ? body.target : null;
  return {
    ok: true,
    report: {
      kind, depth: depthOut, event: needsEvent ? (event as string) : null, lat, lon,
      acc: num(body.acc, 0, 100_000), src, mapRight: typeof mapRight === "string" ? mapRight : null, cellFt: num(body.cellFt, -10, 40), lang: lg, test: body.test === true, survey, page, target,
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
  { name: "Kosgama and Puwakpitiya", south: 6.9, north: 6.99, west: 80.13, east: 80.18 },
  { name: "Avissawella and Seethawaka", south: 6.9, north: 7.01, west: 80.18, east: 80.25 },
  { name: "Ruwanwella", south: 7.01, north: 7.12, west: 80.2, east: 80.33 },
];
export const MIN_PUBLIC_COUNT = 3; // k-anonymity: smaller counts are not shown
