// Warning-rule candidates: hidden rules that change the CHANCE shown of a gauge reaching alert / minor / major, run beside the live
// forecast and LOGGED ONLY (KPI cycle, 29 Oct 2026; DOCS.md "Forecast KPIs"). Pure: no network, no clock, no repo state beyond the
// parameter file. Nothing here is shown to visitors or read by a verdict, alert, push or the forecast panel.
//
// Each candidate returns, per step, the chance it WOULD have shown (0..1, after lib/forecastRules.shownChance) and an optional ETA in
// hours, and only for steps where that differs from the live shown chance ("same as live" = no row). Variants:
//   dry-hold    REMOVES a warning: a dry, steady river with no heavy rain coming has any shown chance of a step it is below held under
//               the "possible" mark (shown = min(shown, DRY_HOLD_CAP)). Never raises.
//   rain-onset  ADDS a warning on rivers that answer fast to rain (and, with a longer window, on the rest): heavy rain forecast over the
//               catchment AND the river already close to the alert step and rising. shown = max(live, rule chance). Never lowers.
//   upstream    ADDS a warning when the gauge upstream has just crossed its alert step (Nawalapitiya -> Peradeniya). Never lowers.
// The KPI scorer (lib/forecastKpi.mjs) replaces a run's shown chance by the candidate's and scores KPI 1-3 exactly like live.
import { DRY_HOLD, hasNoForecast, shownChance } from "./forecastRules.mjs";
import { cleanSeries } from "./readingQc.mjs";
import params from "./model/warning-candidates.json" with { type: "json" };

export const VARIANTS = ["dry-hold", "rain-onset", "upstream"];
export const PARAMS = params;

const HOUR = 3_600_000, FT = 0.3048;
export const MAX_STALE_H = 2.5; // an interpolated reading needs readings within this many hours
export const RISE_FRAC = 0.05; // rain-onset: "already rising" = 3 h rise of at least 5% of the usual distance to the step
export const REFRACT_H = 6; // upstream: onsets closer than this are one trigger
const r5 = (v) => Math.round(v * 1e5) / 1e5;

// ---------------------------------------------------------------- shared helpers

function toFeetSeries(rd, unit) {
  const k = unit === "m" ? 1 / FT : 1;
  const raw = (rd ?? []).filter((r) => r && Number.isFinite(r.level)).map((r) => ({ ts: r.ts, water_level: r.level })).sort((a, b) => a.ts - b.ts);
  const { points } = cleanSeries(raw, { unit: unit === "m" || unit === "ft" ? unit : null });
  return points.map((p) => ({ ts: p.ts, ft: p.water_level * k }));
}
/** Level (ft) at ts by linear interpolation; null when there is no reading within MAX_STALE_H. */
function at(s, ts) {
  const n = s.length;
  if (!n || ts < s[0].ts - 60_000 || ts > s[n - 1].ts + MAX_STALE_H * HOUR) return null;
  if (ts >= s[n - 1].ts) return s[n - 1].ft;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m].ts <= ts) lo = m; else hi = m; }
  const a = s[lo], b = s[hi];
  if (ts < a.ts) return null;
  if (b.ts - a.ts > 2 * MAX_STALE_H * HOUR) return ts - a.ts <= (MAX_STALE_H * HOUR) / 2 ? a.ft : null;
  return a.ft + ((b.ft - a.ft) * (ts - a.ts)) / (b.ts - a.ts);
}

// ---------------------------------------------------------------- 1. dry-hold

/**
 * dry-hold applies when ALL hold (every input must be KNOWN; unknown = no hold, we only remove a warning on evidence):
 *   catchment rain of the last 6 h < DRY_HOLD.PAST6H_MM, the 3 h rate of the gauge <= STEADY_M_PER_H (not rising), the next-24 h forecast
 *   < NEXT24H_MM, its 24 h p90 < P90_MM (a missing p90 counts as not heavy: it is a scenario of the same weather answer), no heavy-rain
 *   warning (`rainRisk`) and the storm flag off.
 * @param {{ rainPast6hMm: number|null, rate3hM: number|null, rainNext24hMm: number|null, rainNext24hP90Mm?: number|null, storm: boolean|null, rainRisk?: boolean|null }} x
 */
export function dryHoldApplies(x) {
  if (x.rainPast6hMm == null || !Number.isFinite(x.rainPast6hMm) || x.rainPast6hMm >= DRY_HOLD.PAST6H_MM) return false;
  if (x.rate3hM == null || !Number.isFinite(x.rate3hM) || x.rate3hM > DRY_HOLD.STEADY_M_PER_H) return false;
  if (x.rainNext24hMm == null || !Number.isFinite(x.rainNext24hMm) || x.rainNext24hMm >= DRY_HOLD.NEXT24H_MM) return false;
  if (x.rainNext24hP90Mm != null && Number.isFinite(x.rainNext24hP90Mm) && x.rainNext24hP90Mm >= DRY_HOLD.P90_MM) return false;
  if (x.storm == null || x.storm || x.rainRisk) return false; // storm flag unknown or on, or a rain-risk warning showing
  return true;
}

