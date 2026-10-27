// @ts-nocheck (node strip-types script)
// Replays ARCHIVED HMIS rain (data branch: hmis/rain/YYYY/YYYY-MM-DD.json) against street-flood reports and compares three rules:
//   sat   the live satellite rule on raw GSMaP 24 h rain (60 mm possible / 100 mm likely; rain-correction/log raw24, NOT hourly-clipped, so it
//         alarms a little more than the live clipped rule)
//   corr  the same 60 / 100 marks on the gauge-corrected satellite (rain-correction/log corr24)
//   ground the ground-gauge rule (lib/groundRain.ts: gauges within 5 km, <= 60 min old, 1 h / 3 h / 24 h thresholds), hierarchy ground -> corrected
// Usage: node --experimental-strip-types --no-warnings scripts/ground-rain-backtest.mts <dataDir> --reports <csv> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--json out.json]
//   <csv> = research/street-flood-reports.csv shape (needs reported_lk "YYYY-MM-DD HH:MM" Sri Lanka time, lat, lon) or the Kolonnawa ledger
//   (onset_lk date; no coordinates = Wellampitiya). The CSVs are PRIVATE: pass the path, never commit them or the output.
// How it is scored (events accumulate slowly; read DOCS.md "Ground-gauge street rain" before trusting a number):
//   timeline  every 30 minutes between the first and last archived day.
//   HIT       an event is hit by a rule when that rule is at least "possible" (and separately "likely") at some step in
//             [report day 00:00 - 12 h, report time + 3 h] (the whole day when only a date is known), for the zone of the town nearest the report.
//   MISS      an event with the rule's data present in that window but no alarm; NO DATA = the rule was unknown (null) throughout: not scored.
//   FALSE ALARM  an alarm episode (steps at or above the level, gaps under 6 h merged) with no event of that zone in [start - 6 h, end + 24 h].
//             Reports are self-selected and the list only holds floods somebody reported, so "false alarm" means "unmatched", an upper bound.
// The archive keeps a gauge's zero readings only near the rain zones since 27 Oct 2026 and omits S = 0 elsewhere; an absent point is treated as a gauge
// that is not live (never as dry), and a missing older point inside the 4.5 h state as a zero 24 h sum (the archive holds no point before the rain
// began): both are conservative for a rule that needs rain to fire.
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PLACES } from "../lib/places.ts";
import { pickRain, groundStreetState, haversineKm } from "../lib/groundRain.ts";

const MIN = 60_000, HOUR = 3_600_000, LK = 5.5 * HOUR, STEP = 30 * MIN;
const RANK = { none: 0, possible: 1, likely: 2 };

export function parseCsv(text) {
  const rows = [];
  let cur = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { cur.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; cur.push(f); f = ""; if (cur.some((x) => x !== "")) rows.push(cur); cur = []; }
    else f += c;
  }
  if (f !== "" || cur.length) { cur.push(f); rows.push(cur); }
  const head = rows.shift() ?? [];
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

/** Events {zone, t0, t1}: window around the report. */
export function eventsFrom(rows) {
  const out = [];
  for (const r of rows) {
    const when = r.reported_lk || r.onset_lk || "";
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(when);
    if (!m) continue;
    const dayStart = Date.UTC(+m[1], +m[2] - 1, +m[3]) - LK;
    const hasTime = m[4] != null;
    const reportMs = hasTime ? dayStart + (+m[4]) * HOUR + (+m[5]) * MIN : dayStart + 24 * HOUR;
    const lat = parseFloat(r.lat), lon = parseFloat(r.lon);
    let zone = null;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      let best = null;
      for (const p of PLACES) if (p.rainZone) { const km = haversineKm({ lat, lon }, p); if (km <= 15 && (!best || km < best.km)) best = { km, zone: p.rainZone }; }
      zone = best?.zone ?? null;
    } else zone = "colombo-east";
    if (!zone) continue;
    out.push({ id: r.id, zone, t0: dayStart - 12 * HOUR, t1: reportMs + 3 * HOUR, reportMs, place: r.place });
  }
  return out;
}

