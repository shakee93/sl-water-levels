// @ts-nocheck (node strip-types script: explicit .ts extensions)
// Backtest for the "measured heavy rain" warning (lib/measuredRain.ts).
// usage: node scripts/measured-rain-backtest.mts <archiveDir> [--live]
//   archiveDir  a checkout/export of the `data` branch (YYYY/YYYY-MM-DD.csv with rain_fall)
//   --live      also pull the last 7 days from the ArcGIS gauges_2_view feed (fills the days after the newest archive snapshot)
//
// Question: for every hour, did the rain measured at the gauge and its upstream gauges (BASIN_ORDER) in the last 1 h / 3 h
// trip the line, and did the gauge's level then rise by 1 ft or more at some point in the next 6 h?
// The rain archive only exists since 15 Oct 2026 (the 11-month level history has no rain_fall column), so this is ~12 days
// and a handful of storms, not 11 months: the thresholds are a starting point and DOCS.md says so.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { BASIN_ORDER } from "../lib/basinOrder.ts";
import { gaugeRainNow, measuredRainFor, MEASURED_1H_MM, MEASURED_3H_MM, type RainRow } from "../lib/measuredRain.ts";

const dir = process.argv[2];
const live = process.argv.includes("--live");
const H = 3_600_000;
type Row = { ts: number; rain_fall: number | null; wl: number | null; alert: number | null };
const rows = new Map<string, Row[]>(); // gauge -> rows by objectid
const seen = new Set<string>();
const push = (id: string, g: string, ts: number, rain: number | null, wl: number | null, alert: number | null) => {
  if (seen.has(id)) return;
  seen.add(id);
  const a = rows.get(g) ?? [];
  a.push({ ts, rain_fall: rain, wl, alert });
  rows.set(g, a);
};
const num = (s: string | undefined) => (s == null || s === "" ? null : Number(s));
for (const f of readdirSync(path.join(dir, "2026")).filter((x) => x.endsWith(".csv"))) {
  const [head, ...lines] = readFileSync(path.join(dir, "2026", f), "utf8").trim().split("\n");
  const col = head.split(",");
  const ix = (n: string) => col.indexOf(n);
  for (const l of lines) {
    const c = l.split(",");
    push(c[ix("objectid")], c[ix("gauge")].trim(), Number(c[ix("creation_ms")]), num(c[ix("rain_fall")]), num(c[ix("water_level")]), num(c[ix("alertpull")]));
  }
}
if (live) {
  const base = "https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services/gauges_2_view/FeatureServer/0/query";
  const cutoff = new Date(Date.now() - 7 * 24 * H).toISOString().slice(0, 19).replace("T", " ");
  for (let off = 0; ; off += 1000) {
    const q = new URLSearchParams({ where: `CreationDate >= TIMESTAMP '${cutoff}'`, outFields: "objectid,gauge,water_level,rain_fall,CreationDate,alertpull", returnGeometry: "false", orderByFields: "objectid", resultOffset: String(off), resultRecordCount: "1000", f: "json" });
    const j: any = await (await fetch(`${base}?${q}`)).json();
    if (j.error) throw new Error(JSON.stringify(j.error));
    for (const f of j.features) {
      const a = f.attributes;
      push(String(a.objectid), String(a.gauge).trim(), a.CreationDate, a.rain_fall, a.water_level, a.alertpull);
    }
    if (!j.exceededTransferLimit) break;
  }
}
for (const a of rows.values()) a.sort((x, y) => x.ts - y.ts);

const ft = (g: string, v: number) => ((rows.get(g)!.find((r) => r.alert != null)?.alert ?? 0) >= 4 ? v : v / 0.3048);
const levelAt = (g: string, t: number): number | null => {
  const a = rows.get(g)!;
  let best: Row | null = null;
  for (const r of a) if (r.wl != null && r.wl > -50 && Math.abs(r.ts - t) <= 40 * 60_000 && (!best || Math.abs(r.ts - t) < Math.abs(best.ts - t))) best = r;
  return best ? ft(g, best.wl as number) : null;
};
const riseNext6 = (g: string, t: number): number | null => {
  const l0 = levelAt(g, t);
  if (l0 == null) return null;
  let mx = -Infinity;
  for (const r of rows.get(g)!) if (r.wl != null && r.wl > -50 && r.ts > t && r.ts <= t + 6 * H) mx = Math.max(mx, ft(g, r.wl));
  return Number.isFinite(mx) ? mx - l0 : null;
};

