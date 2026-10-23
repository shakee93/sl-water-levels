// Reservoirs whose releases can raise a river gauge we show, and how they connect.
//
// Each entry says which gauges are downstream and, when we have measured it, how long water takes
// to arrive. Names of gauges are the exact `station` values in the ArcGIS feed. An entry with no
// gauges is still listed on its river page (basin only): either every gauge we have is upstream of
// it, or a reservoir/barrage sits in between and soaks the release up.
//
// Travel times come from our own archive (data branch), never from guesses:
//  - Deduru Oya -> Moragaswewa: 21-22 Oct 2026. Ada Derana reported the six sluice gates opened at
//    20:53; the gauge was flat at 1.38 m until 01:03 and then climbed 1.39 -> 1.85 m (02:02) ->
//    4.05 m (06:06) with no local rain. So the rise began 4.5 to 5 hours after the first report
//    (the real gate-opening time is not published, so this is an upper bound on the lag). One event
//    only, hence confidence "medium"; refit once releases/ has more events.
//  - Every other pair has no measured event yet (Thambuththegama has no readings in the archive at
//    all), so etaHours is null and the UI says "may rise in the next hours" without a number.
//
// Not mapped on purpose (too uncertain from geography alone): Kimbulwana Oya, Batalagoda,
// Ambakolawewa, Attaragalla (Deduru Oya / Ma Oya tributaries), Inginimitiya (Mi Oya, no gauge),
// Maduru Oya reservoir (Padiyathalawa gauge is upstream of it), Nachchaduwa (Malwathu Oya;
// listed with low confidence).

import { BASIN_ORDER } from "./basinOrder";
import { RIVER_SHAPE } from "./riverTopology";

export type Confidence = "high" | "medium" | "low";

export type GaugeLink = {
  /** Exact station name in the ArcGIS feed. */
  station: string;
  basin: string;
  /** Hours from the release starting to the gauge starting to rise: [min, max]; null = not measured. */
  eta: [number, number] | null;
  confidence: Confidence;
  note: string;
  /** Town shown at the end of the chain "reservoir -> gauge -> town": a gazetteer place (lib/places.ts) this gauge covers, picked by hand as the best-known place downstream. */
  town?: string;
  /** Not a link we curated: the gauge is further down the same river than a linked one. No travel time. */
  indirect?: boolean;
};

export type Reservoir = {
  id: string;
  /** Display name (English; place names are shown as the source gives them). */
  name: string;
  /** Lower-case spellings seen in the sheet, the Mahaweli PDF and the news. */
  aliases: string[];
  /** Spellings that identify the reservoir only when they are the whole name (a sheet or PDF row), not inside a sentence ("Victoria Park"). */
  exactAliases?: string[];
  /** River basin the reservoir feeds, as in the gauge feed (trimmed). */
  basin: string;
  /** Gauges downstream of it. Empty = basin-level only. */
  gauges: GaugeLink[];
  /** A diversion barrage that always passes water: its discharge is not a warning. */
  barrage?: boolean;
  /** The flood-warning basin whose DMC bulletin figure is this reservoir's release (only where one reservoir is meant). */
  dmcBasin?: string;
  /** "watch": its water goes into another reservoir or has no river gauge below it, so a gates-opened report is shown as "Reservoir watch", never as a flood warning. */
  kind?: "watch";
  note?: string;
};

