// Forecast scoreboard: pure scoring of the stored forecast log, one Colombo day at a time. No network, no D1.
// Used by scripts/forecast-archive.mjs (D1 -> forecasts/YYYY/YYYY-MM-DD.jsonl) and scripts/forecast-scoreboard.mjs (archive -> scoreboard/*.json
// + summary.csv), both run nightly by .github/workflows/forecast-scoreboard.yml. MEASURES ONLY: nothing here touches the live forecast.
//
// Method (same as the 28 Oct 2026 review, research/forecast-review-2026-10-28.md): a forecast point is scored against the gauge reading
// nearest its target time within 40 min; everything in feet; persistence = "no change" = the level at issue; bias = forecast minus actual;
// in-band = actual inside the stated 80% band. Only fitted-model runs (method "model") are scored; trend-only gauges have no calibrated band.
// A day = the Colombo (UTC+5:30) day the forecast was ISSUED, so a day's 24 h cells only fill in the next day (`complete` says when).

export const FT = 0.3048;
export const HOUR = 3_600_000;
export const DAY_MS = 24 * HOUR;
export const COLOMBO_MS = 5.5 * HOUR;
export const HORIZONS = [1, 3, 6, 12, 24];
export const MATCH_MS = 40 * 60_000; // a reading must be within 40 min of the target time
export const MAIN_STEM = ["Glencourse", "Hanwella", "Nagalagam Street"];
export const FAST_TRIBUTARIES = ["Holombuwa", "Deraniyagala", "Kithulgala", "Norwood", "Thawalama", "Pitabeddara", "Urawa", "Peradeniya", "Nawalapitiya"];
export const GROUP_NAMES = ["main", "fast", "other", "all"];
export const PROB_BINS = [[0, 0.1], [0.1, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 0.9], [0.9, 1.0001]];
export const THRESHOLDS = ["alert", "minor", "major"];
/** A day is "not comparable" with its trailing median when its difficulty differs by more than this factor, either way. */
export const DIFFICULTY_RATIO = 1.5;
/** Skill (percentage points) a day must beat / trail the trailing median by to count as better / worse. */
export const VERDICT_MARGIN_PTS = 5;
export const MIN_PRIOR_DAYS = 3;
export const TRAILING_DAYS = 7;

export const groupOf = (station) => (MAIN_STEM.includes(station) ? "main" : FAST_TRIBUTARIES.includes(station) ? "fast" : "other");

export const colomboDay = (ts) => new Date(ts + COLOMBO_MS).toISOString().slice(0, 10);
export const dayStart = (day) => Date.parse(`${day}T00:00:00+05:30`);
export const dayEnd = (day) => dayStart(day) + DAY_MS;
export const addDays = (day, n) => colomboDay(dayStart(day) + n * DAY_MS + 12 * HOUR);
export const daysBetween = (from, to) => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
/** A day's 24 h figures are final once the last forecast issued that day has had its 24 h plus an hour for the reading to arrive. */
export const dayComplete = (day, now) => now >= dayEnd(day) + 25 * HOUR;

const num = (v) => v != null && Number.isFinite(Number(v));
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const r3 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);
const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
export const median = (a) => {
  const s = a.filter((v) => v != null && Number.isFinite(v)).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---------------------------------------------------------------- archive lines (one per forecast run)

/** The reading (native unit) nearest `ts` within MATCH_MS, from observations sorted by ts; null when none. */
export function nearestReading(sorted, ts) {
  let lo = 0, hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].ts < ts) lo = mid + 1;
    else hi = mid;
  }
  let best = null, bd = Infinity;
  for (let i = Math.max(0, lo - 2); i <= Math.min(sorted.length - 1, lo + 2); i++) {
    const o = sorted[i];
    if (o.level == null || !Number.isFinite(o.level)) continue;
    const d = Math.abs(o.ts - ts);
    if (d < bd) { bd = d; best = o; }
  }
  return bd <= MATCH_MS ? best.level : null;
}

/**
 * Builds the archive lines for the runs given. Inputs are plain row arrays as stored in D1 (native units):
 *   runs [{id, station, basin, issued_at, method, status, model_version, unit, current_level, tier, verdict, storm}]
 *   points [{run_id, horizon_h, target_ts, level, low, high}]   crossings [{run_id, threshold, level, probability}]
 *   shadows [{station, issued_at, variant, horizon_h, target_ts, level, low, high}]   obs {station: [{ts, level}] sorted}
 * Each line carries the later observed value `y` for every point (null when no reading was near the target yet) and the 24 h
 * maximum after issue (`max24`, `cover24` = readings reached issue + 23 h), which the calibration needs.
 */
