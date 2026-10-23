// Mahaweli Water Management Secretariat "Weekly Operational Meeting" decisions (PDF), as a spill
// watch: per reservoir, last week's release, the planned release and the dates on which the
// meeting said spilling is possible. A plan, not an event: the UI says "may spill" and never
// calls it a flood warning. Fetched with If-Modified-Since, cached an hour, fails soft.
// Parsing lives in lib/wmsWeeklyParse.ts (pure, unit tested by scripts/wms-weekly.test.mts).

import { unstable_cache } from "next/cache";
import { getDocumentProxy } from "unpdf";
import { matchReservoir } from "./reservoirs";
import { slugify } from "./slug";
import { parseWeekly, type TextCell } from "./wmsWeeklyParse";

export const WEEKLY_PDF = "https://mahaweli.gov.lk/WMS%20DATA/Weekly%20Operational%20Meeting.pdf";
const UA = "Mozilla/5.0 (compatible; sl-water-levels; +https://github.com/shakee93/sl-water-levels)";
const HOUR = 3600;
const COLOMBO_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

export type SpillWindow = { from: string; to: string };

export type WeeklyReservoir = {
  /** Catalogue id (lib/reservoirs.ts) or null for a reservoir we do not list. */
  reservoirId: string | null;
  /** Page slug under /reservoirs. */
  slug: string;
  /** Display name. */
  name: string;
  spillWindow: SpillWindow | null;
  /** The listed days (a window may have gaps, e.g. 16-18 and 20-21). */
  spillDays: string[];
  plannedMcmPerDay: number | null;
  lastWeekMcm: number | null;
  rawLine: string;
};

export type WeeklyData = {
  /** Day of the meeting, YYYY-MM-DD. */
  meetingDate: string | null;
  nextWeek: SpillWindow | null;
  fetchedAt: number;
  lastModified: string | null;
  items: WeeklyReservoir[];
};

const colomboDay = (ms: number) => new Date(ms + COLOMBO_MS).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);

/** Spellings in this PDF that differ from the daily report: shown as the daily report writes them. */
const NAME_FIX: Record<string, string> = { maussakelle: "Maussakele", moussakele: "Maussakele", castlereigh: "Castlereagh", broadland: "Broadlands", kukuleganga: "Kukule", udawalawa: "Udawalawe" };

export function weeklyItemFor(rawName: string): Pick<WeeklyReservoir, "reservoirId" | "slug" | "name"> {
  const clean = rawName.replace(/\s+/g, " ").trim();
  const res = matchReservoir(clean);
  if (res) return { reservoirId: res.id, slug: slugify(res.name), name: res.name };
  const name = NAME_FIX[clean.toLowerCase()] ?? clean;
  return { reservoirId: null, slug: slugify(name), name };
}

export async function parseWeeklyPdf(bytes: Uint8Array): Promise<Omit<WeeklyData, "fetchedAt" | "lastModified">> {
  const pdf = await getDocumentProxy(bytes);
  const cells: TextCell[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    for (const it of tc.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      cells.push({ s: it.str.trim(), x: it.transform[4], r: it.transform[4] + it.width, y: it.transform[5], page: p });
    }
  }
  const parsed = parseWeekly(cells);
  return {
    meetingDate: parsed.meetingDate,
    nextWeek: parsed.nextWeek,
    items: parsed.items.map((i) => ({
      ...weeklyItemFor(i.name),
      spillWindow: i.spillWindow,
      spillDays: i.spillDays,
      plannedMcmPerDay: i.plannedMcmPerDay,
      lastWeekMcm: i.lastWeekMcm,
      rawLine: i.rawLine,
    })),
  };
}

let memo: { lastModified: string | null; etag: string | null; data: WeeklyData } | null = null;

async function loadWeekly(): Promise<WeeklyData> {
  const headers: Record<string, string> = { "User-Agent": UA };
  if (memo?.lastModified) headers["If-Modified-Since"] = memo.lastModified;
  if (memo?.etag) headers["If-None-Match"] = memo.etag;
  const res = await fetch(WEEKLY_PDF, { headers, cache: "no-store", signal: AbortSignal.timeout(25_000) });
  if (res.status === 304 && memo) return { ...memo.data, fetchedAt: Date.now() };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const parsed = await parseWeeklyPdf(new Uint8Array(await res.arrayBuffer()));
  if (parsed.items.length < 5) throw new Error(`only ${parsed.items.length} reservoirs found (PDF layout changed?)`);
  const lastModified = res.headers.get("last-modified");
  const data: WeeklyData = { ...parsed, fetchedAt: Date.now(), lastModified };
  memo = { lastModified, etag: res.headers.get("etag"), data };
  return data;
}

const cached = unstable_cache(loadWeekly, ["wms-weekly-v1"], { revalidate: HOUR });

/** The parsed weekly meeting, or null when the PDF cannot be read. Never throws. */
export async function getWeekly(): Promise<WeeklyData | null> {
  try {
    return await cached();
  } catch {
    return null;
  }
}

/** Same, with the error text, for the health check and the archive. */
export async function getWeeklyOutcome(): Promise<{ ok: true; data: WeeklyData } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await cached() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}

// ---------------------------------------------------------------- when to show a window

export type WindowState = "upcoming" | "now" | "ended" | "passed";

/** "now" is inside the window (Colombo days), "ended" the one day after it, then "passed" (hidden). */
export function windowState(w: SpillWindow, now = Date.now()): WindowState {
  const today = colomboDay(now);
  if (today > addDays(w.to, 1)) return "passed";
  if (today > w.to) return "ended";
  return today >= w.from ? "now" : "upcoming";
}

/** Whole hours from now until the window opens (0 when inside). */
export function hoursUntil(w: SpillWindow, now = Date.now()): number {
  const start = Date.parse(w.from + "T00:00:00Z") - COLOMBO_MS;
  return Math.max(0, Math.round((start - now) / 3_600_000));
}

export type ActiveWatch = WeeklyReservoir & { spillWindow: SpillWindow; state: "upcoming" | "now" | "ended" };

/** Windows still worth showing (not yet passed). */
export function activeWatches(data: WeeklyData | null, now = Date.now()): ActiveWatch[] {
  if (!data) return [];
  return data.items.flatMap((i) => {
    if (!i.spillWindow) return [];
    const state = windowState(i.spillWindow, now);
    return state === "passed" ? [] : [{ ...i, spillWindow: i.spillWindow, state }];
  });
}

/** The still-relevant window for one reservoir page (by slug or catalogue id), or null. */
export async function spillWatchFor(slugOrId: string, now = Date.now()): Promise<{ watch: ActiveWatch; data: WeeklyData } | null> {
  const data = await getWeekly();
  const watch = activeWatches(data, now).find((w) => w.slug === slugOrId || w.reservoirId === slugOrId);
  return data && watch ? { watch, data } : null;
}
