// The forecast-inputs record (format 1) of the level-model hidden trial: what the rain inputs of one gauge's forecast run were, exactly as they stood when the run was made.
// Pure (node:zlib for the wire form only; no clock, no I/O, never reached by a visitor). Contract: DOCS.md "Level-model hidden trial".
//
// Decoded record:
//   { fmt: 1,
//     grid: N,                 epoch ms of the hour END that is "now" for the run (the weather code's nowHour, a whole hour)
//     ageMin: number | null,   age of the weather data when the run was made, whole minutes (null = unknown)
//     zones: { full: S[124], near: S[124] | null, up: S[124] | null },
//        S[k] = SUM over the zone's cells of the rain in the hour ENDING N + (k - 75) h, in integer tenths of mm (0.1 mm); null = an hour any cell of the zone lacks.
//        mean mm = S / (10 x cells of the zone). k = 0..123 = hours N-75 ... N+48.
//     cells: [ C[52] x nFull ],  one array per cell of the full zone, in the gauge's catchment cell order; C[k] = the hour ending N + (k - 27) h, tenths of mm or null.
//        k = 0..51 = hours N-27 ... N+24.
//     nz: [nFull, nNear, nUp] }  cell counts of the zones (near / up may be 0: the zone does not exist for this gauge)
// Observed and forecast hours are ONE series (hours up to N are what the weather service reported, later hours are its forecast at the time of the run).
// Wire: grid (6 bytes, whole hours since the epoch, big endian), fmt, nz x 3, ageMin (uint16 big endian, 65535 = unknown), then the zone sums (full, near, up: those with
// cells) and the per-cell arrays as Int16 in two byte planes (all low bytes, then all high bytes), missing = -1; deflateRaw level 9; base64 without padding.
import { deflateRawSync, inflateRawSync } from "node:zlib";

export const FMT = 1;
export const HOUR = 3_600_000;
/** zone series: 124 values, hours N-75 ... N+48 (k = 0..123, hour ending N + (k - ZPAST) h) */
export const ZN = 124;
export const ZPAST = 75;
/** per-cell series: 52 values, hours N-27 ... N+24 (hour ending N + (k - CPAST) h) */
export const CN = 52;
export const CPAST = 27;
export const MISSING = -1;
/** the largest tenths value that can be stored (a zone SUM of 3,200 mm); a larger one is stored as missing by buildRecord */
export const MAX_TENTHS = 32000;
/** a rain value outside [0, 400] mm in one hour is not a rain value (the same bound predict.mjs applies): it is stored as missing */
export const RAIN_MAX_MM_H = 400;
/** a base64 record longer than this is not logged (reason "too_large") */
export const MAX_BLOB_CHARS = 8000;
const AGE_UNKNOWN = 65535;
const ZONES = ["full", "near", "up"];

const planes = (arr) => {
  const n = arr.length;
  const b = Buffer.alloc(2 * n);
  for (let i = 0; i < n; i++) {
    const x = arr[i] === null || arr[i] === undefined ? MISSING : arr[i];
    if (!Number.isInteger(x) || x < -1 || x > MAX_TENTHS) throw new Error("value out of range " + arr[i]);
    b[i] = x & 255;
    b[n + i] = (x >> 8) & 255;
  }
  return b;
};
const unplanes = (b, off, n) => Array.from({ length: n }, (_, i) => {
  const x = b[off + i] | (b[off + n + i] << 8);
  return x === 0xffff ? null : x;
});

