// What the "Is this right?" answers tell us. Pure (no imports, no I/O): scripts/accuracy-snapshot.mjs (public aggregates),
// scripts/feedback-digest.mjs (owner report) and scripts/feedback.test.mts share it.
// A row is { station, town, answer, river_obs, rain_obs, dist_km, shown_tier, shown_level, err1h, inBand1h, created_ms }
// where err1h = actual - predicted (feet) for the 1 h point of the forecast that was shown, when the log has it.
// Public output (accuracy/latest.json) is aggregates only, and a number is never published for fewer than K_MIN answers.

export const K_MIN = 3;
export const DIST_BINS = [["under 1 km", 0, 1], ["1 to 3 km", 1, 3], ["3 to 10 km", 3, 10], ["over 10 km", 10, Infinity]];
const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);
const mean = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100 : null);
// Severity of what the person saw, on the same 0-3 ladder as the verdict tiers
const OBS_RANK = { normal: 0, high: 1, banks: 2, flooding: 3 };
const TIER_RANK = { normal: 0, watch: 1, alert: 1, minor: 2, major: 3 };

/** Counts and rates for a group of answers. "unsure" counts as an answer but not as a judgement. */
export function tally(rows) {
  const c = { yes: 0, worse: 0, better: 0, unsure: 0 };
  for (const r of rows) if (r.answer in c) c[r.answer]++;
  const judged = c.yes + c.worse + c.better;
  return { n: rows.length, ...c, agreePct: pct(c.yes, judged), worsePct: pct(c.worse, judged), betterPct: pct(c.better, judged) };
}

/** Observation versus verdict: how often the severity people saw is above / equal to / below what we said. */
export function obsVsVerdict(rows) {
  const out = { n: 0, higher: 0, same: 0, lower: 0 };
  for (const r of rows) {
    if (!(r.river_obs in OBS_RANK) || !(r.shown_tier in TIER_RANK)) continue;
    out.n++;
    const d = OBS_RANK[r.river_obs] - TIER_RANK[r.shown_tier];
    out[d > 0 ? "higher" : d < 0 ? "lower" : "same"]++;
  }
  return { ...out, higherPct: pct(out.higher, out.n), samePct: pct(out.same, out.n), lowerPct: pct(out.lower, out.n) };
}

/** Agreement by distance from the gauge: where a gauge stops describing the ground. */
export function byDistance(rows) {
  return DIST_BINS.map(([label, lo, hi]) => {
    const g = rows.filter((r) => r.dist_km != null && r.dist_km >= lo && r.dist_km < hi);
    return { label, ...tally(g) };
  }).filter((b) => b.n > 0);
}

/** Do "worse than shown" answers coincide with the forecast being too low? err1h > 0 = the river ended above our forecast. */
export function againstForecast(rows) {
  const withErr = rows.filter((r) => r.err1h != null);
  const g = (a) => withErr.filter((r) => r.answer === a);
  return { n: withErr.length, meanErrWorse: mean(g("worse").map((r) => r.err1h)), meanErrYes: mean(g("yes").map((r) => r.err1h)), meanErrBetter: mean(g("better").map((r) => r.err1h)),
    inBandWhenYesPct: pct(g("yes").filter((r) => r.inBand1h).length, g("yes").length) };
}

/** Everything for one group. */
export const summary = (rows) => ({ ...tally(rows), obs: obsVsVerdict(rows), forecast: againstForecast(rows), distance: byDistance(rows) });

/** Group by gauge (station column, else the town's gauge). */
export function perStation(rows) {
  const m = new Map();
  for (const r of rows) if (r.station) (m.get(r.station) ?? m.set(r.station, []).get(r.station)).push(r);
  return Object.fromEntries([...m].map(([k, v]) => [k, v]));
}

/**
 * The public part: per gauge and overall, { n, agreePct, worsePct, betterPct }, only where at least K_MIN answers back it.
 * No notes, no places, no coordinates, no distances finer than the bins.
 */