/** device -> {n, i, lat, lon, pts: [[ms, mm24]] ascending} from the daily archive files. */
export function loadGaugeArchive(dir, from, to) {
  const root = path.join(dir, "hmis", "rain");
  const dev = new Map();
  if (!existsSync(root)) return dev;
  for (const y of readdirSync(root)) {
    for (const f of readdirSync(path.join(root, y))) {
      const day = f.replace(".json", "");
      if ((from && day < from) || (to && day > to)) continue;
      const j = JSON.parse(readFileSync(path.join(root, y, f), "utf8"));
      for (const [id, e] of Object.entries(j)) {
        const d = dev.get(id) ?? { device: id, n: e.name, i: e.institute, lat: e.lat, lon: e.lon, pts: [] };
        for (const p of e.pts) d.pts.push(p);
        dev.set(id, d);
      }
    }
  }
  for (const d of dev.values()) { d.pts.sort((a, b) => a[0] - b[0]); d.pts = d.pts.filter((p, i) => i === 0 || p[0] !== d.pts[i - 1][0]); }
  return dev;
}

/** The 4.5 h state of every gauge at time t, in the rain-live.json shape ([epoch minute, mm]). */
export function stateAt(dev, t) {
  const out = [];
  for (const d of dev.values()) {
    const pts = d.pts.filter((p) => p[0] <= t && p[0] > t - 4.5 * HOUR);
    if (!pts.length) continue;
    const first = pts[0];
    // the archive has no point before the rain began (zeros are only kept near the rain zones): the 24 h sum was 0 then
    const seeded = first[0] > t - 4.5 * HOUR + 30 * MIN && first[1] > 0 && !d.pts.some((p) => p[0] < first[0] && p[0] > first[0] - 24 * HOUR) ? [[Math.floor((t - 4.5 * HOUR) / MIN), 0], ...pts.map((p) => [Math.floor(p[0] / MIN), p[1]])] : pts.map((p) => [Math.floor(p[0] / MIN), p[1]]);
    out.push({ device: d.device, n: d.n, i: d.i, lat: d.lat, lon: d.lon, pts: seeded });
  }
  return out;
}

/** Satellite series from rain-correction/log/YYYY/*.jsonl: [{end, zones: {zone: {raw24, corr24}}}] */
export function loadCorrectionLog(dir) {
  const root = path.join(dir, "rain-correction", "log");
  const out = [];
  if (!existsSync(root)) return out;
  for (const y of readdirSync(root)) for (const f of readdirSync(path.join(root, y)))
    for (const ln of readFileSync(path.join(root, y, f), "utf8").split("\n")) { if (!ln.trim()) continue; try { const j = JSON.parse(ln); out.push({ end: Date.parse(j.end), zones: j.zones ?? {} }); } catch { /* skip */ } }
  return out.sort((a, b) => a.end - b.end);
}

const at3 = (series, t, maxAgeMs) => {
  let best = null;
  for (const s of series) { if (s.end <= t + 5 * MIN) best = s; else break; }
  return best && t - best.end <= maxAgeMs ? best : null;
};
const satState = (mm) => (mm == null ? null : mm >= 100 ? "likely" : mm >= 60 ? "possible" : "none");

/** The three rules' states for a zone at time t. */
export function statesAt({ zone, t, dev, corrLog }) {
  const towns = PLACES.filter((p) => p.rainZone === zone);
  const gauges = stateAt(dev, t);
  const c = at3(corrLog, t, 3 * HOUR);
  const z = c?.zones?.[zone];
  let ground = null, source = "none";
  for (const tw of towns) {
    const pick = pickRain(tw, gauges, t, { corr24: z?.corr24 });
    const v = pick.source === "ground" || pick.source === "corrected" ? groundStreetState(pick).state : null;
    if (v != null && (ground == null || RANK[v] > RANK[ground])) { ground = v; source = pick.source; }
    else if (ground == null && pick.source === "ground") { source = "ground"; }
  }
  return { sat: satState(z?.raw24 ?? null), corr: satState(z?.corr24 ?? null), ground, source };
}