export function buildArchiveLines({ runs, points, crossings = [], shadows = [], obs }) {
  const pts = new Map(), crs = new Map(), shs = new Map();
  for (const p of points) (pts.get(p.run_id) ?? pts.set(p.run_id, []).get(p.run_id)).push(p);
  for (const c of crossings) (crs.get(c.run_id) ?? crs.set(c.run_id, []).get(c.run_id)).push(c);
  for (const s of shadows) {
    const k = `${s.station}|${s.issued_at}`;
    (shs.get(k) ?? shs.set(k, []).get(k)).push(s);
  }
  const lines = [];
  for (const r of runs) {
    const o = obs[r.station] ?? [];
    const horizons = (pts.get(r.id) ?? [])
      .sort((a, b) => a.horizon_h - b.horizon_h)
      .map((p) => ({ h: p.horizon_h, ts: p.target_ts, level: r3(p.level), low: r3(p.low), high: r3(p.high), y: r3(nearestReading(o, p.target_ts)) }));
    const after = o.filter((x) => x.level != null && x.ts > r.issued_at && x.ts <= r.issued_at + 24 * HOUR);
    const shadowMap = {};
    for (const s of (shs.get(`${r.station}|${r.issued_at}`) ?? []).sort((a, b) => a.horizon_h - b.horizon_h)) {
      (shadowMap[s.variant] ??= []).push({ h: s.horizon_h, ts: s.target_ts, level: r3(s.level), low: r3(s.low), high: r3(s.high) });
    }
    lines.push({
      day: colomboDay(r.issued_at), station: r.station, basin: r.basin, issued_at: r.issued_at, method: r.method, status: r.status,
      model_version: r.model_version ?? null, unit: r.unit ?? null, current_level: r3(r.current_level), tier: r.tier ?? null, verdict: r.verdict ?? null,
      storm: r.storm == null ? null : Number(r.storm),
      horizons,
      crossings: (crs.get(r.id) ?? []).map((c) => ({ threshold: c.threshold, level: r3(c.level), probability: c.probability })),
      shadows: shadowMap,
      max24: after.length ? r3(Math.max(...after.map((x) => x.level))) : null,
      cover24: after.length ? after[after.length - 1].ts >= r.issued_at + 23 * HOUR : false,
    });
  }
  return lines.sort((a, b) => a.issued_at - b.issued_at || a.station.localeCompare(b.station));
}

// ---------------------------------------------------------------- scoring

const toFt = (line) => (line.unit === "m" ? 1 / FT : 1);

/** MAE, persistence MAE, skill, bias, in-band and band width of a list of {p, y, c, low, high} (feet). */
export function cellStats(rows) {
  const n = rows.length;
  if (!n) return null;
  const mae = mean(rows.map((r) => Math.abs(r.y - r.p)));
  const pers = mean(rows.map((r) => Math.abs(r.y - r.c)));
  const banded = rows.filter((r) => r.low != null && r.high != null);
  return {
    n,
    mae: r2(mae),
    persistenceMae: r2(pers),
    skillPct: pers > 0 ? r1(100 * (1 - mae / pers)) : null,
    bias: r2(mean(rows.map((r) => r.p - r.y))),
    inBandPct: banded.length ? r1(100 * mean(banded.map((r) => (r.y >= r.low && r.y <= r.high ? 1 : 0)))) : null,
    bandFt: banded.length ? r2(mean(banded.map((r) => r.high - r.low))) : null,
  };
}

/** Rows (feet) for every scored point of the fitted-model lines: one row per line x horizon with a matched reading. */
export function scoredRows(lines) {
  const rows = [];
  for (const l of lines) {
    if (l.method !== "model" || (l.unit !== "ft" && l.unit !== "m") || l.current_level == null) continue;
    const k = toFt(l);
    for (const p of l.horizons) {
      if (p.y == null || !HORIZONS.includes(p.h)) continue;
      const row = {
        station: l.station, group: groupOf(l.station), h: p.h, c: l.current_level * k, y: p.y * k, p: p.level * k,
        low: p.low == null ? null : p.low * k, high: p.high == null ? null : p.high * k, shadow: {},
      };
      for (const [variant, sp] of Object.entries(l.shadows ?? {})) {
        const m = sp.find((x) => x.h === p.h);
        if (m) row.shadow[variant] = { p: m.level * k, low: m.low == null ? null : m.low * k, high: m.high == null ? null : m.high * k };
      }
      rows.push(row);
    }
  }
  return rows;
}

