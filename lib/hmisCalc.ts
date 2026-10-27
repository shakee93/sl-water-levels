// HMIS (hmis.gov.lk, the Irrigation Department's Hydro-Meteorological Information System, built under CResMPA)
// public dashboard data: everything that is pure maths or a fixed table, so scripts and tests load it with plain node.
// The fetcher is lib/hmis.ts. Credit wherever HMIS data is shown: "HMIS – Irrigation Department (hmis.gov.lk)" plus the institute.
//
// Two timestamp conventions in the SAME API (checked 27 Oct 2026 against ArcGIS to the millisecond):
//   - getwaterlevelsummary: Sri Lanka local time labelled with "Z". Hanwella "2026-10-27T16:03:56.630Z" is the ArcGIS reading of
//     10:33:56.630 UTC. Real UTC = parsed - 5.5 h (fixHmisLevelTime).
//   - getrainfalldevices.latest_record_time: real UTC (its sibling `timestamp` field reads "10/27/2026, 4:15:50 PM" local for
//     "2026-10-27T10:45:50.830Z"). No shift there (hmisRainTime).
// All levels are metres.

export const HMIS_CREDIT = "HMIS – Irrigation Department (hmis.gov.lk)";
export const HMIS_URL = "https://hmis.gov.lk";
const SLT_MS = 5.5 * 3_600_000;
const MIN = 60_000;
const HOUR = 3_600_000;

/** Water-level timestamp (SLT labelled "Z") to real epoch ms. NaN when unparseable. */
export function fixHmisLevelTime(ts: string): number {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms - SLT_MS : NaN;
}
/** Rain `latest_record_time` is already real UTC. */
export function hmisRainTime(ts: string | null | undefined): number {
  const ms = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(ms) ? ms : NaN;
}

export type Pt = { ts: number; m: number };
export type HmisThresholds = { alert: number | null; minor: number | null; major: number | null; extreme: number | null };
export type HmisDevice = {
  device: string;
  name: string;
  institute: string;
  lat: number;
  lon: number;
  district: string;
  thresholds: HmisThresholds;
  /** Ascending, real UTC, metres. */
  series: Pt[];
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const thr = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};

/** The institute as people know it. HMIS spells them "NBRI", "A C C I M T", "Meteorology Department". */
export function instituteName(raw: string | null | undefined): string {
  const s = (raw ?? "").replace(/\s+/g, "").toLowerCase();
  if (s === "nbri" || s === "nbro") return "NBRO";
  if (s === "accimt") return "ACCIMT";
  if (s.startsWith("meteorology") || s === "met") return "Met Department";
  if (s.startsWith("irrigation")) return "Irrigation Department";
  if (s.startsWith("curw")) return "CUrW";
  return (raw ?? "").trim() || "HMIS";
}

type RawLevelRow = { device?: unknown; timestamp?: unknown; value?: unknown; device_name?: unknown; station_name?: unknown; latitude?: unknown; longitude?: unknown; threshold_value?: Record<string, unknown> | null; institute?: unknown; district_name?: unknown };

/** Group the 24 h summary rows into devices. Bad rows (no time, no number, a -9999 sentinel) are dropped; never throws. */
export function normaliseLevelRows(rows: unknown): HmisDevice[] {
  if (!Array.isArray(rows)) return [];
  const by = new Map<string, HmisDevice>();
  for (const r0 of rows as RawLevelRow[]) {
    if (!r0 || typeof r0 !== "object" || typeof r0.device !== "string") continue;
    const ts = typeof r0.timestamp === "string" ? fixHmisLevelTime(r0.timestamp) : NaN;
    const m = num(r0.value);
    if (!Number.isFinite(ts) || m == null || m <= -100 || m >= 1000) continue;
    let d = by.get(r0.device);
    if (!d) {
      const t = r0.threshold_value ?? {};
      d = {
        device: r0.device,
        name: String(r0.device_name ?? r0.station_name ?? r0.device).trim(),
        institute: instituteName(String(r0.institute ?? "")),
        lat: num(r0.latitude) ?? NaN,
        lon: num(r0.longitude) ?? NaN,
        district: String(r0.district_name ?? "").trim(),
        thresholds: { alert: thr(t.alert), minor: thr(t.minor), major: thr(t.major), extreme: thr(t.extreme) },
        series: [],
      };
      by.set(r0.device, d);
    }
    d.series.push({ ts, m });
  }
  const out = [...by.values()].filter((d) => d.series.length > 0);
  for (const d of out) {
    d.series.sort((a, b) => a.ts - b.ts);
    // a device that reports twice at one instant counts once
    d.series = d.series.filter((p, i) => i === 0 || p.ts !== d.series[i - 1].ts);
  }
  return out;
}