/** crossings: the RAW run crossings [{ threshold, level, probability }] in the gauge's unit; currentLevel in the same unit. Returns rows only where lowered. */
export function dryHold(x, crossings, currentLevel) {
  if (!dryHoldApplies(x) || currentLevel == null) return [];
  const out = [];
  for (const c of crossings ?? []) {
    if (c.level == null || c.level <= currentLevel) continue; // only a step the gauge is below
    const live = shownChance(c.threshold, c.probability);
    if (live > DRY_HOLD.CAP) out.push({ threshold: c.threshold, shown: DRY_HOLD.CAP, etaHours: null, live: r5(live) });
  }
  return out;
}

// ---------------------------------------------------------------- 2. rain-onset

/** Does a rain-onset rule's condition hold for this gauge at time ts? sFt = cleaned series (ft); entry = { ts, next: { 6, 12 } } (the forecast as it stood at ts). */
export function onsetCondHolds(rule, info, sFt, entry, ts) {
  const step = rule.target === "minor" ? info.minorFt : info.alertFt, L = at(sFt, ts);
  if (L == null || L >= step) return false;
  const nx = entry?.next?.[rule.W];
  if (!(nx >= rule.R)) return false;
  const dist = step - info.medianFt;
  if (rule.G != null && step - L > rule.G * dist) return false;
  if (rule.rise) { const b = at(sFt, ts - 3 * HOUR); if (b == null || L - b < RISE_FRAC * dist) return false; }
  if (rule.o3 != null && !(entry.past3h >= rule.o3)) return false;
  return true;
}

/**
 * @param {{ [station: string]: { unit: "m"|"ft"|null, readings: {ts:number, level:number|null}[] } }} snapshot raw readings in the gauge's own unit (>= 6 h)
 * @param {number} nowTs the run time
 * @param {{ [station: string]: { ts: number, next: { 6?: number|null, 12?: number|null } }[] }} rain the catchment-mean forecast rain (mm) for the next 6 / 12 h as the
 *        forecast stood at each ts: an entry for "now" is enough; entries 1-3 h back add the 3 h hold (rule.holdH)
 * @returns {{ [station: string]: { threshold: string, chance: number, etaHours: number, etaEarliestHours: number, rainMm: number } }}
 */
export function rainOnset(snapshot, nowTs, rain, p = params.rainOnset, opts = {}) {
  const include = opts.include ?? ["shadow", "candidate", "ship"];
  const out = {};
  for (const rule of p.rules ?? []) {
    if (rule.status != null && !include.includes(rule.status)) continue;
    for (const g of rule.gauges) {
      const info = p.gauges?.[g], snap = snapshot[g], rn = rain?.[g];
      if (!info || !snap || !rn?.length || hasNoForecast(g)) continue;
      const sFt = toFeetSeries(snap.readings, snap.unit), step = rule.target === "minor" ? info.minorFt : info.alertFt;
      const now = at(sFt, nowTs);
      if (now == null || now >= step) continue;
      let since = null;
      for (let j = 0; j <= (rule.holdH ?? 3); j++) {
        const ts = nowTs - j * HOUR;
        const e = rn.filter((x) => x.ts <= ts + 5000 && x.ts > ts - 90 * 60_000).sort((a, b) => b.ts - a.ts)[0];
        if (e && onsetCondHolds(rule, info, sFt, e, ts)) { since = j; break; }
      }
      if (since == null) continue;
      const eta = Math.max(1, Math.round(rule.lag.p50 - since)), early = Math.max(1, Math.round(rule.lag.p10 - since));
      const e0 = rn.filter((x) => x.ts <= nowTs + 5000).sort((a, b) => b.ts - a.ts)[0];
      const cand = { threshold: rule.target, chance: rule.chance, etaHours: eta, etaEarliestHours: early, rainMm: Math.round(e0?.next?.[rule.W] ?? 0) };
      const prev = out[g];
      if (!prev || cand.chance > prev.chance) out[g] = cand;
    }
  }
  return out;
}

// ---------------------------------------------------------------- 3. upstream

/** Does the upstream condition hold at sample i? U = hourly feet (null = no data). */
export function upCond(trig, U, i) {
  const u = U[i];
  if (u == null) return false;
  if (trig.kind === "cross") return u >= trig.levelFt;
  const b = i >= 3 ? U[i - 3] : null;
  return u >= trig.floorFt && b != null && u - b >= trig.rise3hFt;
}
/** Indices of fires: the onset of the upstream condition (not within REFRACT_H of the previous onset) while the downstream gauge is below its step. */
export function fireIdx(rule, U, D, from = 3) {
  const out = [];
  let lastOnset = -1e9;
  for (let i = from; i < U.length; i++) {
    if (!upCond(rule.trigger, U, i) || upCond(rule.trigger, U, i - 1)) continue;
    const fresh = i - lastOnset >= REFRACT_H;
    lastOnset = i;
    if (!fresh) continue;
    const d = D[i];
    if (d == null || d >= rule.stepFt) continue;
    if (rule.trigger.gapMaxFt != null && rule.stepFt - d > rule.trigger.gapMaxFt) continue;
    if (rule.trigger.dRise3hFt != null) { const b = i >= 3 ? D[i - 3] : null; if (b == null || d - b < rule.trigger.dRise3hFt) continue; }
    out.push(i);
  }
  return out;
}

