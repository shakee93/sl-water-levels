// "12 people near Hanwella told us this week, 9 said it matched": the aggregate shown in the thank-you after a feedback answer.
// Counts come from forecast_feedback (Cloudflare D1), only for the last 7 days and only when at least K_MIN answers back them.
import { d1Configured, d1Query } from "./d1";
import { K_MIN } from "./myPlaces";

export type FeedbackImpact = { n: number; matched: number } | null;

/** Answers for this gauge (station pages) or town (town pages) in the last 7 days. Null below K_MIN, when D1 is down or not configured. */
export async function weeklyImpact(page: "station" | "town", target: string, now = Date.now()): Promise<FeedbackImpact> {
  if (!d1Configured()) return null;
  try {
    const col = page === "station" ? "station" : "town";
    const rows = await d1Query(`SELECT COUNT(*) AS n, SUM(answer = 'yes') AS yes FROM forecast_feedback WHERE page = ? AND ${col} = ? AND created_ms > ?`, [page, target, now - 7 * 86_400_000]);
    const n = Number(rows[0]?.n ?? 0);
    return n >= K_MIN ? { n, matched: Number(rows[0]?.yes ?? 0) } : null;
  } catch {
    return null;
  }
}
