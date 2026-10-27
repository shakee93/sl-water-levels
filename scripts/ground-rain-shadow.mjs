// SHADOW run of the ground-gauge street-water rule (lib/groundRain.ts), called by scripts/street-rain-log.mjs at the end of every run.
// Nothing users see changes: no public note, push or town tone reads this. What it does per rain zone (lib/places.ts rainZone):
//   1. reads <dataDir>/hmis/rain-live.json (scripts/hmis-snapshot.mjs: every live HMIS rain gauge, [epoch minute, 24 h sum], last 4.5 h)
//      and, for the fall-back tiers, <dataDir>/rain-correction/latest.json (gauge-corrected satellite per zone) and gsmap/latest.json (raw);
//   2. for each town of the zone picks the rain source (ground gauge within 5 km and <= 60 min old, else corrected satellite <= 3 h, else raw)
//      and applies the ground rule; the zone's state is its worst town;
//   3. stores one row per zone per HMIS snapshot in D1 street_rain_ground_log, every change in street_rain_ground_changes
//      (d1/0011_street_ground_shadow.sql), and posts ONE Slack line per rise / clear: "Shadow (ground gauges): ...".
// The rule applies to the ground and the corrected tiers (gauge-scale millimetres); the raw satellite tier is logged but has no ground state
// (the live satellite rule already covers it with its own thresholds). The river trigger and the wet-week index are the live shadow's.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLACES } from "../lib/places.ts";
import { pickRain, groundStreetState, gaugeLabel, GROUND_NEAR_KM, GROUND_MAX_AGE_MIN, CORRECTED_MAX_AGE_MIN } from "../lib/groundRain.ts";
import { stateChange, isReportable, noticeFor } from "../lib/streetRainLog.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const RANK = { none: 0, possible: 1, likely: 2 };
const readJson = (f) => {
  try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; } catch { return null; }
};

/** Shadow state of every zone at `nowMs`. Pure given its inputs (the files are read by the caller). */
export function evaluateZones({ gauges, nowMs, corrected, satLatest, riverOn, wet, zones }) {
  const out = {};
  for (const zone of zones) {
    const towns = PLACES.filter((p) => p.rainZone === zone);
    const corrOk = corrected && Number.isFinite(Date.parse(corrected.windowEnd)) && nowMs - Date.parse(corrected.windowEnd) <= CORRECTED_MAX_AGE_MIN * 60_000;
    const cz = corrOk ? corrected.zones?.[zone] : null;
    const sz = satLatest?.zones?.[zone];
    const sat = { corr24: cz?.corr24, raw24: sz?.mm24hClipped ?? sz?.mm24h, raw1h: sz?.mm1h, raw3h: sz?.mm3h };
    const zoneRiver = zone === "colombo-east" && !!riverOn;
    let best = null;
    const perTown = [];
    for (const t of towns) {
      const pick = pickRain(t, gauges, nowMs, sat);
      let v = pick.source === "ground" || pick.source === "corrected" ? groundStreetState(pick, { river: zoneRiver, wet }) : { state: zoneRiver ? "likely" : null, why: zoneRiver ? "river at minor level" : "" };
      perTown.push({ town: t.name, slug: t.slug, pick, verdict: v });
      const rank = v.state == null ? -1 : RANK[v.state];
      const bestRank = best ? (best.verdict.state == null ? -1 : RANK[best.verdict.state]) : -2;
      if (rank > bestRank || (rank === bestRank && pick.source === "ground" && best.pick.source !== "ground") ||
          (rank === bestRank && pick.source === "ground" && best.pick.source === "ground" && (pick.mm24h ?? 0) > (best.pick.mm24h ?? 0))) best = perTown[perTown.length - 1];
    }
    out[zone] = { zone, best, perTown, sat };
  }
  return out;
}

