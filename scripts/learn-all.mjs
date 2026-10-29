#!/usr/bin/env node
// Nightly "observations -> models" pipeline (owner, 27 Oct 2026: "use all that data to improve our forecasting"). One job, one D1 pass:
//
//   D1 (forecast_feedback, street_flood_reports, flood3d_reports, observations, forecast_runs/points, street_rain_ground_log, street_rain_log)
//   + data branch (hmis/rain, rain-correction/log, stations.json)
//        |-> 1. unified observation table  learned/observations.jsonl   (PUBLIC-SAFE: no coordinates, hashes, person codes, notes or photos)
//        |-> 2a. street-water level per gauge, now also from 3D-map reports weighted by trust  learned/town-params.json (lib/learnedParams.mjs)
//        |-> 2b. ground-rain mark PROPOSALS per zone with their backtest                        learned/learned.json  groundRain
//        |-> 2c. forecast correction per gauge (momentum) + the "worse while rising" feature test learned/learned.json  forecast
//        |-> 2d. 3D-map re-fit trigger (flag only; scripts/flood3d/prep.py is run by hand)       learned/learned.json  mapRefit
//        |-> 3.  owner text: learned/learned.json is read by scripts/feedback-digest.mjs ("What we learned" block) and exported by
//                scripts/feedback-export.mjs as learned.json for the private dashboard.
// Maths and rules: lib/learnAll.mjs and lib/learnedParams.mjs (tests: scripts/learn-all.test.mts, scripts/feedback-learn.test.mts). DOCS.md "Learning pipeline".
// NOTHING here changes an official step, a verdict, a push level or a live rule: values are bounded notes, `proposed: true, wired: false` proposals or flags.
//
// usage: node --experimental-strip-types scripts/learn-all.mjs <archiveDir> [--dry-run] [--fixture file.json]   (.github/workflows/learn-all.yml, 00:20 Sri Lanka time)
//   <archiveDir> = checkout of the `data` branch (read for rain archives and stations.json; written unless --dry-run).
//   needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (wrangler via npx), optionally SLACK_WEBHOOK_URL.
//   --dry-run prints learned.json, a sample of the observation rows and the Slack text; reads D1 (read only), writes and sends nothing.
//
// D1 budget: the existing learn job's reads (~30k rows) + flood3d_reports (at most 5000, small) + street_rain_ground_log for 45 days (indexed on obs_ms, ~6 zones x 48 steps a day).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { PLACES } from "../lib/places.ts";
import { AREAS, corridorOnly } from "../lib/flood3dReports.ts";
import { pickRain } from "../lib/groundRain.ts";
import { nearestGauge, distKm } from "../lib/feedbackCheck.mjs";
import { FAR } from "../lib/feedbackCheck.mjs";
import { oncePerPersonAcross } from "../lib/feedbackLearn.mjs";
import { colomboDay, feedbackWetness, nearest, dedupe, learnedLines } from "../lib/learnedParams.mjs";
import {
  OBS_VERSION, assertPublicSafe, coverageGaps, diffLearned, fitGroundRain, floodStreetEvidence, gaugeAt, mapRefitStatus, neighbourFlags,
  photoInfo, reportStrength, toPublic, whatWeLearnedLines, whenBucket, worseFeatureTest,
} from "../lib/learnAll.mjs";
import { buildFromEvidence, d1, gather, newsLines, newsText, postSlack, writeParams } from "./feedback-learn.mjs";

const args = process.argv.slice(2);
const FIXTURE = args.includes("--fixture") ? args[args.indexOf("--fixture") + 1] : null;
const DRY = args.includes("--dry-run") || !!FIXTURE;
const arch = args.find((a) => !a.startsWith("--") && a !== FIXTURE);
if (!arch) { console.error("usage: node --experimental-strip-types scripts/learn-all.mjs <archiveDir> [--dry-run] [--fixture f.json]"); process.exit(1); }
const NOW = Date.now();
const HOUR = 3_600_000, DAY = 864e5;
const SINCE = NOW - 120 * DAY;
const ENRICH_AFTER_MS = 3 * HOUR; // a row is joined once its next 3 h of gauge data exist

const readJson = (f) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; } catch { return null; } };
const tableMissing = (e) => /no such table|no such column/i.test(`${e?.message ?? e} ${e?.stdout ?? ""}`);

