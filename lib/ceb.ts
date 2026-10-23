// PUCSL GenData: 15-min hydropower generation per plant (MW).
// Open API, no auth, JSON.
//
// STATE (checked 2026-10-22/23, research/dam-releases.md): powerInMw is populated now (it was null
// for every record in September), but the feed lags about 2.5 days (data for 21-23 Oct was empty on
// 23 Oct), has gaps, and MW is only a loose proxy for turbine flow: Upper Kotmale ran flat at 75 MW
// while its spill gates were being opened. So it is ARCHIVE / post-event analysis material, never a
// live signal or a warning. fetchHydroGeneration() therefore only returns points from the last
// LIVE_MAX_AGE_H hours; with today's lag that is nothing, so the "MW now" badges in BasinDams stay
// hidden instead of showing days-old numbers as live. Real release warnings come from lib/releases.ts.
//
// API: https://gendata.pucsl.gov.lk/api/day-ahead-dispatch
//      ?dateAggregation=15min&from=<ISO>&to=<ISO>
// Response: { data: [{ reportTimeStamp, powerPlantId, powerInMw }] }

const PUCSL_API = "https://gendata.pucsl.gov.lk/api/day-ahead-dispatch";

export type HydroPoint = {
  plantId: number;
  ts: number;
  powerMW: number;
};

/** Older points are history, not "now": never shown as live. */
const LIVE_MAX_AGE_H = 3;

export async function fetchHydroGeneration(hours = 24): Promise<HydroPoint[]> {
  const to = new Date();
  const from = new Date(to.getTime() - hours * 3_600_000);
  const url = `${PUCSL_API}?dateAggregation=15min&from=${from.toISOString()}&to=${to.toISOString()}`;
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: { reportTimeStamp: string; powerPlantId: number; powerInMw: number | null }[];
    };
    if (!Array.isArray(json.data)) return [];
    return json.data
      .filter((r) => r.powerInMw != null && Number.isFinite(r.powerInMw))
      .filter((r) => to.getTime() - new Date(r.reportTimeStamp).getTime() <= LIVE_MAX_AGE_H * 3600000)
      .map((r) => ({
        plantId: r.powerPlantId,
        ts: new Date(r.reportTimeStamp).getTime(),
        powerMW: r.powerInMw as number,
      }));
  } catch {
    return [];
  }
}

export function currentByPlant(records: HydroPoint[]): Map<number, HydroPoint> {
  const m = new Map<number, HydroPoint>();
  for (const r of records) {
    const e = m.get(r.plantId);
    if (!e || r.ts > e.ts) m.set(r.plantId, r);
  }
  return m;
}

export function peakInLast(records: HydroPoint[], plantId: number, hours: number): number {
  const cutoff = Date.now() - hours * 3_600_000;
  let peak = 0;
  for (const r of records) {
    if (r.plantId !== plantId) continue;
    if (r.ts < cutoff) continue;
    if (r.powerMW > peak) peak = r.powerMW;
  }
  return peak;
}
