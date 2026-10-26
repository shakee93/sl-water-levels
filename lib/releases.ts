// Reservoir release warnings: which reservoirs are letting water out, how much, and which of our
// gauges that water will reach. See research/dam-releases.md for the sources and live samples.
//
// Sources (all server-side, every one fails soft; nothing here throws into a page):
//  1. Irrigation Department "Reservoir Water Level" published Google Sheet (Major + Medium tabs):
//     spilling Y/N, spill and sluice cusecs, gate settings, water depth. Daily, overwritten, no
//     timestamp, so we only know the reading's date. Official numbers.
//  2. Mahaweli Authority WMS PDF: spill/downstream discharge in m3/s and ft3/s for the CEB and
//     Mahaweli reservoirs. Blank means unknown, never zero. Official numbers.
//  3. DMC flood-warning PDFs (lib/warnings.ts): one headline cusec figure per bulletin.
//  4. News RSS (Newswire is the main feed; Ada Derana and Daily Mirror are secondary; lib/newsFeeds.ts): "spill gates opened/raised/closed" at a known reservoir.
//     The only early signal (hours ahead of the numbers). Shown as "reported by <outlet>", never as
//     official, and expires after 12 hours.
//
// Gate settings text such as GO=22400(60"@2,48"@4) is turned into "gates open" only. The cusec
// figure printed next to GO is the gate setting's discharge, not a measured flow, so it is never
// shown as the flow: the headline number always comes from the Spilling (Cusec) column.

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getDocumentProxy } from "unpdf";
import { aiConfigured, decide } from "./openai";
import { getOfficialWarnings } from "./warnings";
import { matchGateStoryWith } from "./gateStory";
import { articleCached, articleTimeCached, getFeeds, type Outlet } from "./newsFeeds";
import { reportedFigures, type ReportedFigure } from "./newsFigures";
import { RESERVOIRS, matchReservoir, reservoirsForStation, type Reservoir } from "./reservoirs";

// ---------------------------------------------------------------- types

export type SheetRow = {
  name: string;
  tab: "Major" | "Medium";
  reservoirId: string | null;
  /** Calendar day of the reading, YYYY-MM-DD (the sheet has no clock time). */
  day: string | null;
  spilling: boolean;
  spillCusecs: number | null;
  sluiceCusecs: number | null;
  depthFt: number | null;
  fsdFt: number | null;
  /** Spill gates open, from the GO= part of the remarks; null when the remarks say nothing usable. */
  gatesOpen: number | null;
  /** Raw remarks, kept for the archive and the API only. */
  remarks: string;
};

export type SheetData = { sheetDate: string | null; rows: SheetRow[]; fetchedAt: number };

export type WmsRow = {
  name: string;
  reservoirId: string | null;
  day: string | null;
  levelMsl: number | null;
  storagePct: number | null;
  rainMm: number | null;
  /** Spill / downstream discharge; null when the cell is blank or a dash (unknown, not zero). */
  dischargeM3s: number | null;
  dischargeCusecs: number | null;
};

export type WmsData = { reportDate: string | null; rows: WmsRow[]; lastModified: string | null; fetchedAt: number };

export type NewsDetection = {
  reservoirId: string;
  action: "opened" | "closed";
  outlet: Outlet;
  headline: string;
  url: string;
  /** ISO with +05:30. */
  publishedAt: string;
};

/** The newest figure reported after the official reading: a news story or a later bulletin. Shown as a second line, never as the main figure. */
export type ReportedLine = ReportedFigure & {
  /** "news" = a news story ("Reported ..."); "bulletin" = a later Irrigation Department bulletin. */
  via: "news" | "bulletin";
  /** The news outlet, or "Irrigation Department" for a bulletin. */
  outlet: string;
  url: string;
  /** ISO with +05:30. */
  at: string;
};

