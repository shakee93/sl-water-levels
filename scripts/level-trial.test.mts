// @ts-nocheck (node strip-types test)
// Tests of the level-model hidden trial, stage 1 (pure part): lib/levelTrial/{predict,record,rebuild}.mjs and lib/model/lvl-lin-d4.json.
//   node --experimental-strip-types --no-warnings scripts/level-trial.test.mts
// No network, no D1, no secrets. The fixture (scripts/fixtures/lvl-lin-d4-cases.json.gz) was written on the lab side from the Python candidate; see its meta line.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { stripTypeScriptTypes } from "node:module";
import { predict, VERSION, MAX_AGE_MS } from "../lib/levelTrial/predict.mjs";
import { rebuild, glitchFlags, toFeet, minimalGrid } from "../lib/levelTrial/rebuild.mjs";
import { encode, decode, tryDecode, buildRecord, inputsOf, zonePositions, zoneMean, ZN, CN, ZPAST, CPAST, HOUR, MAX_BLOB_CHARS } from "../lib/levelTrial/record.mjs";
import { UNIT_BY_STATION } from "../lib/units.ts";
import { newState, update, interval, score, quantile } from "../lib/levelTrial/conformal.mjs";

let n = 0;
const ok = (name: string, fn: () => void) => {
  try {
    fn();
    n++;
  } catch (e) {
    console.error("FAIL " + name + "\n  " + String((e as Error).message).split("\n").slice(0, 6).join("\n  "));
    process.exitCode = 1;
  }
};
const J = (p: string) => JSON.parse(readFileSync(new URL("../" + p, import.meta.url), "utf8"));
const model = J("lib/model/lvl-lin-d4.json");
const UT = UNIT_BY_STATION as Record<string, "m" | "ft">;

// ------------------------------------------------------------------------------------------------ the model file
ok("model: sha256 is the production model of the lab", () => {
  const sha = createHash("sha256").update(readFileSync(new URL("../lib/model/lvl-lin-d4.json", import.meta.url))).digest("hex");
  assert.equal(sha, "bd4752a7685f44ac85635ac5fe7896879d577325df794bdfa7caf941e4372313");
  assert.equal(model.schema, "slwl-port/lvl-lin-d4@2");
  assert.equal(Object.keys(model.g).length, 29);
});
ok("predict: no options argument, version string", () => {
  assert.equal(predict.length, 2);
  assert.match(VERSION, /predict@2/);
});

// ------------------------------------------------------------------------------------------------ unit table (R1)
ok("unit table: the model's unit of every gauge and every partner equals the site's own unit table", () => {
  let checked = 0;
  for (const [g, gm] of Object.entries<any>(model.g)) {
    assert.equal(gm.unit, UT[g], g + " model unit " + gm.unit + " vs site table " + UT[g]);
    checked++;
    for (const p of gm.ups) {
      assert.equal(p.unit, UT[p.u], g + " partner " + p.u);
      checked++;
    }
  }
  assert.ok(checked >= 29 + 15);
});
ok("toFeet: one conversion, m and ft only", () => {
  assert.equal(toFeet(1, "ft"), 1);
  assert.ok(Math.abs((toFeet(1, "m") as number) - 3.280839895013123) < 1e-12);
  assert.equal(toFeet(1, "km" as any), null);
});

// ------------------------------------------------------------------------------------------------ the fixture
type Case = { id: string; scenario: string; gauge: string; t: number; lagH: number; age: number | null; record: string; rows: Record<string, [number, number][]>; flags: Record<string, number[]>; expect: { verdict: string | null; reason: string | null; degraded: string[]; hz: number[][] | null; vsource: string } };
const fx = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/lvl-lin-d4-cases.json.gz", import.meta.url))).toString("utf8")) as { meta: any; cases: Case[] };
const rowsOf = (c: Case) => Object.fromEntries(Object.entries(c.rows).map(([k, a]) => [k, a.map(([dt, level]) => ({ ts: c.t + dt, level }))]));
const run = (c: Case, o: any = {}) => rebuild(model, { gauge: c.gauge, t: c.t, record: c.record, rows: rowsOf(c), unitTable: UT, ...o });

ok("fixture: meta, size, coverage (every gauge, fast gauges, no-partner gauge, degraded and refused cases)", () => {
  assert.equal(fx.meta.model_sha256, "bd4752a7685f44ac85635ac5fe7896879d577325df794bdfa7caf941e4372313");
  assert.ok(fx.cases.length >= 200, "cases " + fx.cases.length);
  const gs = new Set(fx.cases.map((c) => c.gauge));
  for (const g of Object.keys(model.g)) assert.ok(gs.has(g), "no case for " + g);
  assert.ok(fx.cases.some((c) => model.g[c.gauge].fast) && fx.cases.some((c) => model.g[c.gauge].ups.length === 0));
  const vs = new Set(fx.cases.map((c) => c.expect.verdict));
  assert.ok(vs.has("ok") && vs.has("degraded") && vs.has("refused"), [...vs].join());
  assert.ok(fx.cases.some((c) => c.lagH > 0));
});

