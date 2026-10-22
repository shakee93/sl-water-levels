// Plain-language advisory (English, Sinhala, Tamil) for one station.
//
// The forecast and status are computed deterministically elsewhere. The model here only REWORDS a
// small fact sheet built from them; it may not add or change numbers, probabilities, times or
// tiers. Output is post-validated and anything that fails falls back to a deterministic English
// template (and Sinhala/Tamil are simply omitted). The template is also used outright when the
// forecast is unavailable or only a low-confidence trend, and whenever the API is off or failing.

import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import type { Forecast } from "./forecast";
import type { Tier } from "./status";
import { aiConfigured, respondJson } from "./openai";

export type Advisory = {
  en: string;
  /** null unless the model produced a validated translation. Machine-translated. */
  si: string | null;
  ta: string | null;
  source: "model" | "template";
  /** Sinhala and Tamil are always machine translations. */
  machineTranslated: true;
  tier: Tier;
};

export type AdvisoryInput = {
  station: string;
  /** River / basin name, e.g. "Kelani Ganga". */
  river: string;
  district: string | null;
  tier: Tier;
  forecast: Forecast;
};

const TIER_RANK: Record<Tier, number> = { stale: -1, none: 0, normal: 0, watch: 1, alert: 2, minor: 3, major: 4 };
export const atLeastAlert = (t: Tier) => TIER_RANK[t] >= TIER_RANK.alert;

const TIER_PHRASE: Record<Tier, string> = {
  normal: "at a normal level",
  watch: "approaching its alert level",
  alert: "above its alert level",
  minor: "above its minor flood level",
  major: "above its major flood level",
  none: "reporting, but no flood levels are published for this gauge",
  stale: "not reporting recent readings",
};

const CALL_117 = "If you feel you are in danger, call 117 (Disaster Management Centre hotline).";

function levelText(f: Forecast): string | null {
  return f.currentLevel == null ? null : `${f.currentLevel.toFixed(2)}${f.unit ? ` ${f.unit}` : ""}`;
}

/** The fact sheet the model sees. Every number the model may use is in here (plus "117"). */
export function factSheet(i: AdvisoryInput): string {
  const f = i.forecast;
  const lines = [
    `Station: ${i.station} on the ${i.river}${i.district ? `, ${i.district} district` : ""}.`,
    `Current status: ${TIER_PHRASE[i.tier]}.`,
  ];
  const lvl = levelText(f);
  if (lvl) lines.push(`Latest level: ${lvl}${f.direction !== "unknown" ? `, ${f.direction}` : ""}.`);
  if (f.status !== "unavailable") lines.push(`Forecast: ${f.headline}`);
  if (f.method === "model" && f.experimental) lines.push("The forecast is experimental and may be wrong.");
  if (f.status === "degraded") lines.push("Some inputs are missing, so the forecast is less accurate.");
  return lines.join("\n");
}

/** Deterministic English advisory. Also the safe fallback. */
export function templateAdvisory(i: AdvisoryInput): string {
  const f = i.forecast;
  const where = `${i.station} on the ${i.river}`;
  const parts: string[] = [];
  if (i.tier === "stale") parts.push(`${where} is not reporting recent readings, so its level is unknown right now.`);
  else {
    parts.push(`${where} is ${TIER_PHRASE[i.tier]}.`);
    if (f.status !== "unavailable") parts.push(f.headline.endsWith(".") ? f.headline : `${f.headline}.`);
  }
  if (atLeastAlert(i.tier)) parts.push(CALL_117);
  else parts.push("Follow official warnings from the Disaster Management Centre.");
  return parts.join(" ");
}

/** True when the model adds nothing over the template (no usable forecast, or only a weak trend). */
function templateOnly(f: Forecast, tier: Tier): boolean {
  if (tier === "stale") return true;
  if (f.status === "unavailable") return true;
  return f.method === "trend" && (f.signals.trendConfidence === "low" || f.signals.trendConfidence === "none");
}

// ---- validation -------------------------------------------------------------

const DIGIT_BASES = [0x0de6, 0x0be6]; // Sinhala Lith digits, Tamil digits
function asciiDigits(s: string): string {
  return s.replace(/[෦-෯௦-௯]/g, (c) => String(c.charCodeAt(0) - DIGIT_BASES.find((b) => c.charCodeAt(0) >= b && c.charCodeAt(0) <= b + 9)!));
}
// Compared by value, so "09" and "9" match; zero is always allowed (e.g. "9:00").
const numbersIn = (s: string) => new Set((asciiDigits(s).match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(parseFloat(n))));

