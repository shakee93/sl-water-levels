// SQL rows of the hidden level-model trial for ONE run of the hourly forecast payload (?shadow=1), for scripts/store-forecasts.mjs.
// Pure. Every value is validated and quoted here; a malformed `run.inputs` / `run.ruleFields` yields fewer statements (or a `skip` row), never a throw
// the caller has to survive (the caller still wraps it). Tables: d1/0023_forecast_inputs.sql, d1/0024_forecast_rule_fields.sql.
import { MAX_BLOB_CHARS } from "./record.mjs";

export const TRIAL_RETENTION_MS = 400 * 86_400_000; // the as-issued inputs are kept long enough to re-run a later model on a full year of them
const SKIPS = new Set(["no_points", "no_times", "bad_now_hour", "no_data", "encode", "too_large", "no_grid", "weather", "deadline", "error"]);
const MARKS = new Set(["alert", "minor", "major"]);
const WORDS = new Set(["likely", "possible", "unlikely", "already"]);
const NH_WORDS = new Set(["rising", "falling", "steady"]);
const B64 = /^[A-Za-z0-9+/]+$/;

const q = (v) => (v == null || (typeof v === "number" && !Number.isFinite(v)) ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const fin = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const prob = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null);

/** @returns {string[]} statements (each ends with ";"), possibly none. */
export function trialStatements(run, madeMs) {
  const out = [];
  if (!run || typeof run !== "object" || !run.station || !Number.isInteger(run.issuedAt)) return out;
  const made = Number.isFinite(madeMs) ? Math.round(madeMs) : Date.now();

  const inp = run.inputs;
  if (inp && typeof inp === "object") {
    const blob = typeof inp.blob === "string" && inp.blob.length > 0 && inp.blob.length <= MAX_BLOB_CHARS && B64.test(inp.blob) ? inp.blob : null;
    const gridMs = int(inp.gridMs, 0, 8.64e15);
    let row;
    if (blob && gridMs != null) {
      row = [run.station, run.issuedAt, 1, gridMs, int(inp.ageMin, 0, 65534), made, int(inp.nCells, 0, 10_000), blob, null];
    } else {
      // no usable record: keep why (a bad blob is "error", never stored)
      const skip = typeof inp.skip === "string" && SKIPS.has(inp.skip) ? inp.skip : "error";
      row = [run.station, run.issuedAt, 1, null, null, made, null, null, skip];
    }
    out.push(
      `INSERT INTO forecast_inputs (station, issued_at, fmt, grid_ms, weather_age_min, made_ms, n_cells, blob, skip) VALUES (${row.map(q).join(", ")}) ` +
        `ON CONFLICT(station, issued_at) DO UPDATE SET fmt = excluded.fmt, grid_ms = excluded.grid_ms, weather_age_min = excluded.weather_age_min, made_ms = excluded.made_ms, n_cells = excluded.n_cells, blob = excluded.blob, skip = excluded.skip WHERE forecast_inputs.blob IS NULL;`,
    );
  }

  const rf = run.ruleFields;
  if (rf && typeof rf === "object") {
    const rows = [];
    for (const s of Array.isArray(rf.steps) ? rf.steps : []) {
      if (!s || !MARKS.has(s.threshold)) continue;
      rows.push(
        `INSERT OR IGNORE INTO forecast_crossings_x (station, issued_at, threshold, p_model, p_model_seen, p_shown, wording_shown) VALUES (${[run.station, run.issuedAt, s.threshold, prob(s.pModel), prob(s.pModelSeen), prob(s.pShown), WORDS.has(s.wordingShown) ? s.wordingShown : null].map(q).join(", ")});`,
      );
    }
    out.push(
      `INSERT OR IGNORE INTO forecast_runs_x (station, issued_at, horizon_limit_h, experimental_on, nh_rate_m_h, nh_word) VALUES (${[run.station, run.issuedAt, int(rf.horizonLimitH, 1, 240), rf.experimentalOn ? 1 : 0, fin(rf.nhRateMh), NH_WORDS.has(rf.nhWord) ? rf.nhWord : null].map(q).join(", ")});`,
      ...rows,
    );
  }
  return out;
}
