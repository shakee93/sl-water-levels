// Small footer / menu strings shared by the desktop footer (server) and the phone More sheet (client).
// si/ta are drafts: need native review.
import type { Locale } from "./config";

export const MADE_BY: Record<Locale, string> = { en: "Made by", si: "නිර්මාණය කළේ", ta: "உருவாக்கியவர்" };
export const RESEARCH: Record<Locale, string> = { en: "Research", si: "පර්යේෂණ", ta: "ஆய்வுகள்" };

export const DATA_NAV: Record<Locale, string> = { en: "Data", si: "දත්ත", ta: "தரவு" };
// Group headings shared by the footer and the phone More sheet (si/ta drafts: need native review).
export const NAV_GROUPS: Record<Locale, { levels: string; news: string; about: string }> = {
  en: { levels: "Rivers and levels", news: "News and data", about: "About and help" },
  si: { levels: "ගංගා සහ මට්ටම්", news: "පුවත් සහ දත්ත", about: "පිළිබඳව සහ උදව්" },
  ta: { levels: "ஆறுகளும் மட்டங்களும்", news: "செய்திகளும் தரவும்", about: "பற்றியும் உதவியும்" },
};

// The one-line strip that replaces the big footer on phones.
export const STRIP: Record<Locale, { warn: string; data: string }> = {
  en: { warn: "Not official. In an emergency call 117", data: "Data: Irrigation Dept & others" },
  si: { warn: "නිල සේවාවක් නොවේ. හදිසි අවස්ථාවක 117 අමතන්න", data: "දත්ත: වාරිමාර්ග දෙපාර්තමේන්තුව සහ අනෙකුත්" },
  ta: { warn: "அதிகாரப்பூர்வமற்றது. அவசரத்தில் 117 அழைக்கவும்", data: "தரவு: நீர்ப்பாசனத் துறை மற்றும் பிறர்" },
};
