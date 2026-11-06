// Older readings for the gauges HMIS and RiverNet add (their live APIs serve only the last 24 h), read back from our own archive on the
// `data` branch: hmis/levels/YYYY/YYYY-MM-DD.json (scripts/hmis-snapshot.mjs, every 30 min since 26 Oct 2026) and rivernet/YYYY/YYYY-MM-DD.json
// (scripts/rivernet-snapshot.mjs, 5-minute points, since 27 Oct 2026). Files are per Colombo day. Server only, never a request to HMIS or
// RiverNet. Used for the long chart only (fetchStationData); the latest reading, official step and every verdict still come from the live read.
// Fails soft: a missing day or a slow GitHub gives fewer points, never an error. Time-boxed so a page never waits on it for long.
import { unstable_cache } from "next/cache";

const BASE = process.env.DATA_RAW_URL ?? "https://raw.githubusercontent.com/shakee93/sl-water-levels/data";
import { archiveDays, type ArchivePoint } from "./gaugeArchiveCalc";
export { mergeArchive } from "./gaugeArchiveCalc";

type DayFile = Record<string, { key?: string; pts?: [number, number][] }>;

/** One device's points from one archive day, cached 30 minutes (only the small per-device list is kept). */
const loadDay = unstable_cache(
  async (kind: "hmis" | "rivernet", day: string, id: string): Promise<ArchivePoint[]> => {
    const p = kind === "hmis" ? `hmis/levels/${day.slice(0, 4)}/${day}.json` : `rivernet/${day.slice(0, 4)}/${day}.json`;
    const res = await fetch(`${BASE}/${p}`, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`HTTP ${res.status}`); // not cached
    const j = (await res.json()) as DayFile;
    // HMIS files are keyed by the device id; RiverNet files by unit, with the chart key inside.
    const e = kind === "hmis" ? j[id] : Object.values(j).find((x) => x?.key === id);
    return (e?.pts ?? []).filter((x) => Array.isArray(x) && Number.isFinite(x[0]) && Number.isFinite(x[1])).map(([ts, m]) => ({ ts, m }));
  },
  ["gauge-archive-v1"],
  { revalidate: 1800 },
);

/** Archived points for one device over the last `days`, within `budgetMs`; [] when nothing arrives in time. */
export async function getArchivedPoints(kind: "hmis" | "rivernet", id: string, days: number, budgetMs = 2500, now = Date.now()): Promise<ArchivePoint[]> {
  if (days <= 1) return [];
  const work = Promise.all(archiveDays(days, now).map((d) => loadDay(kind, d, id).catch(() => [] as ArchivePoint[]))).then((xs) => xs.flat());
  const timeout = new Promise<ArchivePoint[]>((r) => setTimeout(() => r([]), budgetMs));
  return Promise.race([work, timeout]);
}
