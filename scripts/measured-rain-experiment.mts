// @ts-nocheck (node strip-types script: explicit .ts extensions)
// Experiment: does rain MEASURED by the gauges improve the 1 / 3 / 6 h forecast on storm hours? (lib/measuredRain.ts)
// usage: node scripts/measured-rain-experiment.mts <archiveDir> [--live]
//
// Setup: the shipped gauge-only model (lib/model/gauge-model.json) gives a prediction for every gauge-hour; the experiment fits
// a small non-negative correction on its RESIDUAL, on hours where measured heavy rain tripped (the same rule as the warning),
// from the gauge's own and its upstream gauges' measured rain (1 / 3 / 6 h), scaled by the gauge's typical swing
// (storm-model.json `scale`). Scored leave-one-DAY-out (a storm is 1 to 2 days here), on storm hours only: calm hours are untouched.
// Only 12 days of rain_fall exist (the 11-month level history has none), so this is an experiment, NOT a shipped model.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { BASIN_ORDER } from "../lib/basinOrder.ts";
import { gaugeRainNow, measuredInWindow, measuredRainFor } from "../lib/measuredRain.ts";
import { interp, dayOf } from "../lib/model/core.mjs";
import { gaugeFeatures, predictGauge } from "../lib/model/gaugeModel.mjs";
import { fitNonNegL1 } from "../lib/model/stormModel.mjs";

const GM = JSON.parse(readFileSync(new URL("../lib/model/gauge-model.json", import.meta.url), "utf8"));
const SM = JSON.parse(readFileSync(new URL("../lib/model/storm-model.json", import.meta.url), "utf8"));
const dir = process.argv[2];
const H = 3_600_000;
const rows = new Map(), seen = new Set();
const push = (id, g, ts, rain, wl) => { if (seen.has(id)) return; seen.add(id); (rows.get(g) ?? rows.set(g, []).get(g)).push({ ts, rain_fall: rain, wl }); };
const num = (s) => (s == null || s === "" ? null : Number(s));
for (const f of readdirSync(path.join(dir, "2026")).filter((x) => x.endsWith(".csv"))) {
  const [head, ...lines] = readFileSync(path.join(dir, "2026", f), "utf8").trim().split("\n");
  const col = head.split(",");
  for (const l of lines) { const c = l.split(","); push(c[col.indexOf("objectid")], c[col.indexOf("gauge")].trim(), Number(c[col.indexOf("creation_ms")]), num(c[col.indexOf("rain_fall")]), num(c[col.indexOf("water_level")])); }
}
if (process.argv.includes("--live")) {
  const base = "https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services/gauges_2_view/FeatureServer/0/query";
  const cutoff = new Date(Date.now() - 7 * 24 * H).toISOString().slice(0, 19).replace("T", " ");
  for (let off = 0; ; off += 1000) {
    const q = new URLSearchParams({ where: `CreationDate >= TIMESTAMP '${cutoff}'`, outFields: "objectid,gauge,water_level,rain_fall,CreationDate", returnGeometry: "false", orderByFields: "objectid", resultOffset: String(off), resultRecordCount: "1000", f: "json" });
    const j = await (await fetch(`${base}?${q}`)).json();
    for (const f of j.features) { const a = f.attributes; push(String(a.objectid), String(a.gauge).trim(), a.CreationDate, a.rain_fall, a.water_level); }
    if (!j.exceededTransferLimit) break;
  }
}
const lvl = new Map();
for (const [g, a] of rows) { a.sort((x, y) => x.ts - y.ts); lvl.set(g, a.filter((r) => r.wl != null && r.wl > -50).map((r) => ({ ts: r.ts, wl: r.wl }))); }
const ctx = { level: (g, t) => { const a = lvl.get(g); return a ? interp(a, t) : null; } };

