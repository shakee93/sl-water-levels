// RiverNet (rivernet.lk, run by Leecom SCADA Systems for the Disaster Management Centre): the public dashboard's JSON
// (owner decision 28 Oct 2026: public data, robots allow all, responses marked isPublic; "adds credibility with unified data").
// Everything that is pure maths or a fixed table, so scripts and tests load it with plain node. The fetcher is lib/rivernet.ts.
// REMOVAL SWITCH: make getRivernetLevels() in lib/rivernet.ts return null; every caller then shows nothing (no RiverNet gauge, no note).
// Credit wherever a RiverNet reading shows: "RiverNet – DMC / Leecom SCADA (rivernet.lk)" with a plain link to rivernet.lk.
//
// Facts checked 28 Oct 2026 (research/rivernet-integration.md has the full inventory):
//   - api.rivernet.lk/cache-api.php?path=... serves only CACHED paths: one device per call (keys=a,b is a 404), from/to in the path are
//     ignored (it always returns the last 24 h; last24HoursData=1 is required), rain devices have no cached chart (404).
//   - chart series are 1-minute points {x, y, t}; x and t are Sri Lanka local time labelled UTC ("+00:00"), same trap as HMIS:
//     real UTC = x - 5.5 h. Values are metres, already offset-corrected (Pugoda's offset 1.497 is inside y).
//   - a device that stopped reporting still gets a FLAT chart to "now" (Kukule Ganga, Kalawana, since 26 Oct). The truth is the title's
//     `latest.time` (also local time) and `communication`: trim every point newer than it, and call nothing without a title live.
//   - the title also carries coordinates ({0,0} when unknown: 18 of 37 river devices) and the alert marks sit in the chart's plotLines.

export const RIVERNET_CREDIT = "RiverNet – DMC / Leecom SCADA (rivernet.lk)";
export const RIVERNET_URL = "https://rivernet.lk";
const SLT_MS = 5.5 * 3_600_000;
const MIN = 60_000;
const HOUR = 3_600_000;

export type Pt = { ts: number; m: number };
export type RnMarks = { alert: number | null; minor: number | null; major: number | null; critical: number | null };

/** Chart `x` (SLT labelled UTC) to real epoch ms. */
export const fixRivernetX = (x: number): number => x - SLT_MS;

