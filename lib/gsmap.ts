// Satellite-observed rain over a gauge's upstream catchment, from JAXA GSMaP_NOW.
//
// scripts/gsmap-snapshot.mjs (GitHub Actions, JAXA login in repo secrets) writes gsmap/latest.json to
// the `data` branch every ~30 minutes; this file only reads that JSON, so the site needs no JAXA
// secret. Fails soft: any problem returns null. Data older than 3 h is treated as unavailable, so a
// stopped workflow can never pass off old rain as current.
//
// The numbers are the mean over the same cells as the forecast's catchment rain (lib/model/
// catchments.json), so they are directly comparable with BasinWeather.past6hMm / past24hMm.
//
// How this could feed lib/forecast.ts (NOT wired in, the model is unchanged): where the modelled
// past rain (weather.past6hMm) disagrees with the satellite, prefer the satellite for the
// `rainUpstream6h` signal, and use mm1h / rateMmPerHour as a "rain falling now" input. Refit
// scripts/fit-forecast.mjs against the archive (gsmap/archive/ on the data branch) before using it
// in the model; GSMaP also under-reads short, small convective storms.

import { unstable_cache } from "next/cache";

// GSMAP_URL env override: local testing against a hand-made file.
export const GSMAP_URL = process.env.GSMAP_URL ?? "https://raw.githubusercontent.com/shakee93/sl-water-levels/data/gsmap/latest.json";
export const GSMAP_CREDIT = "GSMaP data by Japan Aerospace Exploration Agency (JAXA)";
export const GSMAP_MAX_AGE_MS = 3 * 3_600_000;

export type GsmapGauge = {
  basin: string;
  station: string;
  cells: number;
  /** Rain rate in the newest hour, mm/h. */
  rateMmPerHour: number | null;
  /** Catchment-mean rain over the past 1 / 3 / 6 / 24 hours, mm. null = too many hours missing. */
  mm1h: number | null;
  mm3h: number | null;
  mm6h: number | null;
  mm24h: number | null;
};

/** Rain over a named box of pixels (scripts/gsmap-snapshot.mjs STREET_RAIN_ZONES), same fields as a gauge catchment. */
export type GsmapZone = Omit<GsmapGauge, "basin" | "station"> & {
  name: string;
  /**
   * 24 h sum of the hourly means with EACH HOUR CLIPPED at hourlyCapMm (15): the number the street-flood rule uses
   * (mm24h is the unclipped total, for display). Absent in files written before the clip; the rule is then off.
   */
  mm24hClipped?: number | null;
  hourlyCapMm?: number;
};

export type GsmapFile = {
  source: string;
  credit: string;
  generatedAt: string;
  /** The newest rain covers the hour from latestStart to latestEnd (ISO, UTC). */
  latestStart: string;
  latestEnd: string;
  stations: Record<string, GsmapGauge>;
  /** Absent in files written before zones existed. */
  zones?: Record<string, GsmapZone>;
};

const load = unstable_cache(
  async (): Promise<GsmapFile | null> => {
    const res = await fetch(GSMAP_URL, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`); // not cached
    const j = (await res.json()) as GsmapFile;
    if (!j || typeof j.latestEnd !== "string" || !j.stations) throw new Error("unexpected shape");
    return j;
  },
  ["gsmap-latest-v2"],
  { revalidate: 600 },
);

/** The whole file, or null when it is missing, malformed or older than 3 h. */
export async function getGsmap(now = Date.now()): Promise<GsmapFile | null> {
  try {
    const f = await load();
    if (!f) return null;
    const end = Date.parse(f.latestEnd);
    if (!Number.isFinite(end) || now - end > GSMAP_MAX_AGE_MS) return null;
    return f;
  } catch {
    return null;
  }
}

/** Satellite rain for one gauge's catchment, with the time the newest hour ends (ms). */
export async function getGsmapForStation(basin: string, station: string, now = Date.now()): Promise<(GsmapGauge & { endsAt: number }) | null> {
  const f = await getGsmap(now);
  const g = f?.stations[`${basin.trim()}/${station}`];
  return f && g ? { ...g, endsAt: Date.parse(f.latestEnd) } : null;
}

/** Satellite rain over a named zone (the street-rain rule's area), with the time the newest hour ends (ms). Null = unavailable (no file, stale, zone missing). */
export async function getGsmapZone(id: string, now = Date.now()): Promise<(GsmapZone & { endsAt: number }) | null> {
  const f = await getGsmap(now);
  const z = f?.zones?.[id];
  return f && z ? { ...z, endsAt: Date.parse(f.latestEnd) } : null;
}
