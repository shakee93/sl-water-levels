// @ts-nocheck (node strip-types test)
// Tests of stage 2 of the level-model hidden trial: the hourly path (lib/weather.ts / lib/forecast.ts side channels, lib/levelTrial/routeInputs.mjs,
// app/api/forecasts/route.ts, scripts/store-forecasts.mjs, scripts/forecast-archive.mjs, lib/forecastScoreboard.mjs).
//   node --experimental-strip-types --no-warnings scripts/forecast-inputs.test.mts
// No network, no D1, no secrets. The BEFORE / AFTER proofs load the committed (HEAD) version of each changed file with `git show HEAD:<path>`,
// run it next to the working-tree version on the same inputs and require deep equality on everything that existed before.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = realpathSync(mkdtempSync(path.join(tmpdir(), "slwl-stage2-")));
process.on("exit", () => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });

let n = 0;
const failures: string[] = [];
const ok = async (name: string, fn: () => unknown) => {
  try {
    await fn();
    n++;
  } catch (e) {
    failures.push(name);
    console.error("FAIL " + name + "\n  " + String((e as Error).message).split("\n").slice(0, 8).join("\n  "));
    process.exitCode = 1;
  }
};
// The BEFORE / AFTER proofs compare this code with the last commit BEFORE the change (108020a8, the commit that only added the pure part). They were
// run when the change was made. A checkout that does not hold that commit (the shallow clone of the Tests workflow) cannot repeat them: there the "old"
// side is the current code, the checks that need a real difference between old and new are skipped and counted, and every check of the new code still
// runs. TRIAL_PROOF_BASE=<commit> picks another base.
const BASE = process.env.TRIAL_PROOF_BASE ?? "108020a8";
let PROOF = true;
try { execFileSync("git", ["cat-file", "-e", `${BASE}^{commit}`], { cwd: ROOT, stdio: "ignore" }); } catch { PROOF = false; }
const oldSource = (rel: string): Buffer => (PROOF ? execFileSync("git", ["show", `${BASE}:${rel}`], { cwd: ROOT, maxBuffer: 64 << 20 }) : readFileSync(path.join(ROOT, rel)));
let skipped = 0;
const proof = async (name: string, fn: () => unknown) => { if (PROOF) return ok(name, fn); skipped++; };

