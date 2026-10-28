// Season storage for the medium reservoirs, read from the Irrigation Department's published sheet (the
// Maha / Yala history tabs behind their "Medium Reservoirs Daily Water Level" dashboard). Server only:
// the browser never calls Google. The raw tabs are about 1 MB each, so they are parsed once and only the
// small per-reservoir summary is cached (6 h: the tabs change once a day at most). Pages wait at most
// 1.5 s for it and render without the line otherwise. Pure maths: lib/seasonCalc.ts.

import { unstable_cache } from "next/cache";
import { parseCsv } from "./releases";
import { timeBox } from "./nextHour";
import { archiveKey } from "./reservoirData";
import { compareSeason, seasonOf, summariseSeasonTab, type Season, type SeasonKind, type SeasonSummary } from "./seasonCalc";

const SHEET_ID = "2PACX-1vTcSGhi9RESl7CMCl1TQnrKe07Gx5Q696YiSB9jneIHqIP9lifpqSErgI3D5k9KtQXSdW5JpycIIr5e";
export const SEASON_GIDS: Record<SeasonKind, number> = { maha: 155979206, yala: 1831537855 };
export const seasonUrl = (kind: SeasonKind) => `https://docs.google.com/spreadsheets/d/e/${SHEET_ID}/pub?gid=${SEASON_GIDS[kind]}&single=true&output=csv`;
const UA = "Mozilla/5.0 (compatible; sl-water-levels; +https://github.com/shakee93/sl-water-levels)";
const SIX_HOURS = 6 * 3600;
const COLOMBO_MS = 5.5 * 3_600_000;

export const colomboToday = (ms = Date.now()) => new Date(ms + COLOMBO_MS).toISOString().slice(0, 10);

/** Fetch and summarise the tab for the season that `today` is in. Throws on HTTP errors or a changed layout. */
export async function loadSeason(today: string, noStore = false): Promise<SeasonSummary> {
  const kind = seasonOf(Number(today.slice(5, 7)));
  const res = await fetch(seasonUrl(kind), { headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(noStore ? 20_000 : 12_000) });
  if (!res.ok) throw new Error(`${kind} tab HTTP ${res.status}`);
  return summariseSeasonTab(parseCsv(await res.text()), kind, today);
}

// No day in the cache key on purpose: a key that changed at midnight would make the first visitor of every day
// hit a cold cache and get no line. The summary says which sheet day it used (row.day), and up to 6 h of
// staleness changes a daily average by a fraction of a point.
export const getSeasonSummary = unstable_cache(() => loadSeason(colomboToday()), ["season-storage-v1"], { revalidate: SIX_HOURS });

/** Season line facts for one reservoir (by its sheet name), or null: unknown reservoir, slow or broken sheet. */
export async function getSeasonFor(sheetName: string | null | undefined, livePct: number | null): Promise<Season | null> {
  if (!sheetName) return null;
  const summary = await timeBox(getSeasonSummary(), 1500);
  if (!summary) return null;
  const key = archiveKey(sheetName, "sheet").key;
  const row = summary.rows.find((r) => archiveKey(r.name, "sheet").key === key);
  return row ? compareSeason(row, livePct) : null;
}