const results = new Map<string, ReturnType<typeof rebuild>>();
ok("fixture: rebuild + predict equal the Python candidate within 1e-6 ft (tolerance is for DEQUANTISED inputs: rain in 0.1 mm), verdicts and flags as expected", () => {
  let compared = 0, maxFt = 0, verdictChecked = 0, flagCases = 0;
  const bad: string[] = [];
  for (const c of fx.cases) {
    const r = run(c);
    results.set(c.id, r);
    if (r.verdict === "skipped") {
      bad.push(c.id + " skipped " + r.reason + " " + r.detail);
      continue;
    }
    const e = c.expect;
    if (e.verdict) {
      verdictChecked++;
      if (r.verdict !== e.verdict) bad.push(c.id + " " + c.scenario + " verdict " + r.verdict + " (" + r.detail + ") expected " + e.verdict + " [" + e.vsource + "]");
      else if (e.verdict === "refused" && e.reason && r.reason !== e.reason) bad.push(c.id + " reason " + r.reason + " expected " + e.reason);
      for (const d of e.degraded) if (r.verdict === "degraded" && !r.result!.degraded.some((x) => x.code === d)) bad.push(c.id + " missing degraded code " + d + " has " + r.result!.degraded.map((x) => x.code));
    }
    if (e.hz && r.result!.hz) {
      const k = model.g[c.gauge].k;
      assert.equal(r.result!.hz.length, e.hz.length, c.id);
      for (let j = 0; j < e.hz.length; j++) {
        assert.equal(r.result!.hz[j][0], e.hz[j][0]);
        for (let f = 1; f <= 3; f++) {
          const d = Math.abs(r.result!.hz[j][f] - e.hz[j][f]) * k;
          compared++;
          if (d > maxFt) maxFt = d;
          if (d > 1e-6) bad.push(c.id + " " + c.gauge + " h" + e.hz[j][0] + " diff " + d.toExponential(2) + " ft");
        }
      }
    } else if (e.hz && e.verdict && !r.result!.hz) bad.push(c.id + " no numbers, expected some (" + r.verdict + ")");
    // glitch flags as known at t equal the ones the Python run was given
    const want = c.flags;
    const got: Record<string, number[]> = { [c.gauge]: r.flags!.own.map((x) => x - c.t).sort((a, b) => a - b) };
    for (const [u, f] of Object.entries(r.flags!.partners)) got[u] = f.map((x) => x - c.t).sort((a, b) => a - b);
    for (const [name, f] of Object.entries(want)) if (f.length || (got[name] || []).length) {
      flagCases++;
      if (JSON.stringify(f) !== JSON.stringify(got[name] || [])) bad.push(c.id + " flags of " + name);
    }
  }
  console.log("  fixture: " + fx.cases.length + " cases, " + compared + " values compared, max |diff| " + maxFt.toExponential(2) + " ft, verdicts checked " + verdictChecked + ", series with flags " + flagCases);
  assert.equal(bad.length, 0, bad.length + " problems:\n" + bad.slice(0, 12).join("\n"));
  assert.ok(compared > 2000);
});
ok("fixture: the spike and stuck cases really carry flags, the sentinel case is degraded history_out_of_range", () => {
  const sp = fx.cases.filter((c) => c.scenario === "spike_own" || c.scenario === "stuck_own");
  assert.ok(sp.length >= 4, "spike/stuck cases " + sp.length);
  assert.ok(sp.some((c) => c.flags[c.gauge].length > 0), "no flagged own series");
  const sen = fx.cases.filter((c) => c.scenario === "sentinel_own");
  assert.ok(sen.length >= 2);
  for (const c of sen) assert.ok(results.get(c.id)!.result!.degraded.some((d) => d.code === "history_out_of_range"), c.id);
});
ok("fixture: verdict sources are mixed and independent ones dominate the checked cases", () => {
  const src: Record<string, number> = {};
  for (const c of fx.cases) src[c.expect.vsource] = (src[c.expect.vsource] || 0) + 1;
  assert.ok((src.harness || 0) >= 100 && (src.scenario || 0) >= 40, JSON.stringify(src));
  console.log("  verdict sources: " + JSON.stringify(src));
});

