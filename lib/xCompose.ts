// Words for the X (Twitter) account: pure, no imports, no clock, no I/O, so the sender (scripts/x-post.mjs, run with
// node --experimental-strip-types) and scripts/x-post.test.mts share it.
//
// Rules this file enforces (DOCS.md "X account"):
//  1. Every number in a post comes from the data handed to the composer ("facts"). Templates only print facts, and
//     validatePost() re-reads the finished text and rejects any number that is not in the facts (117 aside).
//  2. A post is at most 280 characters the way X counts them: a link is always 23 (t.co), most letters 1.
//  3. A post always carries its page link and the disclaimer; hashtags are dropped first when space is short.
//  4. An optional language-model polish may only reword; its answer is accepted only if it passes the same checks
//     (same numbers, same link, same disclaimer, same must-keep words, no new hashtags or emoji), else the template is used.

export const MAX_TWEET = 280;
export const TCO_LENGTH = 23;
/** Appended to every post that is our own words. */
export const DISCLAIMER = "Not an official warning. Emergency: 117.";
/** Appended to a post that relays an official bulletin. */
export const DISCLAIMER_RELAY = "Relayed, we are not the source. Emergency: 117.";
/** The only number allowed without being in the facts. */
export const ALWAYS_OK_NUMBERS = [117];

const URL_RE = /https?:\/\/[^\s]+/g;

/** Length the way X counts it (twitter-text v3): a link = 23, characters in the Latin/Sinhala/Tamil ranges = 1, CJK and emoji = 2. */
export function tweetLength(text: string): number {
  const t = text.normalize("NFC").replace(URL_RE, "x".repeat(TCO_LENGTH));
  let n = 0;
  for (const ch of t) {
    const c = ch.codePointAt(0)!;
    n += (c <= 4351 || (c >= 8192 && c <= 8205) || (c >= 8208 && c <= 8223) || (c >= 8242 && c <= 8247)) ? 1 : 2;
  }
  return n;
}