const mmPhrase = (why) => {
  const m = /^(\d+) h (\d+) mm$/.exec(why || "");
  return m ? `${m[2]} mm in ${m[1]} h` : why;
};
export function shadowText({ r, kind, live, site }) {
  const b = r.best, p = b.pick;
  const area = r.zone === "colombo-east" ? "Wellampitiya and nearby" : r.perTown.map((t) => t.town).join(", ");
  const liveTail = `Live satellite rule: ${live ?? "no state"}. Not shown to anyone.`;
  const g = p.gauges[0];
  const src = p.source === "ground"
    ? `${g ? gaugeLabel(g) : "ground gauge"}${p.gauges.length > 1 ? ` and ${p.gauges.length - 1} more within ${GROUND_NEAR_KM} km` : ""}`
    : p.source === "corrected" ? `gauge-corrected satellite (no ground gauge within ${GROUND_NEAR_KM} km)` : "satellite";
  if (kind === "clear") return `Shadow (ground gauges): ${area} back below the street-water marks (${src}, 24 h ${p.mm24h ?? "?"} mm). ${liveTail}`;
  const why = b.verdict.why === "river at minor level" ? "the Kelani is at its minor flood level" : mmPhrase(b.verdict.why);
  const nums = p.source === "ground" ? ` (1 h ${p.mm1h ?? "?"}, 3 h ${p.mm3h ?? "?"}, 24 h ${p.mm24h ?? "?"} mm; short totals are lower bounds)` : "";
  return `Shadow (ground gauges): ${area} street water ${b.verdict.state} — ${b.verdict.why === "river at minor level" ? why : `${src}: ${why}`}${nums}. ${liveTail}`;
}

