// One rain vocabulary for the whole site: the page, push, X, the JSON API and the MCP all take their words and numbers from here.
//
// Two layers, on purpose:
//  1. WORDS are national and simple. light / moderate / heavy / very heavy, by a fixed table per window (1 h, 3 h, 24 h). The same
//     word means the same amount of rain everywhere, so a reader can compare places. The table is for "how much rain is that?".
//  2. TRIGGERS are about floods, and rain affects rivers differently from area to area. The measured-rain warning, the storm line
//     and any "heavy for this river" wording read a per-gauge threshold (lib/model/rain-thresholds.json: mm over the gauge's
//     response window that historically came before a rise) when there is one, and fall back to the national numbers below.
//     Wording that says "for this river" is used ONLY when a per-gauge number was applied (`local`).
//
// Windows and where each number comes from (details and the backtests are in DOCS.md "Rain words"):
//   fallen (measured at a gauge, or the satellite) and forecast (catchment average, Open-Meteo) use the same bands.
//   1 h   : moderate 2.5, heavy 10, very heavy 25 mm   (25 = MEASURED_1H_MM, the measured heavy-rain warning)
//   3 h   : moderate 7.5, heavy 20, very heavy 40 mm   (40 = MEASURED_3H_MM)
//   24 h  : moderate 10, heavy 50, very heavy 100 mm   (50 / 100 = RAIN_RISK_MM / RAIN_RISK_VERY_MM, the "heavy rain forecast" line)
//
// The 25 / 40 / 50 / 100 here are the same numbers as MEASURED_1H_MM / MEASURED_3H_MM (lib/measuredRain.ts) and RAIN_RISK_MM / RAIN_RISK_VERY_MM
// (lib/rainRisk.ts); scripts/rain-words.test.mts fails if they drift apart.
// Pure (no JSON import) so scripts and tests can load it with plain node; the table is passed in (lib/rainTriggers.ts reads the file).
import type { Locale } from "./i18n/config";

export type RainWindow = "1h" | "3h" | "24h";
export type RainBand = "none" | "light" | "moderate" | "heavy" | "veryHeavy";

/** Lower edge (mm) of each band; under `moderate` (but above a trace) is light. */
export const RAIN_BANDS: Record<RainWindow, { moderate: number; heavy: number; veryHeavy: number }> = {
  "1h": { moderate: 2.5, heavy: 10, veryHeavy: 25 },
  "3h": { moderate: 7.5, heavy: 20, veryHeavy: 40 },
  "24h": { moderate: 10, heavy: 50, veryHeavy: 100 },
};
/** Under this the gauge/satellite is dry for practical purposes. */
export const RAIN_TRACE_MM = 0.2;

export function rainBand(window: RainWindow, mm: number | null | undefined): RainBand | null {
  if (mm == null || !Number.isFinite(mm)) return null;
  const b = RAIN_BANDS[window];
  if (mm >= b.veryHeavy) return "veryHeavy";
  if (mm >= b.heavy) return "heavy";
  if (mm >= b.moderate) return "moderate";
  return mm >= RAIN_TRACE_MM ? "light" : "none";
}

const WORDS: Record<Locale, Record<RainBand, string>> = {
  en: { none: "no rain", light: "light rain", moderate: "moderate rain", heavy: "heavy rain", veryHeavy: "very heavy rain" },
  // si / ta: DRAFT translations, not yet reviewed by a native speaker.
  si: { none: "වැසි නැත", light: "සැහැල්ලු වැසි", moderate: "මධ්‍යස්ථ වැසි", heavy: "තද වැසි", veryHeavy: "ඉතා තද වැසි" },
  ta: { none: "மழை இல்லை", light: "லேசான மழை", moderate: "மிதமான மழை", heavy: "கனமழை", veryHeavy: "மிகக் கனமழை" },
};
export const rainWordOf = (band: RainBand, lang: Locale = "en"): string => (WORDS[lang] ?? WORDS.en)[band];
/** "heavy rain" for 60 mm in a day, in the reader's language; null when the amount is unknown. */
export const rainWord = (window: RainWindow, mm: number | null | undefined, lang: Locale = "en"): string | null => {
  const b = rainBand(window, mm);
  return b ? rainWordOf(b, lang) : null;
};

// ---- flood triggers: national defaults, per-gauge overrides -----------------------------------------------------------------