/** Every number in a text, links removed, "1,200" read as 1200. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.replace(URL_RE, " ").matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** All numbers that appear anywhere in the facts (numbers, and numbers inside strings such as "2:30 pm"). */
export function allowedNumbers(facts: unknown): Set<number> {
  const s = new Set<number>(ALWAYS_OK_NUMBERS);
  const walk = (v: unknown): void => {
    if (typeof v === "number" && Number.isFinite(v)) {
      const a = Math.abs(v);
      s.add(a);
      s.add(Math.round(a)); // posts print whole numbers and one decimal
      s.add(Math.round(a * 10) / 10);
      if (a > 1e11) for (const n of [...numbersIn(clock(a)), ...numbersIn(dayText(a))]) s.add(n); // a timestamp is printed as a clock time
    } else if (typeof v === "string") for (const n of numbersIn(v)) s.add(n);
    else if (Array.isArray(v)) {
      for (let k = 0; k <= 3; k++) if (v.length - k >= 0) s.add(v.length - k); // counts: "3 gauges", "and 2 more"
      v.forEach(walk);
    }
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(facts);
  return s;
}

export type Post = {
  /** alert | clear | reservoir | street | warning | morning | evening | storm */
  kind: string;
  text: string;
  /** The same post without the link. */
  textNoLink: string;
  /** Optional thread reply with details. */
  reply?: string;
  link: string;
  facts: unknown;
  /** Words that must survive any rewording (place names, the status word, "forecast"). */
  must: string[];
  hashtags: string[];
  disclaimer: string;
};

const TAG_RE = /#\w+/g;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/** Why a text may not go out; empty = fine. */
export function validateText(text: string, p: Pick<Post, "link" | "facts" | "must" | "hashtags" | "disclaimer"> & { forbidLinks?: boolean }, reference?: string): string[] {
  const problems: string[] = [];
  if (p.forbidLinks && /https?:\/\//.test(text)) problems.push("contains a link");
  if (tweetLength(text) > MAX_TWEET) problems.push(`too long (${tweetLength(text)})`);
  const ok = allowedNumbers(p.facts);
  for (const n of numbersIn(text)) if (!ok.has(n)) problems.push(`number ${n} is not in the data`);
  if (!text.includes(p.link)) problems.push("link missing");
  if (!text.includes(p.disclaimer)) problems.push("disclaimer missing");
  const low = text.replace(URL_RE, " ").toLowerCase(); // a name inside the link does not count
  for (const w of p.must) if (!low.includes(w.toLowerCase())) problems.push(`"${w}" missing`);
  for (const t of text.match(TAG_RE) ?? []) if (!p.hashtags.includes(t)) problems.push(`unexpected hashtag ${t}`);
  if (reference != null) {
    const had = new Set(reference.match(EMOJI_RE) ?? []);
    for (const e of text.match(EMOJI_RE) ?? []) if (!had.has(e)) problems.push("new emoji");
  }
  return problems;
}

export const validatePost = (p: Post): string[] => [...validateText(p.text, p, p.text), ...validateText(p.textNoLink, { ...p, link: "", forbidLinks: true }, p.text).map((x) => `(no link) ${x}`)];

// ---- formatting helpers (all take facts, print facts) -----------------------------------------------------------

const TZ = "Asia/Colombo";
/** "2:30 pm" in Sri Lanka time. */
export function clock(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(ms).replace(/\s?([AP])M$/, (_, a: string) => ` ${a.toLowerCase()}m`);
}
/** "26 Oct" in Sri Lanka time. */
export function dayText(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" }).format(ms);
}
/** "2026-10-26" (Colombo day) and minutes since local midnight. */
export function colomboDay(ms: number): { day: string; minutes: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(ms).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const ft = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)} ft`;
const int = (n: number) => Math.round(n).toLocaleString("en-US");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const TIER_WORD: Record<string, string> = { alert: "Alert level", minor: "Minor flood level", major: "Major flood level" };
const TIER_MARK: Record<string, string> = { alert: "alert level", minor: "minor flood level", major: "major flood level" };

/** "#KelaniGanga" from "Kelani Ganga" (letters only). */
export function riverTag(river: string): string {
  const w = river.replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(Boolean).map(cap).join("");
  return w ? `#${w}` : "";
}

/** Joins "A, B and C". */
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// ---- facts shapes -----------------------------------------------------------------------------------------------

export type GaugeFact = {
  station: string;
  river: string;
  tier: "alert" | "minor" | "major" | "normal" | "watch";
  level: number;
  /** The mark of the tier it reached (or, for a clear, of the alert level it dropped below). */
  mark: number | null;
  alertMark: number | null;
  trend: string | null;
  nextHour: { level: number; low: number | null; high: number | null; direction: string; crossing: string | null } | null;
  url: string;
  at: number;
};

export type Composed = Omit<Post, "kind" | "facts">;

type Parts = { body: string; short?: string; link: string; must: string[]; tags: string[]; disclaimer?: string; reply?: string };

/**
 * Puts body (+ link) + disclaimer (+ hashtags when they fit) together and keeps it within 280. Both versions are built:
 * `text` with the page link and `textNoLink` without (a post with a link costs about 13 times more on the X API, so the
 * sender picks: scripts/x-post.mjs X_LINKS).
 */
function assemble(parts: Parts[] | Parts): Composed {
  const variants = Array.isArray(parts) ? parts : [parts];
  const build = (withLink: boolean) => {
    let last = "";
    let pick: Parts = variants[0];
    for (const p of variants) {
      const disclaimer = p.disclaimer ?? DISCLAIMER;
      for (const body of [p.body, p.short].filter((x): x is string => !!x)) {
        for (const tags of [p.tags, p.tags.slice(0, 1), []]) {
          const text = `${body}${withLink ? `\n${p.link}` : ""}\n${disclaimer}${tags.length ? `\n${tags.join(" ")}` : ""}`;
          last = text;
          pick = p;
          if (tweetLength(text) <= MAX_TWEET) return { text, pick };
        }
      }
    }
    return { text: last, pick };
  };
  const a = build(true);
  const b = build(false);
  const p = a.pick;
  return { text: a.text, textNoLink: b.text, link: p.link, must: p.must, hashtags: p.tags, disclaimer: p.disclaimer ?? DISCLAIMER, reply: p.reply };
}