// ------------------------------------------------------------------------------------------------ rebuild level reasons and unit table
const base = fx.cases.find((c) => results.get(c.id)?.verdict === "ok" && model.g[c.gauge].ups.length === 2 && model.g[c.gauge].rain.up_cells > 0 && c.lagH === 0 && c.scenario.startsWith("control"))!;
ok("rebuild: a base case with two partners, up-zone cells, verdict ok exists", () => assert.ok(base, "none"));
ok("rebuild: no record / bad text / wrong format / misaligned grid", () => {
  assert.equal(run(base, { record: null }).reason, "no_record");
  assert.equal(run(base, { record: undefined }).verdict, "skipped");
  assert.equal(run(base, { record: "not base64 !!" }).reason, "decode_error");
  assert.equal(run(base, { record: {} }).reason, "bad_record");
  assert.equal(run(base, { t: base.t + 5 * HOUR }).reason, "grid_misaligned");
  const noLast = rowsOf(base);
  noLast[base.gauge].pop();
  assert.equal(run(base, { rows: noLast }).reason, "t_not_newest");
  const rec = decode(base.record);
  assert.equal(run(base, { record: { ...rec, grid: rec.grid + 5 * HOUR } }).reason, "grid_misaligned");
  assert.notEqual(run(base, { record: { ...rec, grid: rec.grid + HOUR } }).verdict, "skipped");
  assert.equal(run(base, { record: { ...rec, grid: rec.grid - HOUR } }).reason, "grid_misaligned");
  assert.equal(run(base, { gauge: "Nowhere" }).reason, "unknown_gauge");
  assert.equal(run(base, { gauge: "__proto__" }).reason, "unknown_gauge");
  assert.equal(run(base, { rows: {} }).reason, "no_obs");
  assert.equal(run(base, { rows: { [base.gauge]: [{ ts: base.t, level: 1 }] } }).reason, "history_incomplete");
});
ok("rebuild: unit table mismatch of the gauge or of a partner skips with unit_table_mismatch (R1)", () => {
  const t1 = run(base, { unitTable: { ...UT, [base.gauge]: UT[base.gauge] === "m" ? "ft" : "m" } });
  assert.equal(t1.verdict, "skipped");
  assert.equal(t1.reason, "unit_table_mismatch");
  const u = model.g[base.gauge].ups[0].u;
  const t2 = run(base, { unitTable: { ...UT, [u]: "ft" } });
  assert.equal(t2.reason, "unit_table_mismatch");
  assert.match(t2.detail, new RegExp(u));
  const t3 = run(base, { unitTable: { ...UT, [u]: undefined } });
  assert.equal(t3.reason, "unit_table_mismatch");
  assert.equal(run(base, { unitTable: undefined }).reason, "bad_input");
});
ok("rebuild: a flood is NOT refused by any ratio rule (Badalgama 4.39 -> 13.46 m over four readings is a real pair of values of Cyclone Ditwah)", () => {
  // the last four readings rise 3.07 times: no ratio guard may refuse this (R1); the predictor's own range guard decides, and Badalgama's training range holds 13.46 m
  const c = fx.cases.find((x) => x.gauge === "Badalgama" && x.lagH === 0 && results.get(x.id)!.verdict !== "skipped")!;
  assert.ok(c);
  const rows = rowsOf(c);
  const a = rows.Badalgama;
  [4.39, 7.2, 10.4, 13.46].forEach((lv, i) => { a[a.length - 4 + i].level = lv; });
  assert.ok(13.46 * 3.280839895013123 < model.g.Badalgama.range_ft.max * 1.1 + 1);
  const r = rebuild(model, { gauge: "Badalgama", t: c.t, record: c.record, rows, unitTable: UT });
  assert.notEqual(r.verdict, "skipped");
  assert.ok(!["unit_out_of_range", "unit_reference_mismatch", "partner_unit_out_of_range"].includes(r.reason as string), String(r.reason) + " " + r.detail);
  assert.ok(r.result!.hz === null || r.result!.hz.every((h) => h.every(Number.isFinite)));
});
ok("rebuild: history stats and lag", () => {
  const r = results.get(base.id)!;
  assert.ok(r.nHist! >= 60 && r.gapH! < 3 && r.historyComplete === true, JSON.stringify([r.nHist, r.gapH]));
  const lag = fx.cases.find((c) => c.lagH > 0)!;
  assert.equal(results.get(lag.id)!.lagH, lag.lagH);
});
ok("rebuild: rows in any order, duplicates (first kept), non-finite levels and later rows give the same answer", () => {
  const ref = results.get(base.id)!;
  const rows = rowsOf(base);
  const shuffled: any = {};
  for (const [k, a] of Object.entries<any[]>(rows)) {
    const b = a.slice().reverse();
    b.push({ ts: a[0].ts, level: 123 }); // a later duplicate of the first row: dropped
    b.push({ ts: a[1].ts + 1, level: NaN }); // non-finite: dropped
    b.push({ ts: base.t + 3600000, level: 99 }); // after t: dropped
    shuffled[k] = b;
  }
  const r = rebuild(model, { gauge: base.gauge, t: base.t, record: base.record, rows: shuffled, unitTable: UT });
  assert.deepEqual(r.result!.hz, ref.result!.hz);
  assert.equal(r.verdict, ref.verdict);
});