// ---------------------------------------------------------------- gauges we add (not in the ArcGIS feed)

export type HmisGaugeDef = {
  /** HMIS `device` id. */
  device: string;
  /** Our gauge name (URL slug and display), the HMIS public name. */
  station: string;
  /** River (basin) page it sits under; found from the Irrigation Department's basin polygons (hmis.gov.lk/api/v1/basin/merge) for the east coast. */
  basin: string;
  lat: number;
  lon: number;
  institute: string;
  cadenceMin: number;
  /** Thresholds seen on 27 Oct 2026, used when HMIS is unreachable; the live ones replace them. Metres. */
  thresholds: HmisThresholds;
};
const T = (alert: number, minor: number, major: number, extreme: number): HmisThresholds => ({ alert, minor, major, extreme });

export const HMIS_GAUGES: HmisGaugeDef[] = [
  { device: "Kelani River_Karawanella Bridge", station: "Karawanella Bridge", basin: "Kelani Ganga", lat: 7.02016, lon: 80.2624, institute: "ACCIMT", cadenceMin: 15, thresholds: T(3, 4, 6, 8) },
  { device: "Mahaweli River_Mahiyanganaya Bridge", station: "Mahiyangana Bridge", basin: "Mahaweli Ganga", lat: 7.33813, lon: 80.9866, institute: "ACCIMT", cadenceMin: 15, thresholds: T(5, 6, 8, 10) },
  { device: "IDX", station: "Galodaya Bridge", basin: "Mundeni Aru", lat: 7.56219, lon: 81.3331, institute: "Irrigation Department", cadenceMin: 30, thresholds: T(3, 5, 6, 9) },
  { device: "IDW", station: "Lavanai Aru Bridge", basin: "Mundeni Aru", lat: 7.71772, lon: 81.48, institute: "Irrigation Department", cadenceMin: 30, thresholds: T(2, 4, 6, 8) },
  { device: "IDP", station: "Maalayarkattu Bridge", basin: "Andella Oya", lat: 7.434, lon: 81.6922, institute: "Irrigation Department", cadenceMin: 30, thresholds: T(3, 6, 9, 11) },
  { device: "IDV", station: "Mullamunai Bridge", basin: "Magalawatavan Aru", lat: 7.67919, lon: 81.5933, institute: "Irrigation Department", cadenceMin: 30, thresholds: T(3, 5, 6, 8) },
  { device: "IDT", station: "Pulipanchakal Bridge", basin: "Maduru Oya", lat: 7.8634, lon: 81.5063, institute: "Irrigation Department", cadenceMin: 30, thresholds: T(3, 5, 6, 8) },
  { device: "IDR", station: "Punani Anicut", basin: "Maduru Oya", lat: 7.94636, lon: 81.3972, institute: "Irrigation Department", cadenceMin: 30, thresholds: T(3, 5, 6, 9) },
  { device: "IDQ", station: "Rajagalathenna Bridge", basin: "Andella Oya", lat: 7.47136, lon: 81.633, institute: "Irrigation Department", cadenceMin: 30, thresholds: T(3, 6, 9, 11) },
  { device: "IDS", station: "Vadamunai Bridge", basin: "Maduru Oya", lat: 7.93874, lon: 81.2571, institute: "Irrigation Department", cadenceMin: 30, thresholds: T(5, 7, 8, 10) },
];

