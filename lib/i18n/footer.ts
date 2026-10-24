// Small footer / menu strings shared by the desktop footer (server) and the phone More sheet (client).
// si/ta are drafts: need native review.
import type { Locale } from "./config";

export const MADE_BY: Record<Locale, string> = { en: "Made by", si: "නිර්මාණය කළේ", ta: "உருவாக்கியவர்" };
export const RESEARCH: Record<Locale, string> = { en: "Research", si: "පර්යේෂණ", ta: "ஆய்வுகள்" };

// The one-line strip that replaces the big footer on phones.
export const STRIP: Record<Locale, { warn: string; data: string }> = {
  en: { warn: "Not official. In an emergency call 117", data: "Data: Irrigation Dept & others" },
  si: { warn: "නිල සේවාවක් නොවේ. හදිසි අවස්ථාවක 117 අමතන්න", data: "දත්ත: වාරිමාර්ග දෙපාර්තමේන්තුව සහ අනෙකුත්" },
  ta: { warn: "அதிகாரப்பூர்வமற்றது. அவசரத்தில் 117 அழைக்கவும்", data: "தரவு: நீர்ப்பாசனத் துறை மற்றும் பிறர்" },
};