export type Release = {
  reservoirId: string;
  name: string;
  basin: string;
  /** Downstream gauges of ours (station names), possibly none. */
  stations: string[];
  /** confirmed = official numbers; reported = only a news report of gates being opened. */
  kind: "confirmed" | "reported";
  /** Who published it: "Irrigation Department", "Mahaweli Authority" or the news outlet. */
  source: string;
  url: string;
  cusecs: number | null;
  gatesOpen: number | null;
  /** When the figure was observed: the reading day for the sheet/PDF, the bulletin or story time otherwise. */
  observedAt: string;
  /** True when observedAt is only a day (no clock time known). */
  dayOnly: boolean;
  /** A news report newer than the official reading (shown as an extra line). */
  news: NewsDetection | null;
  /** A cusecs / gate figure newer than the official reading (news story or later bulletin), or null. */
  reported: ReportedLine | null;
  /** "Reservoir watch": its water goes into another reservoir, so this is never a flood warning (lib/reservoirs.ts kind "watch"). */
  watch?: true;
};

export type ReleasesResult = {
  releases: Release[];
  /** Per-source status for diagnostics and the MCP tool. */
  sources: {
    sheet: { ok: boolean; sheetDate: string | null; rows: number; fetchedAt: string | null; error?: string };
    wms: { ok: boolean; reportDate: string | null; rows: number; fetchedAt: string | null; error?: string };
    news: { ok: boolean; detections: number; error?: string };
    dmc: { ok: boolean; error?: string };
  };
};

// ---------------------------------------------------------------- constants

const SHEET_ID = "2PACX-1vTcSGhi9RESl7CMCl1TQnrKe07Gx5Q696YiSB9jneIHqIP9lifpqSErgI3D5k9KtQXSdW5JpycIIr5e";
const SHEET_BASE = `https://docs.google.com/spreadsheets/d/e/${SHEET_ID}`;
const TABS = [
  { gid: 1212294664, tab: "Major" as const },
  { gid: 562386515, tab: "Medium" as const },
];
const WMS_PDF = "https://mahaweli.gov.lk/WMS%20DATA/Menue-WMS%20-%20E.pdf";
const WMS_PAGE = "https://mahaweli.gov.lk/wms.html";
const UA = "Mozilla/5.0 (compatible; sl-water-levels; +https://github.com/shakee93/sl-water-levels)";
const CUSECS_PER_M3S = 35.3147;
const TEN_MIN = 600;
const HOUR = 3600;
const NEWS_TTL_MS = 12 * 3_600_000;
const COLOMBO_MS = 5.5 * 3_600_000;
/** A spill below this is routine tank overflow, not a warning. */
export const MIN_NOTABLE_CUSECS = 500;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const colomboDay = (ms: number) => new Date(ms + COLOMBO_MS).toISOString().slice(0, 10);
const dayStartMs = (day: string) => Date.parse(`${day}T00:00:00+05:30`);
const num = (s: string | undefined | null): number | null => {
  if (s == null) return null;
  const t = s.replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
};

// ---------------------------------------------------------------- CSV + sheet