/**
 * @param snapshot as for rainOnset, for the upstream and the downstream gauge of each rule (>= windowH + 10 h of readings)
 * @returns {{ [downstream: string]: { threshold: string, chance: number, etaHours: number, etaEarliestHours: number, upstream: string, firedHoursAgo: number } }}
 */
export function upstreamTrigger(snapshot, nowTs, p = params.upstream, opts = {}) {
  const include = opts.include ?? ["ship"];
  const clean = {};
  const ser = (st) => (clean[st] ??= snapshot[st] ? toFeetSeries(snapshot[st].readings, snapshot[st].unit) : []);
  const best = {};
  for (const rule of p.rules ?? []) {
    if (rule.status != null && !include.includes(rule.status)) continue;
    if (!snapshot[rule.up] || !snapshot[rule.down] || hasNoForecast(rule.down)) continue;
    const K = Math.ceil(rule.windowH) + REFRACT_H + 4;
    const sU = ser(rule.up), sD = ser(rule.down);
    const U = [], D = [];
    for (let j = K; j >= 0; j--) { const ts = nowTs - j * HOUR; U.push(at(sU, ts)); D.push(at(sD, ts)); }
    const dNow = D[K];
    if (dNow == null || dNow >= rule.stepFt) continue;
    const f = fireIdx(rule, U, D, 3);
    const last = f.length ? f[f.length - 1] : null;
    if (last == null) continue;
    const since = K - last;
    if (since > rule.windowH) continue;
    const eta = Math.max(1, Math.round(rule.lag.p50 - since));
    const cand = { threshold: rule.target, chance: rule.chance, etaHours: eta, etaEarliestHours: Math.max(1, Math.round(rule.lag.p10 - since)), upstream: rule.up, firedHoursAgo: since };
    const prev = best[rule.down];
    if (!prev || cand.chance > prev.chance || (cand.chance === prev.chance && cand.etaHours < prev.etaHours)) best[rule.down] = cand;
  }
  return best;
}

// ---------------------------------------------------------------- all candidates for one run

/**
 * The candidates for one gauge's run. Returns { [variant]: [{ threshold, shown, etaHours }] } with only the variants and steps whose shown
 * chance differs from live. {} for a run that is not a fitted-model run, or has no forecast.
 *
 * @param {{
 *   station: string, method: string, currentLevel: number|null, asOfTs: number|null,
 *   crossings: { threshold: string, level: number|null, probability: number }[],   // the RAW crossings of the run (the log keeps these)
 *   rate3hM: number|null,
 *   rain: { past6hMm: number|null, next24hMm: number|null, next24hP90Mm: number|null, storm: boolean|null, rainRisk: boolean|null } | null,
 *   rainBy: { ts: number, next: { 6?: number|null, 12?: number|null } }[] | null,   // this gauge's forecast rain, newest first (see rainOnset)
 *   snapshot: { [station: string]: { unit: "m"|"ft"|null, readings: {ts:number, level:number|null}[] } },
 * }} run
 */
export function warningCandidates(run) {
  const out = {};
  if (run.method !== "model" || hasNoForecast(run.station) || run.asOfTs == null || run.currentLevel == null) return out;
  const live = (t) => {
    const c = (run.crossings ?? []).find((x) => x.threshold === t);
    return c ? shownChance(t, c.probability) : 0;
  };
  const add = (variant, row) => {
    if (row.shown > live(row.threshold) + 1e-9) (out[variant] ??= []).push({ threshold: row.threshold, shown: r5(row.shown), etaHours: row.etaHours ?? null });
  };
  // 1. removes
  if (run.rain) {
    const rows = dryHold({ rainPast6hMm: run.rain.past6hMm, rate3hM: run.rate3hM, rainNext24hMm: run.rain.next24hMm, rainNext24hP90Mm: run.rain.next24hP90Mm, storm: run.rain.storm, rainRisk: run.rain.rainRisk }, run.crossings, run.currentLevel);
    if (rows.length) out["dry-hold"] = rows.map((r) => ({ threshold: r.threshold, shown: r.shown, etaHours: null }));
  }
  // 2. adds
  const sn = run.snapshot ?? {};
  if (run.rainBy?.length && sn[run.station]) {
    const ro = rainOnset({ [run.station]: sn[run.station] }, run.asOfTs, { [run.station]: run.rainBy })[run.station];
    if (ro) add("rain-onset", { threshold: ro.threshold, shown: shownChance(ro.threshold, ro.chance), etaHours: ro.etaHours });
  }
  // 3.
  const up = upstreamTrigger(sn, run.asOfTs)[run.station];
  if (up) add("upstream", { threshold: up.threshold, shown: shownChance(up.threshold, up.chance), etaHours: up.etaHours });
  return out;
}