export function publicFeedback(rows, since = 0) {
  const rs = rows.filter((r) => r.created_ms >= since);
  const pub = (g) => {
    const t = tally(g);
    return t.n >= K_MIN ? { n: t.n, agreePct: t.agreePct, worsePct: t.worsePct, betterPct: t.betterPct } : null;
  };
  const stations = {};
  for (const [k, v] of Object.entries(perStation(rs))) {
    const p = pub(v);
    if (p) stations[k] = p;
  }
  const o = pub(rs);
  return { overall: o, stations };
}

/** Plain-text digest for the owner (Slack). Includes notes; not for the public data branch. */
export function digestText({ day, rows, urgentCount = 0, site = "https://sl-water-levels.vercel.app" }) {
  if (!rows.length) return `Forecast feedback, ${day}: no answers yesterday.`;
  const t = tally(rows);
  const lines = [`*Forecast feedback, ${day}*: ${t.n} answers. Matches what they see: ${t.yes}. Worse than shown: ${t.worse}. Better than shown: ${t.better}. Not sure: ${t.unsure}.${urgentCount ? ` ${urgentCount} said it is worse and water is on roads or in homes.` : ""}`];
  const worst = Object.entries(perStation(rows)).map(([k, v]) => [k, tally(v)]).filter(([, x]) => x.worse > 0).sort((a, b) => b[1].worse - a[1].worse).slice(0, 5);
  if (worst.length) lines.push("Most 'worse than shown': " + worst.map(([k, x]) => `${k} ${x.worse} of ${x.n}`).join("; "));
  const far = byDistance(rows).filter((b) => b.n >= K_MIN).map((b) => `${b.label}: ${b.agreePct ?? "-"}% match (${b.n})`);
  if (far.length > 1) lines.push("By distance from the gauge: " + far.join("; "));
  const notes = rows.filter((r) => r.note).slice(0, 8).map((r) => `- ${r.station ?? r.town} (${r.answer}${r.river_obs ? `, ${r.river_obs}` : ""}${r.dist_km != null ? `, ${r.dist_km} km from gauge` : ""}): ${r.note}`);
  if (notes.length) lines.push("Notes (private):", ...notes);
  lines.push(`${site}/status`);
  return lines.join("\n");
}

/** The query behind every report: each answer with the 1 h point of the forecast it was shown with (when the log has it). */
export const feedbackSql = (since = 0) => `SELECT f.id, f.created_ms, f.day, f.page, f.station, f.town, f.answer, f.river_obs, f.rain_obs, f.note, f.note_tags, f.dist_km,
  f.shown_tier, f.shown_level, f.shown_next_ft, f.shown_low_ft, f.shown_high_ft, f.shown_method, f.shown_rain, f.lang, f.device, f.notified,
  r.model_version, v.unit AS unit, v.predicted AS p1, v.actual AS a1, v.low AS low1, v.high AS high1
  FROM forecast_feedback f
  LEFT JOIN forecast_runs r ON r.station = f.station AND r.issued_at = f.shown_issued_at
  LEFT JOIN forecast_verification v ON v.station = f.station AND v.issued_at = f.shown_issued_at AND v.horizon_h = 1
  WHERE f.created_ms >= ${Number(since)} ORDER BY f.created_ms`;

const FT = 0.3048;
/** Raw join rows -> rows for the functions above: forecast error and in-band flag in feet. */
export function feedbackRows(raw) {
  return raw.map((r) => {
    const k = r.unit === "m" ? 1 / FT : r.unit === "ft" ? 1 : null;
    const ok = k != null && r.p1 != null && r.a1 != null;
    return { ...r, err1h: ok ? Math.round((r.a1 - r.p1) * k * 100) / 100 : null, inBand1h: ok && r.low1 != null && r.high1 != null ? (r.a1 >= r.low1 && r.a1 <= r.high1 ? 1 : 0) : null };
  });
}