/** RFC 4180 reader: the sheet's title cell contains a quoted newline. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

/** "23-Oct", "22-Oct-26", "10/22/2026", "23-October-2026" -> YYYY-MM-DD, using the sheet's year if none given. */
export function parseSheetDay(raw: string, fallbackYear: number): string | null {
  const s = raw.trim();
  let m = /^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/,]*(\d{2,4})?$/.exec(s);
  if (m) {
    const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mon < 0) return null;
    let y = m[3] ? Number(m[3]) : fallbackYear;
    if (y < 100) y += 2000;
    return `${y}-${String(mon + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); // US order, as the IDAT tab writes it
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

/**
 * Spill gates open from remarks like GO=22400(60"@2, 48"@4, 36"@2) or GO (RB)=1332(28"@2) GO(LB)=400(12"@3).
 * Only the GO parts count (SD= is the sluice outlet); a gate counts as open when its opening is above 0.
 * Null when there is no GO part or no "@count" in it.
 */
export function parseGatesOpen(remarks: string): number | null {
  let total = 0;
  let seen = false;
  for (const g of remarks.matchAll(/\bGO\s*(?:\([A-Za-z]+\))?\s*=\s*[\d.,]*\s*\(([^)]*)\)/gi)) {
    for (const p of g[1].matchAll(/(\d+(?:\.\d+)?)\s*(?:"|''|”|′|'|in)?\s*@\s*(\d+)/gi)) {
      seen = true;
      if (Number(p[1]) > 0) total += Number(p[2]);
    }
  }
  return seen ? total : null;
}

export function parseSheetTab(csv: string, tab: "Major" | "Medium"): { sheetDate: string | null; rows: SheetRow[] } {
  const grid = parseCsv(csv);
  const hi = grid.slice(0, 12).findIndex((r) => r.some((c) => c.trim().toUpperCase() === "RESERVOIR"));
  if (hi < 0) throw new Error(`${tab}: header row not found`);
  const H = grid[hi].map((h) => h.replace(/\s+/g, " ").trim().toLowerCase());
  const col = (f: (h: string) => boolean) => H.findIndex(f);
  const c = {
    name: col((h) => h === "reservoir"),
    date: col((h) => h === "date"),
    depth: col((h) => h.startsWith("water depth")),
    fsd: col((h) => h.startsWith("fsd")),
    spilling: col((h) => h === "spilling"),
    remarks: col((h) => h === "remarks"),
    sluice: col((h) => h.includes("sluice") && h.includes("cusec")),
    spill: col((h) => h.includes("spilling") && h.includes("cusec")),
  };
  if (c.name < 0 || c.date < 0 || c.spilling < 0 || c.spill < 0) throw new Error(`${tab}: expected columns missing (sheet layout changed?)`);

  // "23-October-2026" somewhere in the title rows.
  let sheetDate: string | null = null;
  for (const r of grid.slice(0, hi)) {
    for (const cell of r) {
      const m = /(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](20\d\d)/.exec(cell);
      if (m) sheetDate = parseSheetDay(`${m[1]}-${m[2]}-${m[3]}`, 0);
    }
  }
  const year = sheetDate ? Number(sheetDate.slice(0, 4)) : new Date().getFullYear();

  const rows: SheetRow[] = [];
  for (const r of grid.slice(hi + 1)) {
    const name = (r[c.name] ?? "").replace(/\s+/g, " ").trim();
    if (!name || !(r[c.date] ?? "").trim()) continue;
    const remarks = (r[c.remarks] ?? "").replace(/\s+/g, " ").trim();
    rows.push({
      name,
      tab,
      reservoirId: matchReservoir(name.replace(/\b(tank|wewa|reservoir)\b/gi, ""))?.id ?? matchReservoir(name)?.id ?? null,
      day: parseSheetDay(r[c.date], year),
      spilling: /^y/i.test((r[c.spilling] ?? "").trim()),
      spillCusecs: num(r[c.spill]),
      sluiceCusecs: c.sluice >= 0 ? num(r[c.sluice]) : null,
      depthFt: c.depth >= 0 ? num(r[c.depth]) : null,
      fsdFt: c.fsd >= 0 ? num(r[c.fsd]) : null,
      gatesOpen: parseGatesOpen(remarks),
      remarks,
    });
  }
  if (rows.length < 20) throw new Error(`${tab}: only ${rows.length} reservoirs found (sheet layout changed?)`);
  return { sheetDate, rows };
}

const sheetCached = unstable_cache(
  async (): Promise<SheetData> => {
    const parts = await Promise.all(
      TABS.map(async ({ gid, tab }) => {
        const res = await fetch(`${SHEET_BASE}/pub?gid=${gid}&single=true&output=csv`, {
          headers: { "User-Agent": UA },
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`${tab} tab HTTP ${res.status}`);
        return parseSheetTab(await res.text(), tab);
      }),
    );
    return { sheetDate: parts[0].sheetDate, rows: parts.flatMap((p) => p.rows), fetchedAt: Date.now() };
  },
  ["releases-sheet-v1"],
  { revalidate: TEN_MIN },
);

// ---------------------------------------------------------------- Mahaweli WMS PDF

// Right-hand edges (PDF points) of the numeric columns in the Excel export. The header row is
// searched for "m3/s" and "ft3/s" first; these are the fallback and the tolerance.
const WMS_COLS = { rain: 664, m3s: 715, cusec: 770, tol: 22 };

function wmsName(raw: string): string {
  return raw.replace(/^moussakele$/i, "Maussakele").replace(/^castlereigh$/i, "Castlereagh").replace(/\s+/g, " ").trim();
}

let wmsMemo: { etag: string | null; lastModified: string | null; data: WmsData } | null = null;

async function loadWms(): Promise<WmsData> {
  const headers: Record<string, string> = { "User-Agent": UA };
  if (wmsMemo?.lastModified) headers["If-Modified-Since"] = wmsMemo.lastModified;
  if (wmsMemo?.etag) headers["If-None-Match"] = wmsMemo.etag;
  const res = await fetch(WMS_PDF, { headers, cache: "no-store", signal: AbortSignal.timeout(25_000) });
  if (res.status === 304 && wmsMemo) return { ...wmsMemo.data, fetchedAt: Date.now() };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const pdf = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
  const rows: WmsRow[] = [];
  let reportDate: string | null = null;
  let year = new Date().getFullYear();
  let cols = { ...WMS_COLS };

  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    type Cell = { s: string; x: number; r: number; y: number };
    const cells: Cell[] = [];
    for (const it of tc.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      cells.push({ s: it.str.trim(), x: it.transform[4], r: it.transform[4] + it.width, y: it.transform[5] });
    }
    const lines: Cell[][] = [];
    for (const cell of cells.sort((a, b) => b.y - a.y || a.x - b.x)) {
      const line = lines.find((l) => Math.abs(l[0].y - cell.y) <= 3);
      if (line) line.push(cell);
      else lines.push([cell]);
    }
    for (const line of lines) {
      line.sort((a, b) => a.x - b.x);
      const text = line.map((c) => c.s).join(" ");
      const title = /LATEST STATUS OF RESERVOIRS\s+(20\d\d)\/(\d{2})\/(\d{2})/i.exec(text);
      if (title) {
        reportDate = `${title[1]}-${title[2]}-${title[3]}`;
        year = Number(title[1]);
      }
      const m3 = line.find((c) => c.s === "m3/s");
      const ft3 = line.find((c) => c.s === "ft3/s");
      if (m3 && ft3) cols = { ...cols, m3s: m3.r, cusec: ft3.r };

      // A data row starts with its serial number and has a "dd-Mon" date cell.
      if (!/^\d{1,2}$/.test(line[0].s) || line[0].x > 100) continue;
      const dateCell = line.find((c) => /^\d{1,2}-[A-Za-z]{3}$/.test(c.s));
      if (!dateCell) continue;
      const nameCells = line.filter((c) => c.x > line[0].x + 5 && c.r < 200 && c !== dateCell && !/^[\d.,%-]+$/.test(c.s));
      const name = wmsName(nameCells.map((c) => c.s).join(" "));
      if (!name) continue;
      const at = (right: number) => line.find((c) => Math.abs(c.r - right) <= cols.tol);
      const pct = line.find((c) => /^\d+%$/.test(c.s));
      const level = line.find((c) => Math.abs(c.r - 373) <= 25);
      const m3s = num(at(cols.m3s)?.s);
      const ft3s = num(at(cols.cusec)?.s);
      rows.push({
        name,
        reservoirId: matchReservoir(name)?.id ?? null,
        day: parseSheetDay(dateCell.s, year),
        levelMsl: num(level?.s),
        storagePct: pct ? Number(pct.s.replace("%", "")) : null,
        rainMm: num(at(cols.rain)?.s),
        dischargeM3s: m3s,
        dischargeCusecs: ft3s ?? (m3s != null ? Math.round(m3s * CUSECS_PER_M3S) : null),
      });
    }
  }
  if (rows.length < 20) throw new Error(`only ${rows.length} reservoirs found (PDF layout changed?)`);
  const lastModified = res.headers.get("last-modified");
  const data: WmsData = { reportDate, rows, lastModified, fetchedAt: Date.now() };
  wmsMemo = { etag: res.headers.get("etag"), lastModified, data };
  return data;
}

const wmsCached = unstable_cache(loadWms, ["releases-wms-v1"], { revalidate: HOUR });

// ---------------------------------------------------------------- news

/** Pure keyword matcher: the reservoir and direction of a gates story, or null (lib/gateStory.ts, unit tested). */
export const matchGateStory = (title: string, desc: string) => matchGateStoryWith(matchReservoir, title, desc);

const classifyCached = unstable_cache(
  async (guid: string, title: string, desc: string): Promise<"opened" | "closed" | "unclear"> => {
    void guid;
    const r = await decide(`Headline: ${title}\n\n${desc}`.slice(0, 2000), [
      {
        type: "choice",
        name: "gates",
        instructions: "This is a Sri Lankan news item about reservoir spill gates. Is the main news that gates were opened or raised (more water released), or that gates were closed or lowered (less water released)? Choose unclear if both, or if no gate was opened or closed.",
        choices: [
          { value: "opened", description: "Gates were opened or raised; water is being released or released more." },
          { value: "closed", description: "Gates were closed or lowered; the release stopped or reduced." },
          { value: "unclear", description: "Both happened, neither happened, or it is only a plan or a general statement." },
        ],
      },
    ]);
    if (!r.ok) throw new Error(r.reason);
    const a = r.data.get("gates");
    if (!a || a.type !== "choice" || a.confidence < 0.7) return "unclear";
    return a.choice === "opened" || a.choice === "closed" ? a.choice : "unclear";
  },
  ["releases-news-classify-v1"],
  { revalidate: 7 * 24 * 3600 },
);

const newsCached = unstable_cache(
  async (): Promise<NewsDetection[]> => {
    const out: NewsDetection[] = [];
    // One shared fetch of every feed (Newswire first); a feed that fails is skipped, all failing throws.
    const { items } = await getFeeds();
    await Promise.all(
      items.map(async (it) => {
        try {
          const hit = matchGateStory(it.title, it.desc);
          if (!hit) return;
          let action = hit.action;
          if (action === "unclear" && aiConfigured()) action = await classifyCached(it.guid, it.title, it.desc).catch(() => "unclear" as const);
          if (action === "unclear") return;
          const ms = it.pubMs ?? (await articleTimeCached(it.link).catch(() => null));
          if (ms == null || Date.now() - ms > NEWS_TTL_MS || ms - Date.now() > 3_600_000) return;
          out.push({
            reservoirId: hit.reservoir.id,
            action,
            outlet: it.outlet,
            headline: it.title,
            url: it.link,
            publishedAt: new Date(ms + COLOMBO_MS).toISOString().slice(0, 19) + "+05:30",
          });
        } catch {
          /* one bad story never drops the rest */
        }
      }),
    );
    return out;
  },
  ["releases-news-v2"],
  { revalidate: TEN_MIN },
);

type NewsFigure = ReportedLine & { reservoirId: string };

const FIGURE_WORDS = /\b(gates?|spill(?:ing|s)?|cusecs?|cubic\s+feet|releas\w*)\b/i;

/**
 * Figures (cusecs, gates, feet opened) in release stories of the last 12 hours, per reservoir. A story
 * about one reservoir can carry another's figures ("Meanwhile, four gates of Tabbowa ..."), so the
 * story page is read and split by reservoir (lib/newsFigures.ts). Fails soft; a bad story is skipped.
 */
const figuresCached = unstable_cache(
  async (): Promise<NewsFigure[]> => {
    const out: NewsFigure[] = [];
    const { items } = await getFeeds();
    await Promise.all(
      items.map(async (it) => {
        try {
          const head = `${it.title}. ${it.desc}`;
          if (!FIGURE_WORDS.test(head) || !matchReservoir(head, "contains")) return;
          const art = await articleCached(it.link).catch(() => null);
          const published = it.pubMs ?? art?.publishedMs ?? null;
          if (published == null) return;
          // A story edited later (the figure often arrives in an update) counts from its last edit.
          const ms = art?.modifiedMs && art.modifiedMs > published && art.modifiedMs <= Date.now() ? art.modifiedMs : published;
          if (Date.now() - ms > NEWS_TTL_MS || ms - Date.now() > 3_600_000) return;
          for (const [reservoirId, f] of reportedFigures(it.title, art?.text || it.desc, matchReservoir)) {
            out.push({ ...f, reservoirId, via: "news", outlet: it.outlet, url: it.link, at: new Date(ms + COLOMBO_MS).toISOString().slice(0, 19) + "+05:30" });
          }
        } catch {
          /* one bad story never drops the rest */
        }
      }),
    );
    return out;
  },
  ["releases-news-figures-v1"],
  { revalidate: TEN_MIN },
);

// The feeds hold a story for only a few hours (Ada Derana's drops it sooner), but a figure stays worth
// showing for 12. A warm server instance remembers what it has seen; a cold one starts from the feeds.
const figureMemo = new Map<string, NewsFigure>();
function rememberedFigures(fresh: NewsFigure[], now: number): NewsFigure[] {
  for (const f of fresh) {
    const k = `${f.reservoirId}|${f.url}`;
    const prev = figureMemo.get(k);
    if (!prev || Date.parse(f.at) >= Date.parse(prev.at)) figureMemo.set(k, f);
  }
  for (const [k, f] of figureMemo) if (now - Date.parse(f.at) > NEWS_TTL_MS) figureMemo.delete(k);
  return [...figureMemo.values()];
}

/** Latest report per reservoir that is still inside the 12-hour window; a later "closed" cancels an "opened". */
export function activeNews(all: NewsDetection[], now = Date.now()): Map<string, NewsDetection> {
  const latest = new Map<string, NewsDetection>();
  for (const d of all) {
    const t = Date.parse(d.publishedAt);
    if (now - t > NEWS_TTL_MS) continue;
    const prev = latest.get(d.reservoirId);
    if (!prev || Date.parse(prev.publishedAt) < t) latest.set(d.reservoirId, d);
  }
  for (const [k, d] of latest) if (d.action === "closed") latest.delete(k);
  return latest;
}

// ---------------------------------------------------------------- combine

type Candidate = {
  rank: number; // source preference on the same day: lower wins
  day: string;
  atMs: number;
  source: string;
  url: string;
  cusecs: number | null;
  gatesOpen: number | null;
  dayOnly: boolean;
};

const SHEET_URL = `${SHEET_BASE}/pubhtml?gid=${TABS[0].gid}&single=true`;

/** The sheet is read about 9 am; used to compare a reading's day against a news story's time. */
const readingMs = (day: string) => dayStartMs(day) + 9 * 3_600_000;

/**
 * The newest figure stated after the official reading `after` (ms; 0 when there is none): a news story
 * or a later bulletin. A "gates closed" report newer than the story cancels it.
 */
export function pickReported(figs: NewsFigure[], bulletins: Candidate[], after: number, closedAt: number | null): ReportedLine | null {
  const all: ReportedLine[] = [
    ...figs.filter((f) => closedAt == null || Date.parse(f.at) > closedAt),
    ...bulletins
      .filter((c) => c.rank === 1 && !c.dayOnly && c.cusecs != null)
      .map((c): ReportedLine => ({ via: "bulletin", outlet: "Irrigation Department", url: c.url, at: new Date(c.atMs + COLOMBO_MS).toISOString().slice(0, 19) + "+05:30", cusecs: c.cusecs, atLeast: false, gates: null, openedFt: null, planned: false })),
  ].filter((r) => Date.parse(r.at) > after);
  all.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return all[0] ?? null;
}

function build(res: Reservoir, cands: Candidate[], news: NewsDetection | undefined, now: number, figs: NewsFigure[] = [], closedAt: number | null = null): Release | null {
  const yesterday = colomboDay(now - 86_400_000);
  const fresh = cands.filter((c) => c.day >= yesterday);
  // Newest day wins; on the same day sheet > DMC bulletin > Mahaweli PDF.
  fresh.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.rank - b.rank));
  const best = fresh[0];
  const base = { reservoirId: res.id, name: res.name, basin: res.basin, stations: res.gauges.map((g) => g.station), ...(res.kind === "watch" ? { watch: true as const } : {}) };
  if (best && (best.cusecs ?? 0) >= MIN_NOTABLE_CUSECS) {
    const newer = news && Date.parse(news.publishedAt) > best.atMs ? news : null;
    const reported = pickReported(figs, fresh.filter((c) => c !== best && c.cusecs !== best.cusecs), best.atMs, closedAt);
    return {
      ...base,
      kind: "confirmed",
      source: best.source,
      url: best.url,
      cusecs: best.cusecs,
      gatesOpen: best.gatesOpen,
      observedAt: new Date(best.atMs + COLOMBO_MS).toISOString().slice(0, 19) + "+05:30",
      dayOnly: best.dayOnly,
      news: newer,
      reported,
    };
  }
  if (news && !res.barrage) {
    return {
      ...base,
      kind: "reported",
      source: news.outlet,
      url: news.url,
      cusecs: null,
      gatesOpen: null,
      observedAt: news.publishedAt,
      dayOnly: false,
      news,
      reported: pickReported(figs, [], 0, closedAt),
    };
  }
  return null;
}

export type SourceOutcome<T> = { ok: true; data: T } | { ok: false; error: string };
async function soft<T>(f: () => Promise<T>): Promise<SourceOutcome<T>> {
  try {
    return { ok: true, data: await f() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}

/** All raw source data, for the archive and diagnostics. */
export const getReleaseSources = cache(async () => {
  const [sheet, wms, news, figures] = await Promise.all([soft(sheetCached), soft(wmsCached), soft(newsCached), soft(figuresCached)]);
  return { sheet, wms, news, figures };
});

/** Active reservoir releases from every source, merged per reservoir. Never throws. */
export function getReleases(now?: number): Promise<ReleasesResult> {
  return now === undefined ? releasesThisRequest() : computeReleases(now);
}
// ReleaseCard, the verdict (releaseAffecting) and the reservoir list all ask in one render.
const releasesThisRequest = cache(() => computeReleases(Date.now()));

async function computeReleases(now: number): Promise<ReleasesResult> {
  const [{ sheet, wms, news, figures }, warn] = await Promise.all([getReleaseSources(), soft(() => getOfficialWarnings())]);
  const newsMap = news.ok ? activeNews(news.data, now) : new Map<string, NewsDetection>();

  const releases: Release[] = [];
  for (const res of RESERVOIRS) {
    const cands: Candidate[] = [];
    if (sheet.ok) {
      for (const r of sheet.data.rows) {
        if (r.reservoirId !== res.id || !r.day || !r.spilling) continue;
        cands.push({ rank: 0, day: r.day, atMs: readingMs(r.day), source: "Irrigation Department", url: SHEET_URL, cusecs: r.spillCusecs, gatesOpen: r.gatesOpen, dayOnly: true });
      }
    }
    if (warn.ok && res.dmcBasin) {
      for (const w of warn.data.warnings) {
        if (w.releaseCusecs == null || !w.issuedAt || !w.basins.some((b) => b.trim() === res.dmcBasin)) continue;
        cands.push({ rank: 1, day: colomboDay(Date.parse(w.issuedAt)), atMs: Date.parse(w.issuedAt), source: "Irrigation Department", url: w.url, cusecs: w.releaseCusecs, gatesOpen: null, dayOnly: false });
      }
    }
    if (wms.ok && !res.barrage) {
      for (const r of wms.data.rows) {
        if (r.reservoirId !== res.id || !r.day || r.dischargeCusecs == null || r.dischargeCusecs <= 0) continue;
        cands.push({ rank: 2, day: r.day, atMs: readingMs(r.day), source: "Mahaweli Authority", url: WMS_PAGE, cusecs: r.dischargeCusecs, gatesOpen: null, dayOnly: true });
      }
    }
    const figs = rememberedFigures(figures.ok ? figures.data : [], now).filter((f) => f.reservoirId === res.id);
    const closedAt = news.ok ? Math.max(0, ...news.data.filter((d) => d.reservoirId === res.id && d.action === "closed").map((d) => Date.parse(d.publishedAt))) || null : null;
    const rel = build(res, cands, newsMap.get(res.id), now, figs, closedAt);
    if (rel) releases.push(rel);
  }
  releases.sort((a, b) => (b.kind === "confirmed" ? 1 : 0) - (a.kind === "confirmed" ? 1 : 0) || (b.cusecs ?? 0) - (a.cusecs ?? 0));

  return {
    releases,
    sources: {
      sheet: sheet.ok
        ? { ok: true, sheetDate: sheet.data.sheetDate, rows: sheet.data.rows.length, fetchedAt: new Date(sheet.data.fetchedAt).toISOString() }
        : { ok: false, sheetDate: null, rows: 0, fetchedAt: null, error: sheet.error },
      wms: wms.ok
        ? { ok: true, reportDate: wms.data.reportDate, rows: wms.data.rows.length, fetchedAt: new Date(wms.data.fetchedAt).toISOString() }
        : { ok: false, reportDate: null, rows: 0, fetchedAt: null, error: wms.error },
      news: news.ok ? { ok: true, detections: news.data.length } : { ok: false, detections: 0, error: news.error },
      dmc: warn.ok ? { ok: true, ...(warn.data.reason ? { error: warn.data.reason } : {}) } : { ok: false, error: warn.error },
    },
  };
}

// ---------------------------------------------------------------- station helper

export type ReleaseAffecting = {
  active: boolean;
  /** True when official numbers back it; false when it is only a news report. */
  confirmed: boolean;
  reservoir: string | null;
  cusecs: number | null;
  /** "Irrigation Department", "Mahaweli Authority" or the news outlet. */
  source: string | null;
  url: string | null;
  /** ISO 8601 with +05:30; a bare reading day is shown as that day at 09:00. */
  observedAt: string | null;
  /** Midpoint of the measured travel time to this gauge in hours; null when not measured. */
  etaHours: number | null;
  etaRange: [number, number] | null;
  /** Gates open per the Irrigation Department sheet, when it says. */
  gatesOpen?: number | null;
  /** The reservoir is linked to this gauge by hand (lib/reservoirs.ts), not just further down the same river. */
  direct?: boolean;
};

const NONE: ReleaseAffecting = { active: false, confirmed: false, reservoir: null, cusecs: null, source: null, url: null, observedAt: null, etaHours: null, etaRange: null };

/** The strongest active release upstream of this gauge, from an already fetched result. */
export function releaseAffectingFrom(result: ReleasesResult, station: string): ReleaseAffecting {
  const links = reservoirsForStation(station);
  let best: { rel: Release; eta: [number, number] | null; direct: boolean } | null = null;
  for (const { res, link } of links) {
    const rel = result.releases.find((r) => r.reservoirId === res.id);
    if (!rel) continue;
    // confirmed first, then a reservoir linked directly above this gauge, then the bigger release
    const score = (x: Release, direct: boolean) => (x.kind === "confirmed" ? 2e9 : 0) + (direct ? 1e9 : 0) + (x.cusecs ?? 0);
    const direct = !link.indirect;
    if (!best || score(rel, direct) > score(best.rel, best.direct)) best = { rel, eta: link.eta, direct };
  }
  if (!best) return NONE;
  const { rel, eta } = best;
  return {
    active: true,
    confirmed: rel.kind === "confirmed",
    reservoir: rel.name,
    cusecs: rel.cusecs,
    source: rel.source,
    url: rel.url,
    observedAt: rel.observedAt,
    etaHours: eta ? (eta[0] + eta[1]) / 2 : null,
    etaRange: eta,
    gatesOpen: rel.gatesOpen,
    direct: best.direct,
  };
}

/**
 * Is a reservoir release heading for this gauge? `releaseAffecting("Moragaswewa")`. The verdict
 * should count it as an expected crossing only when the gauge is already within 1 m (or 20% of the
 * alert range) below alert and rising; this helper only reports the release.
 */
export async function releaseAffecting(station: string): Promise<ReleaseAffecting> {
  return releaseAffectingFrom(await getReleases(), station);
}
