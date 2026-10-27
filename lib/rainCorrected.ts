// Gauge-corrected satellite rain, read from rain-correction/latest.json on the `data` branch (written every 30 minutes by
// scripts/rain-correct.mjs; maths and constants in lib/rainCorrection.ts, DOCS.md "Gauge-corrected satellite rain"). Server only, no request
// to JAXA or HMIS, no D1. Fails soft: null when missing, malformed or older than 3 h.
//
// A NOTE only: the official steps, the street-water-likely rule and push alerts still read the raw GSMaP numbers (their thresholds were
// backtested on raw GSMaP). The corrected values are logged beside the raw ones (data branch, rain-correction/log/) so they can be backtested.
import { unstable_cache } from "next/cache";
import { pixelIndex } from "./pointRain.mjs";

export const RAIN_CORRECTION_URL = process.env.RAIN_CORRECTION_URL ?? "https://raw.githubusercontent.com/shakee93/sl-water-levels/data/rain-correction/latest.json";
export const RAIN_CORRECTION_MAX_AGE_MS = 3 * 3_600_000;

type Raw = {
  windowEnd: string;
  pairs: number;
  grid: { lat0: number; lon0: number; step: number; nx: number; ny: number; raw24: string; corr24: string; gain: string; near: string };
};

/** The fields the map and the notes need, decoded. Tenths of mm and gain x100 in the file; mm and a plain factor here (null = missing). */
export type RainCorrection = {
  windowEnd: number;
  pairs: number;
  raw24: (number | null)[];
  corr24: (number | null)[];
  gain: (number | null)[];
  /** Ground gauges within 10 km of each pixel. */
  near: number[];
};

const dec = (s: string, div: number) => s.split(",").map((x) => (x === "x" || x === "" ? null : Number(x) / div));

const load = unstable_cache(
  async (): Promise<RainCorrection | null> => {
    const res = await fetch(RAIN_CORRECTION_URL, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`); // not cached
    const j = (await res.json()) as Raw;
    const n = j?.grid?.nx * j?.grid?.ny;
    if (!j?.windowEnd || !n) throw new Error("unexpected shape");
    const out: RainCorrection = {
      windowEnd: Date.parse(j.windowEnd),
      pairs: j.pairs,
      raw24: dec(j.grid.raw24, 10),
      corr24: dec(j.grid.corr24, 10),
      gain: dec(j.grid.gain, 100),
      near: j.grid.near.split(",").map(Number),
    };
    if (out.raw24.length !== n || out.corr24.length !== n || out.gain.length !== n || out.near.length !== n || !Number.isFinite(out.windowEnd)) throw new Error("unexpected size");
    return out;
  },
  ["rain-correction-v1"],
  { revalidate: 600 },
);

export async function getRainCorrection(now = Date.now()): Promise<RainCorrection | null> {
  try {
    const c = await load();
    return c && now - c.windowEnd <= RAIN_CORRECTION_MAX_AGE_MS ? c : null;
  } catch {
    return null;
  }
}

export type CorrectedPoint = { raw24: number; corr24: number; near: number; pairs: number };

/** Raw and corrected 24 h satellite rain over the pixel a point sits in; null when unavailable. */
export async function getCorrectedAt(lat: number, lon: number, now = Date.now()): Promise<CorrectedPoint | null> {
  const c = await getRainCorrection(now);
  if (!c) return null;
  const i = pixelIndex(lat, lon);
  if (i < 0 || c.raw24[i] == null || c.corr24[i] == null) return null;
  return { raw24: c.raw24[i]!, corr24: c.corr24[i]!, near: c.near[i], pairs: c.pairs };
}