function calibration(lines) {
  const cases = [];
  for (const l of lines) {
    if (l.method !== "model" || !l.cover24 || l.max24 == null || l.current_level == null) continue;
    for (const c of l.crossings) {
      if (!THRESHOLDS.includes(c.threshold) || c.level == null || l.current_level >= c.level) continue; // already crossed: nothing to forecast
      cases.push({ t: c.threshold, prob: c.probability, occ: l.max24 >= c.level });
    }
  }
  const out = {};
  for (const t of THRESHOLDS) {
    const R = cases.filter((c) => c.t === t);
    const hi = R.filter((c) => c.prob >= 0.4);
    out[t] = {
      n: R.length,
      occurred: R.filter((c) => c.occ).length,
      brier: R.length ? r3(mean(R.map((c) => (c.prob - (c.occ ? 1 : 0)) ** 2))) : null,
      meanStated: R.length ? r2(mean(R.map((c) => c.prob))) : null,
      statedAtLeast40: { n: hi.length, cameTrue: hi.filter((c) => c.occ).length },
      bins: PROB_BINS.map(([a, b]) => {
        const x = R.filter((c) => c.prob >= a && c.prob < b);
        return { from: a, to: Math.min(b, 1), n: x.length, observedPct: x.length ? r1(100 * (x.filter((c) => c.occ).length / x.length)) : null };
      }),
    };
  }
  return out;
}

function runHealth(lines) {
  const hours = {};
  for (const l of lines) {
    const h = new Date(l.issued_at + COLOMBO_MS).getUTCHours();
    (hours[h] ??= new Set()).add(l.station);
  }
  const counts = Object.keys(hours).map((h) => hours[h].size);
  return {
    runs: lines.length,
    gauges: new Set(lines.map((l) => l.station)).size,
    hoursWithRuns: counts.length,
    missingHours: Array.from({ length: 24 }, (_, h) => h).filter((h) => !hours[h]),
    medianGaugesPerHour: median(counts),
    minGaugesPerHour: counts.length ? Math.min(...counts) : null,
  };
}

/** The headline figure: pooled skill over 1, 3, 6 and 12 h (24 h is left out: its cells fill in late and are the noisiest). */
const HEADLINE_H = [1, 3, 6, 12];
function headline(rows, variant) {
  const sk = [];
  for (const h of HEADLINE_H) {
    const R = rows.filter((r) => r.h === h && (variant == null || r.shadow[variant]));
    if (!R.length) continue;
    const mae = mean(R.map((r) => Math.abs(r.y - (variant == null ? r.p : r.shadow[variant].p))));
    const pers = mean(R.map((r) => Math.abs(r.y - r.c)));
    if (pers > 0) sk.push(100 * (1 - mae / pers));
  }
  return sk.length === HEADLINE_H.length ? r1(mean(sk)) : null;
}

/**
 * The scoreboard for one Colombo day from that day's archive lines.
 * `now` decides `complete` (24 h cells final). `prior` (earlier days' scoreboards) feeds the verdict.
 */
export function scoreDay(day, lines, { now = Date.now(), prior = [] } = {}) {
  const dl = lines.filter((l) => l.day === day);
  const rows = scoredRows(dl);
  const variants = [...new Set(dl.flatMap((l) => Object.keys(l.shadows ?? {})))].sort();
  const groups = {};
  for (const g of GROUP_NAMES) {
    groups[g] = {};
    for (const h of HORIZONS) {
      const R = rows.filter((r) => (g === "all" || r.group === g) && r.h === h);
      const live = cellStats(R.map((r) => ({ ...r })));
      if (!live) continue;
      const shadow = {};
      for (const v of variants) {
        const S = R.filter((r) => r.shadow[v]).map((r) => ({ ...r, ...r.shadow[v] }));
        const s = cellStats(S);
        if (!s) continue;
        // live MAE on exactly the rows the shadow covers, so the comparison is like for like
        const liveOn = cellStats(R.filter((r) => r.shadow[v]));
        shadow[v] = { ...s, liveMaeSameRows: liveOn?.mae ?? null, maeVsLivePct: liveOn?.mae > 0 ? r1(100 * (s.mae / liveOn.mae - 1)) : null };
      }
      groups[g][`h${h}`] = { ...live, shadow };
    }
  }
  const pers6 = cellStats(rows.filter((r) => r.h === 6));
  const levels = {};
  for (const l of dl) if (l.method === "model" && l.current_level != null) (levels[l.station] ??= []).push(l.current_level * toFt(l));
  const ranges = Object.values(levels).filter((a) => a.length > 1).map((a) => Math.max(...a) - Math.min(...a));
  const sb = {
    day,
    generatedAt: new Date(now).toISOString(),
    complete: dayComplete(day, now),
    modelVersions: Object.fromEntries([...new Set(dl.map((l) => l.model_version))].map((v) => [v ?? "unknown", dl.filter((l) => l.model_version === v).length])),
    runHealth: runHealth(dl),
    difficulty: {
      persistenceMae6hFt: pers6?.persistenceMae ?? null,
      medianGaugeRangeFt: r2(median(ranges)),
    },
    headline: { liveSkillPct: headline(rows, null), shadowSkillPct: Object.fromEntries(variants.map((v) => [v, headline(rows, v)])) },
    groups,
    calibration: calibration(dl),
  };
  sb.verdict = verdictVsTrailing(sb, prior);
  return sb;
}