export function score({ events, timeline }) {
  // timeline: [{t, zone, sat, corr, ground}]
  const rules = ["sat", "corr", "ground"], levels = ["possible", "likely"];
  const res = {};
  for (const rule of rules) for (const lv of levels) {
    let hit = 0, miss = 0, nodata = 0;
    const detail = [];
    for (const e of events) {
      const win = timeline.filter((s) => s.zone === e.zone && s.t >= e.t0 && s.t <= e.t1 && s[rule] != null);
      if (!win.length) { nodata++; detail.push({ id: e.id, result: "no data" }); continue; }
      const first = win.find((s) => RANK[s[rule]] >= RANK[lv]);
      if (first) { hit++; detail.push({ id: e.id, result: "hit", leadH: Math.round(((e.reportMs - first.t) / HOUR) * 10) / 10 }); } else { miss++; detail.push({ id: e.id, result: "miss" }); }
    }
    // alarm episodes
    let episodes = 0, unmatched = 0;
    for (const zone of new Set(timeline.map((s) => s.zone))) {
      const zs = timeline.filter((s) => s.zone === zone).sort((a, b) => a.t - b.t);
      let cur = null;
      const close = () => { if (!cur) return; episodes++; if (!events.some((e) => e.zone === zone && e.reportMs >= cur.start - 6 * HOUR && e.reportMs <= cur.end + 24 * HOUR)) unmatched++; cur = null; };
      for (const s of zs) {
        const on = s[rule] != null && RANK[s[rule]] >= RANK[lv];
        if (on) { if (cur && s.t - cur.end < 6 * HOUR) cur.end = s.t; else { close(); cur = { start: s.t, end: s.t }; } }
      }
      close();
    }
    res[`${rule}_${lv}`] = { hit, miss, noData: nodata, events: events.length, episodes, unmatchedEpisodes: unmatched, detail };
  }
  return res;
}

export function run({ dataDir, reportsCsv, from, to }) {
  const events = eventsFrom(parseCsv(readFileSync(reportsCsv, "utf8")));
  const dev = loadGaugeArchive(dataDir, from, to);
  const corrLog = loadCorrectionLog(dataDir);
  const ts = [...dev.values()].flatMap((d) => d.pts.map((p) => p[0]));
  if (!ts.length) return { error: "no archived HMIS rain in range", events: events.length };
  const t0 = Math.floor(Math.min(...ts) / STEP) * STEP, t1 = Math.max(...ts) + 6 * HOUR;
  const zones = [...new Set(PLACES.map((p) => p.rainZone).filter(Boolean))];
  const timeline = [];
  for (let t = t0; t <= t1; t += STEP) for (const zone of zones) timeline.push({ t, zone, ...statesAt({ zone, t, dev, corrLog }) });
  const inRange = events.filter((e) => e.t1 >= t0 && e.t0 <= t1);
  return { range: [new Date(t0).toISOString(), new Date(t1).toISOString()], gauges: dev.size, eventsTotal: events.length, eventsInArchive: inRange.length, scores: score({ events: inRange, timeline }) };
}

if (process.argv[1] && process.argv[1].endsWith("ground-rain-backtest.mts")) {
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
  const dataDir = a.find((x) => !x.startsWith("--") && ![opt("--reports"), opt("--from"), opt("--to"), opt("--json")].includes(x));
  if (!dataDir || !opt("--reports")) { console.error("usage: node --experimental-strip-types scripts/ground-rain-backtest.mts <dataDir> --reports <csv> [--from D] [--to D] [--json out]"); process.exit(1); }
  const r = run({ dataDir, reportsCsv: opt("--reports"), from: opt("--from"), to: opt("--to") });
  if (r.error) { console.log(r.error, `(${r.events} events in the file)`); process.exit(0); }
  console.log(`archive ${r.range[0]} .. ${r.range[1]}, ${r.gauges} gauges; ${r.eventsInArchive} of ${r.eventsTotal} reported events fall in it`);
  console.log("rule_level        hit  miss  nodata  alarm episodes  unmatched");
  for (const [k, v] of Object.entries(r.scores)) console.log(`${k.padEnd(16)} ${String(v.hit).padStart(4)} ${String(v.miss).padStart(5)} ${String(v.noData).padStart(7)} ${String(v.episodes).padStart(15)} ${String(v.unmatchedEpisodes).padStart(10)}`);
  if (opt("--json")) writeFileSync(opt("--json"), JSON.stringify(r, null, 1));
}
