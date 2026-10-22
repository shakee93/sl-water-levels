// Shared by fit-forecast.mjs and backtest-forecast.mjs: archive + rain loading and the
// per-station model configs (leaders and lags). Zero dependencies, Node 22.
//
// Archive source: a directory laid out like the `data` branch (YYYY/YYYY-MM-DD.csv).
// With no directory given we export origin/data with `git archive` into a temp dir.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { H, interp } from "../lib/model/core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const CATCHMENTS = JSON.parse(readFileSync(path.join(here, "../lib/model/catchments.json"), "utf8")).basins;

/**
 * Model configs. Lags come from lagged cross-correlation of 1h level changes in the
 * first 8 days of archive (see DOCS.md): Glencourse leads Hanwella ~3h, Deraniyagala /
 * Kithulgala / Norwood 8-9h, catchment rain 6-8h; for Glencourse: Holombuwa ~2h, Deraniyagala/Kithulgala 5-6h, rain ~7h; for
 * Nagalagam Street (tidal, noisy): Hanwella ~3h, Glencourse 5-6h, rain ~11h. `local: true` terms form the
 * local-only model that is used as the "model disagreement" signal.
 * Rain term (from,to): rain in (t+h-from, t+h-to] hours.
 */
export const STATIONS = {
  Hanwella: {
    basin: "Kelani Ganga",
    mainLeader: "Glencourse",
    terms: [
      { k: "delta", g: ["Hanwella"], hrs: 3, label: "own 3h change", local: true },
      { k: "delta", g: ["Glencourse"], hrs: 3, label: "Glencourse 3h change" },
      { k: "delta", g: ["Deraniyagala", "Kithulgala"], hrs: 6, label: "Deraniyagala/Kithulgala 6h change" },
      { k: "rain", from: 12, to: 4, label: "catchment rain" },
      { k: "level", label: "level", local: true },
    ],
  },
  Glencourse: {
    basin: "Kelani Ganga",
    mainLeader: "Deraniyagala",
    terms: [
      { k: "delta", g: ["Glencourse"], hrs: 3, label: "own 3h change", local: true },
      { k: "delta", g: ["Holombuwa"], hrs: 3, label: "Holombuwa 3h change" },
      { k: "delta", g: ["Deraniyagala", "Kithulgala"], hrs: 6, label: "Deraniyagala/Kithulgala 6h change" },
      { k: "rain", from: 12, to: 4, label: "catchment rain" },
      { k: "level", label: "level", local: true },
    ],
  },
  "Nagalagam Street": {
    basin: "Kelani Ganga",
    mainLeader: "Hanwella",
    terms: [
      { k: "delta", g: ["Nagalagam Street"], hrs: 3, label: "own 3h change", local: true },
      { k: "delta", g: ["Hanwella"], hrs: 3, label: "Hanwella 3h change" },
      { k: "delta", g: ["Glencourse"], hrs: 6, label: "Glencourse 6h change" },
      { k: "rain", from: 18, to: 8, label: "catchment rain" },
      { k: "level", label: "level", local: true },
    ],
  },
};

export function gaugesOf(cfg) {
  return [...new Set([cfg.target ?? "", ...cfg.terms.flatMap((t) => (t.k === "delta" ? t.g : []))])].filter(Boolean);
}

export function exportDataBranch() {
  const dir = mkdtempSync(path.join(tmpdir(), "sl-data-"));
  execFileSync("sh", ["-c", `git archive origin/data | tar -x -C ${JSON.stringify(dir)}`], { stdio: "inherit" });
  return dir;
}

function parseCsv(text) {
  const L = text.trim().split("\n"), head = L[0].split(",");
  return L.slice(1).map((l) => {
    const c = l.split(",");
    return Object.fromEntries(head.map((k, i) => [k, c[i]]));
  });
}