// ---------------------------------------------------------------------------------------------------------------- evidence
function gatherMore() {
  let flood3d = [], groundLog = [];
  try { flood3d = d1(`SELECT * FROM flood3d_reports WHERE status != 'test' AND created_ms >= ${SINCE} ORDER BY id LIMIT 5000`)[0]; } catch (e) { if (!tableMissing(e)) throw e; }
  try { groundLog = d1(`SELECT zone, obs_ms AS ms, source, mm1h, mm3h, mm24h, peak1h FROM street_rain_ground_log WHERE obs_ms >= ${NOW - 45 * DAY} AND source IN ('ground','corrected')`)[0]; } catch (e) { if (!tableMissing(e)) throw e; }
  return { flood3d, groundLog };
}
const ev = FIXTURE ? JSON.parse(readFileSync(FIXTURE, "utf8")) : { ...gather(), ...gatherMore() };
ev.flood3d ??= []; ev.groundLog ??= [];
if (!ev.stations) ev.stations = readJson(path.join(arch, "stations.json")) ?? undefined;

// ---------------------------------------------------------------------------------------------------------------- 3D-map reports: trust
// the 3D map learns from the Kelani corridor only: survey answers from other parts of Sri Lanka (accepted since 28 Oct 2026) are for pattern analysis, not this
const f3 = corridorOnly(ev.flood3d.filter((r) => r.status !== "test"));
const contradicted = neighbourFlags(f3);
const f3Strength = new Map(f3.map((r) => [r.id, reportStrength(r, { contradicted: contradicted.has(r.id) })]));
const areaOf = (lat, lon) => AREAS.find((a) => lat >= a.south && lat <= a.north && lon >= a.west && lon <= a.east)?.name ?? "Kelani floodplain (elsewhere)";

// One person within 30 minutes counts once over all three forms (a counting rule: the rows themselves, and the observations file, keep every answer)
const [fbCounted, reportsCounted, f3Counted] = oncePerPersonAcross([ev.feedback, ev.reports, f3]);
const base = await buildFromEvidence(ev, { extra: { streetEvidence: floodStreetEvidence(f3Counted, contradicted), counted: [fbCounted, reportsCounted] } });
const { params, checkOf, series, stationList, backtestRows } = base;

