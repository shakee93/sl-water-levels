// The forecast KPI file (kpi/latest.json on the `data` branch), written nightly by scripts/forecast-kpi.mjs from lib/forecastKpi.mjs.
// /[lang]/forecast-accuracy reads it here (cached 1 h, time-boxed, fails soft to null). Same pattern as lib/accuracy.ts.

const URL_ = process.env.KPI_URL ?? "https://raw.githubusercontent.com/shakee93/sl-water-levels/data/kpi/latest.json";

export type KpiPart = { key: string; value: number | null; target: number | string | null; n: number; met: boolean | null; shown?: number | null; worst?: number | null };
export type Kpi = {
  id: number;
  key: "warned" | "falseAlarms" | "honest" | "skill" | "bias" | "coverage" | "fastRises" | "risingRight" | "inputs" | "people";
  value: number | null;
  unit: string;
  target: number | string | null;
  targetText: string;
  met: boolean | null;
  n: number;
  parts: KpiPart[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail?: Record<string, any>;
};
export type KpiSummary = { met: number; assessable: number; total: number; notJudged: number };
export type KpiVersion = {
  id: string;
  name: string;
  from: string;
  what: string;
  runs: number;
  days?: number;
  liveUntil?: string | null;
  kpis: Kpi[] | null;
  summary: KpiSummary | null;
};
export type KpiFile = {
  version: number;
  generatedAt: string;
  asOf: string;
  window: { from: string; to: string; days: number; requested: number };
  runs: number;
  events: number;
  summary: KpiSummary;
  kpis: Kpi[];
  stormDays: string[];
  storm: { days: number; kpis: Kpi[]; summary: KpiSummary } | null;
  versions: KpiVersion[];
};

export async function getForecastKpi(ms = 2000): Promise<KpiFile | null> {
  try {
    const res = await fetch(URL_, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    const j = (await res.json()) as KpiFile;
    return j && Array.isArray(j.kpis) && j.kpis.length ? j : null;
  } catch {
    return null;
  }
}

export const part = (k: Kpi | undefined, key: string): KpiPart | undefined => k?.parts.find((p) => p.key === key);