/** { gauge: [{ts, wl, rf}] } sorted by ts. Sentinels (<= -100 or >= 1000) are dropped as in lib/readings. */
export function loadArchive(dir) {
  const out = {};
  for (const y of readdirSync(dir)) {
    if (!/^\d{4}$/.test(y)) continue;
    for (const f of readdirSync(path.join(dir, y))) {
      if (!f.endsWith(".csv")) continue;
      for (const o of parseCsv(readFileSync(path.join(dir, y, f), "utf8"))) {
        const wl = o.water_level === "" ? null : +o.water_level;
        if (wl == null || !(wl > -100 && wl < 1000)) continue;
        (out[o.gauge.trim()] ??= []).push({ ts: +o.creation_ms, wl, rf: o.rain_fall === "" ? null : +o.rain_fall });
      }
    }
  }
  for (const g in out) out[g].sort((a, b) => a.ts - b.ts);
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Hourly catchment-mean rain for a basin, { T(ms, bin end): mm }. Prefers archived
 * rain/ files from the data branch (written by snapshot.mjs); anything still missing
 * is filled from the Open-Meteo FORECAST api with past_days (<= 92), which is
 * gap-free up to "now" (the archive api lags several days) and is the same product
 * the app reads at serving time.
 */
export async function loadRain(dir, basin, fromTs, toTs) {
  const pts = CATCHMENTS[basin].points;
  const sums = new Map(), counts = new Map();
  const add = (T, v) => { sums.set(T, (sums.get(T) ?? 0) + v); counts.set(T, (counts.get(T) ?? 0) + 1); };
  const rdir = path.join(dir, "rain");
  const names = new Set(pts.map((p) => p.name));
  if (existsSync(rdir)) {
    for (const y of readdirSync(rdir)) {
      if (!/^\d{4}$/.test(y)) continue;
      for (const f of readdirSync(path.join(rdir, y)))
        for (const o of parseCsv(readFileSync(path.join(rdir, y, f), "utf8")))
          if (names.has(o.point) && o.mm !== "") add(Date.parse(o.time_utc), +o.mm);
    }
  }
  const have = (T) => (counts.get(T) ?? 0) >= pts.length;
  let missing = false;
  for (let T = Math.ceil(fromTs / H) * H; T <= toTs; T += H) if (!have(T)) { missing = true; break; }
  if (missing) {
    const past = Math.min(92, Math.ceil((Date.now() - fromTs) / (24 * H)) + 1);
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${pts.map((p) => p.lat)}&longitude=${pts.map((p) => p.lon)}&hourly=precipitation&past_days=${past}&forecast_days=3&timezone=UTC`;
    let j;
    for (let a = 1; a <= 3 && !j; a++) {
      try { const r = await fetch(u); if (r.ok) j = await r.json(); else await sleep(1500 * a); } catch { await sleep(1500 * a); }
    }
    if (!j) throw new Error("Open-Meteo rain fetch failed and the archive has no rain files");
    const list = Array.isArray(j) ? j : [j];
    sums.clear(); counts.clear(); // API is complete; don't double count partial archive files
    for (const p of list) p.hourly.time.forEach((t, i) => { const v = p.hourly.precipitation[i]; if (v != null) add(Date.parse(t + "Z"), v); });
  }
  const R = {};
  for (const [T, n] of counts) if (n >= pts.length) R[T] = sums.get(T) / n;
  return R;
}

export function hourlyGrid(series, names) {
  const t0 = Math.ceil(Math.max(...names.map((g) => series[g]?.[0]?.ts ?? Infinity)) / H) * H;
  const t1 = Math.floor(Math.min(...names.map((g) => series[g]?.at(-1)?.ts ?? -Infinity)) / H) * H;
  const times = [];
  for (let t = t0; t <= t1; t += H) times.push(t);
  return times;
}

/** Fit/backtest context over the archive. */
export const makeCtx = (series, R) => ({
  level: (g, t) => (series[g] ? interp(series[g], t) : null),
  rain: (T) => R[T],
});
