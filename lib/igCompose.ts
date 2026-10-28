// Captions for the Instagram account: pure (no I/O, no clock) so scripts/ig-post.mjs and scripts/ig-post.test.mts share it.
//
// Shape of every caption (owner rules, research/instagram-plan.md):
//   line 1   English, short and plain
//   line 2   Sinhala, line 3 Tamil (IG_LANGS=en,si,ta by default; drafts, see DOCS.md "Instagram")
//   a line   "Live levels: waterlevels.lk" (always; Instagram captions have no clickable links, so never a URL)
//   hashtags place hashtags on FEED posts only (a story has no caption on Instagram, and its picture carries the address)
// Every number printed comes from the facts handed in. A story's caption is never shown by Instagram (API stories take no caption);
// it is still composed, checked, logged and shown in the Slack dry-run so the words are reviewed once.
// @ts-ignore node strip-types needs explicit extensions
import { pushText } from "./i18n/return.ts";

export const LIVE_LINE: Record<"en" | "si" | "ta", string> = { en: "Live levels: waterlevels.lk", si: "සජීවී මට්ටම්: waterlevels.lk", ta: "நேரடி நீர்மட்டம்: waterlevels.lk" };
export const MAX_CAPTION = 2200;
export const MAX_TAGS = 5;
export type Lang = "en" | "si" | "ta";

const ft = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)} ft`;
const int = (n: number) => Math.round(n).toLocaleString("en-US");
const WORD: Record<string, string> = { normal: "normal", watch: "watch", alert: "Alert", minor: "Minor flood", major: "Major flood" };
const LEVEL: Record<string, number> = { normal: 0, watch: 1, alert: 2, minor: 3, major: 4 };
const trendOf = (t?: string | null) => (/rising/.test(t ?? "") ? "rising" : /falling/.test(t ?? "") ? "falling" : /steady|stable/.test(t ?? "") ? "steady" : null);

export type GaugeFact = { station: string; river?: string | null; tier: string; level: number; trend?: string | null; nextHour?: { level: number } | null };
export type Item =
  | { type: "gauge_rise"; gauge: GaugeFact }
  | { type: "gauge_clear"; gauge: GaugeFact }
  | { type: "warning"; warning: { source: string; severity: string; basins: string[] } }
  | { type: "home"; home: { atAlert: number; nearAlert: number; assessed: number; rain?: { mm: number; place: string } | null; weather?: boolean } }
  | { type: "rain"; rain: { place: string; mm: number } | null }
  | { type: "reservoirs"; reservoirs: { count: number; top: { name: string; cusecs: number; day: string | null } | null } }
  | { type: "river"; river: { name: string; gauges: number; station: string; level: number | null; tier: string } }
  | { type: "survey" }
  | { type: "embed" };

/** "Kalu Ganga" -> "#KaluGanga". Letters and digits only; Sinhala / Tamil names are not used as tags. */
export const tagOf = (name: string): string | null => {
  const w = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\(.*?\)/g, " ").split(/[^A-Za-z0-9]+/).filter(Boolean).map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join("");
  return w.length >= 3 ? `#${w}` : null;
};

const SEV_EN: Record<string, string> = { advisory: "weather advisory", alert: "Alert bulletin", "minor flood": "Minor flood bulletin", "major flood": "Major flood bulletin", evacuation: "evacuation bulletin" };