const samples = []; // one per gauge-hour-horizon on a storm hour
const all = []; // every scored gauge-hour (for the calm-hours-untouched statement)
for (const [basin, order] of Object.entries(BASIN_ORDER)) {
  order.forEach((g, i) => {
    const gm = GM.stations[g], sm = SM.stations[g];
    if (!gm || !sm || !rows.has(g) || !lvl.get(g)?.length) return;
    const chain = order.slice(0, i + 1).filter((x) => rows.has(x));
    const ups = chain.filter((x) => x !== g);
    const a = lvl.get(g);
    for (let t = Math.ceil((a[0].ts + 13 * H) / H) * H; t <= a.at(-1).ts - 6 * H; t += H) {
      const gs = chain.map((x) => gaugeRainNow(x, rows.get(x), t)).filter(Boolean);
      const trip = gs.length ? measuredRainFor(g, gs) : null;
      for (const hk of ["1", "3", "6"]) {
        const hm = gm.horizons[hk];
        if (!hm?.skilled) continue;
        const h = +hk;
        const f = gaugeFeatures(g, gm.up, hm.tide, ctx, t, h);
        const l0 = ctx.level(g, t), l1 = ctx.level(g, t + h * H);
        if (!f || l0 == null || l1 == null) continue;
        const pred = predictGauge(hm, f.x), act = l1 - l0;
        all.push({ g, h, storm: !!trip });
        if (!trip) continue;
        const own = (w) => measuredInWindow(rows.get(g), t, w) ?? 0;
        const up = (w) => Math.max(0, ...ups.map((u) => measuredInWindow(rows.get(u), t, w) ?? 0));
        samples.push({ g, h, t, day: dayOf(t), pred, act, scale: sm.scale, x: [own(3) / 100, own(6) / 100, up(3) / 100, up(6) / 100] });
      }
    }
  });
}
console.log(`gauge-hour-horizons scored: ${all.length}; on storm hours (measured rain tripped): ${samples.length}`);
const days = [...new Set(samples.map((s) => s.day))].sort();
for (const h of [1, 3, 6]) {
  const S = samples.filter((s) => s.h === h);
  if (S.length < 20) { console.log(`h=${h}: only ${S.length} storm samples, skipped`); continue; }
  let eBase = 0, eFit = 0, ePers = 0, n = 0;
  const heldOut = new Map();
  for (const d of days) {
    const tr = S.filter((s) => s.day !== d), te = S.filter((s) => s.day === d);
    if (tr.length < 15 || !te.length) continue;
    const m = fitNonNegL1(tr.map((s) => s.x), tr.map((s) => (s.act - s.pred) / s.scale));
    for (const s of te) {
      const corr = Math.max(0, m.b0 + m.w.reduce((z, w, j) => z + w * s.x[j], 0)) * s.scale;
      eBase += Math.abs(s.act - s.pred) / s.scale; eFit += Math.abs(s.act - s.pred - corr) / s.scale; ePers += Math.abs(s.act) / s.scale; n++;
      heldOut.set(`${s.g}|${s.t}`, corr);
    }
  }
  console.log(`h=${h}: ${n} held-out storm hours (leave one day out), error as a share of the gauge's typical swing: persistence ${(ePers / n).toFixed(3)}  shipped model ${(eBase / n).toFixed(3)}  + measured-rain correction ${(eFit / n).toFixed(3)}  (${(((eFit - eBase) / eBase) * 100).toFixed(0)}%)`);
}

// ---- Holombuwa, 26 Oct 2026: what the shipped gauge-only model said at 09:10 and 10:06 Sri Lanka time, and what the river did
const hol = rows.get("Holombuwa"), gmH = GM.stations.Holombuwa;
const FT = 1 / 0.3048;
const at = (iso) => Date.parse(iso);
for (const [label, iso] of [["09:10", "2026-10-26T09:10:00+05:30"], ["10:06", "2026-10-26T10:06:00+05:30"]]) {
  const t = at(iso);
  const l0 = ctx.level("Holombuwa", t);
  const ch = BASIN_ORDER["Kelani Ganga"].slice(0, 3).filter((x) => rows.has(x));
  const m = measuredRainFor("Holombuwa", ch.map((x) => gaugeRainNow(x, rows.get(x), t)).filter(Boolean));
  const out = [];
  for (const hk of ["1", "3", "6"]) {
    const hm = gmH.horizons[hk], f = gaugeFeatures("Holombuwa", gmH.up, hm.tide, ctx, t, +hk);
    const pr = f ? predictGauge(hm, f.x) : null, lA = ctx.level("Holombuwa", t + +hk * H);
    out.push(`${hk} h: said ${pr == null ? "n/a" : ((l0 + pr) * FT).toFixed(1)} ft, river ${lA == null ? "n/a" : (lA * FT).toFixed(1)} ft`);
  }
  console.log(`Holombuwa at ${label}: level ${(l0 * FT).toFixed(1)} ft; ${out.join("; ")}; measured-rain warning: ${m ? `ON (${m.gauge}, ${m.mm} mm in ${m.hours} h)` : "off"}`);
}
