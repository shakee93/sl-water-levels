// Pure matcher for "advance spill warning" news: a reservoir NEARS spill level or MAY open its gates.
// This is not a release (gates are not open) and not official, so it only ever becomes context
// ("Spill warning reported"); it never sets a verdict. No runtime imports, so
// scripts/spill-warning.test.mts runs it under plain node with the real reservoir catalogue.
import type { Reservoir } from "./reservoirs";
import { matchGateStoryWith } from "./gateStory";

const NEAR = /\b(?:nears?|nearing|near(?:ed)?\s+(?:its\s+)?(?:full|spill)|approach(?:es|ing)\s+(?:its\s+)?(?:spill|full)|reach(?:es|ing)\s+(?:its\s+)?spill|close\s+to\s+(?:spill|overflow)\w*|about\s+to\s+spill)\b[^.]{0,30}?\b(?:spill(?:ing)?\s+level|full\s+(?:supply\s+)?level|full\b|capacity|spill|spilling|overflow\w*)?/i;
const LIKELY = /\b(?:likely|expected|set|poised|could|may|might|will\s+soon|soon\s+to)\s+(?:to\s+)?(?:be\s+)?(?:spill(?:ing)?\b|overflow\w*|open\s+(?:its\s+|the\s+)?(?:spill\s+|radial\s+)?gates?)/i;
const MAY_OPEN = /\b(?:may|might|could|will\s+(?:soon\s+)?be\s+(?:forced\s+)?to|to)\s+open\b[^.]{0,30}\bgates?\b|\bgates?\b[^.]{0,30}\b(?:may|might|could|likely)\s+(?:be\s+)?(?:open|opened|raised)\b/i;
const ADVANCE = /\b(?:advance|early|prior)\s+(?:spill\s+|flood\s+)?(?:warning|notice|alert)\b|\bspill\s+(?:warning|alert)\b|\bwarning\s+(?:issued\s+)?(?:to|for)\s+(?:downstream|residents)/i;
// "nears spill level" needs the spill/full wording; a bare "warning issued to downstream residents" is not enough on its own.
const SPILL_WORD = /\bspill|overflow|full\s+(?:supply\s+)?level|full\s+capacity|gates?\b/i;

export type SpillWarningMatch = { reservoir: Reservoir };

/** The catalogue reservoir a "nears spill level / may open gates" story is about, or null (also null when the gates ARE open: that is a release). */
export function matchSpillWarningWith(
  match: (text: string, mode: "exact" | "contains") => Reservoir | null,
  title: string,
  desc = "",
): SpillWarningMatch | null {
  const text = `${title}. ${desc}`;
  const res = match(title, "contains") ?? match(text, "contains");
  if (!res) return null;
  if (!SPILL_WORD.test(text)) return null;
  // Gates opened or closed is the release detector's business (a planned opening stays a warning).
  const gate = matchGateStoryWith(match, title, ""); // the headline is the claim ("other gates remain closed" in the body is not)
  if (gate && gate.action !== "unclear") return null;
  const hit = NEAR.test(title) && /spill|full|capacity|overflow/i.test(title) || LIKELY.test(title) || MAY_OPEN.test(title) || ADVANCE.test(title) ||
    NEAR.test(text) && /spill|full|capacity|overflow/i.test(text) || LIKELY.test(text) || MAY_OPEN.test(text);
  return hit ? { reservoir: res } : null;
}