function english(it: Item): string {
  switch (it.type) {
    case "gauge_rise": {
      const g = it.gauge;
      const tr = trendOf(g.trend);
      const next = g.nextHour && typeof g.nextHour.level === "number" ? ` Next hour: about ${ft(g.nextHour.level)}.` : "";
      const urgent = (LEVEL[g.tier] ?? 0) >= 3 ? " Emergency: 117." : "";
      return `${g.station}${g.river ? `, ${g.river}` : ""}: ${WORD[g.tier] ?? g.tier} at ${ft(g.level)}${tr ? `, ${tr}` : ""}.${next}${urgent}`;
    }
    case "gauge_clear":
      return `${it.gauge.station}${it.gauge.river ? `, ${it.gauge.river}` : ""}: back below Alert, ${ft(it.gauge.level)}.`;
    case "warning":
      return `Official ${SEV_EN[it.warning.severity] ?? "bulletin"} from ${it.warning.source} for ${it.warning.basins.join(", ")}, passed on. We are not the source. Emergency: 117.`;
    case "home": {
      const h = it.home;
      const a = h.atAlert > 0 ? `Rivers right now: ${h.atAlert} gauge${h.atAlert === 1 ? "" : "s"} at Alert or higher${h.nearAlert ? `, ${h.nearAlert} near it` : ""}.` : "Rivers right now: no gauge at Alert or higher.";
      const r = h.weather && h.rain ? ` Rain forecast: up to ${int(h.rain.mm)} mm in 24 hours near ${h.rain.place}.` : "";
      return a + r;
    }
    case "rain":
      return it.rain ? `Rain in the last 24 hours: where it fell. Heaviest gauge reading: ${it.rain.place}, ${int(it.rain.mm)} mm.` : "Rain in the last 24 hours: where it fell.";
    case "reservoirs": {
      const r = it.reservoirs;
      const top = r.top ? ` Largest: ${r.top.name}, ${int(r.top.cusecs)} cusecs${r.top.day ? ` (${r.top.day})` : ""}.` : "";
      return `${r.count} reservoir${r.count === 1 ? " is" : "s are"} spilling or releasing, by the latest official figures.${top}`;
    }
    case "river": {
      const r = it.river;
      return `River of the week: ${r.name}, ${r.gauges} gauge${r.gauges === 1 ? "" : "s"}. ${r.station}${r.level != null ? ` ${ft(r.level)}` : ""}, ${WORD[r.tier] ?? r.tier}.`;
    }
    case "survey":
      return "Did water reach your street? Add your spot to the flood survey. It takes a minute.";
    case "embed":
      return "Want live river levels on your own website? Our free widget does it.";
  }
}

const SI: Record<string, string> = {
  warning: "නිල ගංවතුර නිවේදනයක් ({basins}) ඉදිරිපත් කරමු. අපි මූලාශ්‍රය නොවේ. හදිසි අවස්ථාවක 117.",
  homeCalm: "දැන් ගංගා: අනතුරු ඇඟවීමේ මට්ටමට ළඟා වූ මානයක් නැත.",
  homeAlert: "දැන් ගංගා: මානයන් {n}ක් අනතුරු ඇඟවීමේ මට්ටමේ හෝ ඊට ඉහළ.",
  clear: "{station}: අනතුරු ඇඟවීමේ මට්ටමට පහළට ආවා.",
  rain: "පසුගිය පැය 24 වර්ෂාව: වැසි වැටුණු ස්ථාන.",
  reservoirs: "වාන් දමන හෝ ජලය මුදාහරින ජලාශ {n}ක් (නිල සංඛ්‍යා).",
  river: "සතියේ ගඟ: {river}.",
  survey: "ඔබේ වීදියට ජලය ආවාද? ගංවතුර සමීක්ෂණයේ ඔබේ ස්ථානය එක් කරන්න.",
  embed: "ඔබේ වෙබ් අඩවියේ සජීවී ගං මට්ටම් පෙන්වීමට අපගේ නොමිලේ විජට් එක භාවිතා කරන්න.",
};
const TA: Record<string, string> = {
  warning: "அதிகாரப்பூர்வ வெள்ள அறிவிப்பு ({basins}) பகிரப்படுகிறது. நாங்கள் மூலம் அல்ல. அவசரநிலைக்கு 117.",
  homeCalm: "இப்போது ஆறுகள்: எச்சரிக்கை நிலையை எட்டிய நிலையம் இல்லை.",
  homeAlert: "இப்போது ஆறுகள்: எச்சரிக்கை நிலையில் அல்லது அதற்கு மேல் உள்ள நிலையங்கள்: {n}.",
  clear: "{station}: எச்சரிக்கை நிலைக்குக் கீழே திரும்பியது.",
  rain: "கடந்த 24 மணி நேர மழை: மழை பெய்த இடங்கள்.",
  reservoirs: "வான் பாயும் அல்லது நீர் திறக்கும் நீர்த்தேக்கங்கள் {n} (அதிகாரப்பூர்வ புள்ளிவிவரம்).",
  river: "வாரத்தின் ஆறு: {river}.",
  survey: "உங்கள் தெருவில் தண்ணீர் வந்ததா? வெள்ள ஆய்வில் உங்கள் இடத்தைச் சேர்க்கவும்.",
  embed: "உங்கள் இணையதளத்தில் நேரடி ஆற்று நீர்மட்டத்தைக் காட்ட எங்கள் இலவச விட்ஜெட்டைப் பயன்படுத்துங்கள்.",
};
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