const trendWord = (t: string | null) => (t === "rising" ? ", rising" : t === "rising slowly" ? ", rising slowly" : t === "falling" ? ", falling" : t === "steady" ? ", steady" : "");

function nextHourLine(g: GaugeFact): string | null {
  const n = g.nextHour;
  if (!n) return null;
  const range = n.low != null && n.high != null ? `, most likely between ${ft(n.low)} and ${ft(n.high)}` : "";
  return `Forecast for the next hour (not official): about ${ft(n.level)}${range}.`;
}

// ---- composers --------------------------------------------------------------------------------------------------

/** One or more gauges of ONE river that rose to Alert / Minor / Major. */
export function composeGaugeRise(gs: GaugeFact[]): Composed {
  const river = gs[0].river;
  const time = clock(Math.max(...gs.map((g) => g.at)));
  const tags = ["#SriLanka", riverTag(river)].filter(Boolean);
  const worst = gs.reduce((a, g) => (rank(g.tier) > rank(a.tier) ? g : a), gs[0]);
  const link = worst.url;
  const must = [...gs.slice(0, 3).map((g) => g.station), TIER_WORD[worst.tier].split(" ")[0]];
  if (gs.length === 1) {
    const g = gs[0];
    const markTxt = g.mark != null ? ` (${TIER_MARK[g.tier]} ${ft(g.mark)})` : "";
    const body = `${TIER_WORD[g.tier]} reached at ${g.station} on the ${river}: ${ft(g.level)}${markTxt} at ${time}${trendWord(g.trend)}.`;
    const short = `${TIER_WORD[g.tier]} reached at ${g.station} (${river}): ${ft(g.level)} at ${time}.`;
    const nh = nextHourLine(g);
    const reply = [
      `${g.station}, ${river}: ${ft(g.level)} at ${time}${trendWord(g.trend)}.`,
      g.alertMark != null ? `Alert level ${ft(g.alertMark)}${g.tier !== "alert" && g.mark != null ? `, ${TIER_MARK[g.tier]} ${ft(g.mark)}` : ""}.` : null,
      nh,
      "Check the page for the chart and nearby gauges.",
    ].filter(Boolean).join(" ");
    return assemble({ body, short, link, must, tags, reply: `${reply}\n${g.url}` });
  }
  const shown = gs.slice().sort((a, b) => rank(b.tier) - rank(a.tier) || b.level - a.level);
  const mk = (k: number) => {
    const names = shown.slice(0, k).map((g) => `${g.station} ${ft(g.level)}`);
    const more = shown.length - k;
    return `${river}: ${gs.length} gauges are at Alert level or higher (${list(names)}${more > 0 ? ` and ${more} more` : ""}) at ${time}.`;
  };
  const variants: Parts[] = [3, 2, 1].filter((k) => k <= shown.length || k === 1).map((k) => ({ body: mk(Math.min(k, shown.length)), link, must: [river, ...shown.slice(0, Math.min(k, 3)).map((g) => g.station)], tags }));
  const reply = shown.map((g) => `${g.station}: ${ft(g.level)}, ${g.tier === "normal" || g.tier === "watch" ? "below alert" : TIER_MARK[g.tier]}${trendWord(g.trend)}`).slice(0, 6).join("\n");
  return { ...assemble(variants), reply: `${reply}\n${link}` };
}
const rank = (t: string) => ["normal", "watch", "alert", "minor", "major"].indexOf(t);