// ------------------------------------------------------------------------------------------------ loader: .ts / extensionless / @/ / json, fakes, git-HEAD copies
// Old (HEAD) copies of the changed modules live in TMP; their relative imports resolve against the ORIGINAL directory, and inside an old module
// `./weather` / `@/lib/forecast` resolve to the old copies too, so old route + old forecast + old weather run as one chain.
const CHANGED = ["lib/weather.ts", "lib/forecast.ts", "app/api/forecasts/route.ts"];
const OLD: Record<string, string> = {};
const ORIG: Record<string, string> = {};
for (const rel of CHANGED) {
  const dst = path.join(TMP, "old-" + rel.replace(/\//g, "_"));
  writeFileSync(dst, oldSource(rel));
  OLD[rel] = dst;
  ORIG[dst] = path.join(ROOT, rel);
}
const FAKE: Record<string, string> = {
  "lib/arcgis.ts": `export const getNational = async () => { globalThis.__FAKE.onNational?.(); return globalThis.__FAKE.national; };
    export const fetchBasinSnapshot = async (b) => globalThis.__FAKE.national.filter((s) => s.basin.trim() === b.trim()).map((s) => ({ ...s, prior: null }));`,
  "lib/stationRain.ts": `export const getForecastRainAll = async () => ({}); export const measuredAtGauge = () => null;`,
  "lib/gsmap.ts": `export const getGsmap = async () => null;`,
  "lib/releases.ts": `export const getReleases = async () => null; export const releaseAffectingFrom = () => [];`,
  "lib/groundRainLive.ts": `export const getGroundGauges = async () => [];`,
};
const BARE: Record<string, string> = {
  react: `export const cache = (f) => f;`,
  "next/server": `export const connection = async () => {}; export const after = () => {};`,
  "next/cache": `export const unstable_cache = (f) => f;`,
};
const dataUrl = (src: string) => "data:text/javascript," + encodeURIComponent(src);
const EXTS = [".ts", ".mjs", ".tsx", ".js"];
registerHooks({
  resolve(spec, ctx, next) {
    if (BARE[spec]) return { url: dataUrl(BARE[spec]), shortCircuit: true };
    const parentPath = ctx.parentURL?.startsWith("file:") ? fileURLToPath(ctx.parentURL) : null;
    let target: string | null = null;
    if (spec.startsWith("@/")) target = path.join(ROOT, spec.slice(2));
    else if ((spec.startsWith("./") || spec.startsWith("../")) && parentPath) target = path.resolve(path.dirname(ORIG[parentPath] ?? parentPath), spec);
    if (!target) return next(spec, ctx);
    if (!path.extname(target) || !existsSync(target)) for (const e of EXTS) if (existsSync(target + e)) { target += e; break; }
    const rel = path.relative(ROOT, target);
    if (FAKE[rel]) return { url: dataUrl(FAKE[rel]), shortCircuit: true };
    if (parentPath && ORIG[parentPath] && OLD[rel]) return { url: pathToFileURL(OLD[rel]).href, shortCircuit: true };
    return next(pathToFileURL(target).href, ctx);
  },
  load(url, ctx, next) {
    if (url.endsWith(".json") && url.startsWith("file:")) return { format: "module", shortCircuit: true, source: "export default " + readFileSync(fileURLToPath(url), "utf8") };
    return next(url, ctx);
  },
});
const fresh = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
const old = (rel: string) => import(pathToFileURL(OLD[rel]).href);

const NEW_WEATHER = await fresh("lib/weather.ts");
const OLD_WEATHER = await old("lib/weather.ts");
const NEW_FC = await fresh("lib/forecast.ts");
const OLD_FC = await old("lib/forecast.ts");
console.log("loaded", Object.keys(NEW_WEATHER).length, Object.keys(NEW_FC).length, Object.keys(OLD_FC).length);

import catchments from "../lib/model/catchments.json" with { type: "json" };
import subcatchments from "../lib/model/subcatchments.json" with { type: "json" };
import { decode, encode, zoneMean, zonePositions, inputsOf, buildRecord, ZPAST, CPAST, HOUR, MAX_BLOB_CHARS } from "../lib/levelTrial/record.mjs";
import { inputsField, ruleFieldsOf, attachTrialFields, nextHourRate, ageMinutes, GUARD_MS } from "../lib/levelTrial/routeInputs.mjs";
import { trialStatements, TRIAL_RETENTION_MS } from "../lib/levelTrial/storeRows.mjs";
import { nextHourRateM } from "../lib/forecastRules.mjs";

const H = HOUR;
const NOW = Date.UTC(2026, 10, 12, 10, 25); // 12 Nov 2026 10:25 UTC -> nowHour 10:00
const NOW_HOUR = Math.floor(NOW / H) * H;
const FETCHED = Date.UTC(2026, 10, 12, 10, 8, 0); // the weather answer's Date header: 17 min before NOW

// ------------------------------------------------------------------------------------------------ a frozen Open-Meteo shaped answer
// hours (ends, UTC labels) from NOW_HOUR - 96 h to + 72 h; value of cell c at hour index i. Some hours are null for one cell, some for every cell.
const T0 = NOW_HOUR - 96 * H;
const NT = 96 + 72 + 1;
const label = (ts: number) => new Date(ts).toISOString().slice(0, 16);
const rawVal = (c: number, i: number): number | null => {
  if (i % 47 === 5) return null; // an hour no cell has
  if (i % 29 === c) return null; // an hour only cell c lacks
  return Math.round(((c * 7 + i * 13) % 31) * 0.037 * 1000) / 1000; // 0 .. 1.11 mm, not on a 0.1 grid
};
const omPoints = (nCells: number, ids: number[]) =>
  ids.slice(0, nCells).map((cell, pos) => ({
    latitude: 7, longitude: 80,
    hourly: { time: Array.from({ length: NT }, (_, i) => label(T0 + i * H)), precipitation: Array.from({ length: NT }, (_, i) => rawVal(pos, i)) },
  }));
const calls: string[] = [];
const realFetch = globalThis.fetch;
let detMode: "ok" | "fail" = "ok";
globalThis.fetch = (async (url: string) => {
  calls.push(String(url));
  const u = String(url);
  if (u.includes("api.open-meteo.com/v1/forecast")) {
    if (detMode === "fail") return new Response(JSON.stringify({ reason: "down" }), { status: 500 });
    const lat = new URL(u).searchParams.get("latitude")!.split(",");
    const body = omPoints(lat.length, lat.map((_, i) => i));
    return new Response(JSON.stringify(lat.length === 1 ? body[0] : body), { status: 200, headers: { date: new Date(FETCHED).toUTCString(), "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ reason: "not in the test" }), { status: 404 });
}) as typeof fetch;
const KELANI = "Kelani Ganga";

await ok("weather: getBasinWeather is unchanged (old HEAD vs now) for a 1-cell gauge, a many-cell gauge and a failed fetch", async () => {
  for (const st of ["Hanwella", "Norwood", "Glencourse"]) {
    const a = await OLD_WEATHER.getBasinWeather(KELANI, st, NOW);
    const b = await NEW_WEATHER.getBasinWeather(KELANI, st, NOW);
    assert.equal(a.ok, true);
    assert.deepEqual(b, a, st);
    assert.deepEqual(Object.keys(b), ["ok", "data"]);
  }
  detMode = "fail";
  try {
    const a = await OLD_WEATHER.getBasinWeather(KELANI, "Hanwella", NOW);
    const b = await NEW_WEATHER.getBasinWeather(KELANI, "Hanwella", NOW);
    assert.equal(a.ok, false);
    assert.deepEqual(b, a);
  } finally { detMode = "ok"; }
});

await ok("weather: the raw per-cell answer is kept beside the BasinWeather, with the response's Date header", async () => {
  const before = calls.length;
  const r = await NEW_WEATHER.getBasinWeather(KELANI, "Hanwella", NOW);
  const detCalls = calls.slice(before).filter((u) => u.includes("api.open-meteo.com/v1/forecast")).length;
  assert.equal(detCalls, 1, "one deterministic request per gauge: the raw answer is the one the forecast already fetched");
  const raw = NEW_WEATHER.rawWeatherOf(r.data);
  assert.equal(raw.points.length, 8);
  assert.deepEqual(raw.cells, catchments.basins[KELANI].stations.Hanwella.cells);
  assert.deepEqual(raw.nearIds, subcatchments[KELANI].Hanwella.near);
  assert.deepEqual(raw.upIds, subcatchments[KELANI].Hanwella.up);
  assert.equal(raw.fetchedMs, FETCHED);
  assert.equal(NEW_WEATHER.rawWeatherOf(null), null);
  assert.equal(NEW_WEATHER.rawWeatherOf({}), null, "an object the module did not build has no raw answer");
  assert.equal(JSON.stringify(r).includes("points"), false, "nothing of it is on the object that is serialised or cached");
});

const wOf = async (st: string) => (await NEW_WEATHER.getBasinWeather(KELANI, st, NOW)).data;
const inputsFor = async (st: string, over: any = {}) => {
  const w = await wOf(st);
  const raw = NEW_WEATHER.rawWeatherOf(w);
  const f = inputsField({ tw: { ok: true, data: w }, raw, nowMs: NOW, startMs: NOW - 1000, ...over });
  return { w, raw, f };
};

await ok("R6 real path: response -> inputs record equals the site's own catchment code (full, near, up) for every hour, Hanwella (8 cells, up zone) and Norwood (1 cell, no up zone)", async () => {
  for (const st of ["Hanwella", "Norwood", "Glencourse"]) {
    const { w, f } = await inputsFor(st);
    assert.equal(f.fmt, 1, st);
    assert.ok(f.blob.length <= MAX_BLOB_CHARS);
    assert.equal(f.gridMs, NOW_HOUR);
    assert.equal(f.ageMin, 17);
    const rec = decode(f.blob);
    assert.equal(rec.grid, NOW_HOUR);
    assert.equal(rec.nz[0], w.cells.det);
    const sub = subcatchments[KELANI][st];
    assert.equal(rec.nz[1], sub.near.length);
    assert.equal(rec.nz[2], sub.up.length);
    const site = { full: w.rain, near: w.nearRain, up: w.upRain };
    let compared = 0, nulls = 0;
    for (const z of ["full", "near", "up"]) {
      if (!site[z]) { assert.equal(rec.zones[z], null, `${st} ${z}: the site has no series, the record has no zone`); continue; }
      for (let k = 0; k < 124; k++) {
        const T = NOW_HOUR + (k - ZPAST) * H;
        const m = zoneMean(rec, z, T);
        const s = site[z][T];
        if (s === undefined) { assert.equal(m, null, `${st} ${z} k=${k}: the site dropped the hour`); nulls++; continue; }
        assert.ok(m !== null, `${st} ${z} k=${k}: the record lost an hour the site has`);
        assert.ok(Math.abs(m - s) <= 0.05 + 1e-9, `${st} ${z} k=${k}: ${m} vs ${s}`); // each cell rounded to 0.1 mm
        compared++;
      }
    }
    assert.ok(compared > 100 && nulls > 5, `${st}: compared ${compared} hours, ${nulls} dropped`);
    // per-cell series of the full zone: hour ending N + (k - 27) h
    assert.equal(rec.cells.length, w.cells.det);
    const pts = NEW_WEATHER.rawWeatherOf(w).points;
    rec.cells.forEach((cs, c) => cs.forEach((v, k) => {
      const i = (NOW_HOUR + (k - CPAST) * H - T0) / H;
      const x = rawVal(c, i);
      assert.equal(v, x == null ? null : Math.round(x * 10), `${st} cell ${c} k=${k}`);
    }));
  }
});

await ok("R6: the zones' hour counts equal a hand count; a gauge with no up cells has no up zone", async () => {
  const { f } = await inputsFor("Hanwella");
  const rec = decode(f.blob);
  // full zone: hour index i is usable when no cell is null there
  const nFull = 8;
  let expected = 0;
  for (let k = 0; k < 124; k++) {
    const i = (NOW_HOUR + (k - 75) * H - T0) / H;
    let all = true;
    for (let c = 0; c < nFull; c++) if (rawVal(c, i) === null) all = false;
    if (all) expected++;
  }
  assert.equal(rec.zones.full.filter((v) => v !== null).length, expected);
  assert.equal(decode((await inputsFor("Norwood")).f.blob).zones.up, null);
  assert.deepEqual(decode((await inputsFor("Norwood")).f.blob).nz, [1, 1, 0]);
});

await ok("R6: a hand-computed record (3 cells, null hours, rounding, out-of-range, one-cell zones)", () => {
  // grid N; 3 cells; hours ending N-2 h .. N+1 h; near = cell 1, up = cells 1 and 2
  const N = NOW_HOUR;
  const times = [-2, -1, 0, 1].map((k) => label(N + k * H));
  const pts = [
    [0.04, 0.05, 1.25, null], // 0.04 -> 0; 0.05 -> 1 (round half up); 1.25 -> 13 (1.25*10 = 12.5 -> 13); null
    [0.0, 2.0, 0.36, 0.1],
    [0.1, 0.0, 450, 0.2], // 450 mm is outside [0, 400]: missing
  ].map((p) => ({ hourly: { time: times, precipitation: p } }));
  const r = buildRecord({ points: pts, near: [1], up: [1, 2], nowHour: N, ageMin: 3 });
  assert.equal(r.ok, true);
  const at = (arr: any[], k: number) => arr[k + 75];
  // full zone, per hour (sum of rounded tenths): -2: 0+0+1 = 1 ; -1: 1+20+0 = 21 ; 0: 13+4+missing -> null ; +1: null
  assert.deepEqual([-2, -1, 0, 1].map((k) => at(r.rec.zones.full, k)), [1, 21, null, null]);
  assert.deepEqual([-2, -1, 0, 1].map((k) => at(r.rec.zones.near, k)), [0, 20, 4, 1]);
  assert.deepEqual([-2, -1, 0, 1].map((k) => at(r.rec.zones.up, k)), [1, 20, null, 3]);
  assert.deepEqual(r.rec.nz, [3, 1, 2]);
  assert.equal(r.rec.ageMin, 3);
  // per-cell series at k = 27 + hour offset
  assert.deepEqual([-2, -1, 0, 1].map((k) => r.rec.cells[0][27 + k]), [0, 1, 13, null]);
  assert.deepEqual([-2, -1, 0, 1].map((k) => r.rec.cells[2][27 + k]), [1, 0, null, 2]);
  assert.equal(r.rec.cells[0][27 + 5], null, "an hour outside the response is missing");
  // same through the route's own function and the codec
  const f = inputsField({ tw: { ok: true, data: { nowHour: N } }, raw: { points: pts, cells: [10, 11, 12], nearIds: [11], upIds: [11, 12], fetchedMs: NOW - 5 * 60_000 }, nowMs: NOW, startMs: NOW });
  assert.equal(f.ageMin, 5);
  assert.deepEqual(decode(f.blob).zones, r.rec.zones);
});

// ------------------------------------------------------------------------------------------------ routeInputs: skips, the deadline guard, a throwing encoder
await ok("inputsField: every skip reason, and the deadline guard is checked first", async () => {
  const { w, raw } = await inputsFor("Hanwella");
  const tw = { ok: true, data: w };
  const base = { tw, raw, nowMs: NOW, startMs: NOW - 1000 };
  assert.equal(inputsField(base).fmt, 1);
  assert.deepEqual(inputsField({ ...base, tw: null }), { skip: "no_grid" });
  assert.deepEqual(inputsField({ ...base, tw: undefined }), { skip: "no_grid" });
  assert.deepEqual(inputsField({ ...base, tw: { ok: false, reason: "x" } }), { skip: "weather" });
  assert.deepEqual(inputsField({ ...base, raw: null }), { skip: "no_points" });
  assert.deepEqual(inputsField({ ...base, raw: { ...raw, points: [] } }), { skip: "no_points" });
  assert.deepEqual(inputsField({ ...base, raw: { ...raw, points: [{}, {}, {}, {}, {}, {}, {}, {}] } }), { skip: "no_times" });
  assert.deepEqual(inputsField({ ...base, tw: { ok: true, data: { nowHour: NOW_HOUR + 5 } } }), { skip: "bad_now_hour" });
  // guard: 35 s of the route's 60 s
  assert.equal(GUARD_MS, 35_000);
  assert.equal(inputsField({ ...base, startMs: NOW - 35_000 }).fmt, 1, "exactly 35 s is still inside");
  assert.deepEqual(inputsField({ ...base, startMs: NOW - 35_001 }), { skip: "deadline" });
  assert.deepEqual(inputsField({ ...base, tw: null, startMs: NOW - 40_000 }), { skip: "deadline" }, "past the guard nothing else is looked at");
  assert.deepEqual(inputsField({ ...base, startMs: NOW - 5_000, guardMs: 4_000 }), { skip: "deadline" });
  // a build that does not return ok
  assert.deepEqual(inputsField({ ...base, build: () => ({ ok: false, skip: "too_large" }) }), { skip: "too_large" });
  assert.deepEqual(inputsField({ ...base, build: () => ({ ok: false }) }), { skip: "error" });
  assert.deepEqual(inputsField({ ...base, build: () => null }), { skip: "error" });
  // weather age
  assert.equal(ageMinutes(NOW - 17 * 60_000, NOW), 17);
  assert.equal(ageMinutes(null, NOW), null);
  assert.equal(ageMinutes(NOW + 5 * 60_000, NOW), null, "a Date header from the future is unknown, not 0");
  assert.equal(ageMinutes(NOW + 20_000, NOW), 0);
  assert.equal(inputsField({ ...base, raw: { ...raw, fetchedMs: null } }).ageMin, null);
});

await ok("attachTrialFields: a throwing encoder still yields the run, nothing that was there changes, rule fields are still attached", async () => {
  const { w, raw } = await inputsFor("Hanwella");
  const run = { station: "Hanwella", issuedAt: 1, horizons: [{ h: 1 }], crossings: [{ threshold: "alert", probability: 0.2 }] };
  const snap = JSON.parse(JSON.stringify(run));
  const list = [run];
  const out = attachTrialFields(run, {
    tw: { ok: true, data: w }, raw, nowMs: NOW, startMs: NOW,
    build: () => { throw new Error("encoder broke"); },
    getRules: () => ({ horizonLimitH: null, experimentalOn: false, steps: [{ threshold: "alert", pModel: 0.31, pModelSeen: 0.31, pShown: 0.3, wordingShown: "possible" }] }),
    getNh: () => ({ rateM: 0.01, word: "rising" }),
  });
  assert.equal(out, run);
  assert.equal(list[0], run);
  assert.deepEqual(run.inputs, { skip: "error" });
  assert.equal(run.ruleFields.steps[0].pModel, 0.31);
  const { inputs, ruleFields, ...rest } = run;
  assert.deepEqual(rest, snap, "every existing field of the run is untouched");
  // rules / nh thunks that throw
  const r2 = attachTrialFields({ station: "X" }, { tw: null, raw: null, getRules: () => { throw new Error("x"); }, nowMs: NOW, startMs: NOW });
  assert.deepEqual(r2, { station: "X", inputs: { skip: "no_grid" } });
  const r3 = attachTrialFields({ station: "X" }, { tw: null, raw: null, getRules: () => ({ steps: [] }), getNh: () => { throw new Error("nh"); }, nowMs: NOW, startMs: NOW });
  assert.equal(r3.ruleFields.nhRateM ?? r3.ruleFields.nhRateMh, null);
  // past the guard: neither field
  const r4 = attachTrialFields({ station: "X" }, { tw: null, raw: null, getRules: () => ({ steps: [] }), nowMs: NOW, startMs: NOW - 60_000 });
  assert.deepEqual(r4, { station: "X", inputs: { skip: "deadline" } });
  // a frozen run (cannot be mutated) must not throw out of the helper
  const frozen = Object.freeze({ station: "F" });
  assert.doesNotThrow(() => attachTrialFields(frozen, { tw: null, raw: null, nowMs: NOW, startMs: NOW }));
});

await ok("ruleFieldsOf / nextHourRate: shapes, nulls, and the same rate rule as the Next hour tile", () => {
  assert.equal(ruleFieldsOf({ rules: null, nh: null }), null);
  assert.equal(ruleFieldsOf({ rules: { steps: "x" }, nh: null }), null);
  const rf = ruleFieldsOf({ rules: { horizonLimitH: 6, experimentalOn: 1, steps: [{ threshold: "minor", pModel: 0.5, pModelSeen: NaN, pShown: 0.3, wordingShown: "possible" }] }, nh: { rateM: 0.02, word: "rising" } });
  assert.deepEqual(rf, { horizonLimitH: 6, experimentalOn: true, nhRateMh: 0.02, nhWord: "rising", steps: [{ threshold: "minor", pModel: 0.5, pModelSeen: null, pShown: 0.3, wordingShown: "possible" }] });
  const f = { horizons: [{ h: 1, level: 5.1 }], currentLevel: 5.0, method: "model", signals: { localRatePerH: 0.2 } };
  assert.equal(nextHourRate({ f, me: { rate3hM: 0.001 }, mpu: 1, tidal: false }), nextHourRateM({ h1ChangeM: 5.1 - 5.0, rate3hM: 0.001, source: undefined, method: "model", rate1hM: null, tidal: false }));
  assert.ok(Math.abs(nextHourRate({ f: { ...f, horizons: [{ h: 1, level: 5.1 }] }, me: null, mpu: 0.3048, tidal: false }) - 0.03048) < 1e-9, "no measured rate: the forecast's 1 h change");
  assert.equal(nextHourRate({ f: { ...f, horizons: [] }, me: null, mpu: 1, tidal: false }), null);
  // the model turns against a measured fall: the measured rate wins (nextHourRateM), exactly what the tile shows
  assert.equal(nextHourRate({ f, me: { rate3hM: -0.05 }, mpu: 1, tidal: false }), -0.05);
});

await ok("trialStatements: valid rows, upsert keeps the first record, malformed values never throw and never reach SQL", async () => {
  const { f } = await inputsFor("Hanwella");
  const run = { station: "Han'well", issuedAt: 1792000000000, inputs: f, ruleFields: { horizonLimitH: null, experimentalOn: false, nhRateMh: 0.004, nhWord: "steady", steps: [{ threshold: "alert", pModel: 0.123456789, pModelSeen: 0.1, pShown: 0.1, wordingShown: "unlikely" }, { threshold: "bogus", pModel: 1 }] } };
  const st = trialStatements(run, NOW);
  assert.equal(st.length, 3, st.join("\n"));
  assert.match(st[0], /^INSERT INTO forecast_inputs \(station, issued_at, fmt, grid_ms, weather_age_min, made_ms, n_cells, blob, skip\) VALUES \('Han''well', 1792000000000, 1, \d+, 17, \d+, 8, '[A-Za-z0-9+\/]+', NULL\) ON CONFLICT\(station, issued_at\) DO UPDATE SET .* WHERE forecast_inputs\.blob IS NULL;$/);
  assert.match(st[1], /INTO forecast_runs_x .*'Han''well', 1792000000000, NULL, 0, 0\.004, 'steady'/);
  assert.match(st[2], /INTO forecast_crossings_x .*'alert', 0\.123456789, 0\.1, 0\.1, 'unlikely'/);
  assert.ok(TRIAL_RETENTION_MS === 400 * 86_400_000);
  // skip rows
  assert.match(trialStatements({ station: "A", issuedAt: 5, inputs: { skip: "weather" } }, NOW)[0], /\(.*'A', 5, 1, NULL, NULL, \d+, NULL, NULL, 'weather'\)/);
  // malformed: all yield at most a skip row with reason "error", or nothing
  const bad = [
    { station: "A", issuedAt: 5, inputs: { blob: 12345 } },
    { station: "A", issuedAt: 5, inputs: { blob: "x'; DROP TABLE forecast_runs; --", gridMs: 1 } },
    { station: "A", issuedAt: 5, inputs: { blob: "A".repeat(MAX_BLOB_CHARS + 1), gridMs: 1 } },
    { station: "A", issuedAt: 5, inputs: { skip: "; DROP TABLE x" } },
    { station: "A", issuedAt: 5, inputs: "string" },
    { station: "A", issuedAt: 5, inputs: null, ruleFields: { steps: [null, 7, { threshold: "alert", pModel: "x", wordingShown: "evil'" }] } },
    { station: "A", issuedAt: 5, ruleFields: "x" },
    { station: "A", issuedAt: 5, ruleFields: { steps: { length: 1 } } },
    { station: "A", issuedAt: "5", inputs: { skip: "weather" } },
    { station: null, issuedAt: 5 }, null, undefined, 5, [],
  ];
  for (const b of bad) {
    let st2: string[] = [];
    assert.doesNotThrow(() => { st2 = trialStatements(b, NOW); }, JSON.stringify(b));
    for (const s of st2) { assert.ok(!/DROP|evil/.test(s), s); assert.ok(!/'x'/.test(s) || true); }
  }
  assert.match(trialStatements(bad[0], NOW)[0], /'error'\)/);
  assert.match(trialStatements(bad[1], NOW)[0], /'error'\)/);
  assert.match(trialStatements(bad[2], NOW)[0], /'error'\)/);
  assert.match(trialStatements(bad[3], NOW)[0], /'error'\)/);
  // a row for a gauge the route never skipped but with no inputs field at all (an older site build): nothing for inputs
  assert.equal(trialStatements({ station: "A", issuedAt: 5 }, NOW).length, 0);
});

// ------------------------------------------------------------------------------------------------ R5: the forecast object is unchanged; the rule fields are right
import coefficients from "../lib/model/coefficients.json" with { type: "json" };
import { UNIT_BY_STATION } from "../lib/units.ts";
import { shownChance } from "../lib/forecastRules.mjs";

const KSTATIONS = ["Hanwella", "Glencourse", "Deraniyagala", "Kithulgala", "Holombuwa", "Norwood", "Nagalagam Street"];
const LATEST = NOW - 10 * 60_000;
type Scn = "rising" | "falling" | "already" | "flat";
const mkStation = (name: string, scn: Scn) => {
  const unit = UNIT_BY_STATION[name] ?? "m";
  const c = (coefficients as any).stations[name];
  const lo = c?.levelMin ?? 1, hi = c?.levelMax ?? 3;
  const span = hi - lo;
  const base = lo + 0.45 * span;
  const rate = scn === "rising" ? 0.03 * span : scn === "falling" ? -0.03 * span : scn === "already" ? 0.01 * span : 0;
  const trend24h = Array.from({ length: 25 }, (_, i) => ({ ts: LATEST - (24 - i) * H, water_level: Math.round((base + rate * (i - 24) + (i % 3) * 0.002 * span) * 1000) / 1000, rain_fall: i % 5 === 0 ? 0.4 : 0 }));
  const L = trend24h[24].water_level;
  const mpu = unit === "m" ? 1 : 0.3048;
  const thresholds = scn === "already" ? { alert: L - 0.05 * span, minor: L + 0.12 * span, major: L + 0.4 * span } : { alert: L + 0.1 * span, minor: L + 0.3 * span, major: L + 0.6 * span };
  return {
    station: name, basin: "Kelani Ganga  ", latitude: 7, longitude: 80, href: "", basinHref: "", unit, metresPerUnit: mpu, thresholds,
    latest: trend24h[24], ageMin: 10, tier: "normal", levelTier: "normal",
    rate1h: rate, rate3h: rate * 3, rate1hM: rate * mpu, rate3hM: (rate * 3 * mpu) / 3, rain6h: 0.4, trend24h, prior: trend24h[21],
  };
};
const snapshotOf = (scn: Scn) => KSTATIONS.map((s) => mkStation(s, scn));

await ok("R5: makeForecast is unchanged (HEAD vs now, deep equality on the whole object) for 7 Kelani gauges x 4 river states x weather ok / failed", async () => {
  let compared = 0, models = 0;
  for (const scn of ["rising", "falling", "already", "flat"] as Scn[]) {
    for (const weatherOk of [true, false]) {
      for (const st of KSTATIONS) {
        const snapshot = snapshotOf(scn);
        const weather = weatherOk ? await NEW_WEATHER.getBasinWeather("Kelani Ganga", st, NOW) : { ok: false, reason: "down" };
        const input = { basin: "Kelani Ganga", snapshot, station: st, weather, glofas: null, gsmap: null, ground: null, now: NOW };
        const a = OLD_FC.makeForecast({ ...input, snapshot: structuredClone(snapshot) });
        const b = NEW_FC.makeForecast({ ...input, snapshot: structuredClone(snapshot) });
        assert.deepEqual(b, a, `${st} ${scn} weather ${weatherOk}`);
        assert.deepEqual(Object.keys(b), Object.keys(a));
        compared++;
        if (b.method === "model") models++;
      }
    }
  }
  assert.equal(compared, 56);
  assert.ok(models >= 30, `model forecasts compared: ${models}`);
});

await ok("rule fields: pShown / wordingShown are exactly the shown crossings, pModel the unrounded chance behind rawCrossings, fast gauges cut", async () => {
  let steps = 0, limited = 0, already = 0, differ = 0;
  for (const scn of ["rising", "falling", "already", "flat"] as Scn[]) {
    for (const st of KSTATIONS) {
      const snapshot = snapshotOf(scn);
      const weather = await NEW_WEATHER.getBasinWeather("Kelani Ganga", st, NOW);
      const f = NEW_FC.makeForecast({ basin: "Kelani Ganga", snapshot, station: st, weather, glofas: null, gsmap: null, ground: null, now: NOW });
      const rf = NEW_FC.ruleFieldsOf(f);
      if (f.method !== "model") { assert.equal(rf, null, `${st}: no rule fields on a trend-only / empty forecast`); continue; }
      assert.ok(rf, st);
      assert.equal(rf.horizonLimitH, f.horizonLimitH ?? null);
      assert.equal(rf.experimentalOn, f.experimental);
      assert.equal(rf.steps.length, f.crossings.length);
      rf.steps.forEach((s, i) => {
        const c = f.crossings[i], raw = f.rawCrossings[i];
        assert.equal(s.threshold, c.threshold);
        assert.equal(s.pShown, c.probability, `${st} ${c.threshold}: pShown is the number the page prints`);
        assert.equal(s.wordingShown, c.wording);
        assert.ok(s.pModelSeen <= s.pModel + 1e-12, "the shown horizons are a subset of the fitted ones");
        if (c.wording === "already") { assert.deepEqual([s.pModel, s.pModelSeen, s.pShown], [1, 1, 1]); already++; }
        else {
          // rawCrossings.probability = r5(min(ceiling, pModel)): pModel is the unrounded figure behind it
          const r5 = (p: number) => Math.round(p * 20) / 20;
          assert.equal(raw.probability, r5(f.experimental ? Math.min(NEW_FC.MAX_PROB_EXPERIMENTAL, s.pModel) : s.pModel), `${st} ${c.threshold}`);
          assert.equal(c.probability, r5(shownChance(c.threshold, r5(f.experimental ? Math.min(NEW_FC.MAX_PROB_EXPERIMENTAL, s.pModelSeen) : s.pModelSeen))), `${st} ${c.threshold} shown`);
          if (s.pModelSeen !== s.pModel) differ++;
        }
        assert.ok(s.pModel >= 0 && s.pModel <= 1 && Number.isFinite(s.pModel));
        steps++;
      });
      if (rf.horizonLimitH != null) limited++;
    }
  }
  assert.ok(steps >= 60 && limited >= 4 && already >= 3, `steps ${steps}, limited-horizon runs ${limited}, already ${already}`);
  assert.ok(differ >= 1, "at least one fast gauge step where the cut changes the chance");
});

await ok("side channels: a forecast carries its weather answer and rule fields beside it, through the copies makeForecast makes", async () => {
  const snapshot = snapshotOf("rising");
  const weather = await NEW_WEATHER.getBasinWeather("Kelani Ganga", "Hanwella", NOW);
  const f = NEW_FC.makeForecast({ basin: "Kelani Ganga", snapshot, station: "Hanwella", weather, glofas: null, gsmap: null, ground: null, now: NOW });
  assert.equal(NEW_FC.trialWeatherOf(f), undefined, "built by makeForecast directly: not from loadForecast");
  assert.ok(NEW_FC.ruleFieldsOf(f));
  assert.equal(JSON.stringify(f).includes("pModel"), false, "nothing on the object itself");
  // the two copies makeForecast makes (own latest looks like a glitch -> notes; measured heavy rain -> rainRisk) keep the entry
  const odd = structuredClone(snapshot);
  const h = odd[0].trend24h;
  h[24] = { ...h[24], water_level: h[23].water_level + 6 * ((coefficients as any).stations.Hanwella.levelMax - (coefficients as any).stations.Hanwella.levelMin) };
  odd[0].latest = h[24];
  const f2 = NEW_FC.makeForecast({ basin: "Kelani Ganga", snapshot: odd, station: "Hanwella", weather, glofas: null, gsmap: null, ground: null, now: NOW });
  assert.ok(f2.notes.some((x: string) => /sensor glitch/.test(x)), "the glitch note path ran");
  assert.ok(NEW_FC.ruleFieldsOf(f2), "the notes copy keeps the rule fields");
  assert.deepEqual(NEW_FC.ruleFieldsOf(f2), NEW_FC.ruleFieldsOf(f2));
  // loadForecast: a no-forecast gauge fetches no weather (null); a gauge with a grid carries the answer
  const calls0 = calls.length;
  const nf = await NEW_FC.loadForecast("Kelani Ganga", [mkStation("Ampara", "flat")].map((s) => ({ ...s, basin: "Kelani Ganga" })), "Ampara");
  assert.equal(NEW_FC.trialWeatherOf(nf), null);
  assert.equal(calls.length, calls0, "no fetch for a gauge that shows no forecast");
  const lf = await NEW_FC.loadForecast("Kelani Ganga", snapshotOf("rising"), "Norwood");
  const tw = NEW_FC.trialWeatherOf(lf);
  assert.equal(tw.ok, true);
  assert.equal(NEW_WEATHER.rawWeatherOf(tw.data).points.length, 1);
});


// ------------------------------------------------------------------------------------------------ R5: the route (HEAD vs now) with the real forecast chain and a faked data layer
const NEW_ROUTE = await fresh("app/api/forecasts/route.ts");
const OLD_ROUTE = await old("app/api/forecasts/route.ts");
const realNow = Date.now;
let jump = 0;
(Date as any).now = () => NOW + jump;
globalThis.__FAKE = { national: [...snapshotOf("rising"), mkStation("Ampara", "flat")].map(({ prior, ...s }) => s), onNational: () => { jump = pendingJump; } };
let pendingJump = 0;
const getRoute = async (mod: any, query: string) => {
  jump = 0;
  const res = await mod.GET(new Request("http://localhost/api/forecasts" + query));
  const j = await res.json();
  jump = 0;
  return j;
};
const strip = (r: any) => { const { inputs, ruleFields, ...rest } = r; return rest; };

await ok("R5 route: the default payload is byte for byte what it was (HEAD vs now); no new key without ?shadow=1", async () => {
  const a = await getRoute(OLD_ROUTE, "");
  const b = await getRoute(NEW_ROUTE, "");
  assert.ok(a.runs.length >= 7, `runs: ${a.runs.length}, errors: ${JSON.stringify(a.errors).slice(0, 200)}`);
  assert.equal(JSON.stringify(b), JSON.stringify(a));
  assert.ok(b.runs.every((r: any) => !("inputs" in r) && !("ruleFields" in r)));
});

await proof("R5 route: with ?shadow=1 every existing field of every run is unchanged and the new fields are only added (inputs on every run, rule fields on model runs)", async () => {
  const a = await getRoute(OLD_ROUTE, "?shadow=1");
  const b = await getRoute(NEW_ROUTE, "?shadow=1");
  assert.equal(b.runs.length, a.runs.length);
  assert.deepEqual(b.errors, a.errors);
  assert.deepEqual({ ...b, runs: undefined }, { ...a, runs: undefined });
  const keysNew = new Set<string>();
  b.runs.forEach((r: any, i: number) => {
    assert.deepEqual(strip(r), a.runs[i], r.station);
    assert.deepEqual(Object.keys(r).filter((k) => !(k in a.runs[i])).sort(), "ruleFields" in r ? ["inputs", "ruleFields"] : ["inputs"], r.station);
    Object.keys(r).forEach((k) => keysNew.add(k));
  });
  const by = Object.fromEntries(b.runs.map((r: any) => [r.station, r]));
  assert.equal(by.Hanwella.inputs.fmt, 1);
  assert.equal(by.Hanwella.inputs.gridMs, NOW_HOUR);
  assert.equal(by.Hanwella.inputs.ageMin, 17);
  assert.equal(by.Hanwella.inputs.nCells, 8);
  const rec = decode(by.Hanwella.inputs.blob);
  assert.equal(rec.grid, NOW_HOUR);
  assert.equal(by.Norwood.inputs.nCells, 1);
  assert.deepEqual(by.Ampara.inputs, { skip: "no_grid" });
  assert.equal("ruleFields" in by.Ampara, false, "a no-forecast gauge has no rule fields");
  assert.ok(by.Hanwella.ruleFields.steps.length === 3);
  assert.equal(by.Hanwella.ruleFields.nhWord, ["rising", "falling", "steady"].find((w) => w === by.Hanwella.ruleFields.nhWord));
  assert.equal(typeof by.Hanwella.ruleFields.nhRateMh, "number");
  assert.equal(by.Kithulgala.ruleFields.horizonLimitH, 6, "a fast gauge");
  assert.equal(by.Hanwella.ruleFields.horizonLimitH, null);
  // the route's decoded record is the series it was built from: same hours as the site's own catchment mean for the gauge
  const w = (await NEW_WEATHER.getBasinWeather("Kelani Ganga", "Hanwella", NOW)).data;
  for (let k = 0; k < 124; k++) {
    const T = NOW_HOUR + (k - 75) * H;
    const m = zoneMean(rec, "full", T);
    if (w.rain[T] === undefined) assert.equal(m, null); else assert.ok(Math.abs(m - w.rain[T]) <= 0.05 + 1e-9);
  }
  // payload size: the extra bytes of the shadow payload
  const extra = JSON.stringify(b).length - JSON.stringify(a).length;
  assert.ok(extra > 0 && extra < b.runs.length * 4200, `extra payload ${extra} bytes for ${b.runs.length} runs`);
});

await proof("R5 route: past the 35 s guard every run is still returned, unchanged, with inputs { skip: deadline } and no rule fields", async () => {
  pendingJump = 40_000;
  try {
    jump = 0;
    const mk = async (mod: any) => { const res = await mod.GET(new Request("http://localhost/api/forecasts?shadow=1")); const j = await res.json(); jump = 0; return j; };
    const a = await mk(OLD_ROUTE);
    const b = await mk(NEW_ROUTE);
    assert.ok(a.runs.length >= 7);
    assert.equal(b.runs.length, a.runs.length);
    b.runs.forEach((r: any, i: number) => {
      assert.deepEqual(strip(r), a.runs[i]);
      assert.deepEqual(r.inputs, { skip: "deadline" });
      assert.equal("ruleFields" in r, false);
    });
  } finally { pendingJump = 0; jump = 0; }
});

await ok("route source: the trial block is after runs.push(run), behind withShadow, in its own try/catch, on the Node runtime", () => {
  const src = readFileSync(path.join(ROOT, "app/api/forecasts/route.ts"), "utf8");
  const iPush = src.indexOf("runs.push(run);");
  const iAttach = src.indexOf("attachTrialFields(run");
  assert.ok(iPush > 0 && iAttach > iPush, "attached after the run is in the list");
  const block = src.slice(iPush, iAttach);
  assert.match(block, /if \(withShadow\) \{[\s\S]*try \{/);
  assert.match(src, /export const runtime = "nodejs"/);
  assert.match(src, /const startMs = Date\.now\(\)/);
});


// ------------------------------------------------------------------------------------------------ the store job (HEAD vs now), the SQL itself run on a real SQLite
import { splitSql } from "../lib/d1Sql.mjs";
import { DatabaseSync } from "node:sqlite";

const OLD_STORE = path.join(TMP, "old-store-forecasts.mjs");
writeFileSync(OLD_STORE, oldSource("scripts/store-forecasts.mjs").toString()
  .replace('"../lib/d1Sql.mjs"', JSON.stringify(path.join(ROOT, "lib/d1Sql.mjs")))
  .replace('"../lib/levelTrial/storeRows.mjs"', JSON.stringify(path.join(ROOT, "lib/levelTrial/storeRows.mjs")))
  .replace(/new URL\("\.\.\/d1\//g, `new URL("file://${ROOT}/d1/`));
const shadowPayload = await getRoute(NEW_ROUTE, "?shadow=1");
const PLAIN = await getRoute(NEW_ROUTE, "");
const FEED_NOW = realNow(); // fixed for the whole run, so the same payload always lands on the same issued_at
const asFile = (payload: any, name: string) => {
  // the job refuses a feed whose newest run is over 3 h old (real clock): move the whole payload to now
  const d = FEED_NOW - 600_000 - NOW + 600_000;
  const p = structuredClone(payload);
  p.generatedAt = FEED_NOW;
  for (const r of p.runs) { r.issuedAt += d; for (const o of r.observations ?? []) o.ts += d; }
  const f = path.join(TMP, name);
  writeFileSync(f, JSON.stringify(p));
  return { file: f, payload: p };
};
const runStore = (script: string, file: string, tag: string) => {
  const out = path.join(TMP, `${tag}.sql`);
  const r = spawnSync(process.execPath, [script, file, out], { encoding: "utf8" });
  return { status: r.status, stderr: r.stderr, stdout: r.stdout, live: readFileSync(out, "utf8"), shadow: readFileSync(out + ".shadow.sql", "utf8") };
};
const OLD_STORE_REL = OLD_STORE;
const NEW_STORE = path.join(ROOT, "scripts/store-forecasts.mjs");

await proof("store job: the live SQL file is byte for byte unchanged by the new fields; the shadow file only gains rows at its end", () => {
  const { file } = asFile(shadowPayload, "feed-shadow.json");
  const o = runStore(OLD_STORE_REL, file, "old-shadow"), nw = runStore(NEW_STORE, file, "new-shadow");
  assert.equal(o.status, 0, o.stderr);
  assert.equal(nw.status, 0, nw.stderr);
  assert.equal(nw.live, o.live, "live SQL identical");
  assert.ok(o.live.length > 1000);
  assert.ok(nw.shadow.startsWith(o.shadow), "everything the old shadow file had comes first, unchanged");
  const tail = nw.shadow.slice(o.shadow.length);
  const stmts = splitSql(tail);
  assert.equal(stmts.filter((s) => /^CREATE (TABLE|INDEX) IF NOT EXISTS/.test(s)).length, 6, "forecast_inputs, forecast_crossings_x, forecast_runs_x + 3 indexes");
  assert.equal(stmts.filter((s) => /^INSERT INTO forecast_inputs/.test(s)).length, shadowPayload.runs.length, "one inputs row per run");
  assert.equal(stmts.filter((s) => /^INSERT OR IGNORE INTO forecast_runs_x/.test(s)).length, shadowPayload.runs.filter((r: any) => r.ruleFields).length);
  assert.ok(stmts.filter((s) => /^INSERT OR IGNORE INTO forecast_crossings_x/.test(s)).length >= 15);
  assert.match(stmts[stmts.length - 1], /^DELETE FROM forecast_inputs WHERE issued_at < \d+$/);
  assert.match(nw.stdout, /trial rows: \d+/);
  // the order of the tail: DDL first, then rows, the retention delete last
  const firstInsert = stmts.findIndex((s) => /^INSERT/.test(s));
  assert.ok(stmts.slice(0, firstInsert).every((s) => /^CREATE/.test(s)));
});

await ok("store job: a feed without the new fields (the site before this change) gives byte-identical live AND shadow files", () => {
  const plain = PLAIN;
  const { file } = asFile(plain, "feed-plain.json");
  const o = runStore(OLD_STORE_REL, file, "old-plain"), nw = runStore(NEW_STORE, file, "new-plain");
  assert.equal(nw.live, o.live);
  assert.equal(nw.shadow, o.shadow);
  assert.doesNotMatch(nw.stdout, /trial rows: [1-9]/);
  // a shadow feed with the fields stripped is the same
  const stripped = structuredClone(shadowPayload);
  stripped.runs = stripped.runs.map(strip);
  const { file: f2 } = asFile(stripped, "feed-stripped.json");
  assert.equal(runStore(NEW_STORE, f2, "new-stripped").shadow, runStore(OLD_STORE_REL, f2, "old-stripped").shadow);
});

await ok("store job: malformed inputs / rule fields never stop the live file; bad ones become skip rows or nothing", () => {
  const p = structuredClone(shadowPayload);
  const R = p.runs;
  R[0].inputs = { blob: 12345 };
  R[0].ruleFields = "x";
  R[1].inputs = 5;
  R[1].ruleFields = { steps: null, horizonLimitH: "six", nhRateMh: "fast" };
  R[2].inputs = { blob: "'; DROP TABLE forecast_runs; --", gridMs: 1 };
  R[2].ruleFields = { steps: [null, 1, "x", { threshold: "alert", pModel: {}, pShown: [], wordingShown: 7 }] };
  R[3].inputs = { skip: "not a known reason" };
  R[4].inputs = [];
  R[4].ruleFields = [];
  delete R[5].inputs;
  const { file } = asFile(p, "feed-bad.json");
  const nw = runStore(NEW_STORE, file, "new-bad");
  const o = runStore(OLD_STORE_REL, file, "old-bad");
  assert.equal(nw.status, 0, nw.stderr);
  assert.equal(nw.live, o.live, "live SQL still identical");
  assert.ok(nw.shadow.startsWith(o.shadow));
  assert.ok(!/DROP TABLE/.test(nw.shadow.slice(o.shadow.length)), "no raw text reaches SQL");
  // all of it is valid SQL, in a real SQLite, after the old shadow DDL
  const db = new DatabaseSync(":memory:");
  for (const s of splitSql(nw.shadow)) db.exec(s);
  const inputs = db.prepare("SELECT station, blob IS NULL AS nb, skip FROM forecast_inputs ORDER BY station").all();
  assert.equal(inputs.length, shadowPayload.runs.length - 2, "a run without an inputs field, and one whose inputs is not an object, have no row");
  assert.ok(inputs.filter((r: any) => r.nb).every((r: any) => ["error", "no_grid"].includes(r.skip)), JSON.stringify(inputs.filter((r: any) => r.nb)));
});

await ok("store SQL on a real SQLite: tables, first logged record wins, a skip is upgraded, rule rows, retention delete", () => {
  const { file, payload } = asFile(shadowPayload, "feed-sql.json");
  const out = runStore(NEW_STORE, file, "new-sql");
  const db = new DatabaseSync(":memory:");
  for (const s of splitSql(out.shadow)) db.exec(s);
  const q1 = (sql: string, ...a: any[]) => db.prepare(sql).all(...a);
  const han = payload.runs.find((r: any) => r.station === "Hanwella");
  const row = q1("SELECT * FROM forecast_inputs WHERE station = 'Hanwella'")[0] as any;
  assert.equal(row.issued_at, han.issuedAt);
  assert.equal(row.fmt, 1);
  assert.equal(row.blob, han.inputs.blob);
  assert.equal(row.grid_ms, NOW_HOUR);
  assert.equal(row.weather_age_min, 17);
  assert.equal(row.n_cells, 8);
  assert.equal(row.skip, null);
  assert.equal(decode(row.blob).grid, NOW_HOUR);
  // the same run again with a different blob: the first record stays
  const again = structuredClone(shadowPayload); again.runs.find((r: any) => r.station === "Hanwella").inputs.blob = "AAAA";
  const { file: f2 } = asFile(again, "feed-sql2.json");
  for (const s of splitSql(runStore(NEW_STORE, f2, "new-sql2").shadow)) db.exec(s);
  assert.equal((q1("SELECT blob FROM forecast_inputs WHERE station = 'Hanwella'")[0] as any).blob, han.inputs.blob);
  // a skip row is upgraded by a later logged record, never the other way round
  const amp = q1("SELECT skip, blob FROM forecast_inputs WHERE station = 'Ampara'")[0] as any;
  assert.equal(amp.skip, "no_grid");
  assert.equal(amp.blob, null);
  const up = structuredClone(shadowPayload); const ar = up.runs.find((r: any) => r.station === "Ampara"); ar.inputs = structuredClone(shadowPayload.runs.find((r: any) => r.station === "Norwood").inputs);
  const { file: f3 } = asFile(up, "feed-sql3.json");
  for (const s of splitSql(runStore(NEW_STORE, f3, "new-sql3").shadow)) db.exec(s);
  const amp2 = q1("SELECT skip, blob FROM forecast_inputs WHERE station = 'Ampara'")[0] as any;
  assert.equal(amp2.skip, null, "upgraded");
  assert.ok(amp2.blob);
  // rule rows
  const rx = q1("SELECT * FROM forecast_runs_x WHERE station = 'Kithulgala'")[0] as any;
  assert.equal(rx.horizon_limit_h, 6);
  assert.equal(rx.experimental_on, han.ruleFields.experimentalOn ? 1 : 0);
  const cx = q1("SELECT * FROM forecast_crossings_x WHERE station = 'Hanwella' ORDER BY threshold") as any[];
  assert.deepEqual(cx.map((c) => c.threshold), ["alert", "major", "minor"]);
  const hs = Object.fromEntries(han.ruleFields.steps.map((s: any) => [s.threshold, s]));
  for (const c of cx) { assert.equal(c.p_model, hs[c.threshold].pModel); assert.equal(c.p_shown, hs[c.threshold].pShown); assert.equal(c.wording_shown, hs[c.threshold].wordingShown); }
  // retention: rows older than 400 days go, younger ones stay
  db.exec(`INSERT INTO forecast_inputs (station, issued_at, fmt, made_ms) VALUES ('Old', ${realNow() - 401 * 86_400_000}, 1, 1)`);
  db.exec(`INSERT INTO forecast_inputs (station, issued_at, fmt, made_ms) VALUES ('Kept', ${realNow() - 399 * 86_400_000}, 1, 1)`);
  for (const s of splitSql(out.shadow)) db.exec(s);
  assert.equal(q1("SELECT COUNT(*) AS n FROM forecast_inputs WHERE station = 'Old'")[0].n, 0);
  assert.equal(q1("SELECT COUNT(*) AS n FROM forecast_inputs WHERE station = 'Kept'")[0].n, 1);
  assert.ok((q1("SELECT COUNT(*) AS n FROM forecast_inputs")[0] as any).n >= 8);
});


// ------------------------------------------------------------------------------------------------ the archive (HEAD vs now) on a real SQLite behind a fake D1 HTTP endpoint
import { buildArchiveLines, colomboDay } from "../lib/forecastScoreboard.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);

const OLD_SB = path.join(TMP, "old-forecastScoreboard.mjs");
writeFileSync(OLD_SB, oldSource("lib/forecastScoreboard.mjs").toString().replace('"./forecastRules.mjs"', JSON.stringify(path.join(ROOT, "lib/forecastRules.mjs"))));
const OLD_ARCHIVE = path.join(TMP, "old-forecast-archive.mjs");
writeFileSync(OLD_ARCHIVE, oldSource("scripts/forecast-archive.mjs").toString()
  .replace('"../lib/d1Sql.mjs"', JSON.stringify(path.join(ROOT, "lib/d1Sql.mjs")))
  .replace('"../lib/forecastScoreboard.mjs"', JSON.stringify(OLD_SB)));
const NEW_ARCHIVE = path.join(ROOT, "scripts/forecast-archive.mjs");

const feed = asFile(shadowPayload, "feed-archive.json");
const DAY = colomboDay(Math.min(...feed.payload.runs.map((r: any) => r.issuedAt)));
assert.equal(DAY, colomboDay(Math.max(...feed.payload.runs.map((r: any) => r.issuedAt))), "the fixture's runs are on one Colombo day (rerun the test if it was started within 10 minutes of Colombo midnight)");
const storeOut = runStore(NEW_STORE, feed.file, "arch-new");
const oldShadow = runStore(OLD_STORE_REL, feed.file, "arch-old").shadow;
const mkDb = (shadowSql: string) => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(path.join(ROOT, "d1/0001_init.sql"), "utf8"));
  for (const s of splitSql(readFileSync(path.join(ROOT, "d1/0009_forecast_rain.sql"), "utf8"))) db.exec(s);
  for (const s of splitSql(storeOut.live)) db.exec(s);
  for (const s of splitSql(shadowSql)) db.exec(s);
  return db;
};
const serve = async (db: any) => {
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d)).on("end", () => {
      const j = body ? JSON.parse(body) : {};
      const send = (code: number, o: any) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.url!.includes("/d1/database?name=")) return send(200, { success: true, result: [{ uuid: "db1", name: "sl-water-levels" }] });
      try { send(200, { success: true, result: [{ results: db.prepare(j.sql).all(...(j.params ?? [])) }] }); }
      catch (e) { send(400, { success: false, errors: [{ code: 7500, message: String((e as Error).message) }] }); }
    });
  });
  await new Promise<void>((r) => srv.listen(0, r));
  return srv;
};
const archive = async (script: string, db: any, tag: string) => {
  const srv = await serve(db);
  const dir = path.join(TMP, "arch-" + tag);
  mkdirSync(dir, { recursive: true });
  try {
    const r = await execFileP(process.execPath, [script, dir, "--day", DAY], { env: { ...process.env, CF_API_BASE: `http://127.0.0.1:${(srv.address() as any).port}`, CLOUDFLARE_API_TOKEN: "t" }, encoding: "utf8" });
    const f = path.join(dir, "forecasts", DAY.slice(0, 4));
    return { stdout: r.stdout, jsonl: readFileSync(path.join(f, `${DAY}.jsonl`), "utf8"), readings: readFileSync(path.join(f, `${DAY}.readings.json`), "utf8") };
  } finally { srv.close(); }
};