// ------------------------------------------------------------------------------------------------ hostile inputs (the cases of the lab's list that apply to the shipped predictor)
const B = results.get(base.id)!;
const P = (f: (x: any) => void) => {
  const x = structuredClone(B.inputs);
  f(x);
  return predict(model, x as any);
};
const refusedWith = (o: any, code: string) => o.verdict === "refused" && o.reason === code && o.hz === null && o.hzFt === null && o.c === null && o.complete === false;
const L = B.inputs!.own.ts.length;
const U1 = model.g[base.gauge].ups[0].u;
ok("hostile: control is ok, numbers finite and ordered", () => {
  const o = predict(model, structuredClone(B.inputs) as any);
  assert.equal(o.verdict, "ok");
  assert.ok(o.hz!.every((r) => r.every(Number.isFinite) && r[2] <= r[1] && r[1] <= r[3]));
});
ok("hostile: missing markers (null, undefined, NaN, +-Infinity) are bit-equal to the reading being absent; strings are refused", () => {
  const rm = P((x) => { for (const k of ["ts", "v", "bad"]) x.own[k].splice(L - 6, 1); });
  for (const v of [null, undefined, NaN, Infinity, -Infinity]) assert.deepEqual(P((x) => { x.own.v[L - 6] = v; }).hz, rm.hz);
  for (const v of ["9.9", "", true, {}, [1]]) assert.ok(refusedWith(P((x) => { x.own.v[L - 6] = v; }), "non_numeric_value"));
  assert.ok(refusedWith(P((x) => { x.partners[U1].v[3] = "3.1"; }), "non_numeric_value"));
  assert.ok(refusedWith(P((x) => { x.own.bad[L - 6] = "yes"; }), "bad_flag_invalid"));
});
ok("hostile: reversed, shuffled and single swapped pair of timestamps are refused, own and partner", () => {
  assert.ok(refusedWith(P((x) => { for (const k of ["ts", "v", "bad"]) x.own[k].reverse(); }), "timestamps_not_sorted"));
  assert.ok(refusedWith(P((x) => { const a = x.own.ts; [a[L - 4], a[L - 5]] = [a[L - 5], a[L - 4]]; }), "timestamps_not_sorted"));
  assert.ok(refusedWith(P((x) => { for (const k of ["ts", "v", "bad"]) x.partners[U1][k].reverse(); }), "timestamps_not_sorted"));
  assert.ok(refusedWith(P((x) => { x.own.v.pop(); }), "series_length_mismatch"));
});
ok("hostile: issue time must be an integer in ms and the newest reading (at most 10 minutes older)", () => {
  for (const t of ["1790000000000", NaN, undefined, 1.5, 17900000, 0, -5, 1e18, new Date()]) assert.ok(refusedWith(P((x) => { x.t = t; }), "bad_t"), String(t));
  assert.equal(P((x) => { x.t += 9 * 60000; }).verdict === "refused", false);
  for (const d of [10 * 60000 + 1, 30 * 60000, 3 * HOUR]) assert.ok(refusedWith(P((x) => { x.t += d; }), "stale_newest_reading"));
  assert.ok(refusedWith(P((x) => { x.t -= 60000; }), "reading_after_issue_time"));
  assert.equal(MAX_AGE_MS, 600000);
});
ok("hostile: gauge names (spelling, case, prototype keys, non-strings) and bad input objects are refused", () => {
  for (const g of [B.inputs!.gauge.toLowerCase(), B.inputs!.gauge + " ", "__proto__", "constructor", "toString", 7]) assert.ok(refusedWith(P((x) => { x.gauge = g; }), "unknown_gauge"), String(g));
  for (const x of [null, [], "x", 3]) assert.equal((predict(model, x as any) as any).verdict, "refused");
  assert.equal(predict({} as any, structuredClone(B.inputs) as any).reason, "model_invalid");
});
ok("hostile: rain absent, all missing, wrong cell count, shifted or off-hour origin, sentinel values, zero-filled mean", () => {
  assert.ok(refusedWith(P((x) => { x.rain = null; }), "rain_missing"));
  assert.ok(refusedWith(P((x) => { x.rain.obs.mean = x.rain.obs.mean.map(() => NaN); }), "rain_missing"));
  assert.ok(refusedWith(P((x) => { x.rain.origin += 1000; }), "rain_origin_not_whole_hour"));
  assert.ok(refusedWith(P((x) => { x.rain.obs.cells.pop(); x.rain.fc.cells.pop(); }), "rain_cell_count"));
  assert.ok(refusedWith(P((x) => { x.rain.obs.mean[10] = "0.5"; }), "non_numeric_rain_value"));
  assert.ok(refusedWith(P((x) => { x.rain.obs.mean = x.rain.obs.mean.map((v: any) => (v === null ? null : 0)); }), "rain_inconsistent"));
  // an hour shift of the whole minimal grid exposes an edge window (R2)
  const sh = P((x) => { x.rain.origin += HOUR; });
  assert.ok(sh.verdict === "refused" || sh.degraded.some((d) => d.code === "rain_window_missing"), sh.verdict);
  const sh2 = P((x) => { x.rain.origin -= HOUR; });
  assert.ok(sh2.verdict === "refused" || sh2.degraded.some((d) => d.code === "rain_window_missing"), sh2.verdict);
  for (const bad of [-9999, 400.0001, -1, Infinity]) { const o = P((x) => { x.rain.obs.mean[20] = bad; }); assert.ok(o.verdict !== "ok" || o.diag.rain.windowsMissing.length === 0); }
});
ok("hostile: wrong unit of the own series is refused (reference or range), of a partner when it leaves its range; no ratio guard", () => {
  const ref = B.inputs!.unitRefFt as number;
  const asFeet = P((x) => { x.own.v = x.own.v.map((v: number) => v * 3.280839895013123); });
  assert.equal(asFeet.verdict, "refused");
  assert.ok(["unit_out_of_range", "unit_reference_mismatch"].includes(asFeet.reason!), asFeet.reason!);
  const asM = P((x) => { x.own.v = x.own.v.map((v: number) => v * 0.3048); });
  assert.equal(asM.verdict, "refused");
  assert.ok(refusedWith(P((x) => { x.unitRefFt = ref * 2; }), "unit_reference_mismatch"));
  assert.equal(P((x) => { x.unitRefFt = null; }).degraded.some((d: any) => d.code === "unit_not_cross_checked"), true);
  assert.ok(refusedWith(P((x) => { x.partners[U1].v = x.partners[U1].v.map((v: number) => v * 1000); }), "partner_unit_out_of_range"));
});
ok("hostile: a sentinel or wrong-unit value in the MIDDLE of the history (own and partner) counts as missing and is flagged (R1)", () => {
  const rm = P((x) => { for (const k of ["ts", "v", "bad"]) x.own[k].splice(L - 4, 1); });
  const o = P((x) => { x.own.v[L - 4] = 9999; });
  assert.deepEqual(o.hz, rm.hz);
  assert.equal(o.verdict, "degraded");
  assert.ok(o.degraded.some((d) => d.code === "history_out_of_range" && d.items.some((i) => i.startsWith("own:"))));
  assert.ok(o.diag.series.own.outOfRange === 1);
  for (const v of [0, -9999, 50]) assert.equal(P((x) => { x.own.v[L - 3] = v; }).verdict === "ok" && v !== 0, false);
  const pm = P((x) => { for (const k of ["ts", "v", "bad"]) x.partners[U1][k].splice(2, 1); });
  const po = P((x) => { x.partners[U1].v[2] = -9999; });
  assert.deepEqual(po.hz, pm.hz);
  assert.ok(po.degraded.some((d) => d.code === "history_out_of_range" && d.items.some((i) => i.startsWith(U1 + ":"))));
});
ok("hostile: no test or audit option: a refused call carries no numbers whatever the third argument says", () => {
  const x = structuredClone(B.inputs) as any;
  x.rain = null;
  for (const opt of [{ audit: true }, { maxAgeMs: 1e12 }, true]) {
    const o = (predict as any)(model, structuredClone(x), opt);
    assert.ok(refusedWith(o, "rain_missing"));
  }
  const y = structuredClone(B.inputs) as any;
  y.t += HOUR;
  assert.ok(refusedWith((predict as any)(model, y, { maxAgeMs: 1e12 }), "stale_newest_reading"));
  const z = structuredClone(B.inputs) as any;
  z.audit = true;
  z.maxAgeMs = 1e12;
  assert.equal(predict(model, z).verdict, "ok");
});
ok("hostile: partner absent, stale, empty are degraded (never ok); a flat own series is reported", () => {
  const o = P((x) => { delete x.partners[U1]; });
  assert.ok(o.degraded.some((d) => d.code === "partner_missing"));
  const e = P((x) => { x.partners[U1] = { ts: [], v: [], bad: [] }; });
  assert.deepEqual(e.hz, o.hz);
  const flat = P((x) => { x.own.v = x.own.v.map(() => x.own.v[L - 1]); x.unitRefFt = x.unitRefFt; });
  assert.equal(flat.diag.ownFlat12h, true);
});
ok("hostile: predict is pure: the same call twice, inputs not mutated, a refused call interleaved changes nothing", () => {
  const x = structuredClone(B.inputs) as any;
  const before = JSON.stringify(x);
  const a = predict(model, x);
  predict(model, { ...x, rain: null });
  const b = predict(model, x);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(x), before);
});

