// What the hourly forecast route (app/api/forecasts/route.ts, ?shadow=1 only) attaches to a run for the hidden level-model trial.
// Pure and dependency-light so it is tested without Next. Nothing here changes a run field that existed before: it only ADDS `run.inputs`
// and `run.ruleFields` AFTER the run was pushed, each inside its own try/catch, and only while the route is still inside its time budget.
//
//   run.inputs     = { fmt: 1, blob, gridMs, ageMin, nCells }  the rain inputs "as they stood" (lib/levelTrial/record.mjs), or { skip: reason }
//   run.ruleFields = { horizonLimitH, experimentalOn, nhRateMh, nhWord, steps: [{ threshold, pModel, pModelSeen, pShown, wordingShown }] }
//                    the extra archive fields of the warning rule (lib/forecast.ts RuleFields), or absent when not available
//
// Skip reasons (forecast_inputs.skip): no_points | no_times | bad_now_hour | no_data | encode | too_large (from inputsOf), and
//   no_grid (the gauge has no rain grid / shows no forecast), weather (the weather fetch failed), deadline (route past its guard), error (anything thrown).
import { inputsOf, zonePositions } from "./record.mjs";
import { nextHourRateM } from "../forecastRules.mjs";

/** The route skips the trial work once it has used this much of its 60 s (app/api/forecasts/route.ts maxDuration). */
export const GUARD_MS = 35_000;

/** Whole minutes between the weather answer's own Date header and now; null when unknown or in the future by more than a minute. */
export function ageMinutes(fetchedMs, nowMs) {
  if (!Number.isFinite(fetchedMs) || !Number.isFinite(nowMs)) return null;
  const m = (nowMs - fetchedMs) / 60_000;
  return m >= -1 ? Math.max(0, Math.round(m)) : null;
}

/**
 * The `run.inputs` value. `tw` = what lib/forecast.ts trialWeatherOf(f) returned (undefined / null = no weather fetched, { ok: false } = failed,
 * { ok: true, data: { nowHour } } = the answer), `raw` = lib/weather.ts rawWeatherOf(tw.data). `build` = inputsOf (injectable for tests).
 * Never throws and has no await.
 */
export function inputsField({ tw, raw, nowMs, startMs, guardMs = GUARD_MS, build = inputsOf }) {
  try {
    if (nowMs - startMs > guardMs) return { skip: "deadline" };
    if (tw === undefined || tw === null) return { skip: "no_grid" };
    if (!tw.ok) return { skip: "weather" };
    if (!raw || !Array.isArray(raw.points)) return { skip: "no_points" };
    const r = build({
      points: raw.points,
      near: zonePositions(raw.cells, raw.nearIds),
      up: zonePositions(raw.cells, raw.upIds),
      nowHour: tw.data.nowHour,
      ageMin: ageMinutes(raw.fetchedMs, nowMs),
    });
    if (!r || !r.ok) return { skip: r && typeof r.skip === "string" ? r.skip : "error" };
    return { fmt: 1, blob: r.blob, gridMs: r.gridMs, ageMin: r.ageMin, nCells: r.nCells };
  } catch {
    return { skip: "error" };
  }
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The `run.ruleFields` value from lib/forecast.ts ruleFieldsOf(f) (`rules`) and the next-hour tile's rate and word (`nh`), or null when there are no rules. Never throws. */
export function ruleFieldsOf({ rules, nh }) {
  try {
    if (!rules || !Array.isArray(rules.steps)) return null;
    return {
      horizonLimitH: num(rules.horizonLimitH),
      experimentalOn: !!rules.experimentalOn,
      nhRateMh: num(nh?.rateM),
      nhWord: typeof nh?.word === "string" ? nh.word : null,
      steps: rules.steps.map((s) => ({ threshold: s.threshold, pModel: num(s.pModel), pModelSeen: num(s.pModelSeen), pShown: num(s.pShown), wordingShown: s.wordingShown ?? null })),
    };
  } catch {
    return null;
  }
}

/**
 * The rate (metres per hour) behind the Next hour tile: the same rule as lib/nextHour.ts nextHourOf (that function does not return it, and it is
 * the public API's shape, so it is mirrored here). `f` = { horizons, currentLevel, unit, method, signals }, `me` = the snapshot station, `mpu` = metres per unit.
 */
export function nextHourRate({ f, me, mpu, tidal }) {
  const h1 = f.horizons?.find((h) => h.h === 1);
  if (!h1 || f.currentLevel == null) return null;
  const dM = (h1.level - f.currentLevel) * mpu;
  const lr = f.signals?.localRatePerH;
  const rate3hM = me?.rate3hM ?? (lr != null && Number.isFinite(lr) ? lr * mpu : null);
  return nextHourRateM({ h1ChangeM: dM, rate3hM, source: me?.source, method: f.method, rate1hM: me?.rate1hM ?? null, tidal }) ?? dM;
}

/**
 * Attach the trial fields to a run that is ALREADY in the route's list. Each field in its own try/catch; both skipped past the deadline guard.
 * `getRules` / `getNh` are thunks so that anything they throw is caught here. Returns the same run. Never throws.
 */
export function attachTrialFields(run, { tw, raw, getRules, getNh, nowMs, startMs, guardMs = GUARD_MS, build = inputsOf }) {
  try {
    run.inputs = inputsField({ tw, raw, nowMs, startMs, guardMs, build });
  } catch {}
  try {
    if (!(nowMs - startMs > guardMs)) {
      let nh = null;
      try { nh = getNh ? getNh() : null; } catch { nh = null; }
      const rf = ruleFieldsOf({ rules: getRules ? getRules() : null, nh });
      if (rf) run.ruleFields = rf;
    }
  } catch {}
  return run;
}
