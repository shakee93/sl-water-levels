// Plain-language lines above the town flood map (app/flood/Flood3dInline.tsx), from lib/flood3dTownLevels.ts (precomputed from level.webp:
// no work in the browser, and the first line shows before the map loads). si and ta are DRAFTS (28 Oct 2026) for a native speaker to review.
// River flooding only: an illustration, never an official level or a verdict input.
import { FLOOD3D_TOWN_LEVELS, TOWN_LEVELS_FROM, TOWN_LEVELS_STEP } from "@/lib/flood3dTownLevels";

type Lang = "en" | "si" | "ta";
export type Marks = { alert: number; minor: number; major: number };
export type Scen = "now" | "alert" | "minor" | "major" | "ditwah";

const T: Record<Lang, Record<string, string>> = {
  en: {
    first: "Low ground near {town} starts to take river water at about {ft} ft at Nagalagam Street, {ctx}.",
    ctxAbout: "about the {step} level ({m} ft)", ctxBelowAlert: "below the alert level ({m} ft)", ctxAlertMinor: "between the alert and minor flood levels", ctxMinorMajor: "between the minor and major flood levels", ctxAboveMajor: "above the major flood level",
    now: "It is {ft} ft now", at: "At {ft} ft ({name})",
    nAlert: "the alert level", nMinor: "the minor flood level", nMajor: "the major flood level", nDitwah: "the Cyclone Ditwah peak", sAlert: "alert", sMinor: "minor flood", sMajor: "major flood",
    none: "{pre}, below that, so no low ground near {town} is shown under water.", few: "{pre}: a few low spots near {town} are shown under water.", all: "{pre}: almost all of the ground within 1 km of {town} is shown under water.", some: "{pre}: about {pct}% of the ground within 1 km of {town} is shown under water.",
  },
  si: {
    first: "{town} අවට පහත් බිම් නාගලගම වීදියේ ගඟ අඩි {ft} පමණ වන විට ගඟේ ජලය ගැනීමට පටන් ගනී, {ctx}.",
    ctxAbout: "{step} මට්ටමට ආසන්නයි (අඩි {m})", ctxBelowAlert: "අවවාද මට්ටමට (අඩි {m}) වඩා පහළයි", ctxAlertMinor: "අවවාද සහ සුළු ගංවතුර මට්ටම් අතර", ctxMinorMajor: "සුළු සහ මහා ගංවතුර මට්ටම් අතර", ctxAboveMajor: "මහා ගංවතුර මට්ටමට වඩා ඉහළයි",
    now: "දැන් අඩි {ft} කි", at: "අඩි {ft} දී ({name})",
    nAlert: "අවවාද මට්ටම", nMinor: "සුළු ගංවතුර මට්ටම", nMajor: "මහා ගංවතුර මට්ටම", nDitwah: "දිට්වා සුළි සුළං උච්චතම මට්ටම", sAlert: "අවවාද", sMinor: "සුළු ගංවතුර", sMajor: "මහා ගංවතුර",
    none: "{pre}, ඊට පහළයි, එබැවින් {town} අවට කිසිදු පහත් බිමක් ජලයෙන් යට වී නොපෙන්වයි.", few: "{pre}: {town} අවට පහත් තැන් කිහිපයක් ජලයෙන් යට වී පෙන්වයි.", all: "{pre}: {town} සිට කිලෝමීටර් 1ක් ඇතුළත බිම බොහෝමයක් ජලයෙන් යට වී පෙන්වයි.", some: "{pre}: {town} සිට කිලෝමීටර් 1ක් ඇතුළත බිමෙන් ආසන්න වශයෙන් {pct}%ක් ජලයෙන් යට වී පෙන්වයි.",
  },
  ta: {
    first: "{town} அருகிலுள்ள தாழ்வான நிலம் நாகலகம் தெருவில் ஆறு சுமார் {ft} அடியை அடையும் போது ஆற்று நீரை ஏற்கத் தொடங்கும், {ctx}.",
    ctxAbout: "{step} மட்டத்திற்கு அருகில் ({m} அடி)", ctxBelowAlert: "எச்சரிக்கை மட்டத்திற்கு ({m} அடி) கீழே", ctxAlertMinor: "எச்சரிக்கை மற்றும் சிறு வெள்ள மட்டங்களுக்கு இடையில்", ctxMinorMajor: "சிறு மற்றும் பெரு வெள்ள மட்டங்களுக்கு இடையில்", ctxAboveMajor: "பெரு வெள்ள மட்டத்திற்கு மேல்",
    now: "இப்போது {ft} அடி", at: "{ft} அடியில் ({name})",
    nAlert: "எச்சரிக்கை மட்டம்", nMinor: "சிறு வெள்ள மட்டம்", nMajor: "பெரு வெள்ள மட்டம்", nDitwah: "டிட்வா புயலின் உச்ச மட்டம்", sAlert: "எச்சரிக்கை", sMinor: "சிறு வெள்ள", sMajor: "பெரு வெள்ள",
    none: "{pre}, அதற்குக் கீழே, எனவே {town} அருகில் தாழ்வான நிலம் எதுவும் நீருக்குள் காட்டப்படவில்லை.", few: "{pre}: {town} அருகில் சில தாழ்வான இடங்கள் நீருக்குள் காட்டப்படுகின்றன.", all: "{pre}: {town} இலிருந்து 1 கி.மீ.க்குள் உள்ள நிலம் கிட்டத்தட்ட முழுவதும் நீருக்குள் காட்டப்படுகிறது.", some: "{pre}: {town} இலிருந்து 1 கி.மீ.க்குள் உள்ள நிலத்தில் சுமார் {pct}% நீருக்குள் காட்டப்படுகிறது.",
  },
};
const fill = (s: string, v: Record<string, string | number>) => Object.entries(v).reduce((a, [k, x]) => a.split(`{${k}}`).join(String(x)), s);
const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const fm = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : f1(v));

