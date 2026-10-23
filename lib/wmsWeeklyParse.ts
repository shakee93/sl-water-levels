// Pure parser for the Mahaweli WMS "Weekly Operational Meeting" PDF (no imports, so a plain node
// test can run it: scripts/wms-weekly.test.mts). lib/wmsWeekly.ts fetches the file and maps names
// to the reservoir catalogue.
//
// The PDF is an Excel export: one table "(1) Power Releases" with a row per reservoir. Columns:
// reservoir | proposed (mcm/week) | actual water released last week (mcm) | GWh | planned release
// for next week | "Duration & Remarks". Remarks wrap over several lines and are not vertically
// aligned with the name (a 3-line remark sits centred on its row), and the ordinals (th, nd) are
// separate raised text items. So the parser works on positioned text: it finds the "Possible to
// spilling (...)" sentence, takes the middle of the lines it occupies and gives it to the nearest
// reservoir name. Layout assumptions are checked, never guessed: if no reservoir rows are found the
// caller gets an empty list and reports "layout changed".

export type TextCell = { s: string; x: number; r: number; y: number; page: number };

export type WeeklyItem = {
  /** As written in the PDF ("Maussakelle", "Kukuleganga"). */
  name: string;
  /** Actual water released last week, mcm (null = blank cell). */
  lastWeekMcm: number | null;
  /** Planned release for the coming week, mcm per day (a cusec figure is converted). */
  plannedMcmPerDay: number | null;
  /** Days the sheet says spilling is possible, ISO dates, sorted. */
  spillDays: string[];
  /** First to last of those days; null when no spill is mentioned. */
  spillWindow: { from: string; to: string } | null;
  /** The remark as written: the spill sentence when there is one, else the remark on the row. */
  rawLine: string;
};

export type WeeklyParse = {
  meetingDate: string | null;
  nextWeek: { from: string; to: string } | null;
  items: WeeklyItem[];
};

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const MON_RE = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const ORDINAL = /^(st|nd|rd|th)$/i;
const CUSEC_MCM_PER_DAY = 0.0024466; // 1 cusec = 0.0283168 m3/s = 2446.6 m3/day

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const addDays = (isoDay: string, n: number) => new Date(Date.parse(isoDay + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const validDay = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m && t.getUTCDate() === d;
};

/**
 * "16 to 18, 20 & 21 Oct", "Oct 20-0.76mcm, 21-0.85mcm", "28 Oct to 2 Nov", "16 to 29 Oct." -> sorted ISO days.
 * The month may come after the days (English: "20 to 22 Oct") or before them ("Oct 20th-0.76mcm"); a day
 * with no month takes the month of the meeting. Years come from the meeting date.
 */
export function parseSpillDays(raw: string, meeting: string): string[] {
  const my = Number(meeting.slice(0, 4));
  const mm = Number(meeting.slice(5, 7)) - 1;
  const md = Number(meeting.slice(8, 10));
  const s = raw
    .replace(/-?\s*\d+(?:\.\d+)?\s*mcmc?/gi, " ") // per-day volumes ("-0.76mcm")
    .replace(/\d+\.\d+/g, " ")
    .replace(/(\d)\s*(?:st|nd|rd|th)\b/gi, "$1")
    .replace(/&|\band\b/gi, ",")
    .replace(/[().:;]/g, " ");
  const tok = [...s.matchAll(new RegExp(`(\\d{1,2})(?!\\d)|\\b(${MON_RE})[a-z]*\\b|(to|until|till|through|-|–|—)|(,)`, "gi"))];
  type Ent = { d: number; m: number | null; rangeNext: boolean };
  const ents: Ent[] = [];
  let pending: Ent[] = [];
  let curMonth: number | null = null;
  let prefix = false; // "Oct 20, 21": the month comes first and applies to the days after it
  let rangeFlag = false;
  for (const t of tok) {
    if (t[1] != null) {
      const d = Number(t[1]);
      if (d < 1 || d > 31) continue;
      const e: Ent = { d, m: prefix ? curMonth : null, rangeNext: false };
      if (rangeFlag && ents.length) ents[ents.length - 1].rangeNext = true;
      rangeFlag = false;
      ents.push(e);
      if (e.m == null) pending.push(e);
    } else if (t[2] != null) {
      const m = MONTHS[t[2].slice(0, 3).toLowerCase()];
      prefix = pending.length === 0;
      for (const e of pending) e.m = m;
      pending = [];
      curMonth = m;
    } else if (t[3] != null) {
      if (/^(to|until|till|through)$/i.test(t[3]) || ents.length) rangeFlag = true;
    } else {
      rangeFlag = false;
    }
  }
  // A "-" right after a day is a range only when another day follows before a comma; the loop above sets
  // rangeNext only when a day follows, which is exactly that.
  const days = new Set<string>();
  const abs = (e: Ent, fallbackM: number): string | null => {
    const m = e.m ?? fallbackM;
    let y = my;
    if (m - mm > 6) y -= 1;
    else if (mm - m > 6) y += 1;
    if (!validDay(y, m, e.d)) return null;
    return iso(y, m, e.d);
  };
  const fallback = (e: Ent) => (e.m == null ? (e.d < md - 20 ? (mm + 1) % 12 : mm) : e.m);
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    const a = abs(e, fallback(e));
    if (!a) continue;
    if (e.rangeNext && ents[i + 1]) {
      const n = ents[i + 1];
      const b = abs(n, fallback(n));
      let start = a;
      if (b && b < start) {
        // "28 to 2 Nov": the start month was backfilled with the end's month; step it back one month.
        if (e.m === n.m || e.m == null) {
          const sm = ((n.m ?? fallback(n)) + 11) % 12;
          start = abs({ ...e, m: sm }, sm) ?? a;
        }
      }
      if (b && b >= start) {
        for (let d = start, k = 0; d <= b && k < 62; d = addDays(d, 1), k++) days.add(d);
        continue;
      }
    }
    days.add(a);
  }
  return [...days].sort();
}