export const RESERVOIRS: Reservoir[] = [
  {
    id: "deduru-oya",
    name: "Deduru Oya",
    aliases: ["deduru oya", "deduru oya reservoir"],
    basin: "Deduru Oya",
    dmcBasin: "Deduru Oya",
    gauges: [
      {
        station: "Moragaswewa",
        basin: "Deduru Oya",
        eta: [4, 5],
        confidence: "medium",
        town: "Chilaw",
        note: "One measured event (21-22 Oct 2026): gauge began to rise 4.5-5 h after the first gates-open report; about 55 km by river.",
      },
    ],
  },
  {
    id: "rajangana",
    name: "Rajanganaya",
    aliases: ["rajangana", "rajanganaya", "rajangana wewa"],
    basin: "Kala Oya",
    dmcBasin: "Kala Oya",
    // Kala Oya flows west: Kala Wewa (80.56E) -> Thambuththegama gauge (80.33E) ->
    // Rajanganaya (80.24E) -> Wilpattu / Puttalam. Rajanganaya's releases go downstream of
    // our only Kala Oya gauge (towns per the DMC warning: Wanathawilluwa, Karuwalagaswewa).
    gauges: [],
    note: "Releases flow west towards Wanathawilluwa and Karuwalagaswewa; there is no gauge of ours below it.",
  },
  {
    id: "kalawewa",
    name: "Kala Wewa",
    aliases: ["kala wewa", "kalawewa", "kala wawa"],
    basin: "Kala Oya",
    dmcBasin: "Kala Oya",
    gauges: [
      {
        station: "Thambuththegama",
        basin: "Kala Oya",
        eta: null,
        confidence: "medium",
        town: "Thambuththegama",
        note: "Kala Wewa is upstream of the Thambuththegama gauge on the Kala Oya (gauge 80.33E, tank 80.56E); no archived event to measure the delay.",
      },
    ],
  },
  {
    id: "upper-kotmale",
    name: "Upper Kotmale",
    aliases: ["upper kotmale", "upper kothmale", "upper kotmale reservoir", "upper kotmale dam", "upper kotmale hydropower"],
    basin: "Mahaweli Ganga",
    kind: "watch",
    gauges: [],
    note: "Its water goes into Kotmale reservoir, which absorbs it; the Kotmale Oya valley has no gauge of ours.",
  },
  {
    id: "kotmale",
    name: "Kotmale",
    aliases: ["kotmale", "kothmale"],
    basin: "Mahaweli Ganga",
    gauges: [
      { station: "Nawalapitiya", basin: "Mahaweli Ganga", eta: null, confidence: "medium", note: "Next gauge downstream on the Mahaweli (BASIN_ORDER).", town: "Nawalapitiya" },
      { station: "Peradeniya", basin: "Mahaweli Ganga", eta: null, confidence: "medium", note: "Further downstream, past Gampola.", town: "Kandy" },
    ],
  },
  {
    id: "polgolla",
    name: "Polgolla",
    aliases: ["polgolla", "polgolla barrage"],
    basin: "Mahaweli Ganga",
    gauges: [],
    barrage: true,
    note: "Diversion barrage: passes water all year, so its discharge is shown only in the Mahaweli PDF, never as a warning.",
  },
  {
    id: "victoria",
    name: "Victoria",
    aliases: ["victoria reservoir", "victoria dam"],
    exactAliases: ["victoria"],
    basin: "Mahaweli Ganga",
    gauges: [
      { station: "Weraganthota", basin: "Mahaweli Ganga", eta: null, confidence: "low", note: "Below Victoria, Randenigala and Rantambe; the chain of reservoirs between delays and softens it.", town: "Mahiyangana" },
      { station: "Manampitiya", basin: "Mahaweli Ganga", eta: null, confidence: "low", note: "Far downstream on the Mahaweli.", town: "Polonnaruwa" },
    ],
  },
  {
    id: "randenigala",
    name: "Randenigala",
    aliases: ["randenigala"],
    basin: "Mahaweli Ganga",
    gauges: [
      { station: "Weraganthota", basin: "Mahaweli Ganga", eta: null, confidence: "low", note: "Below Rantambe, near Mahiyangana.", town: "Mahiyangana" },
      { station: "Manampitiya", basin: "Mahaweli Ganga", eta: null, confidence: "low", note: "Far downstream on the Mahaweli.", town: "Polonnaruwa" },
    ],
  },
  {
    id: "rantambe",
    name: "Rantambe",
    aliases: ["rantambe", "rantembe"],
    basin: "Mahaweli Ganga",
    gauges: [
      { station: "Weraganthota", basin: "Mahaweli Ganga", eta: null, confidence: "low", note: "Just below Rantambe, near Mahiyangana.", town: "Mahiyangana" },
      { station: "Manampitiya", basin: "Mahaweli Ganga", eta: null, confidence: "low", note: "Far downstream on the Mahaweli.", town: "Polonnaruwa" },
    ],
  },
  // ---- CEB / Mahaweli dams added for the news matcher and the weekly spill watch (WMS weekly meeting).
  // Their water goes through tunnels, power stations or other reservoirs, so none has a measured travel time.
  // Gauges are listed only where the next gauge below is clear from the map; the rest are basin-level.
  {
    id: "bowatenna",
    name: "Bowatenna",
    aliases: ["bowatenna", "bowathenna", "bowatenna reservoir", "bowatenna dam"],
    basin: "Mahaweli Ganga",
    gauges: [],
    note: "Receives the Polgolla diversion; no gauge of ours below it.",
  },
  {
    id: "moragahakanda",
    name: "Moragahakanda",
    aliases: ["moragahakanda", "moragaha kanda", "moragahakande", "moragahakanda reservoir", "moragahakanda dam"],
    basin: "Mahaweli Ganga",
    gauges: [],
    note: "Kaluganga/Amban Ganga system; no gauge of ours below it.",
  },
  {
    id: "kaluganga",
    name: "Kaluganga",
    aliases: ["kaluganga reservoir", "kalu ganga reservoir", "kaluganga dam", "kalu ganga dam"],
    exactAliases: ["kaluganga"],
    basin: "Mahaweli Ganga",
    gauges: [],
    note: "The Kaluganga reservoir in Matale (not the Kalu Ganga river at Ratnapura), part of the Moragahakanda scheme.",
  },
  {
    id: "samanalawewa",
    name: "Samanalawewa",
    aliases: ["samanalawewa", "samanala wewa", "samanalawawa", "samanalawa", "samanalawewa reservoir", "samanalawewa dam"],
    basin: "Walawe Ganga",
    gauges: [],
    note: "Udawalawe reservoir sits between it and our Moraketiya gauge.",
  },
  {
    id: "castlereagh",
    name: "Castlereagh",
    aliases: ["castlereagh", "castlereigh", "castlereagh reservoir", "castlereigh reservoir", "castlereagh dam", "castlereigh dam"],
    basin: "Kelani Ganga",
    gauges: [{ station: "Kithulgala", basin: "Kelani Ganga", eta: null, confidence: "low", note: "Laxapana complex water reaches the Kelani above Kithulgala; the route goes through tunnels and power stations.", town: "Kithulgala" }],
  },
  {
    id: "maussakele",
    name: "Maussakele",
    aliases: ["maussakele", "moussakele", "maussakelle", "moussakelle", "mousakelle", "maussakale", "mausakelle", "maussakele reservoir", "moussakele reservoir", "maussakele dam", "moussakele dam"],
    basin: "Kelani Ganga",
    gauges: [{ station: "Kithulgala", basin: "Kelani Ganga", eta: null, confidence: "low", note: "Laxapana complex water reaches the Kelani above Kithulgala; the route goes through tunnels and power stations.", town: "Kithulgala" }],
  },
  {
    id: "canyon",
    name: "Canyon",
    aliases: ["canyon reservoir", "canyon dam", "canyon spill", "canyon power station"],
    exactAliases: ["canyon"],
    basin: "Kelani Ganga",
    gauges: [{ station: "Kithulgala", basin: "Kelani Ganga", eta: null, confidence: "low", note: "Laxapana complex water reaches the Kelani above Kithulgala.", town: "Kithulgala" }],
  },
  {
    id: "norton",
    name: "Norton",
    aliases: ["norton reservoir", "norton dam", "norton bridge reservoir", "norton bridge dam"],
    exactAliases: ["norton"],
    basin: "Kelani Ganga",
    gauges: [{ station: "Kithulgala", basin: "Kelani Ganga", eta: null, confidence: "low", note: "Laxapana complex water reaches the Kelani above Kithulgala.", town: "Kithulgala" }],
  },
  {
    id: "laxapana",
    name: "Laxapana",
    aliases: ["laxapana", "laksapana", "laxapana reservoir", "laxapana dam", "new laxapana", "old laxapana"],
    basin: "Kelani Ganga",
    gauges: [{ station: "Kithulgala", basin: "Kelani Ganga", eta: null, confidence: "low", note: "Laxapana tailrace joins the Kelani above Kithulgala.", town: "Kithulgala" }],
  },
  {
    id: "broadlands",
    name: "Broadlands",
    aliases: ["broadlands", "broadlands reservoir", "broadlands dam"],
    exactAliases: ["broadland"],
    basin: "Kelani Ganga",
    gauges: [],
    note: "Run-of-river station on the Kelani above Glencourse.",
  },
  {
    id: "kukule",
    name: "Kukule",
    aliases: ["kukule", "kukule ganga", "kukuleganga", "kukule ganga reservoir", "kukule dam", "kukule ganga dam"],
    basin: "Kalu Ganga",
    gauges: [],
    note: "Kukule Ganga joins the Kalu Ganga below Ratnapura; none of our Kalu Ganga gauges is clearly below it.",
  },
  {
    id: "udawalawe",
    name: "Udawalawe",
    aliases: ["udawalawe", "udawalawa"],
    basin: "Walawe Ganga",
    gauges: [
      { station: "Moraketiya", basin: "Walawe Ganga", eta: null, confidence: "medium", note: "The Moraketiya gauge is south of the dam, on the Walawe below it.", town: "Embilipitiya" },
    ],
  },
  {
    id: "lunugamvehera",
    name: "Lunugamvehera",
    aliases: ["lunugamwehera", "lunugamvehera", "lunugam vehera"],
    basin: "Kirindi Oya",
    gauges: [],
    note: "All three Kirindi Oya gauges (Wellawaya, Kuda Oya, Thanamalwila) are upstream of the dam.",
  },
  {
    id: "senanayake-samudraya",
    name: "Senanayake Samudraya",
    aliases: ["senanayaka samudraya", "senanayake samudraya", "senanayaka samudra", "senanayake samudra"],
    basin: "Gal Oya",
    gauges: [
      { station: "Ampara", basin: "Gal Oya", eta: null, confidence: "medium", note: "Gal Oya flows east from the reservoir past Ampara.", town: "Ampara" },
    ],
  },
  {
    id: "nachchaduwa",
    name: "Nachchaduwa",
    aliases: ["nachchaduwa", "nachchaduwa wewa"],
    basin: "Malwathu Oya",
    gauges: [
      { station: "Thanthirimale", basin: "Malwathu Oya", eta: null, confidence: "low", note: "Malwathu Oya system, downstream of Anuradhapura; the exact route from the tank is not verified." },
    ],
  },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();

// Longest alias first so "upper kotmale" wins over "kotmale".
const ALIAS_INDEX: { alias: string; res: Reservoir; exactOnly: boolean }[] = RESERVOIRS.flatMap((res) => [
  ...res.aliases.map((a) => ({ alias: norm(a), res, exactOnly: false })),
  ...(res.exactAliases ?? []).map((a) => ({ alias: norm(a), res, exactOnly: true })),
]).sort((a, b) => b.alias.length - a.alias.length);

/** The catalogue reservoir a source name (or a sentence) refers to, or null. */
export function matchReservoir(text: string, mode: "exact" | "contains" = "exact"): Reservoir | null {
  const n = norm(text);
  if (!n) return null;
  if (mode === "exact") return ALIAS_INDEX.find((e) => n === e.alias)?.res ?? null;
  // In a sentence the alias that starts first wins ("upper kotmale reservoir" is Upper Kotmale), then the longest.
  let best: { at: number; len: number; res: Reservoir } | null = null;
  for (const e of ALIAS_INDEX) {
    if (e.exactOnly) continue;
    const m = new RegExp(`(^| )${e.alias}( |$)`).exec(n);
    if (!m) continue;
    const at = m.index + m[1].length;
    if (!best || at < best.at || (at === best.at && e.alias.length > best.len)) best = { at, len: e.alias.length, res: e.res };
  }
  return best?.res ?? null;
}

export function reservoirById(id: string): Reservoir | undefined {
  return RESERVOIRS.find((r) => r.id === id);
}

/** Reservoirs with a gauge link to this station. */
export function reservoirsForStation(station: string): { res: Reservoir; link: GaugeLink }[] {
  const out: { res: Reservoir; link: GaugeLink }[] = [];
  for (const res of RESERVOIRS) {
    const link = res.gauges.find((g) => g.station === station);
    if (link) out.push({ res, link });
  }
  return out;
}

export const reservoirsForBasin = (basin: string): Reservoir[] => RESERVOIRS.filter((r) => r.basin === basin.trim());

// ---- Transitive links: a reservoir also feeds every gauge further down the same river.

/** The river's main line, source to sea: gauge names, and "@slug" for a dam the river passes through. */
function mainLine(basin: string): string[] {
  const b = basin.trim();
  return RIVER_SHAPE[b]?.main ?? BASIN_ORDER[b] ?? [];
}

/**
 * Gauges below the linked ones on the same river, nearest first, as `indirect` links. The walk stops
 * at the next dam on the river (it soaks the release up), as the catalogue already does by hand.
 */
export function withDownstreamGauges(gauges: GaugeLink[]): GaugeLink[] {
  const out = [...gauges];
  const have = new Set(gauges.map((g) => `${g.basin.trim()}|${g.station}`));
  for (const g of gauges) {
    const line = mainLine(g.basin);
    const i = line.indexOf(g.station);
    if (i < 0) continue;
    for (const next of line.slice(i + 1)) {
      if (next.startsWith("@")) break;
      const key = `${g.basin.trim()}|${next}`;
      if (have.has(key)) continue;
      have.add(key);
      out.push({ station: next, basin: g.basin, eta: null, confidence: "low", indirect: true, note: `Further down the same river than ${g.station}.` });
    }
  }
  return out;
}

/** Gauges at or above `station` that water can reach it from, with how many gauges/dams away (0 = itself), nearest first. */
function upstreamGauges(basin: string, station: string): { station: string; steps: number }[] {
  const line = mainLine(basin);
  const out: { station: string; steps: number }[] = [];
  const at = line.indexOf(station);
  if (at >= 0) {
    for (let i = at, steps = 0; i >= 0; i--, steps++) {
      if (i < at && line[i].startsWith("@")) break; // a dam in between soaks the release up
      if (!line[i].startsWith("@")) out.push({ station: line[i], steps });
    }
    for (const t of RIVER_SHAPE[basin.trim()]?.tribs ?? []) {
      const j = line.indexOf(t.joins[1]);
      if (j < 0 || j > at) continue;
      t.path.forEach((name, k) => {
        if (!name.startsWith("@")) out.push({ station: name, steps: at - j + 1 + (t.path.length - 1 - k) });
      });
    }
    return out;
  }
  // A gauge on a side branch: itself and the gauges above it on that branch.
  for (const t of RIVER_SHAPE[basin.trim()]?.tribs ?? []) {
    const k = t.path.indexOf(station);
    if (k < 0) continue;
    for (let i = k, steps = 0; i >= 0; i--, steps++) if (!t.path[i].startsWith("@")) out.push({ station: t.path[i], steps });
    return out;
  }
  const order = BASIN_ORDER[basin.trim()] ?? [];
  const i = order.indexOf(station);
  return i < 0 ? [{ station, steps: 0 }] : order.slice(0, i + 1).reverse().map((s, steps) => ({ station: s, steps }));
}

export type ConnectingReservoir = {
  res: Reservoir;
  /** 0 = linked to this gauge itself; otherwise how many gauges upstream the nearest link is. */
  steps: number;
  /** The upstream gauge it is linked to (null when linked to this gauge). */
  via: string | null;
};

/** Reservoirs linked to this gauge or to any gauge above it on the same river, nearest first. */
export function connectingReservoirs(basin: string, station: string): ConnectingReservoir[] {
  const up = upstreamGauges(basin, station);
  const best = new Map<string, ConnectingReservoir>();
  for (const res of RESERVOIRS) {
    for (const g of res.gauges) {
      if (g.basin.trim() !== basin.trim()) continue;
      const hit = up.find((u) => u.station === g.station);
      if (!hit) continue;
      const cur = best.get(res.id);
      if (!cur || hit.steps < cur.steps) best.set(res.id, { res, steps: hit.steps, via: hit.steps === 0 ? null : g.station });
    }
  }
  return [...best.values()].sort((a, b) => a.steps - b.steps || a.res.name.localeCompare(b.res.name));
}