await ok("archive: with the new tables absent, or present and empty, the day file is byte for byte what the old script wrote; a failed read never fails it", async () => {
  const absent = mkDb(oldShadow); // no forecast_crossings_x / forecast_runs_x: the read is a 400 "no such table"
  const o = await archive(OLD_ARCHIVE, absent, "old");
  const a = await archive(NEW_ARCHIVE, absent, "new-absent");
  assert.ok(o.jsonl.split("\n").filter(Boolean).length >= 8, "the day has runs");
  assert.equal(a.jsonl, o.jsonl);
  assert.equal(a.readings, o.readings);
  assert.equal(a.stdout.replace("arch-new-absent", "arch-old"), o.stdout);
  // tables there, no rows (a site build that sends the fields but the day has none)
  const emptyShadow = splitSql(storeOut.shadow).filter((x) => !/^INSERT OR IGNORE INTO forecast_(crossings|runs)_x/.test(x)).map((x) => x + ";").join("\n");
  const empty = mkDb(emptyShadow);
  assert.equal(empty.prepare("SELECT COUNT(*) AS n FROM forecast_crossings_x").get().n, 0);
  const e = await archive(NEW_ARCHIVE, empty, "new-empty");
  assert.equal(e.jsonl, o.jsonl);
  assert.equal(e.readings, o.readings);
});

