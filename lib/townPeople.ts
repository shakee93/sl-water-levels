// What real people near a town told us today, for one quiet line on the town verdict card (owner, 27 Oct 2026: "for cities we need
// to take the real user feedbacks with it"). A NOTE only: it never changes the step, pill, sticky bar, push or tone.
//   - "Is this right?" answers (forecast_feedback) from this town's page today (Colombo day), plus the gauge page's answers when the
//     gauge is in the town (km < 1.5), as counts: matches / worse / better.
//   - "Did the streets get water?" reports (street_flood_reports) for this town in the last 6 hours: deep or little.
// Aggregates only: every number is hidden below K_MIN (lib/myPlaces.ts), no notes, no exact times. Two tiny indexed reads per town,
// cached 5 minutes, time-boxed, fail soft to nothing (D1 unset or slow = no line). Indexes: idx_ff_town_day, idx_ff_target_day, idx_sfr_town_day.
import { unstable_cache } from "next/cache";
import { d1Configured, d1Query } from "./d1";
import { soft } from "./soft";
import { K_MIN } from "./myPlaces";
import { shapePeople, type TownPeople } from "./townNotes";

export const PEOPLE_BUDGET_MS = 1200;
/** Water reports count for this long. */
export const WATER_WINDOW_H = 6;

export type { TownPeople };
const shape = (f: { n: number; yes: number; worse: number; better: number }, water: number) => shapePeople(f, water, K_MIN, WATER_WINDOW_H);

const colomboDay = (ms: number) => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);

async function load(slug: string, station: string, day: string, yesterday: string, sinceMs: number): Promise<TownPeople | null> {
  const tally = (rows: Record<string, string | number | null>[]) => {
    const t = { n: 0, yes: 0, worse: 0, better: 0 };
    for (const r of rows) {
      const c = Number(r.n ?? 0);
      t.n += c;
      if (r.answer === "yes") t.yes += c;
      else if (r.answer === "worse") t.worse += c;
      else if (r.answer === "better") t.better += c;
    }
    return t;
  };
  const [town, gauge, water] = await Promise.all([
    d1Query("SELECT answer, COUNT(*) AS n FROM forecast_feedback WHERE town = ? AND day = ? GROUP BY answer", [slug, day]),
    station ? d1Query("SELECT answer, COUNT(*) AS n FROM forecast_feedback WHERE page = 'station' AND station = ? AND day = ? GROUP BY answer", [station, day]) : Promise.resolve([]),
    d1Query("SELECT COUNT(*) AS n FROM street_flood_reports WHERE town = ? AND day >= ? AND created_ms > ? AND answer IN ('deep','little')", [slug, yesterday, sinceMs]),
  ]);
  const a = tally(town), b = tally(gauge);
  return shape({ n: a.n + b.n, yes: a.yes + b.yes, worse: a.worse + b.worse, better: a.better + b.better }, Number(water[0]?.n ?? 0));
}

const cached = unstable_cache(load, ["town-people-v1"], { revalidate: 300 });

/** `station` = the gauge's name when it sits in the town (its page answers count too), else "". */
export async function getTownPeople(slug: string, station: string, now = Date.now()): Promise<TownPeople | null> {
  if (!d1Configured()) return null;
  // the 6 h window is rounded down to the cache bucket so the cache key stays stable for five minutes
  const bucket = Math.floor(now / 300_000) * 300_000;
  return soft(cached(slug, station, colomboDay(now), colomboDay(now - 86_400_000), bucket - WATER_WINDOW_H * 3_600_000).catch(() => null), PEOPLE_BUDGET_MS, null);
}