function native(it: Item, lang: "si" | "ta"): string | null {
  const D = lang === "si" ? SI : TA;
  switch (it.type) {
    case "gauge_rise": {
      const g = it.gauge;
      const m = pushText(lang, "rise", [{ name: g.station, level: Math.max(2, LEVEL[g.tier] ?? 2), street: null }]);
      return m.title; // "Ratnapura: Alert" in the reader's language; the push body says "open ... to see what to do", which means nothing in a caption
    }
    case "gauge_clear": return fill(D.clear, { station: it.gauge.station });
    case "warning": return fill(D.warning, { basins: it.warning.basins.join(", ") });
    case "home": return it.home.atAlert > 0 ? fill(D.homeAlert, { n: it.home.atAlert }) : D.homeCalm;
    case "rain": return D.rain;
    case "reservoirs": return fill(D.reservoirs, { n: it.reservoirs.count });
    case "river": return fill(D.river, { river: it.river.name });
    case "survey": return D.survey;
    case "embed": return D.embed;
  }
}

/** Place hashtags for a FEED post: the river and the place named in the picture, then the general tag. At most MAX_TAGS. */
export function hashtagsFor(it: Item): string[] {
  const tags: (string | null)[] = [];
  switch (it.type) {
    case "gauge_rise": case "gauge_clear": tags.push(it.gauge.river ? tagOf(it.gauge.river) : null, tagOf(it.gauge.station), "#SriLankaFloods"); break;
    case "warning": tags.push(...it.warning.basins.slice(0, 2).map(tagOf), "#SriLankaFloods"); break;
    case "home": tags.push("#SriLankaFloods", it.home.weather ? "#SriLankaWeather" : "#SriLankaRivers"); break;
    case "rain": tags.push(it.rain ? tagOf(it.rain.place) : null, "#SriLankaRain", "#SriLankaWeather"); break;
    case "reservoirs": tags.push(it.reservoirs.top ? tagOf(it.reservoirs.top.name) : null, "#SriLankaReservoirs", "#SriLankaFloods"); break;
    case "river": tags.push(tagOf(it.river.name), tagOf(it.river.station), "#SriLankaRivers"); break;
    case "survey": tags.push("#SriLankaFloods", "#FloodSurvey"); break;
    case "embed": tags.push("#SriLankaFloods", "#OpenData"); break;
  }
  return [...new Set(tags.filter((t): t is string => !!t))].slice(0, MAX_TAGS);
}

/** { text, lines } for one item. `feed` adds the place hashtags; `langs` picks the language lines (English is always first). */
export function composeCaption(it: Item, o: { feed: boolean; langs?: Lang[] }): { text: string; en: string; tags: string[] } {
  const langs = o.langs?.length ? o.langs : (["en", "si", "ta"] as Lang[]);
  const en = english(it);
  const lines = [en];
  for (const l of langs) if (l !== "en") {
    const t = native(it, l);
    if (t) lines.push(t);
  }
  const live = LIVE_LINE.en;
  const tags = o.feed ? hashtagsFor(it) : [];
  const text = [lines.join("\n"), live, tags.join(" ")].filter(Boolean).join("\n\n");
  return { text, en, tags };
}

/** Problems with a finished caption (empty = fine): no links, the address line, hashtags only on feed posts, length. */
export function validateCaption(text: string, o: { feed: boolean }): string[] {
  const bad: string[] = [];
  if (/https?:\/\/|www\./i.test(text)) bad.push("contains a link (captions are not clickable)");
  if (!text.includes(LIVE_LINE.en)) bad.push("missing the 'Live levels: waterlevels.lk' line");
  if (text.length > MAX_CAPTION) bad.push(`longer than ${MAX_CAPTION} characters`);
  const tags = text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  if (!o.feed && tags.length) bad.push("hashtags on a story");
  if (tags.length > MAX_TAGS) bad.push(`more than ${MAX_TAGS} hashtags`);
  if (/@\w/.test(text)) bad.push("contains an @mention");
  if (!/[A-Za-z]/.test(text.split("\n")[0] ?? "")) bad.push("first line is not English");
  return bad;
}
