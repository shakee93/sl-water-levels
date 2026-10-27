// What visitors' answers teach us, as a few bounded numbers. Pure (no imports, no I/O, no clock): scripts/feedback-learn.mjs gathers the
// evidence from Cloudflare D1 once a day and calls buildParams(); the website reads the result (lib/learned.ts) and the Slack digest
// prints it (learnedLines). scripts/feedback-learn.test.mts covers the maths.
//
// HARD RULES (owner, 27 Oct 2026)
//  - The verdict STEP stays the Irrigation Department's (Normal, Alert, Minor flood, Major flood). Nothing here is read by the step, the pill,
//    the sticky bar or the tone. Learned values only tune NOTES, heads-ups (the street-water note, the opt-in street-water push) and, if the
//    backtest says it helps, the forecast.
//  - A number is emitted only with evidence: at least K_MIN INDEPENDENT answers (one per person per day per target; the salted per-day IP
//    hash is used to tell people apart inside the job and is never written out) on at least MIN_DAYS separate days. Otherwise the default
//    stays and the file only says how far along the evidence is ("pending").
//  - Every learned value is clamped to a band around its default, so one bad report cannot swing anything.
//  - The file holds counts and numbers only: no notes, no places, no coordinates, no tokens, no hashes.

export const PARAMS_VERSION = 1;
/** Independent answers needed before a number is emitted (same floor as the public aggregates in lib/feedbackLearn.mjs). */
export const K_MIN = 3;
/** ... on at least this many separate Sri Lanka days. */
export const MIN_DAYS = 2;
/** Street-water gauge level: never below this fraction of the gauge's official minor-flood mark, never above the mark itself. */
export const STREET_FLOOR_FRAC = 0.6;
/** Street-water rain mark ("possible"): the live rule says 60 mm of 24 h satellite rain (hourly clip 15 mm); learned value stays in [45, 60] (45 = the shadow rule's wet-week mark). */
export const RAIN_POSSIBLE_DEFAULT_MM = 60;
export const RAIN_POSSIBLE_MIN_MM = 45;
/** Share of the independent answers at or above a learned mark that must say "water on the street", else the mark is contested and not emitted. */
export const MIN_WET_SHARE = 0.5;
/** Forecast momentum factor: shrink toward 1 with N0 points of weight, and keep it in [K_LO, K_HI]. */
export const MOMENTUM_N0 = 30;
export const K_LO = 0.8;
export const K_HI = 1.5;
/** A per-gauge momentum factor is emitted only when its own walk-forward test beat "no factor" by this much, on this many test points over this many test days. */
export const MOMENTUM_MIN_GAIN = 0.05;
export const MOMENTUM_MIN_TEST_N = 20;
export const MOMENTUM_MIN_TRAIN_N = 30;
export const HORIZONS = [1, 3, 6];

