// Is a news item about water / flood safety in Sri Lanka, and what kind? Plain keyword rules, no
// imports (scripts/news.test.mts runs it under plain node). Items the rules cannot settle come back
// as "borderline" and lib/news.ts may ask the Decisions API about a few of them.
//
// Tags: Rain, River, Reservoir, Landslide, Cyclone, Warning, Closure. The tag is the hazard named
// first in the headline (ties go to the more specific one), so "Heavy rain warning ... as depression
// intensifies" is a Warning and "Cyclone developing in Bay of Bengal" is a Cyclone.

export type NewsTag = "Rain" | "River" | "Reservoir" | "Landslide" | "Cyclone" | "Warning" | "Closure";
export const NEWS_TAGS: NewsTag[] = ["Warning", "Rain", "River", "Reservoir", "Landslide", "Cyclone", "Closure"];

export type Verdict = { kind: "yes"; tag: NewsTag } | { kind: "borderline"; tag: NewsTag } | { kind: "no" };

const W = (s: string) => new RegExp(s, "i");

// Most specific first: a tie at the same position goes to the earlier entry.
const TAG_RULES: { tag: NewsTag; re: RegExp }[] = [
  { tag: "Reservoir", re: W("\\b(spill\\s*gates?|spill\\s*way|sluice\\s*gates?|radial\\s*gates?|reservoirs?|spilling|dam\\s+(?:overflow|safety|gates?)|tank\\s+(?:spill|overflow|breach)\\w*)\\b") },
  { tag: "Landslide", re: W("\\b(landslides?|land\\s*slides?|land\\s*slips?|earth\\s*slips?|rock\\s*falls?|mud\\s*slides?|slope\\s+failures?|soil\\s+slips?|NBRO|cut\\s+slope\\w*)\\b") },
  { tag: "Closure", re: W("\\b(?:road|roads|railway|rail|train|trains|bridge|bridges|highway|expressway|ferry|flights?|schools?|exams?|examinations?|ports?|harbou?rs?|causeway|railway\\s+line)\\b[^.]{0,60}\\b(?:closed|closure|blocked|suspended|cancell?ed|submerged|disrupted|inaccessible|cut\\s+off|shut|inundated|washed\\s+away)\\b") },
  { tag: "River", re: W("\\b(floods?(?!\\s+of\\b)|flooded|flooding|flash\\s+floods?|inundat\\w+|river\\s+(?:level|levels|water)|water\\s+levels?|overflow\\w*|breached?|(?:\\w+)\\s+(?:ganga|oya)|ganga|marooned|submerged)\\b") },
  { tag: "Warning", re: W("\\b(?:(?:heavy|torrential|very\\s+heavy|intense)\\s+rain(?:fall)?s?\\s+(?:warning|advisory|alert)s?|(?:weather|rain|flood|landslide|red|amber|yellow|orange|lightning|wind)\\s+(?:warning|advisory|alert)s?|evacuat\\w+|warnings?\\s+issued|advisory|alert\\s+(?:issued|level)|early\\s+warning|DMC|Disaster\\s+Management|relief\\s+(?:efforts?|operations?|camps?|supplies)|safe\\s+(?:locations?|shelters?)|displaced|rescue[sd]?)\\b") },
  { tag: "Cyclone", re: W("\\b(cyclon\\w*|depressions?(?=\\s+(?:over|in|near|off|developing|intensif\\w*|deepen\\w*|forms?|formed|moves?|moving|crossing|to)\\b)|(?:low|deep)[\\s-]pressure(?:\\s+(?:area|system))?|tropical\\s+storm|storm\\s+surge|monsoon|bay\\s+of\\s+bengal)\\b") },
  { tag: "Rain", re: W("\\b(rain|rains|rainy|rainfall|rainfalls|downpours?|showers?|thunder\\w*|inclement\\s+weather|wet\\s+weather|met(?:eorology)?\\s+department|weather\\s+(?:update|forecast|outlook)|strong\\s+winds?|rough\\s+seas?|gusty)\\b") },
];

// Words that make an item clearly about a hazard on their own (the headline may then override an off-topic cue).
const STRONG = W("\\b(floods?(?!\\s+of\\b)|flooded|flooding|flash\\s+floods?|spill\\s*gates?|landslides?|land\\s*slips?|earth\\s*slips?|cyclon\\w*|evacuat\\w+|heavy\\s+rain\\w*|rain\\s+warning|inundat\\w+|sluice\\s*gates?|reservoirs?\\s+(?:spilling|overflow\\w*)|NBRO|DMC|Disaster\\s+Management)\\b");

// Topics that are never flood news, unless a STRONG word is in the headline.
const OFF_TOPIC = W("\\b(cricket|rugby|football|soccer|tournament|league|wicket\\w*|innings|match(?:es)?|olympics?|medal|golf|tennis|athletics|election|parliament|cabinet|budget|ministers?|anti-terrorism|bill|tax|dollar|rupee|stock|shares?|cse|asi|prices?|inflation|appointment|appointed|ceo|launch(?:es|ed)?|awards?|concert|film|movie|actor|actress|singer|celebrity|petrol|diesel|gas|litro|navy\\s+band|exports?|imports?|tourists?|arrivals|airport|passport|visa|court|arrest\\w*|remanded|police|murder|stabbed|drug|bribery|corruption|oil\\s+prices?|bitcoin|crypto)\\b");