export async function runGroundShadow({ dataDir, nowMs, dry, river, wet, latest, liveStates, prevGround, q, run, rowsOf, softExit, slack, site }) {
  const live = readJson(path.join(dataDir, "hmis/rain-live.json"));
  const obsMs = live ? Date.parse(live.updatedAt) : NaN;
  if (!live || !Number.isFinite(obsMs) || nowMs - obsMs > 3 * 3_600_000) {
    console.log("ground shadow: hmis/rain-live.json missing or over 3 h old: not logged");
    return;
  }
  const gauges = Object.entries(live.devices ?? {}).map(([device, e]) => ({ device, ...e }));
  const corrected = readJson(path.join(dataDir, "rain-correction/latest.json"));
  const zones = [...new Set(PLACES.map((p) => p.rainZone).filter(Boolean))];
  const res = evaluateZones({ gauges, nowMs: obsMs, corrected, satLatest: latest, riverOn: river ? river.on : false, wet: typeof wet?.apiMm === "number" && wet.apiMm >= 96, zones });
  const wetFlag = typeof wet?.apiMm === "number" ? (wet.apiMm >= 96 ? 1 : 0) : null;

  if (!dry) {
    try {
      await run(readFileSync(path.join(here, "../d1/0011_street_ground_shadow.sql"), "utf8"));
    } catch (e) { return softExit(e); }
  }
  const sql = [], notices = [];
  for (const zone of zones) {
    const r = res[zone], b = r.best, p = b.pick, st = b.verdict.state;
    const g = p.gauges[0];
    const liveState = liveStates?.[zone] ?? null;
    let last = null, lastRiseMs = null, newest = 0, pending = [];
    if (dry) last = prevGround && prevGround !== "null" ? prevGround : null;
    else {
      try {
        const z1 = q(zone);
        newest = Number((await rowsOf(`SELECT COALESCE(MAX(obs_ms), 0) AS t FROM street_rain_ground_log WHERE zone = ${z1}`))[0]?.t ?? 0);
        last = (await rowsOf(`SELECT state FROM street_rain_ground_log WHERE zone = ${z1} AND state IS NOT NULL ORDER BY obs_ms DESC LIMIT 1`))[0]?.state ?? null;
        lastRiseMs = (await rowsOf(`SELECT MAX(notified_ms) AS t FROM street_rain_ground_changes WHERE zone = ${z1} AND notified = 1 AND to_state <> 'none'`))[0]?.t ?? null;
        pending = (await rowsOf(`SELECT changed_ms, from_state, to_state, live_state, town FROM street_rain_ground_changes WHERE zone = ${z1} AND notified = 0 ORDER BY changed_ms`)).map((x) => ({ changedMs: Number(x.changed_ms), from: x.from_state, to: x.to_state, live: x.live_state, replay: true }));
      } catch (e) { return softExit(e); }
    }
    const fresh = obsMs > newest;
    console.log(`ground shadow ${zone}: ${b.town} source ${p.source}${g ? ` ${g.name} ${g.km} km ${g.ageMin} min old` : ""} 1h ${p.mm1h ?? "?"} 3h ${p.mm3h ?? "?"} 24h ${p.mm24h ?? "?"} peak1h ${p.peak1h ?? "?"} -> ${st ?? "unknown"}${b.verdict.why ? ` (${b.verdict.why})` : ""}; live satellite ${liveState ?? "no state"}${fresh ? "" : " (already logged)"}`);
    if (fresh) {
      sql.push(`INSERT OR IGNORE INTO street_rain_ground_log (zone, obs_ms, run_ms, town, source, gauge, km, n_gauges, age_min, mm1h, mm3h, mm24h, peak1h, partial, wet_week, river_trigger, state, why, live_state, sat_corr24, sat_raw24) VALUES (${[zone, obsMs, nowMs, b.town, p.source, g ? `${g.name} (${g.institute})` : null, g?.km ?? null, p.gauges.length, g?.ageMin ?? null, p.mm1h, p.mm3h, p.mm24h, p.peak1h, p.partial ? 1 : 0, wetFlag, zone === "colombo-east" && river ? (river.on ? 1 : 0) : null, st, b.verdict.why || null, liveState, r.sat.corr24 ?? null, r.sat.raw24 ?? null].map(q).join(", ")});`);
      const c = stateChange(last, st);
      if (c && isReportable(c)) {
        sql.push(`INSERT OR IGNORE INTO street_rain_ground_changes (zone, changed_ms, from_state, to_state, live_state, town, source, gauge, km, mm1h, mm3h, mm24h, peak1h, why, notified) VALUES (${[zone, obsMs, c.from, c.to, liveState, b.town, p.source, g ? `${g.name} (${g.institute})` : null, g?.km ?? null, p.mm1h, p.mm3h, p.mm24h, p.peak1h, b.verdict.why || null].map(q).join(", ")}, 0);`);
        pending.push({ changedMs: obsMs, from: c.from, to: c.to, live: liveState, replay: false });
      }
    }
    for (const x of pending) {
      const kind = noticeFor({ from: x.from, to: x.to }, lastRiseMs, x.changedMs, nowMs);
      if (kind === "rise") lastRiseMs = nowMs;
      // a replayed pending change is only announced with the numbers of THIS run if it is still the current state
      notices.push({ zone, changedMs: x.changedMs, kind, r, live: x.live, current: x.to === st });
    }
  }
  const updates = [];
  for (const n of notices) {
    if (n.kind == null || (n.kind === "rise" && !n.current)) {
      updates.push(`UPDATE street_rain_ground_changes SET notified = 2, notified_ms = ${nowMs} WHERE zone = ${q(n.zone)} AND changed_ms = ${n.changedMs} AND notified = 0;`);
      continue;
    }
    if (await slack(shadowText({ r: n.r, kind: n.kind, live: n.live, site }))) updates.push(`UPDATE street_rain_ground_changes SET notified = 1, notified_ms = ${nowMs} WHERE zone = ${q(n.zone)} AND changed_ms = ${n.changedMs};`);
  }
  const body = [...sql, ...updates].join("\n");
  if (!body) return;
  if (dry) console.log("--- ground shadow SQL ---\n" + body);
  else {
    try { await run(body + "\n"); } catch (e) { softExit(e); }
  }
}