/** Share (%) of the ground within 1 km of the town under water at a Nagalagam level, from the precomputed table. */
export function townPct(slug: string, ft: number): number | null {
  const t = FLOOD3D_TOWN_LEVELS[slug];
  if (!t) return null;
  const x = (ft - TOWN_LEVELS_FROM) / TOWN_LEVELS_STEP;
  if (x <= 0) return 0;
  const i = Math.min(t.pct.length - 1, Math.floor(x)), j = Math.min(t.pct.length - 1, i + 1);
  return t.pct[i] + (t.pct[j] - t.pct[i]) * Math.min(1, x - i);
}

export function townHasLevels(slug: string): boolean { return slug in FLOOD3D_TOWN_LEVELS; }

/** "Low ground near X starts to take river water at about N ft at Nagalagam Street, below the alert level (4 ft)." Null where the map has too little ground near the town. */
export function firstLine(lang: Lang, slug: string, town: string, marks: Marks): string | null {
  const t = FLOOD3D_TOWN_LEVELS[slug], d = T[lang] ?? T.en;
  if (!t) return null;
  const f = t.first;
  const near = (m: number) => Math.abs(f - m) <= 0.3;
  const ctx = near(marks.alert) ? fill(d.ctxAbout, { step: d.sAlert, m: fm(marks.alert) }) : near(marks.minor) ? fill(d.ctxAbout, { step: d.sMinor, m: fm(marks.minor) }) : near(marks.major) ? fill(d.ctxAbout, { step: d.sMajor, m: fm(marks.major) })
    : f < marks.alert ? fill(d.ctxBelowAlert, { m: fm(marks.alert) }) : f < marks.minor ? d.ctxAlertMinor : f < marks.major ? d.ctxMinorMajor : d.ctxAboveMajor;
  return fill(d.first, { town, ft: f1(f), ctx });
}

/** What the map shows for the level on it. Null until there is a level to talk about. */
export function levelLine(lang: Lang, slug: string, town: string, scen: Scen, nowFt: number | null, shownFt: number | null): string | null {
  const d = T[lang] ?? T.en;
  const t = FLOOD3D_TOWN_LEVELS[slug];
  if (!t || shownFt == null || (scen === "now" && nowFt == null)) return null;
  const name = scen === "alert" ? d.nAlert : scen === "minor" ? d.nMinor : scen === "major" ? d.nMajor : d.nDitwah;
  const pre = scen === "now" ? fill(d.now, { ft: f1(nowFt ?? shownFt) }) : fill(d.at, { ft: f1(shownFt), name });
  const raw = townPct(slug, shownFt) ?? 0;
  if (shownFt < t.first - 0.05 || raw < 1) return fill(d.none, { pre, town });
  if (raw < 8) return fill(d.few, { pre, town });
  if (raw >= 95) return fill(d.all, { pre, town });
  return fill(d.some, { pre, town, pct: Math.max(10, Math.round(raw / 5) * 5) });
}
