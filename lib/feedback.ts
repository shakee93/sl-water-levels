// "Is this right?" feedback: what is accepted, how it is cleaned, and the limits. Pure (no imports, no clock, no I/O) so
// the route (app/api/feedback/route.ts), the page component and scripts/feedback.test.mts share it.
// Stored: page + gauge/town, one of four answers, optional river/rain observation, an optional note (cleaned), an optional
// location rounded to 0.01 degree (about 1 km). Never precise coordinates, never the IP address.

export const FB_ANSWERS = ["yes", "worse", "better", "unsure"] as const;
export const FB_RIVER = ["normal", "high", "banks", "flooding"] as const;
export const FB_RAIN = ["none", "light", "heavy"] as const;
export const FB_PAGES = ["station", "town"] as const;
export const FB_TONES = ["normal", "watch", "alert", "minor", "major", "stale"] as const;
export type FbAnswer = (typeof FB_ANSWERS)[number];
export type FbRiver = (typeof FB_RIVER)[number];
export type FbRain = (typeof FB_RAIN)[number];
export type FbPage = (typeof FB_PAGES)[number];

export const MIN_FILL_MS = 1200;
const MAX_FILL_MS = 7 * 86_400_000;
export const NOTE_MAX = 500;
/** Sri Lanka's bounding box with a little sea around it; a point outside it is dropped, the answer still counts. */
const BOX = { latMin: 5.7, latMax: 10.0, lonMin: 79.4, lonMax: 82.1 };

export const LIMIT_PER_IP_PER_TARGET_DAY = 6;
export const LIMIT_PER_IP_PER_DAY = 40;
export const LIMIT_PER_IP_PER_10_MIN = 12;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);

/** Rounds a coordinate to 0.01 degree. */
export const roundCoord = (v: number): number => Math.round(v * 100) / 100;

/** Rounded point inside Sri Lanka, or null (missing, not numbers, outside the island). Precise input is rounded here, never stored. */
export function cleanLocation(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < BOX.latMin || lat > BOX.latMax || lon < BOX.lonMin || lon > BOX.lonMax) return null;
  return { lat: roundCoord(lat), lon: roundCoord(lon) };
}

/** Great-circle distance in km, one decimal. */
export function distKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}

// ---- free text ---------------------------------------------------------------------------------------------
// Removed before storing (people paste these by habit; none helps the forecast): links, e-mail addresses, phone numbers.
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|lk|net|org|io|gov|me|info|ly|co)\b\S*/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_RE = /(?:\+?\d[\d\s().-]{6,}\d)/g; // 8 or more digits with the usual separators
// A short list of English slurs and the Singlish/Sinhala/Tamil ones most often typed in Latin letters. Matches reject the note
// (the answer itself is still kept). Deliberately small: it stops obvious abuse, it does not pretend to moderate everything.
const BAD = ["fuck", "shit", "bitch", "asshole", "bastard", "cunt", "dick", "pussy", "whore", "slut", "huththa", "hutta", "huttha", "pakaya", "ponnaya", "wesi", "wesige", "kariya", "thevidiya", "punda", "otha", "sunni", "gotha", "kalla"];
const BAD_RE = new RegExp(`(?:^|[^a-z])(?:${BAD.join("|")})(?:[^a-z]|$)`, "i");

export type NoteResult = { text: string | null; reason?: "spam" | "rude" | "empty" };

/** Cleans a note: strips links, e-mails and phone numbers, collapses spaces, cuts to NOTE_MAX; rejects abuse and obvious spam. */
export function cleanNote(raw: unknown): NoteResult {
  if (raw == null || raw === "") return { text: null, reason: "empty" };
  if (typeof raw !== "string") return { text: null, reason: "spam" };
  const t = raw.normalize("NFKC")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200d\u2028\u2029\ufeff]/g, "")
    .replace(EMAIL_RE, " ").replace(URL_RE, " ").replace(PHONE_RE, " ")
    .replace(/\s+/g, " ").trim().slice(0, NOTE_MAX).trim();
  if (t.length < 2 || !/\p{L}/u.test(t)) return { text: null, reason: "empty" };
  if (BAD_RE.test(t.toLowerCase())) return { text: null, reason: "rude" };
  // spam: one character repeated 10+ times, one word repeated 6+ times, or mostly capitals shouting a long line
  if (/(.)\1{9,}/u.test(t) || /\b(\p{L}{2,})\b(?:\s+\1\b){5,}/iu.test(t)) return { text: null, reason: "spam" };
  return { text: t };
}