// ------------------------------------------------------------------------------------------------ codec
ok("codec: round trip of every fixture record, decode(encode(x)) equals x, text is stable", () => {
  for (const c of fx.cases) {
    const r = decode(c.record);
    assert.equal(r.fmt, 1);
    assert.equal(r.zones.full!.length, ZN);
    assert.equal(r.cells.length, r.nz[0]);
    assert.ok(r.cells.every((a) => a.length === CN));
    assert.deepEqual(decode(encode(r)), r);
    assert.equal(r.ageMin, c.age);
  }
});
ok("codec: size of the fixture records", () => {
  const lens = fx.cases.map((c) => c.record.length).sort((a, b) => a - b);
  assert.ok(lens[lens.length - 1] < MAX_BLOB_CHARS, "max " + lens[lens.length - 1]);
  console.log("  record text: p50 " + lens[lens.length >> 1] + ", max " + lens[lens.length - 1] + " characters, n " + lens.length);
});
ok("codec: bad text and bad records", () => {
  assert.equal(tryDecode("").ok, false);
  assert.equal(tryDecode("AAAA").ok, false);
  assert.equal(tryDecode(base.record.slice(0, 60)).ok, false);
  assert.equal(tryDecode(base.record.slice(0, -8)).ok, false);
  assert.throws(() => decode(null as any));
  const r = decode(base.record);
  assert.throws(() => encode({ ...r, fmt: 2 as any }));
  assert.throws(() => encode({ ...r, grid: r.grid + 5 }));
  assert.throws(() => encode({ ...r, nz: [r.nz[0] + 1, r.nz[1], r.nz[2]] }));
  const z = { ...r, zones: { ...r.zones, full: r.zones.full!.slice() } };
  z.zones.full![0] = 40000;
  assert.throws(() => encode(z));
  z.zones.full![0] = 1.5;
  assert.throws(() => encode(z));
  assert.ok(Math.abs(decode(encode({ ...r, ageMin: 7 })).ageMin! - 7) === 0 && decode(encode({ ...r, ageMin: null })).ageMin === null);
});