await ok("archive: with rows, only the rule fields are added (to the steps and the runs that have a row); everything else is as before", async () => {
  const o = await archive(OLD_ARCHIVE, mkDb(oldShadow), "old2");
  const full = mkDb(storeOut.shadow);
  const x = await archive(NEW_ARCHIVE, full, "new-full");
  assert.equal(x.readings, o.readings);
  const A = o.jsonl.split("\n").filter(Boolean).map((l) => JSON.parse(l)), B = x.jsonl.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(B.length, A.length);
  let withRun = 0, withStep = 0;
  B.forEach((l, i) => {
    const { horizon_limit_h, experimental_on, nh_rate_m_h, nh_word, ...rest } = l;
    if ("horizon_limit_h" in l) { withRun++; assert.deepEqual(Object.keys(l).filter((k) => /^(horizon_limit_h|experimental_on|nh_rate_m_h|nh_word)$/.test(k)), ["horizon_limit_h", "experimental_on", "nh_rate_m_h", "nh_word"]); }
    rest.crossings = rest.crossings.map((c: any) => { if ("p_model" in c) { withStep++; const { p_model, p_model_seen, p_shown, wording_shown, ...r } = c; return r; } return c; });
    assert.deepEqual(rest, A[i], l.station);
  });
  assert.ok(withRun >= 6 && withStep >= 18, `runs with fields ${withRun}, steps ${withStep}`);
  const han = B.find((l) => l.station === "Hanwella");
  const sent = feed.payload.runs.find((r: any) => r.station === "Hanwella").ruleFields;
  assert.equal(han.horizon_limit_h, null);
  assert.equal(han.nh_word, sent.nhWord);
  for (const c of han.crossings) {
    const st = sent.steps.find((s: any) => s.threshold === c.threshold);
    assert.equal(c.p_model, st.pModel, "the unrounded chance, not rounded again");
    assert.equal(c.p_model_seen, st.pModelSeen);
    assert.equal(c.p_shown, st.pShown);
    assert.equal(c.wording_shown, st.wordingShown);
    assert.equal(c.probability, A.find((l: any) => l.station === "Hanwella").crossings.find((k: any) => k.threshold === c.threshold).probability, "probability is still the model's own 5% chance");
  }
  assert.equal(B.find((l) => l.station === "Kithulgala").horizon_limit_h, 6);
});