/** Rule-based tags for the learning report (no model call: free, works offline). English plus the common Sinhala/Tamil words. */
export function noteTags(note: string | null | undefined): string[] {
  if (!note) return [];
  const s = note.toLowerCase();
  const has = (...w: string[]) => w.some((x) => s.includes(x));
  const tags: string[] = [];
  if (has("water", "level", "river", "canal", "flood", "ganga", "oya", "වතුර", "ගඟ", "ඇළ", "වැස්ස් ", "நீர்", "ஆறு", "வெள்ளம்")) tags.push("water");
  if (has("rain", "shower", "drizzle", "වැස්ස", "மழை")) tags.push("rain");
  if (has("road", "street", "house", "home", "shop", "garden", "inside", "පාර", "ගෙදර", "ගෙට", "சாலை", "வீடு")) tags.push("road_home");
  if (has("near", "junction", "bridge", "temple", "school", "lane", "mawatha", "road no", "station", "හන්දිය", "පාලම", "சந்தி", "பாலம்")) tags.push("place");
  if (has("wrong", "not true", "useless", "never", "inaccurate", "incorrect", "වැරදි", "பொய்", "தவறு")) tags.push("complaint");
  if (has("thanks", "thank you", "useful", "helpful", "great", "good job", "ස්තූති", "நன்றி")) tags.push("praise");
  return tags;
}

/** "Urgent" = the person says our verdict is too mild and the water is on roads or in homes. */
export const isUrgent = (answer: string, river: string | null): boolean => answer === "worse" && river === "flooding";

// ---- validation --------------------------------------------------------------------------------------------
export type FbAnswerReq = { page: FbPage; station: string | null; town: string | null; answer: FbAnswer; tone: (typeof FB_TONES)[number] | null; lang: "en" | "si" | "ta" };
export type FbDetailsReq = { token: string; river: FbRiver | null; rain: FbRain | null; note: string | null; noteReason?: NoteResult["reason"]; loc: { lat: number; lon: number } | null };

export type Verdict<T> = { ok: true; value: T } | { ok: false; reason: "invalid" | "bot" };

/** First tap. `isTown` / `isStation` say whether a slug / gauge name exists. */
export function validateAnswer(body: unknown, isTown: (s: string) => boolean, isStation: (s: string) => boolean): Verdict<FbAnswerReq> {
  if (!isObj(body)) return { ok: false, reason: "invalid" };
  const page = oneOf(FB_PAGES, body.page), answer = oneOf(FB_ANSWERS, body.answer);
  if (!page || !answer) return { ok: false, reason: "invalid" };
  const station = typeof body.station === "string" && body.station.length <= 80 ? body.station : null;
  const town = typeof body.town === "string" && body.town.length <= 80 ? body.town : null;
  if (page === "station" && (!station || !isStation(station))) return { ok: false, reason: "invalid" };
  if (page === "town" && (!town || !isTown(town) || (station && !isStation(station)))) return { ok: false, reason: "invalid" };
  if (body.hp != null && body.hp !== "") return { ok: false, reason: "bot" };
  const ms = body.ms;
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < MIN_FILL_MS || ms > MAX_FILL_MS) return { ok: false, reason: "bot" };
  const lang = body.lang === "si" || body.lang === "ta" ? body.lang : "en";
  return { ok: true, value: { page, station: station, town: page === "town" ? town : null, answer, tone: oneOf(FB_TONES, body.tone), lang } };
}

/** Second step. Anything missing is simply not stored; a rude/spam note drops only the note. */
export function validateDetails(body: unknown): Verdict<FbDetailsReq> {
  if (!isObj(body)) return { ok: false, reason: "invalid" };
  if (typeof body.token !== "string" || !/^[0-9a-f]{24}$/.test(body.token)) return { ok: false, reason: "invalid" };
  if (body.hp != null && body.hp !== "") return { ok: false, reason: "bot" };
  const n = cleanNote(body.note);
  return { ok: true, value: { token: body.token, river: oneOf(FB_RIVER, body.river), rain: oneOf(FB_RAIN, body.rain), note: n.text, noteReason: n.reason, loc: cleanLocation(body.lat, body.lon) } };
}

/** Coarse device from a User-Agent string; nothing else is kept. */
export const deviceOf = (ua: string | null | undefined): "mobile" | "desktop" => (/Mobi|Android|iPhone|iPad/i.test(ua ?? "") ? "mobile" : "desktop");

/** Asia/Colombo date (YYYY-MM-DD). */
export const colomboDay = (ms: number): string => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** Cookie that says "this browser already answered for this page today". */
export const fbCookieName = (page: FbPage, target: string): string => `sl_fb_${page[0]}_${target.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;