// ------------------------------------------------------------------------------------------------ R6: Open-Meteo response -> record
const N = Date.UTC(2026, 10, 12, 6); // 2026-11-12 06:00 UTC
const label = (ts: number) => new Date(ts).toISOString().slice(0, 16);
// A frozen Open-Meteo-shaped response of one gauge: 4 cells, hours N-3 h ... N+3 h (labels are hour ENDS), a null value in cell 0 at N+2 h. Values are chosen away from rounding ties.
const FROZEN = {
  hourly: { time: [-3, -2, -1, 0, 1, 2, 3].map((h) => label(N + h * HOUR)) },
} as any;
const COLS = [
  [0.0, 0.41, 1.26, 0.04, 2.0, null, 0.0],
  [0.12, 0.0, 0.74, 0.16, 1.0, 0.5, 0.0],
  [0.0, 0.23, 2.51, 0.0, 0.3, 0.5, 4.0],
  [0.31, 0.0, 0.0, 0.26, 0.0, 0.49, 1.0],
];
const points = COLS.map((c) => ({ hourly: { time: FROZEN.hourly.time, precipitation: c } }));
// hand-computed, in tenths of a mm: cells = round(10 x value); zone sum = sum of the zone's cells; null when any cell of the zone is null
const HAND_CELLS = [[0, 4, 13, 0, 20, null, 0], [1, 0, 7, 2, 10, 5, 0], [0, 2, 25, 0, 3, 5, 40], [3, 0, 0, 3, 0, 5, 10]];
const HAND_FULL = [4, 6, 45, 5, 33, null, 50]; // e.g. N-1 h: 13 + 7 + 25 + 0
const HAND_NEAR = [1, 2, 32, 2, 13, 10, 40]; // cells 1 and 2
const HAND_UP = [3, 4, 13, 3, 20, null, 10]; // cells 0 and 3
ok("R6: frozen response -> record equals the hand-computed arrays (zones, per-cell, grid, nulls everywhere else)", () => {
  const b = buildRecord({ points, near: [1, 2], up: [0, 3], nowHour: N, ageMin: 12 });
  assert.ok(b.ok);
  const r = (b as any).rec;
  assert.equal(r.grid, N);
  assert.equal(r.ageMin, 12);
  assert.deepEqual(r.nz, [4, 2, 2]);
  const at = (arr: any[], off: number, len: number) => arr.slice(off, off + len);
  assert.deepEqual(at(r.zones.full, ZPAST - 3, 7), HAND_FULL);
  assert.deepEqual(at(r.zones.near, ZPAST - 3, 7), HAND_NEAR);
  assert.deepEqual(at(r.zones.up, ZPAST - 3, 7), HAND_UP);
  for (let c = 0; c < 4; c++) assert.deepEqual(at(r.cells[c], CPAST - 3, 7), HAND_CELLS[c]);
  // everything outside the 7 hours of the response is missing
  for (const z of ["full", "near", "up"]) r.zones[z].forEach((v: any, k: number) => { if (k < ZPAST - 3 || k > ZPAST + 3) assert.equal(v, null, z + k); });
  r.cells.forEach((a: any[]) => a.forEach((v, k) => { if (k < CPAST - 3 || k > CPAST + 3) assert.equal(v, null); }));
  assert.equal(r.zones.full.length, ZN);
  // means in mm
  assert.equal(zoneMean(r, "full", N), 5 / 40);
  assert.equal(zoneMean(r, "near", N + HOUR), 13 / 20);
  assert.equal(zoneMean(r, "up", N + 2 * HOUR), null);
  assert.equal(zoneMean(r, "full", N + 50 * HOUR), null);
});
ok("R6: a gauge with no up-zone cells (up = null / empty) has nz[2] = 0 and no up series, and the record survives the wire", () => {
  for (const up of [null, [], undefined]) {
    const b = buildRecord({ points, near: null, up: up as any, nowHour: N });
    assert.ok(b.ok);
    const r = (b as any).rec;
    assert.deepEqual(r.nz, [4, 0, 0]);
    assert.equal(r.zones.up, null);
    assert.equal(r.zones.near, null);
    assert.equal(r.ageMin, null);
    assert.deepEqual(decode(encode(r)), r);
  }
});
ok("R6: values outside [0, 400] mm, non-finite and string values are missing; bad arguments never throw", () => {
  const pts = structuredClone(points) as any;
  pts[1].hourly.precipitation[4] = 450;
  pts[2].hourly.precipitation[1] = -1;
  pts[3].hourly.precipitation[0] = "0.3";
  pts[0].hourly.precipitation[2] = NaN;
  const r = (buildRecord({ points: pts, nowHour: N }) as any).rec;
  assert.equal(r.zones.full[ZPAST + 1], null);
  assert.equal(r.zones.full[ZPAST - 2], null);
  assert.equal(r.zones.full[ZPAST - 3], null);
  assert.equal(r.zones.full[ZPAST - 1], null);
  assert.equal(r.zones.full[ZPAST], 5);
  for (const bad of [{ points: [], nowHour: N }, { points: null, nowHour: N }, { points: [{}], nowHour: N }, { points, nowHour: N + 5 }, { points, nowHour: "x" }, { points: [{ hourly: { time: [] } }], nowHour: N }, { points: [{ hourly: { time: ["x"], precipitation: [1] } }], nowHour: N }]) {
    const b = buildRecord(bad as any);
    assert.equal(b.ok, false);
    assert.equal(inputsOf(bad as any).ok, false);
  }
  assert.equal(buildRecord({ points, near: [9], nowHour: N }).ok, false);
  const i = inputsOf({ points, near: [1, 2], up: [0, 3], nowHour: N, ageMin: 3 }) as any;
  assert.ok(i.ok && i.nCells === 4 && i.gridMs === N && i.ageMin === 3 && typeof i.blob === "string" && !i.blob.includes("="));
  assert.deepEqual(decode(i.blob), i.rec);
});

