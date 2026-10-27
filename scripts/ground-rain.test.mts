// @ts-nocheck (node strip-types test)
// node --experimental-strip-types scripts/ground-rain.test.mts
import assert from "node:assert/strict";
import { windowMm, gaugeTotals, pickRain, groundStreetState, GROUND_RULE, gaugeLabel, haversineKm } from "../lib/groundRain.ts";

const MIN = 60_000, NOW = Date.UTC(2026, 9, 27, 12, 0);
const m = (minAgo) => Math.floor((NOW - minAgo * MIN) / MIN); // epoch minutes
const G = (n, lat, lon, pts, i = "Met Department") => ({ n, i, lat, lon, pts });
const near = { lat: 6.937, lon: 79.891 };

// --- interval derivation: ΔS of the rolling 24 h sum, lower bound, never negative
{
  const p = [[m(120), 5], [m(60), 12], [m(0), 54]];
  assert.equal(windowMm(p, 2, 60), 42); // 54 - 12
  assert.equal(windowMm(p, 2, 180), null); // nothing 135-225 min back
  assert.equal(windowMm([[m(120), 5], [m(0), 4]], 1, 120), 0, "24 h sum fell (yesterday's rain left the window): 0, never negative");
  // a 45 min gap is scaled up to an hour, a 75 min gap is NOT scaled down
  assert.equal(windowMm([[m(45), 10], [m(0), 25]], 1, 60), 20);
  assert.equal(windowMm([[m(75), 10], [m(0), 25]], 1, 60), 15);
  assert.equal(windowMm([[m(30), 10], [m(0), 25]], 1, 60), null, "30 min apart is not an hour");
  assert.equal(windowMm([[m(100), 10], [m(0), 25]], 1, 60), null, "100 min apart is not an hour");
  // nearest to the span wins
  assert.equal(windowMm([[m(80), 0], [m(62), 10], [m(0), 30]], 2, 60), 20);
}
// --- totals
{
  const t = gaugeTotals([[m(250), 0], [m(190), 2], [m(130), 6], [m(65), 14], [m(5), 56]], NOW);
  assert.equal(t.ageMin, 5);
  assert.equal(t.mm24h, 56);
  assert.equal(t.mm1h, 42); // 56 - 14 over 60 min
  assert.equal(t.mm3h, 54); // 56 - 2 over 185 min (nearest to 180)
  assert.equal(t.peak1h, 42);
  assert.equal(gaugeTotals([], NOW), null);
  const one = gaugeTotals([[m(3), 7]], NOW);
  assert.equal(one.mm1h, null); assert.equal(one.mm3h, null); assert.equal(one.mm24h, 7);
  // junk points are dropped, order does not matter
  assert.equal(gaugeTotals([[m(0), 9], [NaN, 1], [m(60), -4], [m(60), 3]], NOW).mm1h, 6);
}
// --- source hierarchy
const kol = G("Kolonnawa", 6.9336, 79.885, [[m(200), 0], [m(70), 0], [m(5), 42]]);
const kol2 = G("Colombo - 5", 6.95, 79.93, [[m(200), 0], [m(70), 0], [m(10), 20]], "NBRO");
const far = G("Far", 7.3, 80.2, [[m(70), 0], [m(5), 99]]);
const stale = G("Stale", 6.94, 79.89, [[m(200), 0], [m(120), 60]]);
{
  const p = pickRain(near, [far, kol], NOW, { corr24: 30, raw24: 120 });
  assert.equal(p.source, "ground"); assert.equal(p.gauges.length, 1); assert.equal(p.mm1h, 42); assert.equal(p.mm24h, 42);
  assert.equal(p.partial, false);
  // two gauges within 5 km: inverse-distance mean, nearest listed first
  const q = pickRain(near, [kol2, kol], NOW);
  assert.equal(q.gauges.length, 2); assert.equal(q.gauges[0].name, "Kolonnawa");
  const dK = haversineKm(near, kol), dC = haversineKm(near, kol2);
  const wK = 1 / dK ** 2, wC = 1 / dC ** 2;
  assert.ok(Math.abs(q.mm24h - (wK * 42 + wC * 20) / (wK + wC)) < 0.11, "IDW mean of the 24 h figures");
  assert.ok(q.mm24h > 20 && q.mm24h < 42 && q.mm24h > 31, "closer gauge weighs more than the plain mean");
  // a gauge older than 60 min is never used even when it is the only one near
  const s = pickRain(near, [stale], NOW, { corr24: 30, raw24: 120 });
  assert.equal(s.source, "corrected"); assert.equal(s.mm24h, 30); assert.equal(s.partial, true);
  assert.equal(pickRain(near, [stale], NOW, { raw24: 120, raw1h: 5, raw3h: 20 }).source, "raw");
  assert.equal(pickRain(near, [stale], NOW, { raw24: 120, raw1h: 5, raw3h: 20 }).partial, false);
  assert.equal(pickRain(near, [], NOW).source, "none");
  // beyond 5 km is out; 5 km edge
  assert.equal(pickRain({ lat: 6.8, lon: 79.89 }, [kol], NOW).source, "none");
  // a record from the future (clock skew) is ignored
  assert.equal(pickRain(near, [G("Fut", 6.94, 79.89, [[m(-30), 5]])], NOW).source, "none");
  // a brand-new gauge (one point) still gives a ground answer for 24 h, marked partial
  const n = pickRain(near, [G("New", 6.94, 79.89, [[m(2), 31]])], NOW);
  assert.equal(n.source, "ground"); assert.equal(n.partial, true); assert.equal(n.mm1h, null);
}
// --- thresholds
{
  const S = (o, x) => groundStreetState(o, x).state;
  assert.deepEqual(GROUND_RULE.possible, { mm1h: 30, mm3h: 50, mm24h: 50 });
  assert.deepEqual(GROUND_RULE.likely, { mm1h: 50, mm3h: 75, mm24h: 75 });
  assert.equal(S({ mm1h: 5, mm3h: 10, mm24h: 20 }), "none");
  assert.equal(S({ mm1h: 30, mm3h: 30, mm24h: 30 }), "possible");
  assert.equal(S({ mm1h: 29.9, mm3h: 49.9, mm24h: 49.9 }), "none");
  assert.equal(S({ mm1h: 0, mm3h: 50, mm24h: 50 }), "possible");
  assert.equal(S({ mm1h: 0, mm3h: 0, mm24h: 50 }), "possible");
  assert.equal(S({ mm1h: 50, mm3h: 50, mm24h: 50 }), "likely");
  assert.equal(S({ mm1h: 10, mm3h: 75, mm24h: 75 }), "likely");
  assert.equal(S({ mm1h: 1, mm3h: 1, mm24h: 75 }), "likely");
  assert.equal(S({ mm1h: 1, mm3h: 1, mm24h: 74.9 }), "possible");
  // a peak hour earlier in the window counts as the hourly intensity
  assert.equal(S({ mm1h: 2, peak1h: 34, mm3h: 40, mm24h: 40 }), "possible");
  // wet week lowers possible 3 h / 24 h (x0.75) but not 1 h and not likely
  assert.equal(S({ mm1h: 0, mm3h: 0, mm24h: 38 }, { wet: true }), "possible");
  assert.equal(S({ mm1h: 0, mm3h: 0, mm24h: 37 }, { wet: true }), "none");
  assert.equal(S({ mm1h: 0, mm3h: 0, mm24h: 38 }), "none");
  assert.equal(S({ mm1h: 0, mm3h: 0, mm24h: 74 }, { wet: true }), "possible");
  // river at minor level = likely whatever the rain says, even with no rain data
  assert.equal(S({}, { river: true }), "likely");
  assert.equal(S({ mm24h: 0, mm1h: 0, mm3h: 0 }, { river: true }), "likely");
  // unknown is never none
  assert.equal(S({}), null);
  assert.equal(S({ mm24h: 10, partial: true }), null, "calm but a short total unknown: unknown, not none");
  assert.equal(S({ mm24h: 55, partial: true }), "possible", "a trigger that fired stands even when partial");
  assert.equal(groundStreetState({ mm1h: 42, mm3h: 42, mm24h: 42 }).why, "1 h 42 mm");
  assert.equal(gaugeLabel({ name: "Kolonnawa ", institute: "Met Department", km: 3.4 }), "Kolonnawa Met gauge (3.4 km)");
}
console.log("ground-rain.test: ok");