/** better / worse / about the same / not comparable against the median of the trailing days; the reason is in `line`. */
export function verdictVsTrailing(sb, prior) {
  const earlier = prior
    .filter((p) => p.day < sb.day && p.headline?.liveSkillPct != null && p.difficulty?.persistenceMae6hFt != null)
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, TRAILING_DAYS);
  const skill = sb.headline.liveSkillPct, diff = sb.difficulty.persistenceMae6hFt;
  if (skill == null || diff == null) return { code: "not_comparable", line: `${sb.day}: not comparable, no scored forecasts yet.` };
  if (earlier.length < MIN_PRIOR_DAYS) return { code: "not_comparable", line: `${sb.day}: not comparable, only ${earlier.length} earlier scored day(s); skill ${skill}% (1-12 h), 6 h no-change error ${diff} ft.` };
  const medSkill = median(earlier.map((p) => p.headline.liveSkillPct));
  const medDiff = median(earlier.map((p) => p.difficulty.persistenceMae6hFt));
  const ratio = medDiff > 0 ? diff / medDiff : null;
  const facts = `skill ${skill}% vs ${r1(medSkill)}% median of ${earlier.length} days; 6 h no-change error ${diff} ft vs ${r2(medDiff)} ft`;
  if (ratio == null || ratio > DIFFICULTY_RATIO || ratio < 1 / DIFFICULTY_RATIO) {
    return { code: "not_comparable", medianSkillPct: r1(medSkill), difficultyRatio: r2(ratio), line: `${sb.day}: not comparable, the day was ${ratio != null && ratio > 1 ? "much harder" : "much easier"} than usual (${facts}).` };
  }
  const delta = skill - medSkill;
  const code = delta >= VERDICT_MARGIN_PTS ? "better" : delta <= -VERDICT_MARGIN_PTS ? "worse" : "same";
  return { code, medianSkillPct: r1(medSkill), difficultyRatio: r2(ratio), line: `${sb.day}: ${code === "same" ? "about the same" : code} (${facts}).` };
}

/** One line on each candidate: its pooled MAE change against live on the rows it covers at 12 h and 24 h. */
export function shadowLine(sb) {
  const out = [];
  for (const v of Object.keys(sb.headline.shadowSkillPct)) {
    const parts = [12, 24].map((h) => {
      const s = sb.groups.all[`h${h}`]?.shadow?.[v];
      return s ? `${h} h MAE ${s.maeVsLivePct > 0 ? "+" : ""}${s.maeVsLivePct}% (${s.mae} vs ${s.liveMaeSameRows} ft, n ${s.n}, bias ${s.bias})` : null;
    }).filter(Boolean);
    if (parts.length) out.push(`${v}: ${parts.join("; ")}`);
  }
  return out;
}

// ---------------------------------------------------------------- summary.csv

export const SUMMARY_HEADER = "day,complete,group,horizon_h,variant,n,mae_ft,persistence_mae_ft,skill_pct,bias_ft,in_band_pct,band_ft,difficulty_6h_ft,runs,hours_with_runs,verdict";

const cell = (v) => (v == null ? "" : String(v));

export function summaryRows(sb) {
  const rows = [];
  const tail = [sb.difficulty.persistenceMae6hFt, sb.runHealth.runs, sb.runHealth.hoursWithRuns, sb.verdict.code];
  for (const g of GROUP_NAMES) {
    for (const h of HORIZONS) {
      const c = sb.groups[g][`h${h}`];
      if (!c) continue;
      rows.push([sb.day, sb.complete, g, h, "live", c.n, c.mae, c.persistenceMae, c.skillPct, c.bias, c.inBandPct, c.bandFt, ...tail].map(cell).join(","));
      for (const [v, s] of Object.entries(c.shadow)) {
        rows.push([sb.day, sb.complete, g, h, v, s.n, s.mae, s.persistenceMae, s.skillPct, s.bias, s.inBandPct, s.bandFt, ...tail].map(cell).join(","));
      }
    }
  }
  return rows;
}

/** Replaces any rows already stored for this day, appends the new ones, keeps days in order. */
export function upsertSummary(text, sb) {
  const old = (text ?? "").split("\n").filter((l) => l && l !== SUMMARY_HEADER && l.split(",")[0] !== sb.day);
  const all = [...old, ...summaryRows(sb)];
  all.sort((a, b) => a.split(",")[0].localeCompare(b.split(",")[0])); // stable: keeps the within-day order
  return [SUMMARY_HEADER, ...all].join("\n") + "\n";
}