await ok("buildArchiveLines: crossingsX / runsX null, [] or without a matching row leave the lines identical; a matching row adds exactly its fields", () => {
  const runs = [{ id: 1, station: "S", basin: "B", issued_at: 5 * H, method: "model", status: "ok", model_version: "v", unit: "m", current_level: 1, tier: "normal", verdict: "normal", storm: 0 }];
  const crossings = [{ run_id: 1, threshold: "alert", level: 2, probability: 0.2 }, { run_id: 1, threshold: "minor", level: 3, probability: 0.05 }];
  const base = buildArchiveLines({ runs, points: [], crossings, obs: {} });
  assert.equal(JSON.stringify(buildArchiveLines({ runs, points: [], crossings, obs: {}, crossingsX: null, runsX: null })), JSON.stringify(base));
  assert.equal(JSON.stringify(buildArchiveLines({ runs, points: [], crossings, obs: {}, crossingsX: [], runsX: [] })), JSON.stringify(base));
  assert.equal(JSON.stringify(buildArchiveLines({ runs, points: [], crossings, obs: {}, crossingsX: [{ station: "OTHER", issued_at: 5 * H, threshold: "alert", p_model: 1 }], runsX: [{ station: "S", issued_at: 6 * H }] })), JSON.stringify(base));
  const x = buildArchiveLines({ runs, points: [], crossings, obs: {}, crossingsX: [{ station: "S", issued_at: 5 * H, threshold: "alert", p_model: 0.2345678, p_model_seen: 0.2, p_shown: 0.2, wording_shown: "possible" }], runsX: [{ station: "S", issued_at: 5 * H, horizon_limit_h: 6, experimental_on: 1, nh_rate_m_h: 0.01, nh_word: "rising" }] })[0];
  assert.deepEqual(x.crossings[0], { threshold: "alert", level: 2, probability: 0.2, p_model: 0.2345678, p_model_seen: 0.2, p_shown: 0.2, wording_shown: "possible" });
  assert.deepEqual(x.crossings[1], base[0].crossings[1], "a step without a row is unchanged");
  assert.deepEqual([x.horizon_limit_h, x.experimental_on, x.nh_rate_m_h, x.nh_word], [6, 1, 0.01, "rising"]);
});

console.log(`${n} checks passed${skipped ? `, ${skipped} before/after proofs skipped (the pre-change commit ${BASE} is not in this checkout)` : ""}${failures.length ? `, ${failures.length} FAILED: ${failures.join("; ")}` : ""}`);