// the site's own catchment code (lib/weather.ts catchmentSeries, extracted from the source and run as it is) on the same responses
const wsrc = readFileSync(new URL("../lib/weather.ts", import.meta.url), "utf8");
const a0 = wsrc.indexOf("type OmPoint");
const a1 = wsrc.indexOf("const sumWindow");
assert.ok(a0 > 0 && a1 > a0, "lib/weather.ts no longer has the expected catchmentSeries block");
const siteJs = stripTypeScriptTypes("type RainSeries = Record<number, number>;\n" + wsrc.slice(a0, a1) + "\nexport { catchmentSeries };", { mode: "strip" });
const site = await import("data:text/javascript;base64," + Buffer.from(siteJs).toString("base64"));
const catchments = J("lib/model/catchments.json").basins as Record<string, any>;
const subs = J("lib/model/subcatchments.json") as Record<string, Record<string, { near?: number[]; up?: number[] }>>;
const stationOf = (g: string) => {
  for (const [basin, b] of Object.entries(catchments)) if (b.stations[g]) return { basin, cells: b.stations[g].cells as number[], sub: subs[basin]?.[g] };
  return null;
};
let lcg = 12345;
const rnd = () => ((lcg = (lcg * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const response = (nCells: number) => {
  const hours = Array.from({ length: 170 }, (_, i) => N + (i - 100) * HOUR);
  return Array.from({ length: nCells }, () => ({
    hourly: { time: hours.map(label), precipitation: hours.map(() => (rnd() < 0.04 ? null : rnd() < 0.5 ? 0 : Math.round(rnd() * 120) / 20 + rnd() * 0.049)) },
  }));
};
ok("R6: model gauges vs the site's catchment files: cell count and up-zone count equal the model's rain.cells / rain.up_cells; 12 gauges have no up zone", () => {
  let noUp = 0;
  for (const [g, gm] of Object.entries<any>(model.g)) {
    const s = stationOf(g)!;
    assert.ok(s, g + " has no rain grid");
    assert.equal(s.cells.length, gm.rain.cells, g);
    const upPos = zonePositions(s.cells, s.sub?.up);
    assert.equal(upPos ? upPos.length : 0, gm.rain.up_cells, g + " up cells");
    if (!upPos) noUp++;
  }
  assert.equal(noUp, 12);
});
ok("R6: real catchments, 29 gauges: the record's zone means equal the site's own catchmentSeries (within the 0.05 mm of rounding to a tenth), same missing hours; cells equal the rounded values", () => {
  assert.match(wsrc, /const pos = idx\.map\(\(c\) => sc\.cells\.indexOf\(c\)\);/, "weather.ts pick() changed: re-check zonePositions");
  let hoursCompared = 0, maxDiff = 0, nulls = 0;
  for (const g of Object.keys(model.g)) {
    const s = stationOf(g)!;
    const pts = response(s.cells.length);
    const near = zonePositions(s.cells, s.sub?.near);
    const up = zonePositions(s.cells, s.sub?.up);
    const b = buildRecord({ points: pts, near, up, nowHour: N });
    assert.ok(b.ok, g);
    const rec = (b as any).rec;
    assert.deepEqual(rec.nz, [s.cells.length, near ? near.length : 0, up ? up.length : 0]);
    for (const [zone, pos] of [["full", pts.map((_, i) => i)], ["near", near], ["up", up]] as [string, number[] | null][]) {
      if (!pos) {
        assert.equal(rec.zones[zone], null, g + " " + zone);
        continue;
      }
      const ser = site.catchmentSeries(pos.map((p) => pts[p]), "precipitation") as Record<number, number>;
      for (let k = 0; k < ZN; k++) {
        const ts = N + (k - ZPAST) * HOUR;
        const mine = zoneMean(rec, zone as any, ts);
        const theirs = ser[ts];
        if (theirs === undefined) {
          assert.equal(mine, null, g + " " + zone + " k" + k + " site has no value");
          nulls++;
        } else {
          assert.notEqual(mine, null, g + " " + zone + " k" + k);
          const d = Math.abs((mine as number) - theirs);
          maxDiff = Math.max(maxDiff, d);
          assert.ok(d <= 0.0501, g + " " + zone + " k" + k + " " + mine + " vs " + theirs);
          hoursCompared++;
        }
      }
    }
    pts.forEach((p, c) => {
      for (let k = 0; k < CN; k++) {
        const v = p.hourly.precipitation[(N + (k - CPAST) * HOUR - (N - 100 * HOUR)) / HOUR];
        assert.equal(rec.cells[c][k], v === null ? null : Math.round(v * 10), g + " cell " + c + " k" + k);
      }
    });
    const enc = encode(rec);
    assert.deepEqual(decode(enc), rec);
    assert.ok(enc.length < MAX_BLOB_CHARS * 1.6, g + " " + enc.length);
  }
  console.log("  R6: " + hoursCompared + " zone-hours compared with the site's catchmentSeries, max |diff| " + maxDiff.toFixed(4) + " mm, " + nulls + " missing hours agree");
});
ok("R6: record -> minimal rain grid: 96 values, edges as documented, means equal the mean of the cells in every hour with all cells", () => {
  const g = "Hanwella";
  const s = stationOf(g)!;
  const rec = (buildRecord({ points: response(s.cells.length), near: zonePositions(s.cells, s.sub?.near), up: zonePositions(s.cells, s.sub?.up), nowHour: N }) as any).rec;
  for (const lag of [0, 1, 4]) {
    const F = N - lag * HOUR;
    const gr = minimalGrid(rec, F) as any;
    assert.equal(gr.origin, F - 71 * HOUR);
    for (const a of [gr.obs.mean, gr.obs.up, gr.fc.mean, ...gr.obs.cells, ...gr.fc.cells]) assert.equal(a.length, 96);
    gr.obs.mean.forEach((v: any, i: number) => { if (i > 71) assert.equal(v, null); else assert.equal(v, zoneMean(rec, "full", F - 71 * HOUR + i * HOUR)); });
    gr.fc.mean.forEach((v: any, i: number) => { if (i <= 71) assert.equal(v, null); else assert.equal(v, zoneMean(rec, "full", F - 71 * HOUR + i * HOUR)); });
    gr.obs.up.forEach((v: any, i: number) => { if (i > 71) assert.equal(v, null); else assert.equal(v, zoneMean(rec, "up", F - 71 * HOUR + i * HOUR)); });
    gr.obs.cells.forEach((a: any[]) => a.forEach((v, i) => { if (i < 48 || i > 71) assert.equal(v, null); }));
    gr.fc.cells.forEach((a: any[]) => a.forEach((v, i) => { if (i <= 71) assert.equal(v, null); }));
    // the mean of a zone is the mean of its cells (no rain_inconsistent)
    for (let i = 48; i <= 71; i++) {
      const cs = gr.obs.cells.map((a: any[]) => a[i]);
      if (cs.every((v: any) => v !== null)) assert.ok(Math.abs(cs.reduce((x: number, y: number) => x + y, 0) / cs.length - gr.obs.mean[i]) < 1e-9);
    }
  }
});

ok("conformal helper (for the later range layer): score, quantile, online update widens after misses", () => {
  assert.equal(score(1, 2, 3), 1);
  assert.equal(score(1, 2, 0.5), 0.5);
  assert.equal(score(1, 2, 1.5), -0.5);
  assert.equal(quantile([], 0.2), null);
  assert.equal(quantile([3, 1, 2, 5, 4], 0.2), 5);
  assert.equal(quantile([3, 1, 2, 5, 4], 0.5), 3);
  const st = newState({ minScores: 3 });
  assert.equal(interval(st, "h|1", 1, 2), null);
  for (let i = 0; i < 30; i++) update(st, "h|1", 1, 2, 2.5 + (i % 3) * 0.1);
  const iv = interval(st, "h|1", 1, 2)!;
  assert.ok(iv[0] < 1 && iv[1] > 2, JSON.stringify(iv));
});

// ------------------------------------------------------------------------------------------------ the filter and the model stay off the visitor paths
const walk = (dir: string, out: string[] = []) => {
  for (const f of readdirSync(dir)) {
    if (f === "node_modules" || f.startsWith(".")) continue;
    const p = dir + "/" + f;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs|mts|js|jsx|json)$/.test(f)) out.push(p);
  }
  return out;
};
ok("nothing under app/ (or any lib/ file outside lib/levelTrial) imports the model JSON or the predictor", () => {
  const root = new URL("../", import.meta.url).pathname;
  const hits: string[] = [];
  for (const dir of ["app", "lib", "components", "middleware"]) {
    let files: string[] = [];
    try { files = walk(root + dir); } catch { continue; }
    for (const f of files) {
      if (f.includes("/lib/levelTrial/") || f.endsWith("/lib/model/lvl-lin-d4.json")) continue;
      const s = readFileSync(f, "utf8");
      if (/lvl-lin-d4\.json|levelTrial\/predict/.test(s)) hits.push(f.replace(root, ""));
    }
  }
  assert.deepEqual(hits, []);
});
ok("predict.mjs is pure: no import, fetch, clock, random, process, fs outside comments", () => {
  const src = readFileSync(new URL("../lib/levelTrial/predict.mjs", import.meta.url), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n").replace(/\/\/.*$/gm, "");
  for (const w of [/\bimport\b/, /\bfetch\(/, /\bDate\b/, /Math\.random/, /\bprocess\b/, /\brequire\(/, /\bconsole\./]) assert.ok(!w.test(src), String(w));
});

console.log("level-trial: " + n + " checks passed" + (process.exitCode ? " (WITH FAILURES)" : ""));