// A foreign place in the headline with no Sri Lankan marker anywhere: not ours.
const FOREIGN = W("\\b(india(?!n\\s+ocean)|indian(?!\\s+ocean)|pakistan|bangladesh|nepal|myanmar|china|chinese|philippines|japan|vietnam|thailand|indonesia|malaysia|australia|brazil|argentina|mexico|texas|florida|california|america|u\\.s\\.|usa|europe|spain|italy|germany|france|britain|uk|africa|nigeria|kenya|gaza|israel|iran|yemen|houthi|ukraine|russia|chennai|tamil\\s+nadu|kerala|odisha|andhra|west\\s+bengal|taiwan|korea|hong\\s+kong|pakistan|afghanistan|saudi|dubai|uae|maldives)\\b");
const SRI_LANKA = W("\\b(sri\\s+lanka\\w*|lanka|colombo|kandy|galle|matara|ratnapura|kalutara|gampaha|kegalle|nuwara\\s+eliya|badulla|hambantota|kurunegala|puttalam|anuradhapura|polonnaruwa|trincomalee|batticaloa|ampara|jaffna|mannar|vavuniya|mullaitivu|kilinochchi|monaragala|matale|western\\s+province|southern\\s+province|central\\s+province|sabaragamuwa|uva|north\\s+western|north\\s+central|eastern\\s+province|northern\\s+province|dmc|irrigation\\s+department|mahaweli|kelani\\w*|kalu\\s+ganga|gin\\s+ganga|nilwala|walawe|deduru|maha\\s+oya)\\b");

const CAUSE = W("\\b(rain\\w*|flood\\w*|landslides?|weather|cyclon\\w*|storm|water|winds?|inundat\\w+|fallen\\s+trees?|trees?)\\b");

// A hazard word in a Warning-tag story (evacuated, rescued, DMC) must come with weather or disaster context:
// "Sri Lanka evacuates sailors off Galle" is a medical story.
const WEATHERISH = W("\\b(rain\\w*|flood\\w*|landslides?|weather|cyclon\\w*|storm|water|winds?|inundat\\w+|disaster|low[- ]lying|vigilan\\w+|monsoon|lightning|spill\\w*|reservoirs?)\\b");
// Government plans and money are not flood news, even about a flood project, unless the headline carries a warning-type word.
const GOVERNANCE = W("\\b(cabinet|budget|tenders?|approves?|approved|allocat\\w+|proposals?|funding|loan|contract)\\b");
const WARNISH = W("\\b(warn\\w*|alert|risk|rises?|rising|evacuat\\w+|opened|spill\\w*|closed|landslides?|cyclon\\w*|advisory)\\b");

export type NewsInput = { title: string; desc?: string };

/** Which tag and how sure. Pure. */
export function classifyNews({ title, desc = "" }: NewsInput): Verdict {
  const t = title;
  const text = `${title}. ${desc}`;

  // Foreign news (a flood in Brazil) is not ours, whatever the hazard word.
  if (FOREIGN.test(t) && !SRI_LANKA.test(text)) return { kind: "no" };

  if (GOVERNANCE.test(t) && !WARNISH.test(t)) return { kind: "no" };

  const strongTitle = STRONG.test(t);
  if (OFF_TOPIC.test(t) && !strongTitle) return { kind: "no" };

  // Tag: the hazard named first in the headline.
  let best: { tag: NewsTag; at: number; rank: number } | null = null;
  TAG_RULES.forEach((r, rank) => {
    const m = r.re.exec(t);
    if (m && (!best || m.index < best.at || (m.index === best.at && rank < best.rank))) best = { tag: r.tag, at: m.index, rank };
  });
  if (best) {
    const b: { tag: NewsTag } = best;
    // A closure only counts when the weather is the cause.
    if (b.tag === "Closure" && !CAUSE.test(text)) return { kind: "no" };
    if (b.tag === "Warning" && !WEATHERISH.test(text)) return { kind: "no" };
    // A bare weather word in the headline ("rain", "showers", "strong winds", "monsoon") is only a clear yes when it
    // is a warning-type story or is backed by a stronger word; otherwise ask the description / the model.
    const weak = b.tag === "Rain" || (b.tag === "Cyclone" && !/cyclon|depression|storm/i.test(t));
    if (weak && !strongTitle && !STRONG.test(desc) && !SRI_LANKA.test(text)) return { kind: "borderline", tag: b.tag };
    return { kind: "yes", tag: b.tag };
  }

  // Nothing in the headline: the description may carry it.
  if (STRONG.test(desc)) {
    for (const r of TAG_RULES) if (r.re.test(desc)) return { kind: "borderline", tag: r.tag };
  }
  return { kind: "no" };
}

/** Tags with their order for the filter chips. */
export const tagIndex = (t: NewsTag) => NEWS_TAGS.indexOf(t);