/** Our gauges that HMIS also reads with its own 10-minute sensor (HMIS id -> our ArcGIS gauge). The hourly ArcGIS gauge stays the official one. */
export const HMIS_FAST: { device: string; station: string; basin: string; label: string }[] = [
  { device: "00001HD002", station: "Hanwella", basin: "Kelani Ganga", label: "Kelani_Hanwella_HMIS" },
  { device: "00009HD001", station: "Baddegama", basin: "Gin Ganga", label: "Gin_Baddegama_HMIS" },
  { device: "00022HD001", station: "Thanamalwila", basin: "Kirindi Oya", label: "Kirindi_Thanamalwila_HMIS" },
];

export const HMIS_GAUGE_BY_STATION = new Map(HMIS_GAUGES.map((g) => [g.station, g]));
export const HMIS_STATION_NAMES = new Set(HMIS_GAUGES.map((g) => g.station));

// ---------------------------------------------------------------- device -> our station

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export type OurStation = { station: string; basin: string; latitude: number; longitude: number };
export type DeviceMatch = { station: string; how: "fast-sensor" | "catalogue" | "name" | "coords"; km: number } | null;

/**
 * Which of our gauges an HMIS water-level device is. Order: the fixed tables above (10-min sensors, gauges we add), then the
 * part after "_" in the device name ("Kelani Ganga_Hanwella" -> Hanwella) or the whole name, then the nearest gauge of the same
 * river within 1 km. null = not one of ours.
 */
export function mapDevice(dev: Pick<HmisDevice, "device" | "name" | "lat" | "lon">, ours: OurStation[]): DeviceMatch {
  const fast = HMIS_FAST.find((f) => f.device === dev.device);
  if (fast) return { station: fast.station, how: "fast-sensor", km: distTo(dev, ours, fast.station) };
  const cat = HMIS_GAUGES.find((g) => g.device === dev.device);
  if (cat) return { station: cat.station, how: "catalogue", km: 0 };
  const part = dev.name.includes("_") ? dev.name.split("_").slice(1).join("_") : dev.name;
  for (const cand of [part, dev.name]) {
    const hit = ours.find((o) => norm(o.station) === norm(cand));
    if (hit) return { station: hit.station, how: "name", km: distTo(dev, ours, hit.station) };
  }
  let best: { s: OurStation; km: number } | null = null;
  for (const o of ours) {
    const km = haversineKm({ lat: dev.lat, lon: dev.lon }, { lat: o.latitude, lon: o.longitude });
    if (km <= 1 && (!best || km < best.km)) best = { s: o, km };
  }
  return best ? { station: best.s.station, how: "coords", km: best.km } : null;
}
function distTo(dev: { lat: number; lon: number }, ours: OurStation[], station: string): number {
  const o = ours.find((x) => x.station === station);
  return o ? haversineKm({ lat: dev.lat, lon: dev.lon }, { lat: o.latitude, lon: o.longitude }) : NaN;
}

// ---------------------------------------------------------------- faster reading with an offset correction

export type Offset = { offsetM: number; n: number; sdM: number };
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};

/**
 * Median of (official hourly reading - HMIS sensor reading) over the last `windowMs`, pairing each hourly reading with the sensor
 * point nearest in time (within `pairMin`). Add it to a sensor reading to put it on the official gauge's scale. null when fewer
 * than `minPairs` pairs, or the two do not track each other (spread over 0.12 m, or offset over 0.5 m): then no sensor reading is shown.
 */
export function medianOffset(fast: Pt[], hourly: Pt[], now: number, opts: { windowMs?: number; pairMin?: number; minPairs?: number } = {}): Offset | null {
  const windowMs = opts.windowMs ?? 24 * HOUR, pairMs = (opts.pairMin ?? 12) * MIN, minPairs = opts.minPairs ?? 6;
  const diffs: number[] = [];
  for (const h of hourly) {
    if (h.ts < now - windowMs || h.ts > now) continue;
    let best: Pt | null = null;
    for (const f of fast) if (Math.abs(f.ts - h.ts) <= pairMs && (!best || Math.abs(f.ts - h.ts) < Math.abs(best.ts - h.ts))) best = f;
    if (best) diffs.push(h.m - best.m);
  }
  if (diffs.length < minPairs) return null;
  const off = median(diffs);
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const sd = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / diffs.length);
  if (sd > 0.12 || Math.abs(off) > 0.5) return null;
  return { offsetM: off, n: diffs.length, sdM: sd };
}