const all = [...rows.values()].flat();
const tMin = Math.ceil(Math.min(...all.map((r) => r.ts)) / H) * H + 3 * H;
const tMax = Math.floor((Math.max(...all.map((r) => r.ts)) - 6 * H) / H) * H;

type Cell = { hour: number; station: string; mm1: number; mm3: number; rise: number };
const cells: Cell[] = [];
for (const [basin, order] of Object.entries(BASIN_ORDER)) {
  void basin;
  order.forEach((station, i) => {
    if (!rows.has(station)) return;
    const chain = order.slice(0, i + 1).filter((g) => rows.has(g));
    for (let t = tMin; t <= tMax; t += H) {
      const rise = riseNext6(station, t);
      if (rise == null) continue;
      const gs = chain.map((g) => gaugeRainNow(g, rows.get(g) as RainRow[], t)).filter((x) => x != null);
      if (!gs.length) continue; // needs data from >= 1 gauge
      cells.push({ hour: t, station, mm1: Math.max(...gs.map((x) => x!.mm1h ?? 0)), mm3: Math.max(...gs.map((x) => x!.mm3h ?? 0)), rise });
    }
  });
}
const base = cells.filter((c) => c.rise >= 1).length / cells.length;
console.log(`station-hours scored: ${cells.length}; base rate of a rise >= 1 ft in the next 6 h: ${(base * 100).toFixed(1)}%`);
console.log("rule (1h mm / 3h mm)        fired  hit>=1ft  precision  recall  mean rise (fired)  >=3 ft");
const rule = (a: number, b: number) => {
  const f = cells.filter((c) => c.mm1 >= a || c.mm3 >= b);
  const hit = f.filter((c) => c.rise >= 1).length;
  const tot = cells.filter((c) => c.rise >= 1).length;
  const mean = f.reduce((s, c) => s + c.rise, 0) / (f.length || 1);
  const big = f.filter((c) => c.rise >= 3).length;
  console.log(`${String(a).padStart(3)} / ${String(b).padStart(3)}${a === MEASURED_1H_MM && b === MEASURED_3H_MM ? "  <- shipped" : "           "}      ${String(f.length).padStart(5)}  ${String(hit).padStart(8)}  ${((hit / (f.length || 1)) * 100).toFixed(0).padStart(8)}%  ${((hit / (tot || 1)) * 100).toFixed(0).padStart(5)}%  ${mean.toFixed(2).padStart(10)} ft  ${String(big).padStart(5)}`);
};
for (const [a, b] of [[15, 25], [20, 30], [20, 40], [25, 40], [25, 50], [30, 50], [40, 60], [1e9, 40], [25, 1e9]]) rule(a, b);
// the shipped rule per station on the events it fired
const fired = cells.filter((c) => c.mm1 >= MEASURED_1H_MM || c.mm3 >= MEASURED_3H_MM);
const by = new Map<string, Cell[]>();
for (const c of fired) by.set(c.station, [...(by.get(c.station) ?? []), c]);
for (const [s, a] of by) console.log(`  ${s}: ${a.length} h fired, ${a.filter((c) => c.rise >= 1).length} followed by a >= 1 ft rise, max rise ${Math.max(...a.map((c) => c.rise)).toFixed(1)} ft`);
// the measuredRainFor() wording check on the Holombuwa case
const hol = rows.get("Holombuwa");
if (hol) {
  const t = Math.max(...hol.filter((r) => r.rain_fall != null).map((r) => r.ts));
  const m = measuredRainFor("Holombuwa", BASIN_ORDER["Kelani Ganga"].slice(0, 3).map((g) => gaugeRainNow(g, rows.get(g) as RainRow[], t + 1000)).filter((x) => x != null));
  console.log("newest Holombuwa reading", new Date(t).toISOString(), "->", m);
}
