// The nightly "observations -> models" pipeline, pure part (scripts/learn-all.mjs gathers the evidence and writes the files; tests:
// scripts/learn-all.test.mts). Builds on lib/learnedParams.mjs (answers / street level / rain mark / forecast factor).
//
// HARD RULES (owner, 27 Oct 2026), all enforced here or by the tests:
//  - Nothing learned changes an official step, a verdict, a push level or a live rule. Every output is a note, a proposal or a flag:
//    learned values are bounded and evidence-gated, proposals carry `proposed: true, wired: false`, and live switches stay the owner's call.
//  - The public file (learned/observations.jsonl lives on the public `data` branch) holds NO coordinates, hashes, person codes, notes or photos:
//    only an allowlist of fields (see PUBLIC_KEYS) and a 3-hour time bucket. Precise positions are used inside the job to join rain and
//    gauges and to find neighbours, then dropped. `assertPublicSafe` makes the job fail instead of writing anything else.
//  - Evidence is weighted by how trustworthy it is (`reportStrength`) but a single report can never set a number on its own.
import { K_MIN, MIN_DAYS, colomboDay, dedupe } from "./learnedParams.mjs";

const HOUR = 3_600_000, DAY = 864e5;
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fin = (v) => typeof v === "number" && Number.isFinite(v);

