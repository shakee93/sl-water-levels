// PUCSL GenData — live 15-min hydropower generation per plant.
// Open API, no auth, JSON. Each MW spike is a release proxy: water has
// to be flowing through the turbines for the plant to be generating.
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