export type RainTriggers = {
  /** mm at which the window counts as flood-relevant for this gauge. */
  mm1h: number;
  mm3h: number;
  mm24h: number;
  /** True when at least one number came from the per-gauge table: only then may a line say "for this river". */
  local: boolean;
};

/** National defaults: the measured heavy-rain warning (25 mm / 1 h, 40 mm / 3 h) and the forecast storm line (50 mm / 24 h). */
export const NATIONAL_TRIGGERS: RainTriggers = { mm1h: RAIN_BANDS["1h"].veryHeavy, mm3h: RAIN_BANDS["3h"].veryHeavy, mm24h: RAIN_BANDS["24h"].heavy, local: false };

/** lib/model/rain-thresholds.json: any subset of the three windows per gauge (key = gauge name as on the site). */
export type RainThresholdTable = { gauges?: Record<string, { mm1h?: number | null; mm3h?: number | null; mm24h?: number | null } | undefined> } | null | undefined;

const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 500;

/** The triggers for one gauge: its own numbers where the table has them, else the national ones. */
export function triggersFor(station: string, table?: RainThresholdTable): RainTriggers {
  const own = table?.gauges?.[station.replace(/\s+/g, " ").trim()];
  if (!own) return NATIONAL_TRIGGERS;
  const t = { ...NATIONAL_TRIGGERS };
  for (const w of ["mm1h", "mm3h", "mm24h"] as const) {
    if (ok(own[w])) {
      t[w] = own[w]!;
      t.local = true;
    }
  }
  return t;
}

/** Did this much rain reach the gauge's flood trigger for that window? */
export const reachesTrigger = (window: RainWindow, mm: number | null | undefined, t: RainTriggers): boolean =>
  mm != null && Number.isFinite(mm) && mm >= (window === "1h" ? t.mm1h : window === "3h" ? t.mm3h : t.mm24h);

const FOR_RIVER: Record<Locale, string> = {
  en: "heavy for this river",
  // si / ta: DRAFT translations, not yet reviewed by a native speaker.
  si: "මෙම ගඟට තද",
  ta: "இந்த ஆற்றுக்குக் கனமானது",
};
/** " (heavy for this river)" when a per-gauge trigger was used and reached, else "" (national wording never claims it). */
export const forThisRiver = (reached: boolean, t: RainTriggers, lang: Locale = "en"): string =>
  reached && t.local ? ` (${(FOR_RIVER[lang] ?? FOR_RIVER.en)})` : "";

// ---- satellite caveat: regional ---------------------------------------------------------------------------------------------

/**
 * Basins in the dry zone, where the satellite (GSMaP) over-reads against the gauges: 24 h satellite 76-112 mm against 3-12 mm at the
 * gauge in Siyambalanduwa (Heda Oya), Nakkala (Kumbukkan Oya), Thanthirimale (Malwathu Oya) and Katharagama (Menik Ganga) on
 * 26 Oct 2026. The other listed basins are dry-zone by geography, not yet measured.
 */
export const DRY_ZONE_BASINS: readonly string[] = ["Gal Oya", "Heda Oya", "Kala Oya", "Kirindi Oya", "Kumbukkan Oya", "Maduru Oya", "Malwathu Oya", "Menik Ganga", "Yan Oya"];
export const isDryZoneBasin = (basin: string | null | undefined): boolean => DRY_ZONE_BASINS.includes(String(basin ?? "").trim());

const SAT: Record<Locale, { base: string; dry: string }> = {
  en: {
    base: "It can differ from the gauges.",
    dry: "In this dry-zone area it often reads much higher than the gauges, so treat it as an upper figure.",
  },
  // si / ta: DRAFT translations, not yet reviewed by a native speaker.
  si: {
    base: "එය මානයන්ට වඩා වෙනස් විය හැක.",
    dry: "මෙම වියළි කලාපයේ එය මානයන්ට වඩා බොහෝ වැඩියෙන් පෙන්විය හැක, එබැවින් ඉහළ අගයක් ලෙස සලකන්න.",
  },
  ta: {
    base: "இது அளவீடுகளிலிருந்து வேறுபடலாம்.",
    dry: "இந்த வறண்ட வலயத்தில் இது அளவீடுகளை விட மிக அதிகமாகக் காட்டலாம், எனவே உச்ச மதிப்பாகக் கருதுங்கள்.",
  },
};
export const satelliteCaveat = (basin: string | null | undefined, lang: Locale = "en"): string => {
  const l = SAT[lang] ?? SAT.en;
  return isDryZoneBasin(basin) ? l.dry : l.base;
};
