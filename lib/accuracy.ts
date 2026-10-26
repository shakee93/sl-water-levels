// How well the forecasts have done, measured live from the prediction log (Cloudflare D1: forecast_verification).
// scripts/accuracy-snapshot.mjs scores the log every 3 hours (.github/workflows/accuracy-snapshot.yml) and writes
// accuracy/latest.json on the `data` branch; this file reads it (cached 1 h, time-boxed to 1.5 s, fails soft to
// null). The browser never needs the D1 token and no page waits on the database.
//
// Each forecast point is checked against the gauge reading closest to its target time (within 40 minutes).
// Levels are in feet. "No change" is the level at the time of the forecast. Segments:
//   model-v4     issued since the measured-rain storm model went live (satellite rain, up-channels timed separately, where it beat v3; v3 elsewhere)
//   model-v3     issued from the storm-aware version until v4: the storm-aware version went live (gauge-only model at 1/3/6/12/24 h + rain correction on storm hours)
//   model        issued from 24 Oct 2026 (gauge-only 1/3/6 h model live; 12 / 24 h were still the older rain model) until then
//   model-early  fitted-model forecasts before that
//   trend        gauges without a fitted model (simple trend estimate)

const URL_ = process.env.ACCURACY_URL ?? "https://raw.githubusercontent.com/shakee93/sl-water-levels/data/accuracy/latest.json";

export type Stat = { n: number; gauges: number; maeFt: number | null; baseMaeFt: number | null; inBandPct: number | null; bandFt: number | null; dirPct: number | null; dirSteadyPct: number | null };
type BySeg = Partial<Record<"model" | "model-early" | "model-v3" | "model-v4" | "trend", Record<string, Stat>>>;
export type AccuracyFile = {
  version: number;
  generatedAt: string;
  asOf: string; // Sri Lanka date
  firstForecast: string;
  gaugeModelSince: string;
  /** Sri Lanka date the storm-aware version went live; absent in files written before it. */
  stormModelSince?: string;
  /** Sri Lanka date the measured-rain storm model (v4) went live; absent until it does. */
  stormModelV4Since?: string;
  overall: { d30?: BySeg; all?: BySeg };
  /** Fitted-model forecasts split by storm (a heavy-rain warning showing or a storm-horizon step in use) and calm hours. Absent in older files. */
  rainSplit?: { d30?: Partial<Record<"storm" | "calm", Record<string, Stat>>>; all?: Partial<Record<"storm" | "calm", Record<string, Stat>>> };
  stations: Record<string, { d30?: BySeg; all?: BySeg }>;
  /** "Is this right?" answers of the last 30 days (aggregates only, gauges with fewer than 3 answers are absent). */
  feedback?: { window: string; overall: FeedbackStat | null; stations: Record<string, FeedbackStat> };
};
export type FeedbackStat = { n: number; agreePct: number | null; worsePct: number | null; betterPct: number | null };
export type Win = "d30" | "all";

