// "Did the streets near you get water today?" reports: what is accepted, and nothing else. Pure (no imports, no
// clock, no I/O) so the route (app/api/flood-report/route.ts) and scripts/street-flood.test.mts share it.
// No free text, no name, no location: a town slug, one of three answers and an optional "now / earlier today".

export const REPORT_ANSWERS = ["deep", "little", "dry"] as const; // ankle or more / a little on the road / dry
export const REPORT_WHEN = ["now", "earlier"] as const;
export type ReportAnswer = (typeof REPORT_ANSWERS)[number];
export type ReportWhen = (typeof REPORT_WHEN)[number];
export type ReportLang = "en" | "si" | "ta";

export type FloodReport = { town: string; answer: ReportAnswer; when: ReportWhen | null; lang: ReportLang };

/** A person cannot read the question and tap an answer sooner than this after the page opened; faster means a script. */
export const MIN_FILL_MS = 1500;
/** A page left open for longer than a day is not a human mid-answer either; still accepted, just a sanity cap on the number. */
const MAX_FILL_MS = 7 * 86_400_000;

export type Verdict =
  | { ok: true; report: FloodReport }
  /** invalid = malformed (400); bot = honeypot filled or answered too fast (reply "thanks", store nothing). */
  | { ok: false; reason: "invalid" | "bot" };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Validates a decoded JSON body. `isTown` says whether a slug is a town page (lib/places.ts placeBySlug). */
export function validateReport(body: unknown, isTown: (slug: string) => boolean): Verdict {
  if (!isObj(body)) return { ok: false, reason: "invalid" };
  const { town, answer, when, lang, hp, ms } = body;
  if (typeof town !== "string" || town.length > 80 || !isTown(town)) return { ok: false, reason: "invalid" };
  if (typeof answer !== "string" || !(REPORT_ANSWERS as readonly string[]).includes(answer)) return { ok: false, reason: "invalid" };
  if (when != null && (typeof when !== "string" || !(REPORT_WHEN as readonly string[]).includes(when))) return { ok: false, reason: "invalid" };
  const l = lang === "si" || lang === "ta" ? lang : "en";
  // bot traps: the hidden field must stay empty, and the page must have been open for a moment
  if (hp != null && hp !== "") return { ok: false, reason: "bot" };
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < MIN_FILL_MS || ms > MAX_FILL_MS) return { ok: false, reason: "bot" };
  return { ok: true, report: { town, answer: answer as ReportAnswer, when: (when as ReportWhen | null | undefined) ?? null, lang: l } };
}

/** Asia/Colombo calendar date (YYYY-MM-DD) of an instant: UTC+05:30, no daylight saving. */
export const colomboDay = (ms: number): string => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** Name of the "already answered" cookie for a town. */
export const reportCookieName = (slug: string): string => `sl_fr_${slug}`;

/** Per-day, per-address limits. Generous: many phones share one address behind a mobile operator. */
export const LIMIT_PER_IP_PER_TOWN_DAY = 8;
export const LIMIT_PER_IP_PER_DAY = 60;
export const LIMIT_PER_IP_PER_10_MIN = 12;