/** Gauges of one river that are no longer at Alert level. */
export function composeGaugeClear(gs: GaugeFact[]): Composed {
  const river = gs[0].river;
  const time = clock(Math.max(...gs.map((g) => g.at)));
  const tags = ["#SriLanka", riverTag(river)].filter(Boolean);
  const link = gs[0].url;
  if (gs.length === 1) {
    const g = gs[0];
    const body = `All clear at ${g.station} on the ${river}: ${ft(g.level)} at ${time}${g.alertMark != null ? `, below Alert level (${ft(g.alertMark)})` : ", no longer at Alert level"}.`;
    const short = `All clear at ${g.station} (${river}): ${ft(g.level)} at ${time}.`;
    return assemble({ body, short, link, must: [g.station, "clear"], tags });
  }
  const names = (k: number) => list(gs.slice(0, k).map((g) => `${g.station} ${ft(g.level)}`));
  const mk = (k: number) => `All clear on the ${river} at ${time}: ${names(k)}${gs.length > k ? ` and ${gs.length - k} more` : ""} no longer at Alert level.`;
  return assemble([3, 2, 1].map((k) => ({ body: mk(Math.min(k, gs.length)), link, must: [river, "clear"], tags })));
}

export type ReservoirFact = { name: string; river: string | null; status: "spilling" | "releasing"; cusecs: number; storagePercent: number | null; day: string; source: string | null; url: string };

export function composeReservoirStart(rs: ReservoirFact[]): Composed {
  const tags = ["#SriLanka", rs[0].river ? riverTag(rs[0].river) : ""].filter(Boolean);
  if (rs.length === 1) {
    const r = rs[0];
    const verb = r.status === "spilling" ? "is spilling water over its spillway" : "is releasing water through its gates";
    const stor = r.storagePercent != null ? ` Storage ${int(r.storagePercent)}%.` : "";
    const body = `${r.name} reservoir ${verb}: about ${int(r.cusecs)} cusecs (${r.day}).${stor}${r.river ? ` Water may reach the ${r.river} in the next hours.` : ""}`;
    const short = `${r.name} reservoir ${r.status === "spilling" ? "is spilling" : "is releasing water"}: about ${int(r.cusecs)} cusecs (${r.day}).`;
    const reply = `${r.name}: ${r.status}, about ${int(r.cusecs)} cusecs on ${r.day}${r.source ? ` (${r.source})` : ""}. The figure is the agency's daily reading, not live.${r.river ? ` Watch the ${r.river} gauges downstream.` : ""}`;
    return assemble({ body, short, link: r.url, must: [r.name], tags, reply: `${reply}\n${r.url}` });
  }
  const mk = (k: number) => `${rs.length} reservoirs are letting water out: ${list(rs.slice(0, k).map((r) => `${r.name} ${int(r.cusecs)} cusecs`))}${rs.length > k ? ` and ${rs.length - k} more` : ""} (${rs[0].day}).`;
  return assemble([3, 2, 1].map((k) => ({ body: mk(Math.min(k, rs.length)), link: rs[0].url, must: [rs[0].name], tags })));
}

export function composeReservoirStop(rs: { name: string; river: string | null; day: string; url: string }[]): Composed {
  const tags = ["#SriLanka"];
  const mk = (k: number) => (rs.length === 1 ? `${rs[0].name} reservoir has stopped letting water out (${rs[0].day}).` : `${list(rs.slice(0, k).map((r) => r.name))}${rs.length > k ? ` and ${rs.length - k} more` : ""}: reservoirs have stopped letting water out (${rs[0].day}).`);
  return assemble([3, 2, 1].map((k) => ({ body: mk(Math.min(k, rs.length)), link: rs[0].url, must: [rs[0].name], tags })));
}

export type StreetFact = { towns: string[]; rain24Mm: number | null; windowH: number; gaugeStation: string | null; gaugeLevel: number | null; url: string; at: number };

export function composeStreetLikely(f: StreetFact): Composed {
  const t = f.towns;
  const where = t.length > 1 ? `${list(t.slice(0, 2))} and nearby canal areas` : t[0];
  const rain = f.rain24Mm != null ? ` About ${int(f.rain24Mm)} mm of rain fell in the last ${f.windowH} hours (satellite estimate).` : "";
  const gauge = f.gaugeStation && f.gaugeLevel != null ? ` ${f.gaugeStation} gauge: ${ft(f.gaugeLevel)}.` : "";
  const body = `Street flooding is likely in ${where} (${clock(f.at)}).${rain}`;
  const short = `Street flooding likely in ${where} (${clock(f.at)}).`;
  const reply = `Why: heavy rain on low canal areas, which can flood streets before the river reaches any official level.${gauge} This is our own estimate from satellite rain, not an official warning.`;
  return assemble({ body, short, link: f.url, must: [t[0], "likely"], tags: ["#SriLanka", "#floods"], reply: `${reply}\n${f.url}` });
}

