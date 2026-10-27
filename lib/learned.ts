// What visitors' answers taught us (learned/town-params.json on the `data` branch, written once a day by scripts/feedback-learn.mjs
// from lib/learnedParams.mjs). The site reads it the same way as accuracy/latest.json: cached 1 h, time-boxed to 1.5 s, fails soft to null
// (= every default stays). It is used ONLY by notes and heads-ups (the street-water level suggestion on town pages, the rain mark of the
// street-water note); never by the verdict step, pill, sticky bar, tone or push levels.
import { streetLevelOf, streetRainLevel, streetLevelReached } from "./learnedParams.mjs";

const URL_ = process.env.LEARNED_URL ?? "https://raw.githubusercontent.com/shakee93/sl-water-levels/data/learned/town-params.json";

export type LearnedParams = {
  version: number;
  updatedAt: string;
  asOf: string;
  totals: { answers: number; people: number; streetReports: number; days: number };
  stations: Record<string, { answers?: { n: number; days: number }; streetLevel?: { ft: number; n: number; days: number; defaultFt: number; clamped: boolean } }>;
  zones: Record<string, { streetRain?: { possibleMm: number; n: number; days: number; defaultMm: number } }>;
  pending: { kind: "streetLevel" | "streetRain"; station?: string; zone?: string; n: number; days: number }[];
  forecast?: { horizons?: Record<string, { n: number; maeBase: number | null; maeFit: number | null; gainPct: number | null }>; useful?: boolean; wired?: boolean };
};

export async function getLearned(ms = 1500): Promise<LearnedParams | null> {
  try {
    const res = await fetch(URL_, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    const j = (await res.json()) as LearnedParams;
    return j && j.version === 1 && j.stations ? j : null;
  } catch {
    return null;
  }
}

export { streetLevelOf, streetRainLevel, streetLevelReached };