/** decoded record -> base64 text. Throws (Error) on a record that does not have the shape above; inputsOf() turns that into reason "encode". */
export function encode(rec) {
  if (!rec || rec.fmt !== FMT) throw new Error("record fmt must be " + FMT);
  const nz = rec.nz;
  if (!Array.isArray(nz) || nz.length !== 3 || !nz.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) throw new Error("nz must be [nFull, nNear, nUp]");
  if (!Number.isInteger(rec.grid) || rec.grid % HOUR !== 0 || rec.grid < 0) throw new Error("grid must be a whole hour in epoch ms");
  const age = rec.ageMin === null || rec.ageMin === undefined ? AGE_UNKNOWN : Math.min(Math.max(Math.round(rec.ageMin), 0), AGE_UNKNOWN - 1);
  const head = Buffer.alloc(12);
  head.writeUIntBE(rec.grid / HOUR, 0, 6);
  head[6] = FMT;
  head[7] = nz[0];
  head[8] = nz[1];
  head[9] = nz[2];
  head.writeUInt16BE(age, 10);
  const parts = [head];
  ZONES.forEach((z, i) => {
    if (nz[i] > 0) {
      const a = rec.zones && rec.zones[z];
      if (!Array.isArray(a) || a.length !== ZN) throw new Error("zone " + z + " must have " + ZN + " values");
      parts.push(planes(a));
    } else if (rec.zones && rec.zones[z]) throw new Error("zone " + z + " has values but nz says 0 cells");
  });
  if (!Array.isArray(rec.cells) || rec.cells.length !== nz[0]) throw new Error("cells must hold nz[0] arrays");
  for (const c of rec.cells) if (!Array.isArray(c) || c.length !== CN) throw new Error("each cell array must have " + CN + " values");
  parts.push(planes(rec.cells.flat()));
  return deflateRawSync(Buffer.concat(parts), { level: 9 }).toString("base64").replace(/=+$/, "");
}

/** base64 text -> decoded record. Throws (Error) on text that is not a format-1 record of exactly the expected length. */
export function decode(text) {
  if (typeof text !== "string" || text.length === 0) throw new Error("record text must be a non-empty string");
  const b = inflateRawSync(Buffer.from(text, "base64"));
  if (b.length < 12) throw new Error("record too short");
  const grid = b.readUIntBE(0, 6) * HOUR;
  const fmt = b[6];
  if (fmt !== FMT) throw new Error("unknown format " + fmt);
  const nz = [b[7], b[8], b[9]];
  const age = b.readUInt16BE(10);
  const need = 12 + 2 * ZN * nz.filter((n) => n > 0).length + 2 * CN * nz[0];
  if (b.length !== need) throw new Error("record length " + b.length + " does not match nz " + nz.join("/") + " (expected " + need + ")");
  let off = 12;
  const zones = {};
  ZONES.forEach((z, i) => {
    if (nz[i] > 0) {
      zones[z] = unplanes(b, off, ZN);
      off += 2 * ZN;
    } else zones[z] = null;
  });
  const flat = unplanes(b, off, nz[0] * CN);
  return { fmt, grid, ageMin: age === AGE_UNKNOWN ? null : age, zones, cells: Array.from({ length: nz[0] }, (_, c) => flat.slice(c * CN, (c + 1) * CN)), nz };
}

/** decode() that never throws: { ok: true, rec } | { ok: false, reason: "decode_error", detail } */
export function tryDecode(text) {
  try {
    return { ok: true, rec: decode(text) };
  } catch (e) {
    return { ok: false, reason: "decode_error", detail: String(e && e.message ? e.message : e).slice(0, 200) };
  }
}

/**
 * The positions (indices into a gauge's cell list, i.e. into the response's point list) of a sub-zone, computed exactly like lib/weather.ts `pick`: `ids` = the sub-zone's cell ids
 * (lib/model/subcatchments.json near / up), `stationCells` = the gauge's cell ids in catchments.json order. null when the zone is empty or any of its cells is not a cell of the gauge.
 */
export function zonePositions(stationCells, ids) {
  if (!Array.isArray(ids) || ids.length === 0 || !Array.isArray(stationCells)) return null;
  const pos = ids.map((c) => stationCells.indexOf(c));
  return pos.some((p) => p < 0) ? null : pos;
}

const hourTs = (s) => Date.parse(`${s}Z`); // Open-Meteo times are UTC labels of the hour END (timezone=UTC), the same parse as lib/weather.ts binTs

/**
 * The Open-Meteo deterministic response of one gauge (the list of points, one per cell of the gauge's catchment, in catchment cell order; each `{ hourly: { time: [...], precipitation: [...] } }`)
 * -> the decoded record. `near` / `up` = positions of those zones among the points (zonePositions) or null. `nowHour` = the weather code's hour boundary (whole hour, epoch ms).
 * `ageMin` = age of the response when known. Never throws: { ok: true, rec } | { ok: false, reason: "no_points" | "no_times" | "bad_now_hour" | "no_data" }.
 * Rules (the site's own): the hour is keyed by its END; a cell value that is null / not finite is missing, and so is a zone hour in which any cell of the zone is missing; a value outside [0, 400] mm
 * is missing (the site's own catchment mean would carry it, predict.mjs refuses it). Each cell value is rounded to a tenth of a mm and the zone sum is the sum of the rounded values, so the zone
 * mean equals the mean of the per-cell values exactly.
 */
