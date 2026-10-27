// Strings for the desktop Basins mega-menu (app/BasinsMenu.tsx). si/ta are drafts: need native review.
import type { Locale } from "./config";

export type BasinsMenuStrings = {
  filter: string; // placeholder + accessible name of the filter box
  attention: string; // group header: basins at Alert or above
  all: string; // group header: the rest, A-Z
  gauges: string; // "{n} gauges"
  gauge1: string;
  none: string; // nothing matches the filter
  allBasins: string; // footer link to the overview
};

export const BASINS_MENU: Record<Locale, BasinsMenuStrings> = {
  en: { filter: "Find a river", attention: "At Alert or above now", all: "All rivers, A to Z", gauges: "{n} gauges", gauge1: "1 gauge", none: "No river matches", allBasins: "All rivers" },
  si: { filter: "ගඟක් සොයන්න", attention: "දැන් අනතුරු ඇඟවීම හෝ ඉහළ", all: "සියලු ගංගා, A-Z", gauges: "මානක {n}", gauge1: "මානක 1", none: "ගඟක් හමු නොවීය", allBasins: "සියලු ගංගා" },
  ta: { filter: "ஆற்றைத் தேடுங்கள்", attention: "இப்போது எச்சரிக்கை அல்லது அதற்கு மேல்", all: "அனைத்து ஆறுகள், A-Z", gauges: "{n} மானிகள்", gauge1: "1 மானி", none: "பொருந்தும் ஆறு இல்லை", allBasins: "அனைத்து ஆறுகள்" },
};