const SCRIPT = { si: /[඀-෿]/g, ta: /[஀-௿]/g };
const scriptShare = (s: string, re: RegExp) => (s.match(re)?.length ?? 0) / Math.max(1, s.replace(/[\s\d.,()%:;'"-]/g, "").length);

type ModelOut = { en: string; si: string; ta: string };

/** Returns the validated parts; each language is dropped independently if it fails. */
export function validate(out: ModelOut, facts: string, tier: Tier): { en: string | null; si: string | null; ta: string | null } {
  const allowed = numbersIn(facts);
  allowed.add("0");
  if (atLeastAlert(tier)) allowed.add("117");
  const ok = (text: string | undefined, lang: "en" | "si" | "ta") => {
    if (!text || text.length < 10 || text.length > 700) return false;
    for (const n of numbersIn(text)) if (!allowed.has(n)) return false;
    if (atLeastAlert(tier) && !numbersIn(text).has("117")) return false;
    if (!atLeastAlert(tier) && numbersIn(text).has("117")) return false;
    if (lang !== "en" && scriptShare(text, SCRIPT[lang]) < 0.5) return false;
    if (/https?:\/\/|<[a-z]/i.test(text)) return false;
    return true;
  };
  return { en: ok(out.en, "en") ? out.en.trim() : null, si: ok(out.si, "si") ? out.si.trim() : null, ta: ok(out.ta, "ta") ? out.ta.trim() : null };
}

// ---- model call (cached) ----------------------------------------------------

const INSTRUCTIONS = `You turn a flood-forecast fact sheet for a Sri Lankan river gauge into a short public advisory.
Write 1 or 2 short sentences, in three versions: English (en), Sinhala (si) and Tamil (ta). Plain words, calm and factual, no alarm, no exclamation marks.
STRICT RULES:
- Use ONLY the facts in the fact sheet. Do not add, change, round or invent any number, probability, time, level, place or tier. Copy numbers exactly as written (digits, not words). Do not write any other number.
- Keep the same level of certainty: "could" stays "could", "likely" stays "likely". Mention that the forecast is experimental if the sheet says so.
- No medical or legal advice, no instructions beyond the sheet.
- ${"{CALL}"}
- In Sinhala and Tamil, translate ordinary words (hours, rising, level) into that language; keep station and river names and level units (ft, m) in English letters.`;

function instructionsFor(tier: Tier): string {
  return INSTRUCTIONS.replace(
    "{CALL}",
    atLeastAlert(tier)
      ? "End every version with a short line telling people who feel in danger to call 117 (the Disaster Management Centre hotline). Include the digits 117 in each."
      : "Do not mention 117 or any phone number.",
  );
}

const SCHEMA = {
  type: "object",
  properties: { en: { type: "string" }, si: { type: "string" }, ta: { type: "string" } },
  required: ["en", "si", "ta"],
  additionalProperties: false,
};

/**
 * Cached per (station, forecast hour, tier, fact-sheet hash): the hash is there so a cached
 * sentence can never disagree with the numbers on the card. Throws on failure so failures are
 * not cached (the caller catches and falls back to the template).
 */
const generateCached = unstable_cache(
  async (_key: string, facts: string, tier: Tier) => {
    const r = await respondJson<ModelOut>({ instructions: instructionsFor(tier), input: facts, schemaName: "advisory", schema: SCHEMA, maxOutputTokens: 1500 });
    if (!r.ok) throw new Error(r.reason);
    const v = validate(r.data, facts, tier);
    if (!v.en) throw new Error("model output failed validation");
    return v;
  },
  ["advisory-v1"],
  { revalidate: 1800 }, // 30 min
);

const failedUntil = new Map<string, number>();
const BACKOFF_MS = 5 * 60_000;

export async function getAdvisory(i: AdvisoryInput): Promise<Advisory> {
  const base = (en: string, source: Advisory["source"], si: string | null = null, ta: string | null = null): Advisory => ({ en, si, ta, source, machineTranslated: true, tier: i.tier });
  const template = templateAdvisory(i);
  try {
    if (!aiConfigured() || templateOnly(i.forecast, i.tier)) return base(template, "template");
    const facts = factSheet(i);
    const hour = i.forecast.asOfTs != null ? Math.floor(i.forecast.asOfTs / 3_600_000) : 0;
    const key = `${i.station}|${hour}|${i.tier}|${createHash("sha256").update(facts).digest("hex").slice(0, 12)}`;
    if ((failedUntil.get(key) ?? 0) > Date.now()) return base(template, "template");
    try {
      const v = await generateCached(key, facts, i.tier);
      // The English line the model wrote replaced by the template is never worse, so use the
      // model's English only when it validated; otherwise keep the template.
      return base(v.en ?? template, "model", v.si, v.ta);
    } catch {
      failedUntil.set(key, Date.now() + BACKOFF_MS);
      return base(template, "template");
    }
  } catch {
    return base(template, "template");
  }
}