// --- backtest harness on a synthetic archive
{
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { run, parseCsv, eventsFrom } = await import("./ground-rain-backtest.mts");
  const dir = mkdtempSync(path.join(tmpdir(), "grb-"));
  mkdirSync(path.join(dir, "hmis/rain/2026"), { recursive: true });
  mkdirSync(path.join(dir, "rain-correction/log/2026"), { recursive: true });
  const T = Date.UTC(2026, 9, 28, 10, 0); // 15:30 Sri Lanka, 28 Oct
  // gauge 4 km from Wellampitiya: dry, then a downpour: 24 h sum 2 -> 8 -> 60 -> 95 over 90 min
  const mk = (min, mm) => [T + min * MIN, mm];
  writeFileSync(path.join(dir, "hmis/rain/2026/2026-10-28.json"), JSON.stringify({ G1: { name: "Test gauge", institute: "Met Department", lat: 6.905, lon: 79.8717, pts: [mk(-60, 2), mk(-30, 8), mk(0, 60), mk(30, 95)] } }));
  // a satellite that over-reads: raw 130 mm, corrected 20 mm
  writeFileSync(path.join(dir, "rain-correction/log/2026/2026-10-28.jsonl"), [-60, 0, 30, 60, 120].map((m) => JSON.stringify({ end: new Date(T + m * MIN).toISOString(), zones: { "colombo-east": { raw24: 130, corr24: 20 } } })).join("\n") + "\n");
  const csv = path.join(dir, "reports.csv");
  writeFileSync(csv, 'id,reported_lk,place,lat,lon,report\nR1,2026-10-28 16:00,"Wellampitiya, test",6.937,79.891,water on road\n');
  assert.equal(eventsFrom(parseCsv("id,reported_lk,place,lat,lon\nX,2026-10-28 16:00,\"a, b\",6.937,79.891\n")).length, 1);
  const r = run({ dataDir: dir, reportsCsv: csv });
  assert.equal(r.eventsInArchive, 1);
  const s = r.scores;
  assert.equal(s.ground_likely.hit, 1, "52 mm in the hour is a ground 'likely'");
  assert.equal(s.ground_possible.hit, 1);
  assert.ok(s.ground_likely.detail[0].leadH >= 0, "fires before or at the report");
  assert.equal(s.sat_likely.hit, 1, "raw satellite 130 mm also fires (it over-reads)");
  assert.equal(s.corr_possible.hit, 0, "corrected satellite 20 mm stays quiet: a miss");
  assert.equal(s.corr_possible.miss, 1);
  assert.equal(s.ground_possible.unmatchedEpisodes, 0, "the alarm episode matches the report");
  // no reports near: the same alarm is unmatched
  writeFileSync(csv, 'id,reported_lk,place,lat,lon,report\nR1,2026-10-20 16:00,"Wellampitiya, test",6.937,79.891,water on road\n');
  const r2 = run({ dataDir: dir, reportsCsv: csv });
  assert.equal(r2.eventsInArchive, 0);
  assert.equal(r2.scores.ground_possible.unmatchedEpisodes, 1);
}
console.log("ground-rain backtest harness: ok");

