// Pure date rule for the data-health check "irrigation-sheet" (lib/health.ts).
//
// The Irrigation "Reservoir Water Level" sheet is typed by hand and is often dated one day AHEAD (8 Nov 2026: newest row 2026-11-09, flagged
// "not today or yesterday", a false alarm that healed at midnight). Rule: the newest row's Colombo (UTC+05:30) day may be today, yesterday or
// tomorrow. Older than yesterday = stale; more than one day ahead = a typo or a broken date column, still a fault.
// Dependency-free so a node test can run it (test: node --experimental-strip-types --no-warnings scripts/sheet-freshness.test.mts).

const LK_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;
const dayNumber = (ms) => Math.floor((ms + LK_MS) / DAY_MS);

/** Whole Colombo days from `now` to the "YYYY-MM-DD" `day` (positive = in the future), or null when `day` is not a valid date. */
export function daysFromToday(day, now) {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return Math.round(t / DAY_MS) - dayNumber(now);
}

/** null when the newest row's date is acceptable, else a short problem text. */
export function newestRowProblem(newest, now) {
  const d = daysFromToday(newest, now);
  if (d === null) return `newest row is dated ${newest ?? "none"}, not a valid date`;
  if (d > 1) return `newest row is dated ${newest}, ${d} days in the future (up to 1 day ahead is normal)`;
  if (d < -1) return `newest row is dated ${newest}, ${-d} days old (only today, yesterday or tomorrow is accepted)`;
  return null;
}
