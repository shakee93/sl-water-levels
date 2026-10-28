// Season context for the medium (Irrigation Department) reservoirs: "how full is it for this time of the
// season?". Pure maths and parsing, no Next imports, so `node scripts/season.test.mts` can run it.
//
// Source: two tabs of the same published Google Sheet the daily reservoir tabs come from, which the
// Irrigation Department's "Medium Reservoirs Daily Water Level" dashboard reads:
//  - "Maha" (1 Oct - 31 Mar): one row per reservoir per day, columns Active Storage, Long Term Average and
//    ES_24_25 / ES_25_26 / ES_26_27 (effective storage in acre-feet, one column per season; the current
//    season fills in day by day and stays blank for days still to come).
//  - "Yala" (1 Apr - 30 Sep): the same, with one column per calendar year ("EFFECTIVE STORAGE (Acft) 2026").
// The "Update Date" column carries a placeholder year (2026 / 2027 for Maha): only the month and day matter.
// A blank cell is unknown, never zero.

export type SeasonKind = "maha" | "yala";

/** What we keep per reservoir: today's row only, in acre-feet. */
export type SeasonRow = {
  name: string;
  activeAcft: number;
  /** Long-term average effective storage for this day of the season. */
  ltaAcft: number | null;
  /** This season's effective storage on `day` (null when blank). */
  curAcft: number | null;
  /** The same day last season / year. */
  prevAcft: number | null;
  /** The sheet day (month-day of the row used, written with the current year) */
  day: string;
};

export type SeasonSummary = { kind: SeasonKind; asOf: string; rows: SeasonRow[] };

export const seasonOf = (month1to12: number): SeasonKind => (month1to12 >= 10 || month1to12 <= 3 ? "maha" : "yala");

/** Month/day -> a number that grows through the season (Oct 1 = 0 for Maha, Apr 1 = 0 for Yala). */
const ordinal = (kind: SeasonKind, m: number, d: number) => ((m - (kind === "maha" ? 10 : 4) + 12) % 12) * 31 + d;

/** The year the current season started in (Maha 2026-27 starts 1 Oct 2026; Jan 2027 is still "2026"). */
export const seasonStartYear = (kind: SeasonKind, y: number, m: number) => (kind === "maha" && m <= 3 ? y - 1 : y);

const num = (s: string | undefined | null): number | null => {
  if (s == null) return null;
  const t = s.replace(/,/g, "").trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

/** "10/28/2026" (US order, as the tab writes it) -> [month, day]. */
function md(raw: string): [number, number] | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/\d{4}$/.exec(raw.trim());
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? [mo, d] : null;
}

/** Longest tolerated gap between today and the newest filled row of the current season. */
export const MAX_GAP_DAYS = 4;

/**
 * Today's row per reservoir. `parseCsv` is passed in (lib/releases.ts has the RFC 4180 reader) so this file
 * stays import-free. `today` is the Colombo calendar day, YYYY-MM-DD. Throws when the layout is not the one
 * we know (health check turns that into a warning); a missing current-season column is not an error (null values).
 */