export type FasterReading = { m: number; rawM: number; ts: number; offsetM: number; cadenceMin: number | null };

/**
 * The sensor's newest point when it is newer than the official hourly reading by at least 10 minutes and not older than
 * `maxAgeMin`, moved onto the official scale. null otherwise (nothing to add). A note only; the official step is never taken from it.
 */
export function fasterReading(fast: Pt[], hourly: Pt[], now: number, opts: { maxAgeMin?: number } = {}): FasterReading | null {
  const last = fast[fast.length - 1];
  const lastHourly = hourly[hourly.length - 1];
  if (!last || !lastHourly) return null;
  if (now - last.ts > (opts.maxAgeMin ?? 90) * MIN || last.ts - lastHourly.ts < 10 * MIN) return null;
  const off = medianOffset(fast, hourly, now);
  if (!off) return null;
  const gaps = fast.slice(-6).map((p, i, a) => (i ? p.ts - a[i - 1].ts : 0)).filter((g) => g > 0);
  return { m: last.m + off.offsetM, rawM: last.m, ts: last.ts, offsetM: off.offsetM, cadenceMin: gaps.length ? Math.round(median(gaps) / MIN) : null };
}

// ---------------------------------------------------------------- ground rain

export type HmisRainDevice = {
  device: string;
  name: string;
  institute: string;
  lat: number;
  lon: number;
  district: string;
  /** Real UTC ms of the newest record; NaN when none. */
  latestTs: number;
  /** mm over the last 24 h. */
  mm24h: number;
};

type RawRain = { device?: unknown; device_name?: unknown; station_name?: unknown; institute?: unknown; latitude?: unknown; longitude?: unknown; district_name?: unknown; latest_record_time?: unknown; sum_diffval_in_period?: unknown };
export function normaliseRain(rows: unknown): HmisRainDevice[] {
  if (!Array.isArray(rows)) return [];
  const out: HmisRainDevice[] = [];
  for (const r of rows as RawRain[]) {
    if (!r || typeof r !== "object") continue;
    const lat = num(r.latitude), lon = num(r.longitude), mm = num(r.sum_diffval_in_period);
    const latestTs = hmisRainTime(typeof r.latest_record_time === "string" ? r.latest_record_time : null);
    if (lat == null || lon == null || mm == null || mm < 0 || mm > 1500 || !Number.isFinite(latestTs)) continue;
    const name = String(r.station_name || r.device_name || r.device || "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    out.push({ device: String(r.device ?? name), name, institute: instituteName(String(r.institute ?? "")), lat, lon, district: String(r.district_name ?? "").trim(), latestTs, mm24h: mm });
  }
  return out;
}

/** A rain gauge reporting within 3 h counts as live. */
export const RAIN_MAX_AGE_MIN = 180;
export const RAIN_NEAR_KM = 5;

export type NearRain = { device: HmisRainDevice; km: number };
/**
 * The nearest live ground rain gauge (record within `maxAgeMin`) to a point, within `maxKm`; null when none. Ties go to the
 * closer one; a gauge with a stale record is never used even if it is the closest.
 */
export function nearestRain(devs: HmisRainDevice[], at: { lat: number; lon: number }, now: number, opts: { maxKm?: number; maxAgeMin?: number } = {}): NearRain | null {
  const maxKm = opts.maxKm ?? RAIN_NEAR_KM, maxAge = (opts.maxAgeMin ?? RAIN_MAX_AGE_MIN) * MIN;
  let best: NearRain | null = null;
  for (const d of devs) {
    if (now - d.latestTs > maxAge || d.latestTs > now + 10 * MIN) continue;
    const km = haversineKm(at, d);
    if (km <= maxKm && (!best || km < best.km)) best = { device: d, km };
  }
  return best;
}

/** "Measured 64 mm in 24 h at Baddegama rain gauge (NBRO)". */
export function rainNoteParts(n: NearRain): { mm: string; name: string; institute: string; km: number } {
  return { mm: String(Math.round(n.device.mm24h)), name: n.device.name, institute: n.device.institute, km: Math.round(n.km * 10) / 10 };
}
