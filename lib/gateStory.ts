// Pure keyword matcher for "spill gates opened" news stories (no runtime imports, so
// scripts/gate-story.test.mts runs it under plain node with the real reservoir catalogue).
import type { Reservoir } from "./reservoirs";

const GATE = /\bgates?\b/i;
const OPEN = /\b(open(?:ed|ing|s)?|rais(?:e|ed|ing)|lift(?:ed|ing)?|unclos)/i;
const CLOSE = /\b(clos(?:e|ed|ing)|shut|lower(?:ed|ing))\b/i;
// "will be opened", "to open tonight": a plan, not an event.
const PLANNED = /\b(will|may|might|could|expected to|plans? to|to be|are to|is to|going to)\b[^.]{0,25}\bopen|\bto open\b|\bopen(?:ing|ed)?\s+(?:tonight|tomorrow|later)/i;

export type GateMatch = { reservoir: Reservoir; action: "opened" | "closed" | "unclear" };

/** The reservoir and direction of a gates story, or null. `match` is lib/reservoirs.ts matchReservoir. */
export function matchGateStoryWith(
  match: (text: string, mode: "exact" | "contains") => Reservoir | null,
  title: string,
  desc: string,
): GateMatch | null {
  const text = `${title}. ${desc}`;
  if (!GATE.test(text)) return null;
  const res = match(title, "contains") ?? match(text, "contains");
  if (!res) return null;
  if (PLANNED.test(title)) return null;
  const decide1 = (s: string) => {
    const o = OPEN.test(s);
    const c = CLOSE.test(s);
    return o && !c ? "opened" : c && !o ? "closed" : o && c ? "unclear" : null;
  };
  // The headline is the claim; the description may add "other gates remain closed".
  const a = decide1(title) ?? decide1(text);
  return a ? { reservoir: res, action: a } : null;
}