export function summariseSeasonTab(grid: string[][], kind: SeasonKind, today: string): SeasonSummary {
  const hi = grid.slice(0, 5).findIndex((r) => r.some((c) => c.trim().toLowerCase() === "reservoir"));
  if (hi < 0) throw new Error(`${kind}: header row not found (sheet layout changed?)`);
  const H = grid[hi].map((h) => h.replace(/\s+/g, " ").trim());
  const idx = (f: (h: string) => boolean) => H.findIndex(f);
  const c = {
    date: idx((h) => /^update date$/i.test(h)),
    name: idx((h) => /^reservoir$/i.test(h)),
    active: idx((h) => /^active storage/i.test(h)),
    lta: idx((h) => /^long term/i.test(h)),
  };
  if (c.date < 0 || c.name < 0 || c.active < 0 || c.lta < 0) throw new Error(`${kind}: expected columns missing (sheet layout changed?)`);

  const [ty, tm, td] = today.split("-").map(Number);
  const start = seasonStartYear(kind, ty, tm);
  // Season columns: Maha "ES_24_25_Acft" (start year 24), Yala "EFFECTIVE STORAGE (Acft) 2026".
  const seasonCol = (startYear: number) =>
    kind === "maha"
      ? idx((h) => new RegExp(`^ES_${String(startYear % 100).padStart(2, "0")}_`, "i").test(h))
      : idx((h) => /^effective storage/i.test(h) && h.endsWith(String(startYear)));
  const curCol = seasonCol(start);
  const prevCol = seasonCol(start - 1);
  const todayOrd = ordinal(kind, tm, td);

  type Best = { ord: number; row: string[] };
  const best = new Map<string, Best>();
  const filled = (r: string[]) => (curCol >= 0 ? num(r[curCol]) != null : true);
  for (const r of grid.slice(hi + 1)) {
    const name = (r[c.name] ?? "").replace(/\s+/g, " ").trim();
    const d = md(r[c.date] ?? "");
    if (!name || !d) continue;
    const ord = ordinal(kind, d[0], d[1]);
    if (ord > todayOrd || !filled(r)) continue; // days still to come are blank; a filled-in future day is not "now"
    const b = best.get(name);
    if (!b || ord > b.ord) best.set(name, { ord, row: r });
  }

  const rows: SeasonRow[] = [];
  for (const [name, b] of best) {
    const active = num(b.row[c.active]);
    if (active == null || active <= 0) continue;
    if (todayOrd - b.ord > MAX_GAP_DAYS) continue; // stale: say nothing rather than compare an old day
    const m = md(b.row[c.date])!;
    const yr = m[0] >= 10 || kind === "yala" ? start : start + 1; // calendar year of that month-day
    rows.push({
      name,
      activeAcft: active,
      ltaAcft: num(b.row[c.lta]),
      curAcft: curCol >= 0 ? num(b.row[curCol]) : null,
      prevAcft: prevCol >= 0 ? num(b.row[prevCol]) : null,
      day: `${yr}-${String(m[0]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`,
    });
  }
  if (rows.length < 20) throw new Error(`${kind}: only ${rows.length} reservoirs with a current row (sheet layout changed?)`);
  return { kind, asOf: today, rows };
}

// ---------------------------------------------------------------- the comparison

export type Band = "above" | "near" | "below";
export type Season = {
  /** % full now (of active storage) used for the comparison. */
  nowPct: number;
  /** Long-term average % full for this day of the season. */
  avgPct: number;
  /** Same day last season / year, % full; null when unknown. */
  lastPct: number | null;
  band: Band;
  /** Percentage points above (+) or below (-) the long-term average. */
  diffPts: number;
  /** Calendar month (1-12) and part of month for the wording. */
  month: number;
  part: "early" | "mid" | "late";
};

/** Within this many percentage points of the long-term average counts as "about normal". */
export const NEAR_PTS = 10;

const r1 = (x: number) => Math.round(x * 10) / 10;
// The sheet's own % column stops at 100 when a tank overflows, so does this.
const pct = (acft: number | null, active: number) => (acft == null ? null : r1(Math.min(100, Math.max(0, (acft / active) * 100))));

/**
 * Storage now against the long-term average for the same day of the season. `livePct` (the daily sheet's
 * figure, fresher than the weekly tabs) is used when given; otherwise this season's value from the tab.
 * Null when there is no usable average or no current figure: no line is better than a wrong one.
 */
export function compareSeason(row: SeasonRow, livePct: number | null): Season | null {
  const avg = pct(row.ltaAcft, row.activeAcft);
  const now = livePct != null && Number.isFinite(livePct) ? livePct : pct(row.curAcft, row.activeAcft);
  if (avg == null || now == null) return null;
  const now1 = r1(now);
  const diff = r1(now1 - avg);
  const [, m, d] = row.day.split("-").map(Number);
  return {
    nowPct: now1,
    avgPct: avg,
    lastPct: pct(row.prevAcft, row.activeAcft),
    band: diff >= NEAR_PTS ? "above" : diff <= -NEAR_PTS ? "below" : "near",
    diffPts: diff,
    month: m,
    part: d <= 10 ? "early" : d <= 20 ? "mid" : "late",
  };
}