export function composeStreetClear(f: { towns: string[]; url: string; at: number }): Composed {
  const t = f.towns;
  const where = t.length > 1 ? `${list(t.slice(0, 2))} and nearby canal areas` : t[0];
  const body = `Street flood risk has eased in ${where} (${clock(f.at)}). Water already on the streets can take hours to drain.`;
  return assemble({ body, short: `Street flood risk has eased in ${where} (${clock(f.at)}).`, link: f.url, must: [t[0], "eased"], tags: ["#SriLanka"] });
}

export type WarningFact = { source: string; severity: string; basins: string[]; issuedAt: number; releaseCusecs: number | null; bulletinUrl: string; url: string };

const SEVERITY_TEXT: Record<string, string> = { advisory: "flood advisory", alert: "flood alert", "minor flood": "minor flood warning", "major flood": "major flood warning", evacuation: "evacuation warning" };

export function composeWarning(w: WarningFact): Composed {
  const basins = list(w.basins.slice(0, 3));
  const what = SEVERITY_TEXT[w.severity] ?? "flood warning";
  const rel = w.releaseCusecs != null ? ` It mentions a release of about ${int(w.releaseCusecs)} cusecs.` : "";
  const body = `Official ${what} from the ${w.source} (issued ${clock(w.issuedAt)}): ${basins}.${rel} Follow their instructions.`;
  const short = `${w.source}: ${what} for ${basins} (issued ${clock(w.issuedAt)}).`;
  const first = w.basins[0] ?? "";
  return assemble({ body, short, link: w.url, must: [w.source.split(" ")[0], first], tags: ["#SriLanka", "#floods"], disclaimer: DISCLAIMER_RELAY, reply: `Bulletin: ${w.bulletinUrl}\nThe bulletin is the official source; this account only passes it on.` });
}

export type SummaryFact = {
  period: "morning" | "evening";
  at: number;
  reporting: number;
  assessed: number;
  atAlert: { station: string; tier: string }[];
  nearAlert: number;
  /** Heaviest 24 h rain forecast among the places we check, or null when none could be read. */
  rain: { mm: number; place: string } | null;
  rainWindowH: number;
  spilling: number;
  url: string;
};

export function composeSummary(f: SummaryFact): Composed {
  const hello = f.period === "morning" ? "Good morning." : "Evening update.";
  const parts: string[] = [];
  if (f.atAlert.length === 0) parts.push(`All ${f.assessed} river gauges with flood levels are below Alert level.`);
  else {
    const names = list(f.atAlert.slice(0, 3).map((a) => a.station));
    parts.push(`${f.atAlert.length} of ${f.assessed} river gauges are at Alert level or higher: ${names}${f.atAlert.length > 3 ? ` and ${f.atAlert.length - 3} more` : ""}.`);
  }
  if (f.nearAlert > 0) parts.push(`${f.nearAlert} more ${f.nearAlert === 1 ? "is" : "are"} close to Alert level.`);
  const rain = f.rain && f.rain.mm >= 5 ? `Rain forecast, next ${f.rainWindowH} hours: up to ${int(f.rain.mm)} mm near ${f.rain.place}.` : f.rain ? `Little rain forecast for the next ${f.rainWindowH} hours.` : null;
  const res = f.spilling > 0 ? `${f.spilling} ${f.spilling === 1 ? "reservoir is" : "reservoirs are"} letting water out.` : null;
  const body = [`${hello} ${clock(f.at)}.`, ...parts, rain, res].filter(Boolean).join(" ");
  const short = [`${hello}`, ...parts, rain].filter(Boolean).join(" ");
  const must = f.atAlert.slice(0, 1).map((a) => a.station);
  return assemble([{ body, short, link: f.url, must, tags: ["#SriLanka"] }, { body: [hello, ...parts].join(" "), link: f.url, must, tags: ["#SriLanka"] }]);
}

