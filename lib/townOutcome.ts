// Answers to "Did the streets near you get water today?" (street_flood_reports in Cloudflare D1), for the thank-you line
// after a report. Aggregates only, never fewer than K_MIN (lib/myPlaces.ts) answers behind a number; fails soft.
import { d1Configured, d1Query } from "./d1";
import { placeBySlug } from "./places";
import { colomboDay } from "./floodReport";
import { K_MIN } from "./myPlaces";

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
