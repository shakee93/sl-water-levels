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

export type Confidence = "high" | "medium" | "low";

export type GaugeLink = {
  /** Exact station name in the ArcGIS feed. */
  station: string;
  basin: string;
  /** Hours from the release starting to the gauge starting to rise: [min, max]; null = not measured. */
  eta: [number, number] | null;
  confidence: Confidence;
  note: string;
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
    gauges: [
      {
        station: "Thambuththegama",
        basin: "Kala Oya",
        eta: null,
        confidence: "medium",
        note: "Same river (the DMC Kala Oya warning names Rajanganaya); no archived readings at Thambuththegama to measure the delay.",
      },
    ],
  },
  {
    id: "upper-kotmale",
    name: "Upper Kotmale",
    aliases: ["upper kotmale", "upper kothmale"],
    basin: "Mahaweli Ganga",
    gauges: [],
    note: "Its water goes into Kotmale reservoir, which absorbs it; the Kotmale Oya valley has no gauge of ours.",
  },
  {
    id: "kotmale",
    name: "Kotmale",
    aliases: ["kotmale", "kothmale"],
    basin: "Mahaweli Ganga",
    gauges: [
      { station: "Nawalapitiya", basin: "Mahaweli Ganga", eta: null, confidence: "medium", note: "Next gauge downstream on the Mahaweli (BASIN_ORDER)." },
      { station: "Peradeniya", basin: "Mahaweli Ganga", eta: null, confidence: "medium", note: "Further downstream, past Gampola." },
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
      { station: "Weraganthota", basin: "Mahaweli Ganga", eta: null, confidence: "low", note: "Below Victoria, Randenigala and Rantambe; the chain of reservoirs between delays and softens it." },
      { station: "Manampitiya", basin: "Mahaweli Ganga", eta: null, confidence: "low", note: "Far downstream on the Mahaweli." },
    ],
  },
  {
    id: "randenigala",
    name: "Randenigala",
    aliases: ["randenigala"],
    basin: "Mahaweli Ganga",
    gauges: [
      { station: "Weraganthota", basin: "Mahaweli Ganga", eta: null, confidence: "low", note: "Below Rantambe, near Mahiyangana." },
      { station: "Manampitiya", basin: "Mahaweli Ganga", eta: null, confidence: "low", note: "Far downstream on the Mahaweli." },
    ],
  },
  {
    id: "rantambe",
    name: "Rantambe",
    aliases: ["rantambe", "rantembe"],
    basin: "Mahaweli Ganga",
    gauges: [
      { station: "Weraganthota", basin: "Mahaweli Ganga", eta: null, confidence: "low", note: "Just below Rantambe, near Mahiyangana." },
      { station: "Manampitiya", basin: "Mahaweli Ganga", eta: null, confidence: "low", note: "Far downstream on the Mahaweli." },
    ],
  },
  {
    id: "udawalawe",
    name: "Udawalawe",
    aliases: ["udawalawe", "udawalawa"],
    basin: "Walawe Ganga",
    gauges: [
      { station: "Moraketiya", basin: "Walawe Ganga", eta: null, confidence: "medium", note: "The Moraketiya gauge is south of the dam, on the Walawe below it." },
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
      { station: "Ampara", basin: "Gal Oya", eta: null, confidence: "medium", note: "Gal Oya flows east from the reservoir past Ampara." },
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
