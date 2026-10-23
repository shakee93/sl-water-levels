// "How our warnings did" for a town page: reads the live-validation tables in Cloudflare D1 (street_rain_log,
// street_flood_reports, forecast_verification) and returns only aggregates that pass the k-anonymity minimum
// (lib/myPlaces.ts K_MIN). Fails soft: any problem returns empty parts, never an error to a visitor.
import { d1Configured, d1Query } from "./d1";
import { PLACES, placeBySlug } from "./places";
import { colomboDay } from "./floodReport";
import { K_MIN, outcomes, scorecard, worstPerDay, type DayAnswers, type Outcome, type Scorecard } from "./myPlaces";

export type TownOutcome = {
  today: string;
  /** Per day: what we said and how neighbours answered. Totals only: single counts below the minimum are never exposed. */
  outcomes: Omit<Outcome, "wet" | "dry">[];
  score: Scorecard | null;
  /** Share (0-100) of 24 h river forecasts whose real level stayed inside the stated range, last 30 days; null until there are enough checks. */
  river: { pct: number; n: number } | null;
  /** True when this town is covered by the street-rain rule (so the section makes sense). */
  covered: boolean;
};

const DAY_MS = 86_400_000;
const MIN_RIVER_CHECKS = 100;

export async function loadTownOutcome(slug: string, now = Date.now()): Promise<TownOutcome> {
  const place = placeBySlug(slug);
  const empty: TownOutcome = { today: colomboDay(now), outcomes: [], score: null, river: null, covered: !!place?.rainZone };
  if (!place || !d1Configured()) return empty;
  const zone = place.rainZone;
  const out = { ...empty };

  if (zone) {
    try {
      const towns = PLACES.filter((p) => p.rainZone === zone).map((p) => p.slug);
      const since = now - 14 * DAY_MS;
      const sinceDay = colomboDay(since);
      const [rainRows, ansRows] = await Promise.all([
        d1Query("SELECT data_end_ms, state FROM street_rain_log WHERE zone = ? AND data_end_ms > ?", [zone, since]),
        d1Query(
          `SELECT day, answer, COUNT(*) AS n FROM street_flood_reports WHERE day >= ? AND town IN (${towns.map(() => "?").join(",")}) GROUP BY day, answer`,
          [sinceDay, ...towns],
        ),
      ]);
      const rain = worstPerDay(rainRows.map((r) => ({ day: colomboDay(Number(r.data_end_ms)), state: (r.state as string | null) ?? null })));
      const byDay = new Map<string, DayAnswers>();
      for (const r of ansRows) {
        const day = String(r.day);
        const a = byDay.get(day) ?? { day, wet: 0, dry: 0 };
        if (r.answer === "dry") a.dry += Number(r.n);
        else a.wet += Number(r.n);
        byDay.set(day, a);
      }
      const answers = [...byDay.values()];
      out.outcomes = outcomes(rain, answers).slice(0, 2).map(({ wet: _w, dry: _d, ...rest }) => rest);
      out.score = scorecard(rain, answers);
    } catch {
      /* tables missing or D1 down: no closure section, nothing else breaks */
    }
  }

  try {
    const rows = await d1Query(
      "SELECT COUNT(*) AS n, SUM(in_band) AS inb FROM forecast_verification WHERE horizon_h = 24 AND issued_at > ?",
      [now - 30 * DAY_MS],
    );
    const n = Number(rows[0]?.n ?? 0);
    if (n >= MIN_RIVER_CHECKS) out.river = { pct: Math.round((100 * Number(rows[0]?.inb ?? 0)) / n), n };
  } catch {
    /* view missing or slow: skip the river line */
  }
  return out;
}

export { K_MIN };

/** Answers from this town's zone in the current Colombo month, for the thank-you line after a report. Null below the minimum. */
export async function monthlyAnswers(slug: string, now = Date.now()): Promise<number | null> {
  const place = placeBySlug(slug);
  if (!place || !d1Configured()) return null;
  try {
    const month = colomboDay(now).slice(0, 7); // YYYY-MM
    const rows = await d1Query("SELECT COUNT(*) AS n FROM street_flood_reports WHERE town = ? AND day >= ? AND day < ?", [slug, `${month}-01`, `${month}-32`]);
    const n = Number(rows[0]?.n ?? 0);
    return n >= K_MIN ? n : null;
  } catch {
    return null;
  }
}