/** Title `latest.time` "2026-10-28 18:58:00" (Sri Lanka local time) to real epoch ms; NaN when unparseable. */
export function parseSltStamp(s: unknown): number {
  if (typeof s !== "string") return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s.trim());
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) - SLT_MS;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** The chart's series as real-UTC metre points, ascending, de-duplicated. Bad points (no time, no number, sentinels) dropped. null = wrong shape. */
export function parseChart(json: unknown): Pt[] | null {
  const series = (json as { results?: { series?: unknown } } | null)?.results?.series;
  if (!Array.isArray(series) || series.length === 0) return null;
  const data = (series[0] as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  const out: Pt[] = [];
  for (const p of data as { x?: unknown; y?: unknown }[]) {
    const x = num(p?.x), y = num(p?.y);
    if (x == null || y == null || y <= -50 || y >= 500) continue;
    out.push({ ts: fixRivernetX(x), m: y });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out.filter((p, i) => i === 0 || p.ts !== out[i - 1].ts);
}

/** Alert marks from the chart's plotLines ("Alert Flood(5.20 m)", "Minor ...", "Major ...", "Critical ..."), by the label text. null when none. */
export function parseMarks(json: unknown): RnMarks | null {
  const axes = (json as { results?: { chartOptions?: { yAxis?: { plotLines?: unknown }[] } } } | null)?.results?.chartOptions?.yAxis;
  const lines = Array.isArray(axes) ? axes.flatMap((a) => (Array.isArray(a?.plotLines) ? (a.plotLines as { value?: unknown; label?: { text?: unknown } }[]) : [])) : [];
  const m: RnMarks = { alert: null, minor: null, major: null, critical: null };
  for (const l of lines) {
    const v = num(l?.value);
    const text = String(l?.label?.text ?? "").toLowerCase();
    if (v == null || v <= 0) continue;
    if (text.startsWith("alert")) m.alert = v;
    else if (text.startsWith("minor")) m.minor = v;
    else if (text.startsWith("major")) m.major = v;
    else if (text.startsWith("critical") || text.startsWith("extreme")) m.critical = v;
  }
  return m.alert == null && m.minor == null && m.major == null && m.critical == null ? null : m;
}

export type RnTitle = { lat: number | null; lon: number | null; latestTs: number; latestM: number | null; communicating: boolean };
/** Coordinates ({0,0} = unknown -> null), the device's own newest reading time and whether it is communicating. null = wrong shape. */
export function parseTitle(json: unknown): RnTitle | null {
  const dd = (json as { results?: { deviceData?: unknown } } | null)?.results?.deviceData;
  const d = Array.isArray(dd) ? (dd[0] as { coordinates?: { latitude?: unknown; longitude?: unknown }; latest?: Record<string, unknown> } | undefined) : undefined;
  if (!d || typeof d !== "object" || !d.latest || typeof d.latest !== "object") return null;
  const lat = num(d.coordinates?.latitude), lon = num(d.coordinates?.longitude);
  const known = lat != null && lon != null && !(lat === 0 && lon === 0) && lat > 5 && lat < 10.5 && lon > 79 && lon < 82.5;
  return {
    lat: known ? lat : null,
    lon: known ? lon : null,
    latestTs: parseSltStamp(d.latest.time),
    latestM: num(d.latest.latestLevel),
    communicating: d.latest.communication === true,
  };
}

/** Chart points up to the device's own newest reading (+2 min), so the padding RiverNet draws after a dead device is dropped. */
export function trimToLatest(pts: Pt[], latestTs: number): Pt[] {
  if (!Number.isFinite(latestTs)) return [];
  return pts.filter((p) => p.ts <= latestTs + 2 * MIN);
}

/** One point per `bucketMs` (the last in the bucket, so values are real readings), plus always the newest point. Keeps the cache entry small. */
export function downsample(pts: Pt[], bucketMs = 10 * MIN): Pt[] {
  const out: Pt[] = [];
  let lastBucket = NaN;
  for (let i = 0; i < pts.length; i++) {
    const b = Math.floor(pts[i].ts / bucketMs);
    const nextB = i + 1 < pts.length ? Math.floor(pts[i + 1].ts / bucketMs) : NaN;
    if (b !== nextB && b !== lastBucket) { out.push(pts[i]); lastBucket = b; }
  }
  if (pts.length && out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

/** A 1-minute sensor read every 10 minutes that is over an hour old is not reporting (the site's 3 h rule is for hourly gauges). */
export const LIVE_MAX_MIN = 60;

export type RivernetDevice = {
  key: string;
  series: Pt[];
  /** Real UTC ms of the device's own newest reading; the series ends here. */
  latestTs: number;
  communicating: boolean;
  marks: RnMarks | null;
};

/** Title + chart of one device into what the site uses. null when the title says nothing usable; a dead device gets an empty series. */
export function buildDevice(key: string, title: unknown, chart: unknown, now = Date.now()): RivernetDevice | null {
  const t = parseTitle(title);
  if (!t || !Number.isFinite(t.latestTs)) return null;
  const pts = parseChart(chart);
  if (!pts) return null;
  const live = t.communicating && now - t.latestTs < LIVE_MAX_MIN * MIN;
  const series = live ? downsample(trimToLatest(pts, t.latestTs)) : [];
  return { key, series, latestTs: t.latestTs, communicating: t.communicating, marks: parseMarks(chart) };
}

// ---------------------------------------------------------------- the devices and what we do with each

export type RnDecision = "new" | "duplicate" | "skip";
export type RnCatalogEntry = {
  /** RiverNet deviceKey (used in the API path). */
  key: string;
  /** RiverNet unitId; for the east-coast bridges the same id HMIS uses as `device`. */
  unit: string;
  /** RiverNet's own name. */
  name: string;
  region: string;
  decision: RnDecision;
  /** new: our gauge name / river page. duplicate: the gauge we already have. */
  station?: string;
  basin?: string;
  lat?: number;
  lon?: number;
  /** Marks RiverNet published on 28 Oct 2026 (metres), used when the live chart carries none. */
  marks?: RnMarks;
  /** A tributary of the river it sits under (not on the main stem): grouped apart in lists, never upstream or downstream of a main-stem gauge. */
  tributary?: true;
  /** Why it is skipped, or what it duplicates. */
  why: string;
};
const M = (alert: number, minor: number, major: number, critical: number | null = null): RnMarks => ({ alert, minor, major, critical });

export const RIVERNET_CATALOG: RnCatalogEntry[] = [
  // ratnapura region (Kalu Ganga basin)
  { key: "2bq292rf6uz", unit: "I97", name: "Kalu Ganga (Ratnapura)", region: "ratnapura", decision: "duplicate", station: "Rathnapura", basin: "Kalu Ganga", why: "same gauge as ArcGIS Rathnapura (5.86 m at the same minute; RiverNet's pin 6.728N 80.199E is wrong, 25 km west). RiverNet marks 5.2/7.5/9.5/10.5 differ from ours 5.2/8/10: ours stay." },
  { key: "76k6cqo0ipwk", unit: "ID3", name: "Kuru Ganga (Kuruvita)", region: "ratnapura", decision: "new", station: "Kuru Ganga (Kuruvita)", basin: "Kalu Ganga", tributary: true, lat: 6.79874, lon: 80.36843, why: "tributary gauge, no marks published" },
  { key: "6nb2troqa5c0", unit: "ID4", name: "Galathura Oya (Ayagama)", region: "ratnapura", decision: "new", station: "Galathura Oya (Ayagama)", basin: "Kalu Ganga", tributary: true, lat: 6.695, lon: 80.385, why: "tributary gauge, no marks (coordinates rounded to 3 decimals by RiverNet)" },
  { key: "1kp1hhh7zbu", unit: "ID5", name: "Denawaka Ganga (Pelmadulla)", region: "ratnapura", decision: "new", station: "Denawaka Ganga (Pelmadulla)", basin: "Kalu Ganga", tributary: true, lat: 6.70926, lon: 80.29092, why: "tributary gauge, no marks" },
  { key: "5asknpp28bs", unit: "ID6", name: "Kukule Ganga (Kalawana)", region: "ratnapura", decision: "new", station: "Kukule Ganga (Kalawana)", basin: "Kalu Ganga", tributary: true, lat: 6.58019, lon: 80.32701, why: "tributary gauge, no marks; offline since 26 Oct 2026 (RiverNet's chart is flat padding): shown as no recent reading" },
  { key: "5f4al4atv8ws", unit: "ID7", name: "Wey Ganga (Kahawaththa)", region: "ratnapura", decision: "new", station: "Wey Ganga (Kahawaththa)", basin: "Kalu Ganga", tributary: true, lat: 6.58173, lon: 80.57361, why: "tributary gauge, no marks" },
  { key: "2q6uiwmovjcw", unit: "ID8", name: "Niriella Ganga (Elapatha)", region: "ratnapura", decision: "new", station: "Niriella Ganga (Elapatha)", basin: "Kalu Ganga", tributary: true, lat: 6.63163, lon: 80.3656, why: "tributary gauge, no marks" },
  // kelaniya region
  { key: "m1wy7g3guyo", unit: "ID1", name: "Kelani Ganga Level at Mapitigama", region: "kelaniya", decision: "new", station: "Mapitigama", basin: "Kelani Ganga", lat: 7.00315, lon: 80.22181, marks: M(6, 7, 8.5), why: "new Kelani gauge between Karawanella and Glencourse; RiverNet marks 6/7/8.5 m; flat at 4.22 m since 06:06 on 28 Oct (floor or stuck: unknown)" },
  { key: "693ymeaky0ow", unit: "ID2", name: "Kelani Ganga Level at Pugoda", region: "kelaniya", decision: "new", station: "Pugoda", basin: "Kelani Ganga", lat: 6.9742, lon: 80.12328, marks: M(8, 10, 11.5), why: "new Kelani gauge between Glencourse and Hanwella; RiverNet marks 8/10/11.5 m; its 1.497 m offset is already inside the reading" },
  // gampaha region
  { key: "2ul37w3w6zy8", unit: "IG1", name: "Miriswatta Uruwal Oya", region: "gampaha", decision: "new", station: "Miriswatta", basin: "Uruwal Oya", lat: 7.0832, lon: 79.98629, why: "small Gampaha stream, no marks" },
  { key: "17mccyydrhus", unit: "IG2", name: "Wattala Kalu Ela", region: "gampaha", decision: "new", station: "Wattala", basin: "Wattala Kalu Ela", lat: 6.99119, lon: 79.89219, why: "canal north of Colombo, no marks" },
  // batticaloa region: the 8 bridges/anicuts are the HMIS gauges (same unit ids, identical values)
  { key: "q9noz41qfio", unit: "IDP", name: "Maalayarkattu Bridge", region: "batticaloa", decision: "duplicate", station: "Maalayarkattu Bridge", basin: "Andella Oya", why: "HMIS gauge IDP, identical value; RiverNet is 1-minute, HMIS 30-minute" },
  { key: "64crg0rih544", unit: "IDQ", name: "Rajagalathenna Bridge", region: "batticaloa", decision: "duplicate", station: "Rajagalathenna Bridge", basin: "Andella Oya", why: "HMIS gauge IDQ" },
  { key: "62ltbd3wueos", unit: "IDR", name: "Punani Anicut", region: "batticaloa", decision: "duplicate", station: "Punani Anicut", basin: "Maduru Oya", why: "HMIS gauge IDR" },
  { key: "5fiuhs4nj74s", unit: "IDS", name: "Vadamunai Bridge", region: "batticaloa", decision: "duplicate", station: "Vadamunai Bridge", basin: "Maduru Oya", why: "HMIS gauge IDS" },
  { key: "3s4d6vws8mww", unit: "IDT", name: "Pulipanchakal Bridge", region: "batticaloa", decision: "duplicate", station: "Pulipanchakal Bridge", basin: "Maduru Oya", why: "HMIS gauge IDT" },
  { key: "73higlche8co", unit: "IDV", name: "Mullamunai Bridge", region: "batticaloa", decision: "duplicate", station: "Mullamunai Bridge", basin: "Magalawatavan Aru", why: "HMIS gauge IDV" },
  { key: "7lbmw7cxt8so", unit: "IDW", name: "Lavanai Aru Bridge", region: "batticaloa", decision: "duplicate", station: "Lavanai Aru Bridge", basin: "Mundeni Aru", why: "HMIS gauge IDW" },
  { key: "39j7dqwvfwqo", unit: "IDX", name: "Galodaya Bridge", region: "batticaloa", decision: "duplicate", station: "Galodaya Bridge", basin: "Mundeni Aru", why: "HMIS gauge IDX" },
  { key: "27nlhe05n2m8", unit: "IDO", name: "Navakiri Tank", region: "batticaloa", decision: "skip", why: "a tank (reservoir depth, no marks), not a river gauge: phase 2 for the reservoir pages" },
  { key: "5xk3xuphh6c", unit: "IDU", name: "Unnichchai Tank", region: "batticaloa", decision: "skip", why: "a tank, phase 2 (reservoir pages)" },
  { key: "rs73sla93og", unit: "IFP", name: "Rugam Tank", region: "batticaloa", decision: "skip", why: "a tank, and RiverNet gives no coordinates" },
  { key: "2o642o3nyhk", unit: "IFQ", name: "Mawadiodai Anicut", region: "batticaloa", decision: "skip", why: "no coordinates from RiverNet (needs an OSM lookup)" },
  { key: "70lg29s65f0o", unit: "IFS", name: "Kallaru Lagoon", region: "batticaloa", decision: "skip", why: "a lagoon (tide-driven, 0.2-0.3 m), no coordinates, not a river gauge" },
  { key: "5efvurfjjz8k", unit: "IFR", name: "Kallady Lagoon", region: "batticaloa", decision: "skip", why: "a lagoon, no coordinates, not a river gauge" },
  // nilwala region: no coordinates from RiverNet
  { key: "3pwu4tc3qk2s", unit: "IDY", name: "Bangama Bridge", region: "nilwala", decision: "skip", why: "no coordinates from RiverNet; locate on OSM, then add lat/lon here and it appears under Nilwala Ganga" },
  { key: "1j5z9k1s0f0g", unit: "IDZ", name: "Polothugama Bridge", region: "nilwala", decision: "skip", why: "no coordinates from RiverNet (as above)" },
  { key: "4tfs2kfjrpc0", unit: "IEX", name: "Hulandawa Bridge", region: "nilwala", decision: "skip", why: "no coordinates from RiverNet (as above)" },
  { key: "i37lz6443qg", unit: "IFL", name: "Kirama Tank Warapitiya", region: "nilwala", decision: "skip", why: "a tank, no coordinates" },
  { key: "6rxlmp8lutwc", unit: "IFM", name: "Kekiriobada Reservoir", region: "nilwala", decision: "skip", why: "a reservoir (13 m depth scale), no coordinates: phase 2 for the reservoir pages" },
  // galoya region
  { key: "2tb2fa5jupmo", unit: "IEG", name: "Wawinna Bridge", region: "galoya", decision: "skip", why: "no coordinates from RiverNet" },
  { key: "5cfzv6bus5s8", unit: "IEH", name: "Gal Oya Bridge", region: "galoya", decision: "skip", why: "no data since 26 Nov 2025, no coordinates" },
  { key: "4lr2qrunqdk4", unit: "IEI", name: "Waripathanchena Bridge", region: "galoya", decision: "skip", why: "no coordinates; one 7-hour outage in 24 h" },
  // other basins
  { key: "5z10uc2ex58o", unit: "IEY", name: "Hali-Ela Bridge", region: "badulu_oya", decision: "skip", why: "Badulu Oya, no coordinates" },
  { key: "3v3j8whpigsg", unit: "I30", name: "Ridibendiella Bridge", region: "deduru_oya", decision: "skip", why: "Deduru Oya, no coordinates (we have Moragaswewa from HMIS)" },
  { key: "6p9gxoy9vww8", unit: "I33", name: "Sengaloya Anicut Bridge", region: "deduru_oya", decision: "skip", why: "Deduru Oya, no coordinates" },
  { key: "3qptc8vf0fgg", unit: "I34", name: "Deduru Oya Bridge", region: "deduru_oya", decision: "skip", why: "Deduru Oya, no coordinates" },
];

export type RnNewDef = RnCatalogEntry & { station: string; basin: string; lat: number; lon: number };
/** The gauges we add (not in ArcGIS or HMIS). */
export const RIVERNET_NEW: RnNewDef[] = RIVERNET_CATALOG.filter((e): e is RnNewDef => e.decision === "new" && e.station != null && e.basin != null && e.lat != null && e.lon != null);
/** Duplicates: RiverNet's 1-minute sensor for a gauge we already have. The official reading stays with the other source. */
export const RIVERNET_FAST = RIVERNET_CATALOG.filter((e) => e.decision === "duplicate");
/** Names of the gauges that are tributaries of the river page they sit under. */
export const RIVERNET_TRIBUTARIES = new Set(RIVERNET_NEW.filter((g) => g.tributary).map((g) => g.station));
export const RIVERNET_NEW_BY_STATION = new Map(RIVERNET_NEW.map((g) => [g.station, g]));
export const RIVERNET_FAST_BY_STATION = new Map(RIVERNET_FAST.map((g) => [g.station as string, g]));
/** Every device the site reads: the ones we add and the ones that back a "Latest" note. */
export const RIVERNET_READ = [...RIVERNET_NEW, ...RIVERNET_FAST];

// ---------------------------------------------------------------- the "Latest (1-minute sensor)" note on duplicates

export type FasterReading = { m: number; rawM: number; ts: number; offsetM: number };
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};

/**
 * The sensor's newest point when it is at least 10 minutes newer than the official reading and under `maxAgeMin` old, moved onto the
 * official scale by the median (official - sensor) over the last 24 h (each official reading paired with the sensor point nearest in
 * time within 12 min; at least 6 pairs; spread under 0.12 m and offset under 0.5 m, else null: the two do not track each other).
 * A note only: the official step, pill and forecast never come from it.
 */
export function fasterThanOfficial(sensor: Pt[], official: Pt[], now: number, maxAgeMin = 90): FasterReading | null {
  const last = sensor[sensor.length - 1];
  const lastOff = official[official.length - 1];
  if (!last || !lastOff) return null;
  if (now - last.ts > maxAgeMin * MIN || last.ts - lastOff.ts < 10 * MIN) return null;
  const diffs: number[] = [];
  for (const h of official) {
    if (h.ts < now - 24 * HOUR || h.ts > now) continue;
    let best: Pt | null = null;
    for (const f of sensor) if (Math.abs(f.ts - h.ts) <= 12 * MIN && (!best || Math.abs(f.ts - h.ts) < Math.abs(best.ts - h.ts))) best = f;
    if (best) diffs.push(h.m - best.m);
  }
  if (diffs.length < 6) return null;
  const off = median(diffs);
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const sd = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / diffs.length);
  if (sd > 0.12 || Math.abs(off) > 0.5) return null;
  return { m: last.m + off, rawM: last.m, ts: last.ts, offsetM: off };
}