const num = (s: string | undefined) => (s != null && /^\d+(\.\d+)?$/.test(s.trim()) ? Number(s) : null);
const plannedOf = (text: string): number | null => {
  const m = /(\d+(?:\.\d+)?)\s*mcm\s*\/?\s*d(?:ay)?/i.exec(text);
  if (m) return Number(m[1]);
  const c = /(\d[\d,]*(?:\.\d+)?)\s*cusecs?/i.exec(text);
  return c ? Math.round(Number(c[1].replace(/,/g, "")) * CUSEC_MCM_PER_DAY * 100) / 100 : null;
};

/** Extract the dates a spill sentence refers to, given the text right after "possible to spilling". */
function datesAfter(rest: string): string {
  const paren = /^\s*\(([^)]*)\)/.exec(rest);
  if (paren) return paren[1];
  const open = /^\s*(?:on|from|during|between|at)?\s*(\d.{0,48}?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)/i.exec(rest);
  return open ? open[1] : "";
}

/** Parse the positioned text of the whole PDF. */
export function parseWeekly(cells: TextCell[]): WeeklyParse {
  const all = cells
    .filter((c) => c.s.trim())
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const textOnly = all.filter((c) => !ORDINAL.test(c.s));
  const flat = textOnly.map((c) => c.s).join(" ");

  let meetingDate: string | null = null;
  const mt = new RegExp(`held\\s+on\\s+(\\d{1,2})\\s+(${MON_RE})[a-z]*\\s+(20\\d\\d)`, "i").exec(flat);
  if (mt) meetingDate = iso(Number(mt[3]), MONTHS[mt[2].slice(0, 3).toLowerCase()], Number(mt[1]));
  const nw = /Next\s+week\s*\(\s*(20\d\d-\d\d-\d\d)\s+to\s+(20\d\d-\d\d-\d\d)\s*\)/i.exec(flat);
  const nextWeek = nw ? { from: nw[1], to: nw[2] } : null;
  const ref = meetingDate ?? nextWeek?.from ?? null;

  // The power table: below its header rows, down to "(2) Irrigation Diversions".
  const hdr = all.filter((c) => /\(mcm\/week\)|\(GWh\/week\)/i.test(c.s));
  if (!hdr.length || !ref) return { meetingDate, nextWeek, items: [] };
  const first = hdr[0];
  const hdrY = Math.min(...hdr.map((c) => c.y));
  const endIdx = all.findIndex((c) => /Irrigation\s+Diversions/i.test(c.s));
  const body = all.filter((c, i) => (endIdx < 0 || i < endIdx) && (c.page > first.page || (c.page === first.page && c.y < hdrY - 1)));
  if (!body.length) return { meetingDate, nextWeek, items: [] };

  const col = (re: RegExp) => all.find((c) => c.page === first.page && re.test(c.s));
  const dur = col(/^Duration\s*&\s*Remarks$/i);
  const plan = col(/Water\s+Release\s*&\s*Power/i);
  const act = col(/^Water\s+Released/i);
  const remarkX = dur ? dur.x - 45 : 600;
  const planL = plan ? plan.x - 12 : 470;
  const actL = act ? act.x - 25 : 270;
  const actR = act ? act.r + 25 : 375;
  const nameMax = (col(/^Reservoir$/i)?.r ?? 111) + 25;

  const names = body.filter((c) => c.x <= nameMax && c.x >= 40 && /^[A-Za-z][A-Za-z .'()-]+$/.test(c.s) && !/^(Reservoir|Proposed|Actual|Remarks)$/i.test(c.s));
  if (names.length < 3) return { meetingDate, nextWeek, items: [] };
  const nearest = (y: number, page: number, maxDy = 1e9) => {
    let best: (typeof names)[number] | null = null;
    let bd = maxDy;
    for (const n of names) {
      if (n.page !== page) continue;
      const d = Math.abs(n.y - y);
      if (d <= bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  };

  const items = new Map<TextCell, WeeklyItem & { _plan: number | null }>();
  for (const n of names) {
    const line = body.filter((c) => c.page === n.page && Math.abs(c.y - n.y) <= 2);
    const lw = line.find((c) => c.x >= actL && c.r <= actR && num(c.s) != null);
    const remarkLine = line.filter((c) => c.x >= remarkX && !ORDINAL.test(c.s)).map((c) => c.s).join(" ");
    items.set(n, { name: n.s, lastWeekMcm: lw ? num(lw.s) : null, plannedMcmPerDay: null, spillDays: [], spillWindow: null, rawLine: remarkLine, _plan: null });
  }

  // Planned release: the nearest-name rule on the planned column, then the remark text on the name line.
  for (const c of body) {
    if (c.x < planL || c.x >= remarkX) continue;
    const owner = nearest(c.y, c.page, 12);
    const it = owner && items.get(owner);
    if (!it) continue;
    const v = plannedOf(c.s);
    const dy = Math.abs(owner.y - c.y);
    if (v != null && (it._plan == null || dy < 2)) {
      it.plannedMcmPerDay = v;
      it._plan = dy;
    }
  }
  for (const [n, it] of items) {
    if (it.plannedMcmPerDay != null) continue;
    const v = plannedOf(it.rawLine);
    if (v != null && body.some((c) => c.page === n.page && c.x >= remarkX && Math.abs(c.y - n.y) <= 2 && plannedOf(c.s) != null)) it.plannedMcmPerDay = v;
  }

  // Remark column as one text, remembering which line each character came from.
  const rem = body.filter((c) => c.x >= remarkX && !ORDINAL.test(c.s));
  let text = "";
  const marks: { at: number; end: number; y: number; page: number }[] = [];
  for (const c of rem) {
    if (text) text += " ";
    marks.push({ at: text.length, end: text.length + c.s.length, y: c.y, page: c.page });
    text += c.s;
  }
  const markAt = (i: number) => marks.find((m) => i >= m.at && i <= m.end) ?? marks[marks.length - 1];
  const spillRe = /possible\s+(?:to\s+)?spill\w*|spill\w*\s+possible/gi;
  let m: RegExpExecArray | null;
  while ((m = spillRe.exec(text))) {
    const after = text.slice(m.index + m[0].length);
    const dates = datesAfter(after);
    const sentenceEnd = m.index + m[0].length + (dates ? after.indexOf(dates) + dates.length + (after.slice(after.indexOf(dates) + dates.length).startsWith(")") ? 1 : 0) : 0);
    const a = markAt(m.index);
    const b = markAt(Math.max(m.index, sentenceEnd - 1));
    if (a.page !== b.page) continue;
    const owner = nearest((a.y + b.y) / 2, a.page);
    const it = owner && items.get(owner);
    if (!it) continue;
    const days = dates ? parseSpillDays(dates, ref) : [];
    if (/^\s*from\b/i.test(after) && days.length === 1 && nextWeek && nextWeek.to > days[0]) {
      for (let d = addDays(days[0], 1); d <= nextWeek.to; d = addDays(d, 1)) days.push(d);
    }
    it.spillDays = [...new Set([...it.spillDays, ...days])].sort();
    it.rawLine = text.slice(m.index, sentenceEnd).trim();
  }

  const out: WeeklyItem[] = [];
  for (const it of items.values()) {
    const { _plan, ...rest } = it;
    void _plan;
    out.push({ ...rest, spillWindow: rest.spillDays.length ? { from: rest.spillDays[0], to: rest.spillDays[rest.spillDays.length - 1] } : null });
  }
  return { meetingDate, nextWeek, items: out };
}