const COLOMBO_MS = 5.5 * 3_600_000;
export const colomboDay = (ms) => new Date(ms + COLOMBO_MS).toISOString().slice(0, 10);
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** First item per key (rows in time order): one person counts once per day per target. */
export function dedupe(items, keyOf) {
  const seen = new Set(), out = [];
  for (const it of items) {
    const k = keyOf(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}
/**
 * One feedback row as street-water evidence at the gauge level shown, or null. "Where is the water now?" (water_at) beats the older
 * river observation: road / yard / inside = water on the streets (strong evidence, the person looked at the water itself), none = no
 * water, just a higher river (strong dry). Without water_at the river observation is used as before (flooding roads or homes = wet).
 * A bare "worse" with neither says nothing about water, so it gives no evidence.
 */
export function feedbackWetness(waterAt, riverObs) {
  if (waterAt === "road" || waterAt === "yard" || waterAt === "inside") return { wet: true, strong: true };
  if (waterAt === "none") return { wet: false, strong: true };
  if (riverObs) return { wet: riverObs === "flooding", strong: false };
  return null;
}
/** Stable sort that puts strong observations first, so a person's strong answer wins when they gave both. */
const strongFirst = (items) => items.map((i, n) => [i, n]).sort((a, b) => (b[0].strong ? 1 : 0) - (a[0].strong ? 1 : 0) || a[1] - b[1]).map((x) => x[0]);

const dayCount = (items) => new Set(items.map((i) => i.day)).size;

/** The reading in a time-sorted series [{ts, v}] nearest to ms, when it is within maxGapMs; else null. */
export function nearest(series, ms, maxGapMs) {
  let best = null, bd = Infinity;
  for (const p of series) {
    const d = Math.abs(p.ts - ms);
    if (d < bd) { bd = d; best = p; }
  }
  return best && bd <= maxGapMs ? best : null;
}

/**
 * Street-water level of one gauge: the gauge reading (feet) at which people near it start reporting water on roads or in homes.
 * items: [{ level (ft), wet (true = water on the street, false = no), day, key }] where key identifies the person that day.
 * Estimate = the second-lowest level at which independent people reported street water (one early report cannot set it), clamped to
 * [0.6 x minor mark, minor mark]. Emitted only if >= K_MIN independent wet answers on >= MIN_DAYS days, the gauge has a minor mark, and at
 * least half of the independent answers at or above the estimate say wet. Returns { fact } or { pending } (counts only).
 */
export function streetLevelFact(rawItems, minorFt) {
  const items = strongFirst(rawItems);
  const wetAll = dedupe(items.filter((i) => i.wet), (i) => i.key);
  const n = wetAll.length, days = dayCount(wetAll);
  const pending = { n, days, needN: K_MIN, needDays: MIN_DAYS };
  if (n < K_MIN || days < MIN_DAYS) return { pending };
  if (!(minorFt > 0)) return { pending: { ...pending, why: "no official minor mark" } };
  const levels = wetAll.map((i) => i.level).sort((a, b) => a - b);
  const raw = levels[1];
  const ft = clamp(raw, STREET_FLOOR_FRAC * minorFt, minorFt);
  const above = dedupe(items.filter((i) => i.level >= raw - 1e-9), (i) => i.key); // judged at the raw estimate: a clamped value may have no answers around it
  const wetShare = above.length ? above.filter((i) => i.wet).length / above.length : 0;
  if (wetShare < MIN_WET_SHARE) return { pending: { ...pending, why: "contested" } };
  const dryBelow = dedupe(items.filter((i) => !i.wet && i.level < ft), (i) => i.key).length;
  return { fact: { ft: r1(ft), n, days, defaultFt: r1(minorFt), clamped: ft !== raw, dryBelowN: dryBelow } };
}

/**
 * Rain mark for "street water possible" in one rain zone (24 h satellite rain, hourly clip 15 mm). items: [{ mm, wet, day, key }] from the
 * street-flood reports (deep or little = wet, dry = not). Same estimator and gates as streetLevelFact, clamped to [45, 60] mm and rounded
 * to 5 mm. Also returns the typical rain of wet and dry reports (medians, counts) as evidence.
 */
export function rainFact(items) {
  const wetAll = dedupe(items.filter((i) => i.wet), (i) => i.key);
  const dryAll = dedupe(items.filter((i) => !i.wet), (i) => i.key);
  const n = wetAll.length, days = dayCount(wetAll);
  const pending = { n, days, needN: K_MIN, needDays: MIN_DAYS };
  if (n < K_MIN || days < MIN_DAYS) return { pending };
  const mms = wetAll.map((i) => i.mm).sort((a, b) => a - b);
  const raw = mms[1];
  const mark = clamp(Math.round(raw / 5) * 5, RAIN_POSSIBLE_MIN_MM, RAIN_POSSIBLE_DEFAULT_MM);
  const above = dedupe(items.filter((i) => i.mm >= raw - 1e-9), (i) => i.key);
  const share = above.length ? above.filter((i) => i.wet).length / above.length : 0;
  if (share < MIN_WET_SHARE) return { pending: { ...pending, why: "contested" } };
  return { fact: { possibleMm: mark, n, days, defaultMm: RAIN_POSSIBLE_DEFAULT_MM, clamped: mark !== Math.round(raw / 5) * 5, wetMedianMm: r1(median(mms)), dryN: dryAll.length, dryMedianMm: dryAll.length ? r1(median(dryAll.map((i) => i.mm))) : null } };
}

/**
 * How the "Is this right?" answers split for one gauge when it is rising / falling (evidence for the digest and the About card; no
 * parameter is wired to it). rows: [{ answer, dir ('rising' | 'falling' | 'steady' | null), day, key }]. Judged = yes, worse, better.
 */
export function directionFact(rows, dir) {
  const judged = dedupe(rows.filter((r) => r.dir === dir && (r.answer === "yes" || r.answer === "worse" || r.answer === "better")), (r) => r.key + "|" + r.answer);
  if (!judged.length) return null;
  const c = { yes: 0, worse: 0, better: 0 };
  for (const r of judged) c[r.answer]++;
  const errs = judged.filter((r) => Number.isFinite(r.err1h)).map((r) => r.err1h);
  // err1h = what the gauge read an hour later minus the next-hour forecast shown (ft): > 0 means the river ended above our forecast
  return { n: judged.length, days: dayCount(judged), yes: c.yes, worse: c.worse, better: c.better, ...(errs.length ? { errN: errs.length, meanErrFt: r2(mean(errs)) } : {}) };
}

const OBS_RANK = { normal: 0, high: 1, banks: 2, flooding: 3 };
const TIER_RANK = { normal: 0, watch: 0, alert: 1, minor: 2, major: 3 };
/**
 * What people saw against the step they were shown: higher / same / lower (counts). rows: [{ riverObs, tier, tierOk, day, key }]; tierOk is false
 * for station-page rows saved before 27 Oct 2026 11:16 (commit 961440f), which stored the raw gauge tier instead of the shown step.
 * Ladders: what they saw normal 0, high 1, over its banks 2, flooding 3; the step shown normal 0 (the internal "watch" reads Normal), alert 1, minor 2, major 3.
 */
export function seenFact(rows) {
  const ok = dedupe(rows.filter((r) => r.tierOk && r.riverObs in OBS_RANK && r.tier in TIER_RANK), (r) => r.key);
  const c = { n: ok.length, higher: 0, same: 0, lower: 0 };
  for (const r of ok) { const d = OBS_RANK[r.riverObs] - TIER_RANK[r.tier]; c[d > 0 ? "higher" : d < 0 ? "lower" : "same"]++; }
  return c.n ? c : null;
}

/** Momentum factor k for p' = c + k * (p - c): least squares of (y - c) on (p - c), shrunk toward 1 by n / (n + N0), clamped to [K_LO, K_HI]. */
export function fitK(rows) {
  let num = 0, den = 0;
  for (const r of rows) { num += (r.p - r.c) * (r.y - r.c); den += (r.p - r.c) ** 2; }
  if (rows.length === 0 || den < 1e-9) return 1;
  const w = rows.length / (rows.length + MOMENTUM_N0);
  return clamp(1 + (num / den - 1) * w, K_LO, K_HI);
}

/**
 * Would a per-gauge momentum factor have reduced the error? Walk-forward by Sri Lanka day: for each day D, k is fitted per gauge and horizon
 * on rows from days before D only (needs MOMENTUM_MIN_TRAIN_N points, else k = 1) and scored on day D. rows: [{ st, t (issued ms), h, c, p, y }]
 * in feet (c = level at issue, p = forecast, y = what the gauge read at the target time). Returns
 *   horizons[h] = { n, maeBase, maeFit, gainPct, maePooled, pooledGainPct }   (all test points together; "Pooled" = one factor for all gauges)
 *   gauges[st][h] = { k (fitted on all rows), nTrain, testN, testDays, gainPct }   only where it passes every gate
 *   useful = true when the pooled gain at every horizon with enough test points is >= MOMENTUM_MIN_GAIN
 */
export function momentumBacktest(rows) {
  const horizons = {}, gauges = {};
  const per = {}; // st|h -> { base: [], fit: [], days: Set }
  for (const h of HORIZONS) {
    const R = rows.filter((r) => r.h === h && [r.c, r.p, r.y].every(Number.isFinite)).map((r) => ({ ...r, day: colomboDay(r.t) }));
    const days = [...new Set(R.map((r) => r.day))].sort();
    let base = 0, fit = 0, n = 0, pool = 0;
    for (const D of days.slice(1)) {
      const train = R.filter((r) => r.day < D), test = R.filter((r) => r.day === D);
      const kPool = fitK(train); // one factor for every gauge, for comparison
      const kOf = {};
      for (const st of new Set(test.map((r) => r.st))) {
        const tr = train.filter((r) => r.st === st);
        kOf[st] = tr.length >= MOMENTUM_MIN_TRAIN_N ? fitK(tr) : 1;
      }
      for (const r of test) {
        const b = Math.abs(r.y - r.p), f = Math.abs(r.y - (r.c + kOf[r.st] * (r.p - r.c)));
        base += b; fit += f; n++;
        pool += Math.abs(r.y - (r.c + kPool * (r.p - r.c)));
        const cell = (per[`${r.st}|${h}`] ??= { base: 0, fit: 0, n: 0, days: new Set() });
        cell.base += b; cell.fit += f; cell.n++; cell.days.add(D);
      }
    }
    horizons[h] = { n, maeBase: n ? r2(base / n) : null, maeFit: n ? r2(fit / n) : null, gainPct: n && base > 0 ? Math.round(((base - fit) / base) * 100) : null, maePooled: n ? r2(pool / n) : null, pooledGainPct: n && base > 0 ? Math.round(((base - pool) / base) * 100) : null };
    for (const st of new Set(R.map((r) => r.st))) {
      const cell = per[`${st}|${h}`];
      const all = R.filter((r) => r.st === st);
      if (!cell || all.length < MOMENTUM_MIN_TRAIN_N || cell.n < MOMENTUM_MIN_TEST_N || cell.days.size < MIN_DAYS || cell.base <= 0) continue;
      const gain = (cell.base - cell.fit) / cell.base;
      if (gain < MOMENTUM_MIN_GAIN) continue;
      (gauges[st] ??= {})[h] = { k: r2(fitK(all)), nTrain: all.length, testN: cell.n, testDays: cell.days.size, gainPct: Math.round(gain * 100) };
    }
  }
  const scored = HORIZONS.filter((h) => horizons[h].n >= MOMENTUM_MIN_TEST_N);
  const useful = scored.length > 0 && scored.every((h) => (horizons[h].gainPct ?? 0) >= MOMENTUM_MIN_GAIN * 100);
  return { horizons, gauges, useful };
}

/**
 * The whole file. Input (all evidence already joined by the job; no personal data beyond the per-day person key, which is dropped here):
 *   now                 ms
 *   answers             [{ station, town, answer, dir, riverObs, tier, tierOk, err1h (ft or null), day, key }]   one per "Is this right?" row
 *   streetEvidence      [{ station, level (ft), wet, day, key }]              feedback with a river observation + street-flood reports matched to a gauge reading
 *   rainEvidence        [{ zone, mm, wet, day, key }]                         street-flood reports matched to the satellite rain of the town's zone
 *   reports             [{ town, answer ('deep' | 'little' | 'dry'), day }]
 *   marks               { [station]: { minorFt, alertFt } }                   official marks, from the forecast log
 *   backtestRows        [{ st, t, h, c, p, y }]
 */
export function buildParams({ now, answers = [], streetEvidence = [], rainEvidence = [], reports = [], marks = {}, backtestRows = [], window = null }) {
  const stations = {}, zones = {}, towns = {}, pending = [];
  const st = (name) => (stations[name] ??= {});
  // answers per gauge
  for (const name of new Set(answers.map((a) => a.station).filter(Boolean))) {
    const mine = answers.filter((a) => a.station === name);
    const ind = dedupe(mine, (a) => `${a.key}|${a.answer}|${a.dir}`);
    const c = { yes: 0, worse: 0, better: 0, unsure: 0 };
    for (const a of ind) if (a.answer in c) c[a.answer]++;
    const o = st(name);
    o.answers = { n: ind.length, days: dayCount(ind), ...c };
    const rising = directionFact(mine, "rising"), falling = directionFact(mine, "falling");
    const seen = seenFact(mine.map((a) => ({ riverObs: a.riverObs, tier: a.tier, tierOk: a.tierOk, key: a.key })));
    if (seen) o.seen = seen;
    if (rising) o.rising = rising;
    if (falling) o.falling = falling;
  }
  // street-water level per gauge
  for (const name of new Set(streetEvidence.map((e) => e.station))) {
    const r = streetLevelFact(streetEvidence.filter((e) => e.station === name), marks[name]?.minorFt);
    if (r.fact) st(name).streetLevel = r.fact;
    else if (r.pending.n > 0) pending.push({ kind: "streetLevel", station: name, ...r.pending });
  }
  // rain mark per zone
  for (const zone of new Set(rainEvidence.map((e) => e.zone))) {
    const r = rainFact(rainEvidence.filter((e) => e.zone === zone));
    if (r.fact) (zones[zone] ??= {}).streetRain = r.fact;
    else if (r.pending.n > 0) pending.push({ kind: "streetRain", zone, ...r.pending });
  }
  // street-flood report counts per town (the "did your street flood" answers), counts only
  for (const town of new Set(reports.map((r) => r.town))) {
    const mine = reports.filter((r) => r.town === town);
    towns[town] = { reports: mine.length, days: dayCount(mine), deep: mine.filter((r) => r.answer === "deep").length, little: mine.filter((r) => r.answer === "little").length, dry: mine.filter((r) => r.answer === "dry").length };
  }
  // forecast momentum
  const bt = momentumBacktest(backtestRows);
  // 40 gauges x 3 horizons: some will beat "no factor" by chance, so per-gauge factors are kept only when the pooled walk-forward gain is real too
  if (bt.useful) for (const [name, byH] of Object.entries(bt.gauges)) st(name).momentum = byH;
  const forecast = {
    window,
    horizons: bt.horizons,
    gaugesPassingOwnTest: Object.keys(bt.gauges).length,
    // Wired into lib/forecast.ts only if this is true AND the owner turns it on; the site ignores `momentum` while wired = false.
    useful: bt.useful,
    wired: false,
  };
  const people = dedupe(answers, (a) => `${a.key}|${a.station}|${a.town}`).length;
  return {
    version: PARAMS_VERSION,
    updatedAt: new Date(now).toISOString(),
    asOf: colomboDay(now),
    minimums: { answers: K_MIN, days: MIN_DAYS, streetFloorFrac: STREET_FLOOR_FRAC, rainPossibleMm: [RAIN_POSSIBLE_MIN_MM, RAIN_POSSIBLE_DEFAULT_MM], momentumGainPct: MOMENTUM_MIN_GAIN * 100 },
    totals: { answers: answers.length, people, streetReports: reports.length, days: dayCount(answers) },
    stations,
    zones,
    towns,
    pending: pending.sort((a, b) => b.n - a.n).slice(0, 12),
    forecast,
  };
}

// ---- reading the file (website, digest). All defensive: the file is on a public branch and may be old or hand-edited.

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** The learned street-water level (ft) of a gauge, or null. Re-checked against the same bounds the job uses. */
export function streetLevelOf(params, station) {
  const f = params?.stations?.[station]?.streetLevel;
  const ft = num(f?.ft), def = num(f?.defaultFt), n = num(f?.n), days = num(f?.days);
  if (ft == null || def == null || n == null || days == null || n < K_MIN || days < MIN_DAYS) return null;
  if (ft < STREET_FLOOR_FRAC * def - 0.11 || ft > def + 0.11) return null;
  return { ft, n, days };
}
/** The learned "street water possible" rain mark (mm) of a zone, or the default 60. */
export function rainPossibleMm(params, zone) {
  const f = params?.zones?.[zone]?.streetRain;
  const mm = num(f?.possibleMm), n = num(f?.n), days = num(f?.days);
  if (mm == null || n == null || days == null || n < K_MIN || days < MIN_DAYS) return RAIN_POSSIBLE_DEFAULT_MM;
  return clamp(mm, RAIN_POSSIBLE_MIN_MM, RAIN_POSSIBLE_DEFAULT_MM);
}
/**
 * The rain-based street-water heads-up level of a town ("possible" | "likely" | null), tuned by what visitors reported. `base` is what the
 * default rule says (lib/townRisk.ts lowSpot). A learned rain mark can only ADD a "possible" (24 h satellite rain at or over the learned mark,
 * which is never above the default 60 mm); it never removes one and never creates "likely", the level that sends the opt-in push, so no
 * learned number can send a new push. A note only; it is not read by the verdict step.
 */
export function streetRainLevel({ base, mm24h, zone }, params) {
  if (base || mm24h == null || !zone) return base ?? null;
  return mm24h >= rainPossibleMm(params, zone) ? "possible" : null;
}
/** The gauge is at or above the learned street-water level (both in feet). False when nothing is learned or the reading is missing. */
export function streetLevelReached(params, station, gaugeFt) {
  const sl = station ? streetLevelOf(params, station) : null;
  return !!sl && gaugeFt != null && Number.isFinite(gaugeFt) && gaugeFt >= sl.ft;
}

/** Lines for the owner's Slack digest: what has been learned and how far along the rest is. */
export function learnedLines(params) {
  if (!params) return [];
  const out = [];
  for (const [name, s] of Object.entries(params.stations ?? {})) {
    if (s.streetLevel) out.push(`Learned: ${name}: people report road water from ~${s.streetLevel.ft.toFixed(1)} ft (${s.streetLevel.n} reports, ${s.streetLevel.days} days; official minor ${s.streetLevel.defaultFt.toFixed(1)} ft${s.streetLevel.clamped ? ", capped" : ""})`);
    if (s.momentum) out.push(`Learned: ${name}: forecast factor ${Object.entries(s.momentum).map(([h, m]) => `${h} h x${m.k}`).join(", ")} (backtest ${Object.entries(s.momentum).map(([h, m]) => `-${m.gainPct}%`).join(", ")} miss)`);
  }
  for (const [zone, z] of Object.entries(params.zones ?? {})) {
    if (z.streetRain) out.push(`Learned: ${zone}: street water reported from ~${z.streetRain.possibleMm} mm of 24 h rain (${z.streetRain.n} reports, ${z.streetRain.days} days; default ${z.streetRain.defaultMm} mm)`);
  }
  if (!out.length) out.push(`Learned: nothing yet (a number needs ${K_MIN} independent answers on ${MIN_DAYS} separate days).`);
  const prog = (params.pending ?? []).slice(0, 4).map((p) => `${p.station ?? p.zone} ${p.kind === "streetRain" ? "rain mark" : "street level"} ${p.n}/${K_MIN} reports, ${p.days}/${MIN_DAYS} days${p.why ? ` (${p.why})` : ""}`);
  if (prog.length) out.push("Building up: " + prog.join("; "));
  const f = params.forecast;
  if (f?.horizons) {
    const h = HORIZONS.filter((x) => f.horizons[x]?.n).map((x) => `${x} h ${f.horizons[x].maeBase}->${f.horizons[x].maeFit} ft (${f.horizons[x].gainPct}%)`);
    if (h.length) out.push(`Forecast factor backtest (miss before->after): ${h.join("; ")}. ${f.wired ? "In use." : "Not in use."}`);
  }
  return out;
}