// --- shadow evaluation and Slack text
{
  const { evaluateZones, shadowText } = await import("./ground-rain-shadow.mjs");
  const g = [G("Kolonnawa", 6.9336, 79.885, [[m(200), 0], [m(70), 0], [m(5), 42]])];
  const gz = ["colombo-east", "ja-ela"];
  const r = evaluateZones({ gauges: g, nowMs: NOW, corrected: null, satLatest: null, riverOn: false, wet: false, zones: gz });
  assert.equal(r["colombo-east"].best.verdict.state, "possible"); // 42 mm in 1 h
  assert.equal(r["colombo-east"].best.pick.source, "ground");
  assert.equal(r["ja-ela"].best.verdict.state, null, "no gauge, no corrected data: unknown, never none");
  const t = shadowText({ r: r["colombo-east"], kind: "rise", live: "none", site: "x" });
  assert.match(t, /^Shadow \(ground gauges\): Wellampitiya and nearby street water possible — Kolonnawa Met gauge \(\d+(\.\d)? km\): 42 mm in 1 h/);
  assert.match(t, /Live satellite rule: none\. Not shown to anyone\./);
  // river at minor level: likely for the Colombo zone only
  const rv = evaluateZones({ gauges: [], nowMs: NOW, corrected: null, satLatest: null, riverOn: true, wet: false, zones: gz });
  assert.equal(rv["colombo-east"].best.verdict.state, "likely"); assert.equal(rv["ja-ela"].best.verdict.state, null);
  // corrected tier applies the ground 24 h marks to gauge-scale numbers
  const cz = { windowEnd: new Date(NOW - 3600_000).toISOString(), zones: { "ja-ela": { corr24: 80 } } };
  assert.equal(evaluateZones({ gauges: [], nowMs: NOW, corrected: cz, satLatest: null, riverOn: false, wet: false, zones: ["ja-ela"] })["ja-ela"].best.verdict.state, "likely");
  const old = { ...cz, windowEnd: new Date(NOW - 4 * 3600_000).toISOString() };
  assert.equal(evaluateZones({ gauges: [], nowMs: NOW, corrected: old, satLatest: null, riverOn: false, wet: false, zones: ["ja-ela"] })["ja-ela"].best.pick.source, "none", "corrected older than 3 h is not used");
}
console.log("ground shadow: ok");
