// Figures in a news story about a reservoir release: cusecs, gates, how far the gates were opened.
// Pure (no runtime imports) so scripts/news-figures.test.mts runs it under plain node with the real
// catalogue. A report is shown next to the official figure as "Reported ...", never as official.
import type { Reservoir } from "./reservoirs";

export type ReportedFigure = {
  /** Release in cusecs, or null when the story gives none. */
  cusecs: number | null;
  /** "more than / over / above N": the real figure is at least this. */
  atLeast: boolean;
  /** Spill gates the story says are (or are to be) open, or null. */
  gates: number | null;
  /** Each gate opened by this many feet ("opened by 1 ft"), or null. */
  openedFt: number | null;
  /** The story says the gates are to be opened (not yet). */
  planned: boolean;
};

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const NUM = "\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?";
const toNum = (s: string) => Number(s.replace(/,/g, ""));

// A cusec marker: the English words, and the Sinhala / Tamil "cubic feet" (only the digits survive the
// legacy fonts of the bulletins, so a number within 40 characters of the marker counts).
const MARKER = /cusecs?\b|cubic\s+(?:feet|foot|ft)\b|cu\.?\s*ft\b|ft3\/s|ft³\/s|ඝණ\s*අඩි|கன\s*அடி/gi;
const NUMBER = new RegExp(`(${NUM})(\\s*(?:thousand|k)\\b)?`, "gi");
const ATLEAST = /(?:more\s+than|over|above|exceeding|in\s+excess\s+of|upwards?\s+of|at\s+least|beyond)\s*$/i;

function cusecsOf(s: string): { n: number; atLeast: boolean } | null {
  let best: { n: number; atLeast: boolean } | null = null;
  for (const m of s.matchAll(MARKER)) {
    const from = Math.max(0, m.index - 40);
    const to = m.index + m[0].length + 40;
    const near = s.slice(from, to);
    for (const x of near.matchAll(NUMBER)) {
      let v = toNum(x[1]);
      if (x[2]) v *= 1000;
      if (!(v >= 100 && v <= 200_000)) continue;
      // Only the number's own qualifier ("more than 15,000") counts, not one further back.
      const before = near.slice(Math.max(0, x.index - 24), x.index);
      if (!best || v > best.n) best = { n: v, atLeast: ATLEAST.test(before) };
    }
  }
  return best;
}

const GATES = new RegExp(`\\b(\\d{1,2}|${Object.keys(WORDS).join("|")})\\s+(?:(?:radial|spill|sluice|more|additional|of\\s+the|of\\s+its)\\s+)*gates?\\b`, "gi");
function gatesOf(s: string): number | null {
  for (const m of s.matchAll(GATES)) {
    // "four of the six gates": the number after "of the" is the total, not the open ones.
    if (/\b(?:of|all|its|the|only)\s*$/i.test(s.slice(Math.max(0, m.index - 12), m.index))) continue;
    const n = /^\d/.test(m[1]) ? Number(m[1]) : WORDS[m[1].toLowerCase()];
    if (n >= 1 && n <= 40) return n;
  }
  return null;
}

const FT = new RegExp(`(?:opened|raised|lifted)(?:\\s+\\w+){0,2}?\\s+(?:by\\s+|up\\s+to\\s+)?(${NUM}|${Object.keys(WORDS).join("|")}|a)\\s*(?:ft\\b|feet\\b|foot\\b)`, "i");
function feetOf(s: string): number | null {
  const m = FT.exec(s);
  if (!m) return null;
  const v = /^\d/.test(m[1]) ? toNum(m[1]) : m[1].toLowerCase() === "a" ? 1 : WORDS[m[1].toLowerCase()];
  return v > 0 && v <= 30 ? v : null;
}

const PLAN = /\b(?:to\s+be|will\s+be|are\s+to\s+be|is\s+to\s+be|to)\s+(?:opened|open|raised|lifted)\b/i;
const DONE = /\b(?:were|was|have\s+been|has\s+been|been)\s+(?:opened|raised|lifted)\b|\bopened\s+(?:by|up)\b/i;
const CLOSED = /\b(?:clos(?:e|ed|ing)|shut|lower(?:ed|ing))\b/i;
const OPENED = /\b(?:open(?:ed|ing|s)?|rais(?:e|ed|ing)|lift(?:ed|ing)?)\b/i;

/** Figures in one sentence, or null when it states none. */
export function figureOf(sentence: string): ReportedFigure | null {
  if (CLOSED.test(sentence) && !OPENED.test(sentence)) return null;
  const c = cusecsOf(sentence);
  const gates = gatesOf(sentence);
  const openedFt = feetOf(sentence);
  if (!c && gates == null && openedFt == null) return null;
  return { cusecs: c?.n ?? null, atLeast: c?.atLeast ?? false, gates, openedFt, planned: PLAN.test(sentence) && !DONE.test(sentence) };
}

/** Sentences of a story, the headline first. */
export const sentencesOf = (title: string, body: string): string[] =>
  [title, ...body.split(/(?<=[.!?])\s+(?=[A-Z“"‘'(])/)].map((s) => s.trim()).filter(Boolean);

/**
 * The figures per catalogue reservoir in one story. A story can cover two reservoirs ("Meanwhile, four
 * gates of the Tabbowa Reservoir ..."): a sentence belongs to the reservoir it names, and a sentence
 * that names none continues the previous one. Within a reservoir the largest cusec figure and the
 * first gate count win; a headline of a closing story gives nothing.
 */
export function reportedFigures(
  title: string,
  body: string,
  match: (text: string, mode: "exact" | "contains") => Reservoir | null,
): Map<string, ReportedFigure> {
  const out = new Map<string, ReportedFigure>();
  let cur: string | null = null;
  for (const s of sentencesOf(title, body)) {
    const res = match(s, "contains");
    if (res) cur = res.id;
    if (!cur) continue;
    const f = figureOf(s);
    if (!f) continue;
    const prev = out.get(cur);
    if (!prev) {
      out.set(cur, f);
      continue;
    }
    const bigger = f.cusecs != null && (prev.cusecs == null || f.cusecs > prev.cusecs);
    out.set(cur, {
      cusecs: bigger ? f.cusecs : prev.cusecs,
      atLeast: bigger ? f.atLeast : prev.atLeast,
      gates: prev.gates ?? f.gates,
      openedFt: prev.openedFt ?? f.openedFt,
      planned: prev.planned && f.planned,
    });
  }
  return out;
}