export function buildRecord({ points, near = null, up = null, nowHour, ageMin = null }) {
  try {
    if (!Number.isInteger(nowHour) || nowHour % HOUR !== 0) return { ok: false, reason: "bad_now_hour" };
    if (!Array.isArray(points) || points.length === 0 || points.length > 255) return { ok: false, reason: "no_points" };
    const times = points[0] && points[0].hourly && points[0].hourly.time;
    if (!Array.isArray(times) || times.length === 0) return { ok: false, reason: "no_times" };
    const idxOf = new Map();
    times.forEach((s, i) => {
      const ts = hourTs(s);
      if (Number.isFinite(ts) && !idxOf.has(ts)) idxOf.set(ts, i);
    });
    // per cell, the rounded tenths at an hour END, or null
    const tenth = (c, ts) => {
      const i = idxOf.get(ts);
      if (i === undefined) return null;
      const col = points[c] && points[c].hourly && points[c].hourly.precipitation;
      const v = Array.isArray(col) ? col[i] : undefined;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > RAIN_MAX_MM_H) return null;
      return Math.round(v * 10);
    };
    const zoneSeries = (positions) => {
      const out = new Array(ZN);
      for (let k = 0; k < ZN; k++) {
        const ts = nowHour + (k - ZPAST) * HOUR;
        let s = 0;
        let ok = true;
        for (const c of positions) {
          const q = tenth(c, ts);
          if (q === null) {
            ok = false;
            break;
          }
          s += q;
        }
        out[k] = ok && s <= MAX_TENTHS ? s : null;
      }
      return out;
    };
    const all = points.map((_, i) => i);
    const nearP = near && near.length ? near : null;
    const upP = up && up.length ? up : null;
    if ((nearP && nearP.some((p) => !Number.isInteger(p) || p < 0 || p >= points.length)) || (upP && upP.some((p) => !Number.isInteger(p) || p < 0 || p >= points.length))) return { ok: false, reason: "no_points" };
    const full = zoneSeries(all);
    if (full.every((x) => x === null)) return { ok: false, reason: "no_data" };
    const cells = all.map((c) => Array.from({ length: CN }, (_, k) => tenth(c, nowHour + (k - CPAST) * HOUR)));
    const rec = {
      fmt: FMT,
      grid: nowHour,
      ageMin: Number.isFinite(ageMin) && ageMin >= 0 ? Math.min(Math.round(ageMin), AGE_UNKNOWN - 1) : null,
      zones: { full, near: nearP ? zoneSeries(nearP) : null, up: upP ? zoneSeries(upP) : null },
      cells,
      nz: [all.length, nearP ? nearP.length : 0, upP ? upP.length : 0],
    };
    return { ok: true, rec };
  } catch (e) {
    return { ok: false, reason: "no_data", detail: String(e && e.message ? e.message : e).slice(0, 200) };
  }
}

/**
 * What the hourly route stores per gauge and run: buildRecord + encode, no await, no I/O, never throws.
 *   { ok: true, blob, rec, nCells, gridMs, ageMin }  |  { ok: false, skip: "no_points" | "no_times" | "bad_now_hour" | "no_data" | "encode" | "too_large" }
 */
export function inputsOf(args) {
  const b = buildRecord(args);
  if (!b.ok) return { ok: false, skip: b.reason };
  let blob;
  try {
    blob = encode(b.rec);
  } catch {
    return { ok: false, skip: "encode" };
  }
  if (blob.length > MAX_BLOB_CHARS) return { ok: false, skip: "too_large" };
  return { ok: true, blob, rec: b.rec, nCells: b.rec.nz[0], gridMs: b.rec.grid, ageMin: b.rec.ageMin };
}

/** The mean rain (mm) of a zone at the hour ending `ts`, from a decoded record: null when the hour is missing or outside the record. */
export function zoneMean(rec, zone, ts) {
  const arr = rec.zones && rec.zones[zone];
  if (!arr) return null;
  const k = (ts - rec.grid) / HOUR + ZPAST;
  if (!Number.isInteger(k) || k < 0 || k >= ZN) return null;
  const s = arr[k];
  const n = rec.nz[ZONES.indexOf(zone)];
  return s === null || s === undefined || !n ? null : s / (10 * n);
}