export async function getAccuracy(ms = 1500): Promise<AccuracyFile | null> {
  try {
    const res = await fetch(URL_, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    const j = (await res.json()) as AccuracyFile;
    return j && j.overall ? j : null;
  } catch {
    return null;
  }
}

/** Fitted-model checks pooled over both model segments (count-weighted means). */
function pool(parts: (Stat | undefined)[]): Stat | null {
  const ps = parts.filter((p): p is Stat => !!p && p.n > 0);
  const n = ps.reduce((s, p) => s + p.n, 0);
  if (!n) return null;
  const w = (f: (p: Stat) => number | null, r = 2) => {
    const xs = ps.filter((p) => f(p) != null);
    const m = xs.reduce((s, p) => s + p.n, 0);
    return m ? Math.round((xs.reduce((s, p) => s + (f(p) as number) * p.n, 0) / m) * 10 ** r) / 10 ** r : null;
  };
  return {
    n, gauges: Math.max(...ps.map((p) => p.gauges)),
    maeFt: w((p) => p.maeFt), baseMaeFt: w((p) => p.baseMaeFt), inBandPct: w((p) => p.inBandPct, 0), bandFt: w((p) => p.bandFt),
    dirPct: w((p) => p.dirPct, 0), dirSteadyPct: w((p) => p.dirSteadyPct, 0),
  };
}

type Scope = { d30?: BySeg; all?: BySeg };
/** Pooled fitted-model figure for one horizon; falls back to the trend estimate when a scope has no model at all. */
export function figure(scope: Scope | undefined, h: number, win: Win, withTrend = false): Stat | null {
  const w = scope?.[win];
  if (!w) return null;
  const m = pool([w.model?.[h], w["model-early"]?.[h], w["model-v3"]?.[h], w["model-v4"]?.[h]]);
  return m ?? (withTrend ? (w.trend?.[h] ?? null) : null);
}
/** Only the gauge-only model's own record (issued since it went live). */
export const newModelFigure = (scope: Scope | undefined, h: number, win: Win): Stat | null => pool([scope?.[win]?.model?.[h], scope?.[win]?.["model-v3"]?.[h], scope?.[win]?.["model-v4"]?.[h]]);
/** Only the storm-aware version's own record (issued since it went live): its 12 / 24 h steps are the new gauge-only + rain model, not the old rain ridge. */
export const stormModelFigure = (scope: Scope | undefined, h: number, win: Win): Stat | null => pool([scope?.[win]?.["model-v3"]?.[h], scope?.[win]?.["model-v4"]?.[h]]);

/** Only the measured-rain version's own record (issued since it went live); null until it has checks. */
export const measuredStormFigure = (scope: Scope | undefined, h: number, win: Win): Stat | null => scope?.[win]?.["model-v4"]?.[h] ?? null;

/** Fitted-model record on storm or calm hours for one horizon; null when the file has no split or it is empty. */
export const rainSplitFigure = (a: AccuracyFile | null, mode: "storm" | "calm", h: number, win: Win): Stat | null => a?.rainSplit?.[win]?.[mode]?.[String(h)] ?? null;

/** 30 days, unless that holds fewer than `min` one-hour checks (then everything since launch). */
export function bestWindow(a: AccuracyFile, min = 30): Win {
  return (figure(a.overall, 1, "d30")?.n ?? 0) >= min ? "d30" : "all";
}
export const MIN_CHECKS = 10;

const ftx = (v: number | null) => (v == null ? "n/a" : v.toFixed(2));
const day = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Sentence for the window: "the last 30 days" or "since 22 Oct". */
export function spanText(a: AccuracyFile, win: Win): string {
  return win === "d30" ? "the last 30 days" : `${day(a.firstForecast).replace(/ \d{4}$/, "")} to ${day(a.asOf).replace(/ \d{4}$/, "")}`;
}

/** Plain sentences for llms.txt / the MCP: live, per horizon, with the date and number of checks. */
export function accuracyLine(a: AccuracyFile | null): string {
  if (!a) return "Live accuracy figures are temporarily unavailable; see https://sl-water-levels.vercel.app/about#next-hour.";
  const win = bestWindow(a);
  const h1 = figure(a.overall, 1, win);
  if (!h1) return "Live accuracy figures are not available yet.";
  const parts = [1, 3, 6, 12, 24].map((h) => ({ h, f: figure(a.overall, h, win) })).filter((x) => x.f);
  const hs = parts.map(({ h, f }) => `${h} h: ${f!.n} checks, average miss ${ftx(f!.maeFt)} ft vs ${ftx(f!.baseMaeFt)} ft for "no change", real level inside the range ${f!.inBandPct}% of the time (range about ${ftx(f!.bandFt)} ft wide), direction right ${f!.dirPct}% vs ${f!.dirSteadyPct}% for always "steady"`);
  const nm = newModelFigure(a.overall, 1, win);
  const nmText = nm && nm.n >= MIN_CHECKS ? ` The gauge-only model that has run since ${day(a.gaugeModelSince)} (next hour, 3 h and 6 h) has its own record: ${nm.n} next-hour checks, average miss ${ftx(nm.maeFt)} ft vs ${ftx(nm.baseMaeFt)} ft for "no change".` : ` The newer gauge-only model (live since ${day(a.gaugeModelSince)}) has only ${nm?.n ?? 0} next-hour checks so far, too few to report on its own.`;
  const sv = a.stormModelSince ? [3, 6, 12, 24].map((h) => ({ h, f: stormModelFigure(a.overall, h, win) })).filter((x) => x.f && x.f.n >= MIN_CHECKS) : [];
  const svText = sv.length ? ` The storm-aware version (live since ${day(a.stormModelSince as string)}; 12 and 24 h now come from the gauge-only model with a rain correction on storm hours) has its own record: ${sv.map(({ h, f }) => `${h} h: ${f!.n} checks, average miss ${ftx(f!.maeFt)} ft vs ${ftx(f!.baseMaeFt)} ft for "no change"`).join("; ")}.` : "";
  const sp = [6, 24].map((h) => ({ h, s: rainSplitFigure(a, "storm", h, win), c: rainSplitFigure(a, "calm", h, win) })).filter((x) => x.s && x.c && x.s.n >= MIN_CHECKS && x.c.n >= MIN_CHECKS);
  const spText = sp.length ? ` On hours with heavy rain in the picture vs calm hours: ${sp.map(({ h, s, c }) => `${h} h average miss ${ftx(s!.maeFt)} ft (${s!.n} checks) vs ${ftx(c!.maeFt)} ft (${c!.n} checks)`).join("; ")}.` : "";
  return `Measured live from our prediction log, as of ${day(a.asOf)}, over ${spanText(a, win)} (average miss in feet; each forecast checked against the gauge reading closest to its target time): ${hs.join("; ")}. Longer horizons are much less certain.${nmText}${svText}${spText} Do not quote these as a guarantee.`;
}

/** The small line under a gauge's chart, or null when that gauge has too few checks. */
export function stationSummary(a: AccuracyFile | null, station: string): { h1: number; h24: number | null; n: number; since: string | null } | null {
  const sc = a?.stations?.[station];
  if (!a || !sc) return null;
  const win: Win = (figure(sc, 1, "d30", true)?.n ?? 0) >= MIN_CHECKS ? "d30" : "all";
  const f1 = figure(sc, 1, win, true);
  if (!f1 || f1.n < MIN_CHECKS || f1.maeFt == null) return null;
  const f24 = figure(sc, 24, win);
  return { h1: f1.maeFt, h24: f24 && f24.n >= MIN_CHECKS ? f24.maeFt : null, n: f1.n, since: win === "all" ? day(a.firstForecast).replace(/ \d{4}$/, "") : null };
}