// ---------------------------------------------------------------------------------------------------------------- places and rain at the spot
const place = (slug) => PLACES.find((p) => p.slug === slug);
const rainPlaces = PLACES.filter((p) => p.rainZone);
const zoneNear = (pt, maxKm) => {
  let best = null;
  for (const p of rainPlaces) { const d = distKm(pt, p); if (d <= maxKm && (!best || d < best.d)) best = { zone: p.rainZone, d }; }
  return best?.zone ?? null;
};
const hmisCache = new Map(), corrCache = new Map();
function hmisDay(day) {
  if (!hmisCache.has(day)) hmisCache.set(day, readJson(path.join(arch, "hmis/rain", day.slice(0, 4), `${day}.json`)) ?? {});
  return hmisCache.get(day);
}
function corrDay(day) {
  if (!corrCache.has(day)) {
    let lines = [];
    try { lines = readFileSync(path.join(arch, "rain-correction/log", day.slice(0, 4), `${day}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch {}
    corrCache.set(day, lines.map((l) => ({ ms: Date.parse(l.end), zones: l.zones ?? {} })).filter((l) => Number.isFinite(l.ms)));
  }
  return corrCache.get(day);
}
/** { source, km, mm1h, mm3h, mm24h } at a point and time, by the site's own hierarchy (lib/groundRain.ts pickRain): ground gauge <= 5 km and <= 60 min old, else gauge-corrected satellite. */
function rainAt(pt, ms) {
  const days = [colomboDay(ms), colomboDay(ms - DAY)];
  const byDev = new Map();
  for (const d of days) for (const [dev, g] of Object.entries(hmisDay(d))) {
    if (!Number.isFinite(g.lat) || !Number.isFinite(g.lon) || distKm(pt, g) > 6) continue;
    const e = byDev.get(dev) ?? { device: dev, n: g.name, i: g.institute, lat: g.lat, lon: g.lon, pts: [] };
    for (const p of g.pts ?? []) if (p[0] <= ms) e.pts.push([Math.round(p[0] / 60000), p[1]]);
    byDev.set(dev, e);
  }
  const gauges = [...byDev.values()].map((g) => ({ ...g, pts: [...new Map(g.pts.map((p) => [p[0], p])).values()].sort((a, b) => a[0] - b[0]) })).filter((g) => g.pts.length);
  const zone = zoneNear(pt, 10);
  let corr24 = null;
  if (zone) {
    const c = [...corrDay(days[0]), ...corrDay(days[1])].filter((l) => l.ms <= ms && ms - l.ms <= 3 * HOUR).sort((a, b) => b.ms - a.ms)[0];
    corr24 = c?.zones?.[zone]?.corr24 ?? null;
  }
  const pick = pickRain(pt, gauges, ms, { corr24 });
  if (pick.source === "none" || pick.source === "raw") return null;
  return { source: pick.source, km: pick.gauges[0]?.km, mm1h: pick.mm1h ?? undefined, mm3h: pick.mm3h ?? undefined, mm24h: pick.mm24h ?? undefined };
}

// ---------------------------------------------------------------------------------------------------------------- 1. unified observations
const prevFile = path.join(arch, "learned/observations.jsonl");
const prevRows = new Map();
if (existsSync(prevFile)) for (const l of readFileSync(prevFile, "utf8").split("\n")) if (l) { try { const r = JSON.parse(l); prevRows.set(r.id, r); } catch {} }
const gaugeAtName = (name, ms) => (name && series[name] ? gaugeAt(series[name], ms) : null);
const stationPt = (name) => { const s = stationList.find((x) => x.station === name); return s ? { lat: s.latitude, lon: s.longitude } : null; };

/** Join one internal row (exact position, never written) to gauges, rain and the forecast shown. */
function join(o) {
  const out = {};
  const ng = o.pt ? nearestGauge(o.pt, stationList) : null;
  const g = ng ? gaugeAtName(ng.station, o.ms) : null;
  if (ng) out.gauge = { name: ng.station, km: ng.km, ...(g ?? {}) };
  if (o.townGauge) { const tg = gaugeAtName(o.townGauge, o.ms); out.townGauge = { name: o.townGauge, ...(tg ?? (o.fallbackFt != null ? { ft: o.fallbackFt } : {})) }; const sp = stationPt(o.townGauge); if (sp && o.pt) out.townGauge.km = distKm(o.pt, sp); }
  if (o.pt) { const r = rainAt(o.pt, o.ms); if (r) out.rain = r; }
  if (o.forecast) out.forecast = o.forecast;
  return out;
}

const internal = [];
for (const f of ev.feedback) {
  const pl = place(f.page === "town" ? f.town : f.place_pick) ?? place(f.town);
  const pt = f.lat_r != null && f.lon_r != null ? { lat: f.lat_r, lon: f.lon_r } : pl ? { lat: pl.lat, lon: pl.lon } : f.station ? stationPt(f.station) : null;
  let err1h;
  if (f.shown_next_ft != null && f.station && series[f.station]) { const o = nearest(series[f.station], f.created_ms + HOUR, 40 * 60_000); if (o) err1h = Math.round((o.v - f.shown_next_ft) * 100) / 100; }
  const w = feedbackWetness(f.water_at, f.river_obs);
  const check = checkOf.get(f.id);
  internal.push({
    id: `fb-${f.id}`, src: "feedback", ms: f.created_ms, day: f.day, area: (f.page === "town" ? f.town : f.place_pick ?? f.station) ?? "unknown", pt, townGauge: f.station,
    fallbackFt: f.shown_level ?? undefined, answer: f.answer, riverSeen: f.river_obs ?? undefined, waterAt: f.water_at ?? undefined, wet: w ? w.wet : undefined,
    strength: w?.strong ? 1.1 : 1, flags: { check: check && check !== "pending" ? check : undefined },
    forecast: f.shown_next_ft != null || f.shown_dir ? { nextFt: f.shown_next_ft ?? undefined, dir: f.shown_dir ?? undefined, tier: f.shown_tier ?? undefined, err1hFt: err1h } : undefined,
  });
}
for (const r of ev.reports) {
  const pl = place(r.town);
  internal.push({
    id: `sr-${r.id}`, src: "street", ms: r.created_ms, day: r.day, area: r.town, pt: pl ? { lat: pl.lat, lon: pl.lon } : null, townGauge: pl?.stations.find((s) => series[s]?.length) ?? pl?.stations[0],
    answer: r.answer, wet: r.answer === "deep" || r.answer === "little" ? true : r.answer === "dry" ? false : undefined, strength: 1, flags: {},
  });
}
for (const r of f3) {
  const st = f3Strength.get(r.id);
  const { photo, exif } = photoInfo(r);
  const wet = r.kind === "water_now" || r.kind === "past_wet" ? true : r.kind === "past_dry" ? false : undefined;
  const fallback = Math.abs(r.lon - 79.8786) + Math.abs(r.lat - 6.958) < Math.abs(r.lon - 80.0831) + Math.abs(r.lat - 6.9097) ? r.nag_ft : r.han_fast_ft ?? r.han_ft;
  internal.push({
    id: `f3-${r.id}`, src: "flood3d", kind: r.kind, ms: r.created_ms, day: r.day, area: areaOf(r.lat, r.lon), pt: { lat: r.lat, lon: r.lon }, depth: r.depth ?? undefined, event: r.event ?? undefined,
    answer: r.map_right ?? undefined, wet, strength: st.strength, fallbackFt: fallback ?? undefined,
    townGauge: nearestGauge({ lat: r.lat, lon: r.lon }, stationList)?.station,
    flags: { contradicted: contradicted.has(r.id) || undefined, pin: r.src === "pin" || undefined, lowAccuracy: st.flags.includes("low-accuracy") || undefined, photo: photo || undefined, exif: photo && exif != null ? exif : undefined, outlier: r.status === "outlier" || undefined },
  });
}

const rows = [];
let added = 0;
for (const o of internal) {
  const prev = prevRows.get(o.id);
  let joined = {};
  if (prev) joined = { gauge: prev.gauge, townGauge: prev.townGauge, rain: prev.rain, forecast: prev.forecast };
  else if (NOW - o.ms >= ENRICH_AFTER_MS || FIXTURE) { joined = join(o); added++; }
  else continue; // too new: joined tomorrow, when its next 3 h of gauge data exist
  const flags = Object.fromEntries(Object.entries(o.flags).filter(([, v]) => v !== undefined));
  const pub = toPublic({ id: o.id, src: o.src, kind: o.kind, day: o.day, when: whenBucket(o.ms), area: o.area, wet: o.wet, depth: o.depth, event: o.event, answer: o.answer, riverSeen: o.riverSeen, waterAt: o.waterAt, strength: o.strength, ...joined, flags });
  rows.push(pub);
}
// rows kept from earlier nights that fell out of the 120-day window or were removed upstream stay as they were
const have = new Set(rows.map((r) => r.id));
for (const [id, r] of prevRows) if (!have.has(id)) rows.push(r);
rows.sort((a, b) => (a.day === b.day ? a.id.localeCompare(b.id) : a.day < b.day ? -1 : 1));
assertPublicSafe(rows);

// ---------------------------------------------------------------------------------------------------------------- 2b ground-rain proposals
const person = (r) => (r.person_day ? `p|${r.person_day}` : `${r.ip_hash}|${r.day}`);
const events = [];
for (const r of reportsCounted) { const z = place(r.town)?.rainZone; if ((r.answer === "deep" || r.answer === "little") && z) events.push({ zone: z, ms: r.created_ms, day: r.day, key: person(r) }); }
for (const f of fbCounted) {
  if (!(f.water_at === "road" || f.water_at === "yard" || f.water_at === "inside") || checkOf.get(f.id) === FAR) continue;
  const pl = place(f.page === "town" ? f.town : f.place_pick) ?? place(f.town);
  const z = f.lat_r != null ? zoneNear({ lat: f.lat_r, lon: f.lon_r }, 8) : pl?.rainZone;
  if (z) events.push({ zone: z, ms: f.created_ms, day: f.day, key: person(f) });
}
for (const r of f3Counted) {
  if (r.kind !== "water_now" || !(f3Strength.get(r.id)?.strength > 0)) continue;
  const z = zoneNear(r, 6);
  if (z) events.push({ zone: z, ms: r.created_ms, day: r.day, key: `p|${r.person_day}` });
}
const groundRain = fitGroundRain(ev.groundLog, events);

// ---------------------------------------------------------------------------------------------------------------- 2c forecast
const worse = dedupe(fbCounted.filter((f) => f.answer === "worse" && f.shown_dir === "rising" && f.station && checkOf.get(f.id) !== FAR).sort((a, b) => a.created_ms - b.created_ms), (f) => `${person(f)}|${f.station}`)
  .map((f) => ({ station: f.station, ms: f.created_ms }));
const worseFeature = worseFeatureTest(backtestRows, worse);
const forecast = {
  window: params.forecast.window,
  momentum: { horizons: params.forecast.horizons, gaugesPassingOwnTest: params.forecast.gaugesPassingOwnTest, useful: params.forecast.useful, wired: false },
  worseFeature,
};

// ---------------------------------------------------------------------------------------------------------------- 2d map re-fit
const mapRefit = mapRefitStatus(f3.filter((r) => r.kind !== "map_check").map((r) => ({ area: areaOf(r.lat, r.lon), status: r.status, strength: f3Strength.get(r.id).strength, person_day: r.person_day })), AREAS.map((a) => a.name));
const gaps = coverageGaps(mapRefit, params.pending);

// ---------------------------------------------------------------------------------------------------------------- learned.json
const countBy = (src) => rows.filter((r) => r.src === src).length;
const learned = {
  version: 1,
  updatedAt: new Date(NOW).toISOString(),
  asOf: colomboDay(NOW),
  rules: "Notes, proposals and flags only. No learned value changes an official step, a verdict, a push level or a live rule; proposals carry wired = false until the owner switches them.",
  counts: { total: rows.length, feedback: countBy("feedback"), street: countBy("street"), flood3d: countBy("flood3d"), newTonight: added, trusted: f3.filter((r) => f3Strength.get(r.id).strength > 0 && r.kind !== "map_check").length, flagged: f3.filter((r) => f3Strength.get(r.id).strength === 0).length },
  streetLevel: Object.fromEntries(Object.entries(params.stations).filter(([, s]) => s.streetLevel).map(([k, s]) => [k, s.streetLevel])),
  groundRain,
  forecast,
  mapRefit,
  gaps,
  changes: [],
};
const paramsFile = path.join(arch, "learned/town-params.json");
const learnedFile = path.join(arch, "learned/learned.json");
const beforeParams = readJson(paramsFile);
const beforeLearned = readJson(learnedFile);
learned.changes = [...newsLines(params, beforeParams), ...diffLearned(beforeLearned, learned)];

// ---------------------------------------------------------------------------------------------------------------- write
const blockLines = whatWeLearnedLines(learned);
const text = newsText(newsLines(params, beforeParams));
console.error(`observations: ${rows.length} (${added} new), 3D-map reports ${f3.length} (${learned.counts.trusted} trusted, ${learned.counts.flagged} flagged), ground-rain events ${events.length}, shadow-log steps ${ev.groundLog.length}, worse-while-rising reports ${worse.length}`);
if (DRY) {
  console.log(JSON.stringify(learned, null, 2));
  console.log(`\n--- observations.jsonl: ${rows.length} rows, last 3 ---\n` + rows.slice(-3).map((r) => JSON.stringify(r)).join("\n"));
  console.log("\n--- town-params digest lines ---\n" + learnedLines(params).join("\n"));
  console.log("\n--- What we learned (Slack digest block) ---\n" + blockLines.join("\n"));
  if (text) console.log(`\n[dry-run] Slack:\n${text}`);
  process.exit(0);
}
mkdirSync(path.join(arch, "learned"), { recursive: true });
const { same } = writeParams(params, paramsFile);
console.log(same ? "learned/town-params.json unchanged" : `wrote ${paramsFile}`);
const sameL = beforeLearned && JSON.stringify({ ...beforeLearned, updatedAt: 0, changes: 0 }) === JSON.stringify({ ...learned, updatedAt: 0, changes: 0 });
if (!sameL) writeFileSync(learnedFile, JSON.stringify(learned, null, 2) + "\n");
console.log(sameL ? "learned/learned.json unchanged" : `wrote ${learnedFile}`);
const obsText = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
if (!existsSync(prevFile) || readFileSync(prevFile, "utf8") !== obsText) writeFileSync(prevFile, obsText);
console.log(`learned/observations.jsonl: ${rows.length} rows (v${OBS_VERSION})`);
await postSlack(text);
// a due map re-fit is raised by the workflow as a GitHub issue (it reads learned.json)
