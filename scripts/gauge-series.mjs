// Hourly gauge series for the fitting / backtest scripts: this repo's `data` branch export merged with the
// nuuuwan/lk_irrigation hourly feed (see scripts/fit-gauge-model.mjs for the story). Returns the same arrays the
// gauge-model fit uses: L[g][i] = level (native unit) at t0 + i hours, NaN where unknown.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { interp } from "../lib/model/core.mjs";
import { exportDataBranch, loadArchive } from "./forecast-data.mjs";

const H = 3_600_000;

export function loadGaugeSeries({ dir, histFile } = {}) {
  dir ??= exportDataBranch();
  if (!histFile) {
    histFile = path.join(mkdtempSync(path.join(tmpdir(), "sl-hist-")), "all.json");
    execFileSync("curl", ["-sfL", "-o", histFile, "https://raw.githubusercontent.com/nuuuwan/lk_irrigation/main/data/all.json"], { stdio: "inherit" });
  }
  const ours = loadArchive(dir);
  const stationList = JSON.parse(readFileSync(path.join(dir, "stations.json"), "utf8"));
  const basinOf = {}, unitOf = {}, thr = {};
  for (const s of stationList) {
    const n = s.station.trim();
    basinOf[n] = (s.basin ?? "").trim();
    unitOf[n] = s.Unit ?? null;
    thr[n] = { alert: s.Alert_Level, minor: s.Minor_Flood_Level, major: s.Major_Flood_Level };
  }
  const by = {};
  for (const r of JSON.parse(readFileSync(histFile, "utf8"))) {
    if (r.water_level_m == null) continue;
    (by[r.station_name.trim()] ??= []).push({ ts: r.time_ut * 1000, wl: r.water_level_m });
  }
  const series = {}, factor = {};
  for (const g of Object.keys(by)) {
    by[g].sort((a, b) => a.ts - b.ts);
    const o = ours[g];
    let k = 1;
    if (o) {
      const m = new Map(by[g].map((p) => [Math.round(p.ts / 120000), p.wl]));
      const rs = [];
      for (const p of o) { const v = m.get(Math.round(p.ts / 120000)); if (v != null && p.wl > 0.2) rs.push(v / p.wl); }
      rs.sort((a, b) => a - b);
      if (rs.length > 10 && Math.abs(rs[rs.length >> 1] - 0.3048) < 0.02) k = 0.3048;
    } else if (unitOf[g] === "ft") k = 0.3048;
    factor[g] = k;
    const start = o ? o[0].ts : Infinity;
    const merged = by[g].map((p) => ({ ts: p.ts, wl: p.wl / k })).filter((p) => p.ts < start - 60000).concat(o ?? []);
    const d = [];
    for (const p of merged) if (!d.length || p.ts - d.at(-1).ts >= 60000) d.push(p);
    series[g] = d;
  }
  const gauges = Object.keys(series).filter((g) => basinOf[g]);
  const t0 = Math.ceil(Math.min(...gauges.map((g) => series[g][0].ts)) / H) * H;
  const t1 = Math.floor(Math.max(...gauges.map((g) => series[g].at(-1).ts)) / H) * H;
  const N = (t1 - t0) / H + 1;
  const L = {};
  for (const g of gauges) {
    const a = new Float64Array(N).fill(NaN);
    for (let i = 0; i < N; i++) { const v = interp(series[g], t0 + i * H); if (v != null) a[i] = v; }
    L[g] = a;
  }
  const unit = (g) => (factor[g] === 0.3048 || unitOf[g] === "ft" ? "ft" : "m");
  return { L, gauges, t0, t1, N, basinOf, unitOf, thr, factor, unit };
}
