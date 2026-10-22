// Flood history for /history: reads history.json from the `data` branch
// (built daily by scripts/build-history.mjs) and turns it into compact
// per-station day codes the client calendar can aggregate cheaply.
//
// Gauge days are classified with the live site's own levelTier() against the
// station's current thresholds, so "alert" here means the same as on the
// station pages. Modelled days use the percentile thresholds the build script
// stored (calibrated to the real national warning rate, see its header).

import { levelTier } from "./status";
import type { Thresholds } from "./readings";
import { detectUnit, type Unit } from "./units";
import { stationPath } from "./slug";
import { stationDisplayName } from "./displayName";

const HISTORY_URL = "https://raw.githubusercontent.com/shakee93/sl-water-levels/data/history.json";

type HistoryFile = {
  generatedAt: string;
  stations: { station: string; basin: string; lat: number; lon: number; thresholds: Thresholds | null }[];
  gauge: { start: string; days: number; levels: Record<string, (number | null)[]> };
  model: {
    start: string;
    days: number;
    stations: Record<string, { thresholds: { alert: number; minor: number; major: number }; values: (number | null)[] }>;
  };
};

/**
 * One character per day:
 *   "."  no data   "n" gauge has no flood levels published
 *   "0"  normal (incl. "near alert")   "1" alert   "2" minor flood   "3" major flood
 */
export type DayCodes = string;

export type HistoryStation = {
  station: string;
  name: string;
  basin: string;
  href: string;
  unit: Unit;
  thresholds: Thresholds | null;
};

export type HistoryData = {
  generatedAt: string;
  stations: HistoryStation[];
  gauge: { start: string; codes: DayCodes[]; levels: (number | null)[][] };
  model: { start: string; codes: DayCodes[] };
};

function gaugeCode(level: number | null, t: Thresholds | null): string {
  if (level == null) return ".";
  if (!t) return "n";
  switch (levelTier(level, t)) {
    case "major":
      return "3";
    case "minor":
      return "2";
    case "alert":
      return "1";
    case "none":
      return "n";
    default:
      return "0";
  }
}

function modelCode(v: number | null, t: { alert: number; minor: number; major: number }): string {
  if (v == null) return ".";
  if (v >= t.major) return "3";
  if (v >= t.minor) return "2";
  if (v >= t.alert) return "1";
  return "0";
}

export async function getHistory(): Promise<HistoryData | null> {
  let file: HistoryFile;
  try {
    // Rebuilt twice a day by the snapshot workflow; an hour of staleness is fine.
    const r = await fetch(HISTORY_URL, { next: { revalidate: 3600 } });
    if (!r.ok) return null;
    file = (await r.json()) as HistoryFile;
  } catch {
    return null;
  }

  const stations: HistoryStation[] = file.stations
    .map((s) => ({
      station: s.station,
      name: stationDisplayName(s.station),
      basin: s.basin,
      href: stationPath(s.basin, s.station),
      unit: s.thresholds ? detectUnit(s.thresholds, s.station) : null,
      thresholds: s.thresholds,
    }))
    .sort((a, b) => a.basin.localeCompare(b.basin) || a.name.localeCompare(b.name));

  const empty = (n: number) => ".".repeat(n);
  return {
    generatedAt: file.generatedAt,
    stations,
    gauge: {
      start: file.gauge.start,
      codes: stations.map((s) => {
        const lv = file.gauge.levels[s.station];
        return lv ? lv.map((v) => gaugeCode(v, s.thresholds)).join("") : empty(file.gauge.days);
      }),
      levels: stations.map((s) => file.gauge.levels[s.station] ?? []),
    },
    model: {
      start: file.model.start,
      codes: stations.map((s) => {
        const m = file.model.stations[s.station];
        return m ? m.values.map((v) => modelCode(v, m.thresholds)).join("") : empty(file.model.days);
      }),
    },
  };
}