/** Great-circle km. */
export function km(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------------------------------------------------------- trust (2a)

/** Peak Nagalagam stage (ft) of the named floods, as scripts/flood3d/prep.py REPORT_STAGE. June 2024 and "other" have no known stage: not used. */
export const EVENT_STAGE_FT = { ditwah_2025: 8.4, may_2016: 7.64 };
export const GPS_GOOD_M = 50, GPS_OK_M = 150, GPS_BAD_M = 500;
/** Nearest-gauge choice for a 3D-map report: the two gauges the map is built on (stations.json coordinates). */
export const MAP_GAUGES = [
  { station: "Nagalagam Street", lat: 6.958265, lon: 79.878642 },
  { station: "Hanwella", lat: 6.9097, lon: 80.083126 },
];

const truthy = (v) => v === 1 || v === true || (typeof v === "string" && v !== "" && v !== "0");
/** Photo and EXIF columns are being added by the 3D-map work; read whichever name arrives, and treat absence as "no photo". */
export function photoInfo(r) {
  const has = truthy(r.photo_key) || truthy(r.photo) || truthy(r.has_photo) || truthy(r.photo_id) || truthy(r.photo_ok);
  const raw = r.exif_ok ?? r.exif_agree ?? r.photo_exif_ok ?? null;
  const exif = raw == null ? null : raw === 1 || raw === true || raw === "yes" || raw === "ok";
  return { photo: has, exif };
}

/**
 * How much a 3D-map report is worth as evidence. A bare answer is 1.0. Added: depth given +0.10, a good GPS fix (<= 50 m) +0.15 or an ok
 * one (<= 150 m) +0.05, a dragged pin -0.10, a photo +0.15 and a photo whose EXIF time and place agree +0.25, a recalled past flood -0.20.
 * Excluded (strength 0, with the reason in `flags`): owner-marked test / outlier rows, a contradicted report (see `neighbourFlags`),
 * a GPS fix worse than 500 m, a photo whose EXIF disagrees. Capped at 1.5 (< 2), so two reports are always needed for any number.
 */
export function reportStrength(r, { contradicted = false } = {}) {
  const flags = [];
  const { photo, exif } = photoInfo(r);
  if (r.src === "pin") flags.push("pin");
  if (r.src === "gps" && fin(r.acc_m) && r.acc_m > GPS_OK_M) flags.push("low-accuracy");
  if (photo) flags.push(exif === false ? "photo-disagrees" : exif === true ? "photo-agrees" : "photo");
  if (contradicted) flags.push("contradicted");
  if (r.status === "outlier") flags.push("outlier");
  if (r.status === "test") flags.push("test");
  const excluded = r.status === "test" || r.status === "outlier" || contradicted || exif === false || (r.src === "gps" && fin(r.acc_m) && r.acc_m > GPS_BAD_M);
  if (excluded) return { strength: 0, flags };
  let s = 1;
  if (r.depth) s += 0.1;
  if (r.src === "gps" && fin(r.acc_m)) s += r.acc_m <= GPS_GOOD_M ? 0.15 : r.acc_m <= GPS_OK_M ? 0.05 : 0;
  if (r.src === "pin") s -= 0.1;
  if (photo) s += exif === true ? 0.25 : 0.15;
  if (r.kind === "past_wet" || r.kind === "past_dry") s -= 0.2;
  return { strength: r2(clamp(s, 0.5, 1.5)), flags };
}

/**
 * A report is "contradicted" when at least two other people, within 400 m and within 6 h (or the same named event), reported the opposite
 * (wet vs dry) and they outnumber the agreeing others two to one. rows carry exact lat/lon: used here, never written out.
 * Returns the set of contradicted row ids.
 */
export function neighbourFlags(rows) {
  const wetOf = (r) => (r.kind === "water_now" || r.kind === "past_wet" ? true : r.kind === "past_dry" ? false : null);
  const out = new Set();
  for (const r of rows) {
    const w = wetOf(r);
    if (w == null || r.status === "test") continue;
    let agree = 0, oppose = 0;
    const seen = new Set([r.person_day]);
    for (const o of rows) {
      if (o === r || o.status === "test" || seen.has(o.person_day)) continue;
      const ow = wetOf(o);
      if (ow == null) continue;
      const sameWhen = r.kind === "water_now" && o.kind === "water_now" ? Math.abs(o.created_ms - r.created_ms) <= 6 * HOUR : r.event && r.event === o.event && r.kind !== "water_now" && o.kind !== "water_now";
      if (!sameWhen || km(r, o) > 0.4) continue;
      seen.add(o.person_day);
      if (ow === w) agree++; else oppose++;
    }
    if (oppose >= 2 && oppose >= 2 * agree) out.add(r.id);
  }
  return out;
}

/**
 * Street-water evidence items for lib/learnedParams.mjs streetLevelFact from 3D-map reports: "water here now" at the live level of the nearer of
 * the two map gauges, "flooded last time" at the named flood's peak (Nagalagam only). "Stayed dry" and map checks say where, not when: not level
 * evidence. Items: { station, level (ft), wet: true, strength, day, key }, one per report with strength > 0.
 */
export function floodStreetEvidence(rows, contradicted = new Set()) {
  const out = [];
  for (const r of rows) {
    if (r.kind !== "water_now" && r.kind !== "past_wet") continue;
    const { strength } = reportStrength(r, { contradicted: contradicted.has(r.id) });
    if (strength <= 0) continue;
    const g = MAP_GAUGES.map((x) => ({ ...x, d: km(r, x) })).sort((a, b) => a.d - b.d)[0];
    let level = null;
    if (r.kind === "water_now") level = g.station === "Hanwella" ? (fin(r.han_fast_ft) ? r.han_fast_ft : r.han_ft) : r.nag_ft;
    else if (g.station === "Nagalagam Street") level = EVENT_STAGE_FT[r.event] ?? null;
    if (!fin(level)) continue;
    out.push({ station: g.station, level, wet: true, strength, day: r.day, key: `p|${r.person_day}|${g.station}` });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- public rows (1)

/** Allowed keys of a public observation row, and of its nested parts. Anything else makes the job fail. */
export const PUBLIC_KEYS = {
  row: ["v", "id", "src", "kind", "day", "when", "area", "wet", "depth", "event", "answer", "riverSeen", "waterAt", "strength", "gauge", "townGauge", "rain", "forecast", "flags"],
  gauge: ["name", "ft", "rise3hFt", "km"],
  rain: ["source", "km", "mm1h", "mm3h", "mm24h"],
  forecast: ["nextFt", "dir", "tier", "err1hFt"],
  flags: ["check", "contradicted", "pin", "lowAccuracy", "photo", "exif", "outlier"],
};
export const OBS_VERSION = 1;
/** 3-hour Sri Lanka time bucket "09-12": finer times plus an area and a depth could identify a household. */
export const whenBucket = (ms) => {
  const h = new Date(ms + 19_800_000).getUTCHours();
  const a = Math.floor(h / 3) * 3;
  return `${String(a).padStart(2, "0")}-${String(a + 3).padStart(2, "0")}`;
};
const pick = (o, keys) => {
  const out = {};
  if (o) for (const k of keys) if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
  return Object.keys(out).length ? out : undefined;
};
/** Keep only the allowlisted fields of an internal observation. */
export function toPublic(o) {
  const row = pick(o, PUBLIC_KEYS.row.filter((k) => !["gauge", "townGauge", "rain", "forecast", "flags"].includes(k)));
  row.v = OBS_VERSION;
  for (const [k, keys] of [["gauge", PUBLIC_KEYS.gauge], ["townGauge", PUBLIC_KEYS.gauge], ["rain", PUBLIC_KEYS.rain], ["forecast", PUBLIC_KEYS.forecast], ["flags", PUBLIC_KEYS.flags]]) {
    const p = pick(o[k], keys);
    if (p) row[k] = p;
  }
  return row;
}
/** Throws when a row has any key outside the allowlist, or a value that looks like a coordinate pair, hash, e-mail or phone number. */
export function assertPublicSafe(rows) {
  const nested = { gauge: PUBLIC_KEYS.gauge, townGauge: PUBLIC_KEYS.gauge, rain: PUBLIC_KEYS.rain, forecast: PUBLIC_KEYS.forecast, flags: PUBLIC_KEYS.flags };
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (!PUBLIC_KEYS.row.includes(k)) throw new Error(`public row ${r.id}: key "${k}" is not allowed`);
      if (nested[k]) for (const k2 of Object.keys(v)) if (!nested[k].includes(k2)) throw new Error(`public row ${r.id}: key "${k}.${k2}" is not allowed`);
      if (typeof v === "string" && (/[0-9a-f]{16,}/i.test(v) || /@|https?:|\b\d{9,}\b/.test(v))) throw new Error(`public row ${r.id}: value of "${k}" looks private`);
    }
  }
  return true;
}

/** The reading of a [{ts, v}] series (time-sorted, feet) nearest to ms within maxGapMs, and how far it moved over the following spanMs. */
export function gaugeAt(series, ms, { maxGapMs = 40 * 60_000, spanMs = 3 * HOUR } = {}) {
  if (!series?.length) return null;
  let a = null, ad = Infinity;
  for (const p of series) { const d = Math.abs(p.ts - ms); if (d < ad) { ad = d; a = p; } }
  if (!a || ad > maxGapMs) return null;
  let b = null, bd = Infinity;
  for (const p of series) { const d = Math.abs(p.ts - (ms + spanMs)); if (d < bd) { bd = d; b = p; } }
  return { ft: r2(a.v), rise3hFt: b && bd <= maxGapMs ? r2(b.v - a.v) : null };
}

// ---------------------------------------------------------------------------------------------------------------- ground rain (2b)

export const GROUND_MIN_EVENTS = 3, GROUND_MIN_EVENT_DAYS = 2, GROUND_MIN_STEP_DAYS = 2;
export const GROUND_RECALL_POSSIBLE = 0.75, GROUND_RECALL_LIKELY = 0.5;
/** A proposal may move a current mark by at most this factor either way. */
export const GROUND_BAND = [0.5, 1.5];
const METRICS = {
  mm1h: { value: (s) => (fin(s.mm1h) || fin(s.peak1h) ? Math.max(s.mm1h ?? 0, s.peak1h ?? 0) : null), grid: range(10, 70, 5) },
  mm3h: { value: (s) => (fin(s.mm3h) ? s.mm3h : null), grid: range(20, 120, 5) },
  mm24h: { value: (s) => (fin(s.mm24h) ? s.mm24h : null), grid: range(25, 150, 5) },
};
function range(a, b, s) { const o = []; for (let v = a; v <= b; v += s) o.push(v); return o; }
/** Mirror of GROUND_RULE in lib/groundRain.ts (a test keeps them equal): the live shadow marks the proposals are compared with. */
export const CURRENT_GROUND = { possible: { mm1h: 30, mm3h: 50, mm24h: 50 }, likely: { mm1h: 50, mm3h: 75, mm24h: 75 } };

/**
 * Score one mark of one metric against reported street water. steps: [{ ms, v }] time-sorted (v null = unknown, skipped); events: [{ ms }].
 * HIT: some step within [event - 12 h, event + 3 h] is at or above the mark. SCORABLE: some step with a value lies in that window.
 * Alarm episode: consecutive steps at or above the mark (gaps under 6 h merged); UNMATCHED when no event lies in [start - 6 h, end + 24 h].
 */
export function scoreMark(steps, events, mark) {
  let hits = 0, scorable = 0;
  for (const e of events) {
    const w = steps.filter((s) => s.v != null && s.ms >= e.ms - 12 * HOUR && s.ms <= e.ms + 3 * HOUR);
    if (!w.length) continue;
    scorable++;
    if (w.some((s) => s.v >= mark)) hits++;
  }
  const eps = [];
  for (const s of steps) {
    if (s.v == null || s.v < mark) continue;
    const last = eps[eps.length - 1];
    if (last && s.ms - last.end <= 6 * HOUR) last.end = s.ms; else eps.push({ start: s.ms, end: s.ms });
  }
  const unmatched = eps.filter((p) => !events.some((e) => e.ms >= p.start - 6 * HOUR && e.ms <= p.end + 24 * HOUR)).length;
  return { events: scorable, hits, episodes: eps.length, unmatched };
}

/**
 * Per zone and metric, the highest mark that still catches GROUND_RECALL_POSSIBLE of the scorable reported street-water events (fewest
 * unmatched alarms), and the highest that catches GROUND_RECALL_LIKELY (not below the possible mark), clamped to GROUND_BAND x the current
 * mark. log: [{ zone, ms, mm1h, mm3h, mm24h, peak1h }] shadow log rows (ground / corrected tiers only); events: [{ zone, ms, day, key }]
 * independent wet reports (weak or flagged evidence already removed). Output: proposals only (`proposed: true, wired: false`), with the
 * backtest of the proposal and of the current mark on the same steps. A zone below the evidence gates only says what it is waiting for.
 */
export function fitGroundRain(log, events) {
  const out = {};
  const zones = [...new Set([...log.map((l) => l.zone), ...events.map((e) => e.zone)])].sort();
  for (const zone of zones) {
    const L = log.filter((l) => l.zone === zone).sort((a, b) => a.ms - b.ms);
    const ev = dedupe(events.filter((e) => e.zone === zone).sort((a, b) => a.ms - b.ms), (e) => `${e.key}|${e.day}`);
    const stepDays = new Set(L.map((l) => colomboDay(l.ms))).size;
    const evDays = new Set(ev.map((e) => e.day)).size;
    const z = { proposed: true, wired: false, steps: L.length, stepDays, events: ev.length, eventDays: evDays };
    const why = ev.length < GROUND_MIN_EVENTS || evDays < GROUND_MIN_EVENT_DAYS ? `needs ${GROUND_MIN_EVENTS} independent street-water reports on ${GROUND_MIN_EVENT_DAYS} days (has ${ev.length} on ${evDays})`
      : stepDays < GROUND_MIN_STEP_DAYS ? `needs ${GROUND_MIN_STEP_DAYS} days of shadow-log steps (has ${stepDays})` : null;
    if (why) { z.pending = why; out[zone] = z; continue; }
    z.metrics = {};
    for (const [name, m] of Object.entries(METRICS)) {
      const steps = L.map((l) => ({ ms: l.ms, v: m.value(l) }));
      if (!steps.some((s) => s.v != null)) continue;
      const scored = m.grid.map((mark) => ({ mark, ...scoreMark(steps, ev, mark) }));
      const n = scored[0].events;
      if (n < GROUND_MIN_EVENTS) continue;
      const best = (recall, lo) => {
        const ok = scored.filter((s) => s.mark >= lo && s.hits / s.events >= recall);
        return ok.length ? ok.reduce((a, b) => (b.mark > a.mark || (b.mark === a.mark && b.unmatched < a.unmatched) ? b : a)) : null;
      };
      const cur = CURRENT_GROUND;
      const bandLo = (c) => Math.round((c * GROUND_BAND[0]) / 5) * 5, bandHi = (c) => Math.round((c * GROUND_BAND[1]) / 5) * 5;
      const p = best(GROUND_RECALL_POSSIBLE, 0), pm = p ? clamp(p.mark, bandLo(cur.possible[name]), bandHi(cur.possible[name])) : null;
      const l = best(GROUND_RECALL_LIKELY, pm ?? 0), lm = l ? clamp(l.mark, Math.max(pm ?? 0, bandLo(cur.likely[name])), bandHi(cur.likely[name])) : null;
      const sc = (mark) => (mark == null ? null : (({ events, hits, episodes, unmatched }) => ({ events, hits, episodes, unmatched }))(scoreMark(steps, ev, mark)));
      z.metrics[name] = {
        current: { possible: cur.possible[name], likely: cur.likely[name] },
        proposed: { possible: pm, likely: lm },
        backtest: { atProposedPossible: sc(pm), atCurrentPossible: sc(cur.possible[name]), atProposedLikely: sc(lm), atCurrentLikely: sc(cur.likely[name]) },
      };
    }
    if (!Object.keys(z.metrics).length) z.pending = "no scorable events in the shadow-log window";
    out[zone] = z;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- forecast feature (2c)

export const FEATURE_MIN_TEST_N = 8, FEATURE_MIN_DAYS = 2, FEATURE_MIN_GAIN = 0.05, FEATURE_N0 = 10, FEATURE_BETA = [0, 0.8], FEATURE_LOOKBACK_MS = 3 * HOUR;

/**
 * Do recent public "worse while rising" reports at a gauge predict that the forecast is too low? rows: [{ st, t (issue ms), h, c, p, y }] in feet
 * (the same backtest rows as momentumBacktest, 1 h and 3 h horizons here); reports: [{ station, ms }] independent "worse" answers on a RISING gauge
 * that were not marked far from the gauge. Feature f = number of such reports for that gauge in the 3 h up to the issue time (capped 3), known when
 * the forecast was made. Correction p' = p + beta * f, beta = least squares of (y - p) on f over the OTHER days (leave-one-day-out), shrunk by
 * n / (n + 10) and kept in [0, 0.8] ft per report (under-forecast only). Scored on the rows that have f > 0. `useful` only when the pooled miss on those
 * rows falls by at least 5% over at least 8 held-out points on 2 days; even then `wired` stays false (owner approval).
 */
export function worseFeatureTest(rows, reports) {
  const byH = {};
  for (const h of [1, 3]) {
    const R = rows.filter((r) => r.h === h && [r.c, r.p, r.y].every(fin)).map((r) => {
      let f = 0;
      for (const w of reports) if (w.station === r.st && w.ms <= r.t && w.ms > r.t - FEATURE_LOOKBACK_MS) f++;
      return { ...r, f: Math.min(3, f), day: colomboDay(r.t) };
    });
    const withF = R.filter((r) => r.f > 0);
    const days = [...new Set(withF.map((r) => r.day))].sort();
    let base = 0, fit = 0, n = 0, betaAll = null;
    const testDays = new Set();
    for (const D of days) {
      const tr = withF.filter((r) => r.day !== D);
      if (tr.length < 3) continue;
      let num = 0, den = 0;
      for (const r of tr) { num += (r.y - r.p) * r.f; den += r.f * r.f; }
      const beta = clamp((num / den) * (tr.length / (tr.length + FEATURE_N0)), FEATURE_BETA[0], FEATURE_BETA[1]);
      for (const r of withF.filter((x) => x.day === D)) { base += Math.abs(r.y - r.p); fit += Math.abs(r.y - (r.p + beta * r.f)); n++; testDays.add(D); }
    }
    if (withF.length >= 3) {
      let num = 0, den = 0;
      for (const r of withF) { num += (r.y - r.p) * r.f; den += r.f * r.f; }
      betaAll = r2(clamp((num / den) * (withF.length / (withF.length + FEATURE_N0)), FEATURE_BETA[0], FEATURE_BETA[1]));
    }
    const gain = n && base > 0 ? (base - fit) / base : null;
    byH[h] = { rowsWithReports: withF.length, testN: n, testDays: testDays.size, maeBase: n ? r2(base / n) : null, maeFit: n ? r2(fit / n) : null, gainPct: gain == null ? null : Math.round(gain * 100), beta: betaAll };
  }
  const useful = Object.values(byH).some((x) => x.testN >= FEATURE_MIN_TEST_N && x.testDays >= FEATURE_MIN_DAYS && (x.gainPct ?? 0) >= FEATURE_MIN_GAIN * 100);
  return { horizons: byH, reports: reports.length, useful, wired: false };
}

// ---------------------------------------------------------------------------------------------------------------- map refit trigger (2d)

export const REFIT_MIN_NEW = 10, REFIT_MIN_PEOPLE = 3;
/**
 * When has a reach collected enough NEW trustworthy 3D-map reports to be worth re-running the heavy per-cell fit (scripts/flood3d/prep.py)?
 * rows: [{ area, status, strength, person_day }] (status 'new' = not yet used by a fit; the exact positions stay in the job). Due when at least
 * REFIT_MIN_NEW new reports of strength > 0 from at least REFIT_MIN_PEOPLE different people. `areas` lists reaches to report even with no reports yet. The job only raises a flag; the fit is run by hand.
 */
export function mapRefitStatus(rows, areas = []) {
  const out = {};
  for (const area of [...new Set([...areas, ...rows.map((r) => r.area)])].sort()) {
    const mine = rows.filter((r) => r.area === area && r.strength > 0);
    const fresh = mine.filter((r) => r.status === "new");
    const people = new Set(fresh.map((r) => r.person_day)).size;
    out[area] = { trusted: mine.length, newTrusted: fresh.length, newPeople: people, needNew: REFIT_MIN_NEW, needPeople: REFIT_MIN_PEOPLE, due: fresh.length >= REFIT_MIN_NEW && people >= REFIT_MIN_PEOPLE };
  }
  return out;
}

/** Areas and gauges that need more reports, most lacking first: from the refit status and the street-level / rain-mark "pending" list. */
export function coverageGaps(refit, pending = []) {
  const gaps = [];
  for (const [area, s] of Object.entries(refit)) if (!s.due) gaps.push({ kind: "map", name: area, have: s.newTrusted, need: s.needNew, missing: Math.max(0, s.needNew - s.newTrusted) });
  for (const p of pending) gaps.push({ kind: p.kind, name: p.station ?? p.zone, have: p.n, need: p.needN, missing: Math.max(0, p.needN - p.n), ...(p.why ? { why: p.why } : {}) });
  return gaps.sort((a, b) => b.missing - a.missing).slice(0, 10);
}

// ---------------------------------------------------------------------------------------------------------------- owner text (3)

/** Slack / dashboard lines for the "What we learned" block. `learned` = the learned/learned.json this job writes. */
export function whatWeLearnedLines(L) {
  if (!L) return [];
  const out = [];
  const c = L.counts ?? {};
  out.push(`Observations: ${c.total ?? 0} in the table (${c.feedback ?? 0} answers, ${c.street ?? 0} street reports, ${c.flood3d ?? 0} 3D-map reports; ${c.newTonight ?? 0} added tonight, ${c.trusted ?? 0} trusted map reports, ${c.flagged ?? 0} flagged).`);
  for (const ch of L.changes ?? []) out.push(`Changed: ${ch}`);
  if (!(L.changes ?? []).length) out.push("Changed: no learned value moved.");
  const waiting = Object.entries(L.groundRain ?? {}).filter(([, z]) => z.pending);
  if (waiting.length) out.push(`Ground-rain marks: waiting for evidence in ${waiting.length} zone${waiting.length === 1 ? "" : "s"} (${waiting.map(([zn, z]) => `${zn}: ${z.events ?? 0} reports on ${z.eventDays ?? 0} days, ${z.stepDays ?? 0} days of steps`).slice(0, 4).join("; ")}); each needs 3 reports on 2 days and 2 days of shadow steps.`);
  for (const [zone, z] of Object.entries(L.groundRain ?? {})) {
    if (z.pending) continue;
    for (const [name, m] of Object.entries(z.metrics ?? {})) {
      const b = m.backtest, pp = m.proposed;
      if (pp.possible == null) continue;
      out.push(`Proposed (not live) ${zone} ${name}: possible ${m.current.possible} -> ${pp.possible} mm${pp.likely != null ? `, likely ${m.current.likely} -> ${pp.likely} mm` : ""}; backtest at proposed ${b.atProposedPossible?.hits}/${b.atProposedPossible?.events} floods caught, ${b.atProposedPossible?.unmatched} unmatched alarms (current mark: ${b.atCurrentPossible?.hits}/${b.atCurrentPossible?.events}, ${b.atCurrentPossible?.unmatched} unmatched).`);
    }
  }
  const f = L.forecast;
  if (f?.momentum) {
    const h = Object.entries(f.momentum.horizons ?? {}).filter(([, x]) => x?.n).map(([k, x]) => `${k} h ${x.maeBase}->${x.maeFit} ft (${x.gainPct}%)`);
    out.push(`Forecast correction per gauge: ${h.join("; ") || "no test points"}. ${f.momentum.useful ? "Passes the test (not wired: owner approval)." : "No gain yet."}`);
  }
  if (f?.worseFeature) {
    const w = f.worseFeature, h1 = w.horizons?.[1], h3 = w.horizons?.[3];
    out.push(`"Worse while rising" reports as a forecast feature: ${w.reports} reports, held-out points 1 h ${h1?.testN ?? 0}, 3 h ${h3?.testN ?? 0}; ${w.useful ? `reduces the miss (1 h ${h1?.gainPct ?? "-"}%, 3 h ${h3?.gainPct ?? "-"}%), not wired` : "no gain yet / not enough points"}.`);
  }
  const due = Object.entries(L.mapRefit ?? {}).filter(([, s]) => s.due).map(([a, s]) => `${a} (${s.newTrusted} new from ${s.newPeople} people)`);
  if (due.length) out.push(`3D-map re-fit due: ${due.join("; ")}. Run scripts/flood3d/prep.py by hand.`);
  const gaps = (L.gaps ?? []).slice(0, 5).map((g) => `${g.name} ${g.have}/${g.need}`);
  if (gaps.length) out.push(`Needs more reports: ${gaps.join("; ")}.`);
  return out;
}

/** Values that moved between two nightly files, as short lines (counts and numbers only). */
export function diffLearned(prev, next) {
  const out = [];
  const old = prev?.groundRain ?? {};
  for (const [zone, z] of Object.entries(next.groundRain ?? {})) {
    for (const [name, m] of Object.entries(z.metrics ?? {})) {
      const o = old[zone]?.metrics?.[name]?.proposed;
      if (m.proposed.possible != null && o?.possible !== m.proposed.possible) out.push(`${zone} ${name} proposed possible mark ${o?.possible ?? "none"} -> ${m.proposed.possible} mm (proposal only)`);
    }
  }
  if ((prev?.forecast?.momentum?.useful ?? false) !== (next.forecast?.momentum?.useful ?? false)) out.push(`forecast correction test now ${next.forecast.momentum.useful ? "passes" : "fails"}`);
  if ((prev?.forecast?.worseFeature?.useful ?? false) !== (next.forecast?.worseFeature?.useful ?? false)) out.push(`worse-while-rising feature test now ${next.forecast.worseFeature.useful ? "passes" : "fails"}`);
  for (const [a, s] of Object.entries(next.mapRefit ?? {})) if (s.due && !prev?.mapRefit?.[a]?.due) out.push(`3D-map re-fit now due in ${a}`);
  return out;
}

export { K_MIN, MIN_DAYS, DAY };