export type StormFact = { river: string; at: number; gauges: (GaugeFact & { tier: string })[]; url: string };

export function composeStorm(f: StormFact): Composed {
  const gs = f.gauges.slice(0, 2);
  const line = (g: GaugeFact) => {
    const nh = g.nextHour;
    const fc = nh ? ` Forecast next hour: about ${ft(nh.level)}${nh.low != null && nh.high != null ? ` (${ft(nh.low)} to ${ft(nh.high)})` : ""}.` : "";
    const lab = g.tier === "normal" || g.tier === "watch" ? "below alert" : TIER_MARK[g.tier];
    return `${g.station} ${ft(g.level)}, ${lab}${trendWord(g.trend)}.${fc}`;
  };
  const body = `${f.river} update, ${clock(f.at)}: ${gs.map(line).join(" ")}`;
  const short = `${f.river}, ${clock(f.at)}: ${gs.map((g) => `${g.station} ${ft(g.level)}${trendWord(g.trend)}`).join("; ")}.`;
  const reply = f.gauges.map((g) => `${g.station}: ${ft(g.level)}${g.alertMark != null ? ` (alert ${ft(g.alertMark)})` : ""}${trendWord(g.trend)}`).join("\n");
  return assemble({ body, short, link: f.url, must: [f.river, gs[0].station, "forecast"].filter((w, i) => i < 2 || gs[0].nextHour), tags: ["#SriLanka", riverTag(f.river)].filter(Boolean), reply: `${reply}\n${f.url}` });
}

export type RainWatchFact = { mm: number; place: string; windowH: number; atAlert: number; at: number; url: string };

export function composeRainWatch(f: RainWatchFact): Composed {
  const body = `Heavy rain forecast (${clock(f.at)}): up to ${int(f.mm)} mm in the next ${f.windowH} hours near ${f.place}. ${f.atAlert === 0 ? "No river gauge is at Alert level yet." : `${f.atAlert} river ${f.atAlert === 1 ? "gauge is" : "gauges are"} at Alert level or higher.`} Forecast, can change.`;
  return assemble({ body, short: `Heavy rain forecast: up to ${int(f.mm)} mm in the next ${f.windowH} hours near ${f.place}. Forecast, can change.`, link: f.url, must: [f.place, "forecast"], tags: ["#SriLanka", "#floods"] });
}

// ---- optional language-model polish -----------------------------------------------------------------------------

export const POLISH_INSTRUCTIONS =
  "You edit short public safety posts about river levels in Sri Lanka. Reword the DRAFT so it reads naturally for ordinary people, " +
  "in plain English. Rules: keep every fact; do not add any number, place, cause, advice or claim that is not in DRAFT or FACTS; " +
  "do not change any number; keep every link and the sentence about not being official/emergency 117 exactly as written; " +
  "keep forecasts called forecasts; no new hashtags or emoji; at most 280 characters. Answer with JSON {\"text\": \"...\"}.";

export type Llm = (instructions: string, input: string) => Promise<string | null>;

/** The reworded text if (and only if) it passes every check; otherwise the template text. `used` says which. */
export async function polish(p: Post, llm: Llm | null, withLink = true): Promise<{ text: string; used: "template" | "ai"; why?: string }> {
  const base = withLink ? p.text : p.textNoLink;
  if (!llm) return { text: base, used: "template" };
  let out: string | null = null;
  try {
    out = await llm(POLISH_INSTRUCTIONS, JSON.stringify({ DRAFT: base, FACTS: p.facts }));
  } catch {
    return { text: base, used: "template", why: "ai error" };
  }
  if (!out) return { text: base, used: "template", why: "ai gave nothing" };
  const text = out.trim();
  const problems = validateText(text, { ...p, link: withLink ? p.link : "", forbidLinks: !withLink }, base);
  if (problems.length) return { text: base, used: "template", why: problems.join("; ") };
  return { text, used: "ai" };
}
