// Words for the X (Twitter) account: pure, no imports, no clock, no I/O, so the sender (scripts/x-post.mjs, run with
// node --experimental-strip-types) and scripts/x-post.test.mts share it.
//
// Rules this file enforces (DOCS.md "X account"):
//  1. Every number in a post comes from the data handed to the composer ("facts"). Templates only print facts, and
//     validatePost() re-reads the finished text and rejects any number that is not in the facts (117 aside).
//  2. A post is at most 280 characters the way X counts them: a link is always 23 (t.co), most letters 1.
//  3. A post always carries its page link and the disclaimer; hashtags are dropped first when space is short.
//  4. The words themselves are written by the language model (gpt-6-luna) from a compact JSON of facts, in a human voice
//     (lunaWrite below); the template is the fallback. The model's text is accepted only if validateLlmText() passes: every
//     number is in the facts, <= 280, disclaimer present, no links / @mentions / invented tier words, no low-spot rain talk.
//     One retry with the problems fed back, then the template. (polish() is the older reword-only path, kept for its tests.)

export const MAX_TWEET = 280;
export const TCO_LENGTH = 23;
/** Appended to every post that is our own words. */
export const DISCLAIMER = "Not an official warning. Emergency: 117.";
/** Appended to a post that relays an official bulletin. */
/** Routine posts carry no closing (the bio and the pinned post say "Not official · 117"); serious ones carry this short one. */
export const DISCLAIMER_SHORT = "Emergency: 117.";
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
  /** alert | clear | reservoir | warning | morning | evening | storm */
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
  /** Flood risk is serious (Minor / Major, or a forecast that could reach one): a short "Emergency: 117" closing is required. */
  serious?: boolean;
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
const listMore = (xs: string[], more: number) => (more > 0 ? `${xs.join(", ")} and ${more} more` : list(xs));
const dayOf = (d: string) => (/^\d{4}-\d\d-\d\d$/.test(d) ? dayText(Date.parse(`${d}T12:00:00+05:30`)) : d);
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
function assemble(parts: Parts[] | Parts, serious = false): Composed {
  const variants = Array.isArray(parts) ? parts : [parts];
  const build = (withLink: boolean) => {
    let last = "";
    let pick: Parts = variants[0];
    for (const p of variants) {
      const disclaimer = p.disclaimer ?? (serious ? DISCLAIMER_SHORT : "");
      for (const body of [p.body, p.short].filter((x): x is string => !!x)) {
        for (const tags of [p.tags, p.tags.slice(0, 1), []]) {
          const text = `${body}${withLink ? `\n${p.link}` : ""}${disclaimer ? `\n${disclaimer}` : ""}${tags.length ? `\n${tags.join(" ")}` : ""}`;
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
  return { text: a.text, textNoLink: b.text, link: p.link, must: p.must, hashtags: p.tags, disclaimer: p.disclaimer ?? (serious ? DISCLAIMER_SHORT : ""), reply: p.reply, serious: serious || p.disclaimer === DISCLAIMER_RELAY };
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
    return assemble({ body, short, link, must, tags, reply: `${reply}\n${g.url}` }, isSerious(gs));
  }
  const shown = gs.slice().sort((a, b) => rank(b.tier) - rank(a.tier) || b.level - a.level);
  const mk = (k: number) => {
    const names = shown.slice(0, k).map((g) => `${g.station} ${ft(g.level)}`);
    const more = shown.length - k;
    return `${river}: ${gs.length} gauges are at Alert level or higher (${listMore(names, more)}) at ${time}.`;
  };
  const variants: Parts[] = [3, 2, 1].filter((k) => k <= shown.length || k === 1).map((k) => ({ body: mk(Math.min(k, shown.length)), link, must: [river, ...shown.slice(0, Math.min(k, 3)).map((g) => g.station)], tags }));
  const reply = shown.map((g) => `${g.station}: ${ft(g.level)}, ${g.tier === "normal" || g.tier === "watch" ? "below alert" : TIER_MARK[g.tier]}${trendWord(g.trend)}`).slice(0, 6).join("\n");
  return { ...assemble(variants, isSerious(gs)), reply: `${reply}\n${link}` };
}
/** Minor / Major reached, or the next-hour forecast says it could reach one. */
export const isSerious = (gs: { tier: string; nextHour?: { crossing: string | null } | null }[]) => gs.some((g) => g.tier === "minor" || g.tier === "major" || /minor|major/i.test(g.nextHour?.crossing ?? ""));
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
  const mk = (k: number) => `All clear on the ${river} at ${time}: ${listMore(gs.slice(0, k).map((g) => `${g.station} ${ft(g.level)}`), gs.length - k)} no longer at Alert level.`;
  return assemble([3, 2, 1].map((k) => ({ body: mk(Math.min(k, gs.length)), link, must: [river, "clear"], tags })));
}

export type ReservoirFact = { name: string; river: string | null; status: "spilling" | "releasing"; cusecs: number; storagePercent: number | null; day: string; source: string | null; url: string };

export function composeReservoirStart(rs: ReservoirFact[]): Composed {
  const tags = ["#SriLanka", rs[0].river ? riverTag(rs[0].river) : ""].filter(Boolean);
  if (rs.length === 1) {
    const r = rs[0];
    const verb = r.status === "spilling" ? "is spilling water over its spillway" : "is releasing water through its gates";
    const stor = r.storagePercent != null ? ` Storage ${int(r.storagePercent)}%.` : "";
    const body = `${r.name} reservoir ${verb}: about ${int(r.cusecs)} cusecs (${dayOf(r.day)}).${stor}${r.river ? ` Water may reach the ${r.river} in the next hours.` : ""}`;
    const short = `${r.name} reservoir ${r.status === "spilling" ? "is spilling" : "is releasing water"}: about ${int(r.cusecs)} cusecs (${dayOf(r.day)}).`;
    const reply = `${r.name}: ${r.status}, about ${int(r.cusecs)} cusecs on ${dayOf(r.day)}${r.source ? ` (${r.source})` : ""}. The figure is the agency's daily reading, not live.${r.river ? ` Watch the ${r.river} gauges downstream.` : ""}`;
    return assemble({ body, short, link: r.url, must: [r.name], tags, reply: `${reply}\n${r.url}` });
  }
  const mk = (k: number) => `${rs.length} reservoirs are letting water out: ${listMore(rs.slice(0, k).map((r) => `${r.name} ${int(r.cusecs)} cusecs`), rs.length - k)} (${dayOf(rs[0].day)}).`;
  return assemble([3, 2, 1].map((k) => ({ body: mk(Math.min(k, rs.length)), link: rs[0].url, must: [rs[0].name], tags })));
}

export function composeReservoirStop(rs: { name: string; river: string | null; day: string; url: string }[]): Composed {
  const tags = ["#SriLanka"];
  const mk = (k: number) => (rs.length === 1 ? `${rs[0].name} reservoir has stopped letting water out (${dayOf(rs[0].day)}).` : `${listMore(rs.slice(0, k).map((r) => r.name), rs.length - k)}: reservoirs have stopped letting water out (${dayOf(rs[0].day)}).`);
  return assemble([3, 2, 1].map((k) => ({ body: mk(Math.min(k, rs.length)), link: rs[0].url, must: [rs[0].name], tags })));
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
    const names = listMore(f.atAlert.slice(0, 3).map((a) => a.station), f.atAlert.length - 3);
    parts.push(`${f.atAlert.length} of ${f.assessed} river gauges are at Alert level or higher: ${names}.`);
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
  const short = `${f.river}, ${clock(f.at)}: ${line(gs[0])}`;
  const reply = f.gauges.map((g) => `${g.station}: ${ft(g.level)}${g.alertMark != null ? ` (alert ${ft(g.alertMark)})` : ""}${trendWord(g.trend)}`).join("\n");
  return assemble({ body, short, link: f.url, must: [f.river, gs[0].station, "forecast"].filter((w, i) => i < 2 || gs[0].nextHour), tags: ["#SriLanka", riverTag(f.river)].filter(Boolean), reply: `${reply}\n${f.url}` }, isSerious(f.gauges));
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

/** Several rivers rising towards or past Alert at once: one national post instead of one per river. */
export type RiversRisingFact = { at: number; count: number; gauges: GaugeFact[]; url: string };

export function composeRiversRising(f: RiversRisingFact): Composed {
  const time = clock(f.at);
  const one = (g: GaugeFact) => `${g.river} at ${g.station} ${ft(g.level)}`;
  const shown = f.gauges.slice(0, 3);
  const more = f.count - shown.length;
  const mk = (k: number) => `${f.count} rivers are rising towards or past Alert level at ${time}: ${listMore(shown.slice(0, k).map(one), f.count - Math.min(k, shown.length))}.`;
  const short = `${f.count} rivers are rising towards Alert level: ${listMore(shown.slice(0, 3).map((g) => `${g.river} (${g.station})`), more)}.`;
  const variants: Parts[] = [{ body: mk(shown.length), short, link: f.url, must: [shown[0].station], tags: ["#SriLanka"] }];
  return assemble(variants, isSerious(f.gauges));
}

// ---- the language model writes the post (gpt-6-luna), the template is the fallback -------------------------------

const r1 = (n: number) => Math.round(n * 10) / 10;

const gaugeLuna = (g: GaugeFact) => ({
  station: g.station,
  river: g.river,
  status: g.tier === "normal" || g.tier === "watch" ? "below alert level" : TIER_MARK[g.tier],
  level_ft: r1(g.level),
  mark_ft: g.mark != null ? r1(g.mark) : undefined,
  alert_mark_ft: g.alertMark != null ? r1(g.alertMark) : undefined,
  trend: g.trend ?? undefined,
  next_hour_forecast: g.nextHour
    ? { level_ft: r1(g.nextHour.level), likely_low_ft: g.nextHour.low != null ? r1(g.nextHour.low) : undefined, likely_high_ft: g.nextHour.high != null ? r1(g.nextHour.high) : undefined, direction: g.nextHour.direction, may_cross: g.nextHour.crossing ? g.nextHour.crossing.replace(/^(expected to|may|will) reach/i, "could reach") : undefined }
    : undefined,
  time_sri_lanka: clock(g.at),
});

/** The compact JSON the model gets for one event (`type` is the engine's event type). Numbers are already rounded the way a post prints them. */
export function lunaFacts(type: string, f: any): Record<string, unknown> {
  switch (type) {
    case "gauge_rise": return { post: "river gauge rose to a flood mark", river: f[0].river, gauges: f.slice(0, 4).map(gaugeLuna) };
    case "rivers_rising": return { post: "several rivers are rising towards or past their alert marks at the same time (one national post, mention at most the rivers listed)", time_sri_lanka: clock(f.at), rivers_rising_total: f.count, other_rivers_not_listed: Math.max(0, f.count - f.gauges.slice(0, 3).length), rivers: f.gauges.slice(0, 3).map(gaugeLuna) };
    case "gauge_clear": return { post: "all clear: gauge back below the alert level", river: f[0].river, gauges: f.slice(0, 4).map(gaugeLuna) };
    case "storm": return { post: "storm-time river update", river: f.river, time_sri_lanka: clock(f.at), gauges: f.gauges.slice(0, 3).map(gaugeLuna) };
    case "reservoir_start": return { post: "reservoir started letting water out", reservoirs: f.slice(0, 3).map((r: ReservoirFact) => ({ name: r.name, river: r.river ?? undefined, status: r.status, cusecs: Math.round(r.cusecs), storage_percent: r.storagePercent != null ? Math.round(r.storagePercent) : undefined, reading_date: dayOf(r.day), source: r.source ?? undefined, note: "the agency's daily reading, not live" })) };
    case "reservoir_stop": return { post: "reservoir stopped letting water out", reservoirs: f.slice(0, 3).map((r: { name: string; river: string | null; day: string }) => ({ name: r.name, river: r.river ?? undefined, reading_date: dayOf(r.day) })) };
    case "warning": return { post: "relay of a new official flood bulletin (we are not its source)", source: f.source, severity: SEVERITY_TEXT[f.severity] ?? "flood warning", basins: f.basins.slice(0, 3), issued_sri_lanka_time: clock(f.issuedAt), release_cusecs: f.releaseCusecs != null ? Math.round(f.releaseCusecs) : undefined };
    case "summary": {
      const s = f as SummaryFact;
      return {
        post: s.period === "morning" ? "morning summary of all river gauges" : "evening summary of all river gauges",
        time_sri_lanka: clock(s.at), gauges_checked: s.assessed,
        gauges_at_alert_or_higher: s.atAlert.length, at_alert_stations: s.atAlert.slice(0, 3).map((a) => a.station),
        gauges_close_to_alert: s.nearAlert,
        rain_forecast: s.rain ? { heaviest_mm: Math.round(s.rain.mm), near: s.rain.place, next_hours: s.rainWindowH } : "no rain figure available",
        reservoirs_letting_water_out: s.spilling,
      };
    }
    case "rainwatch": return { post: "heavy rain forecast heads-up", rain_forecast_mm: Math.round(f.mm), near: f.place, next_hours: f.windowH, river_gauges_at_alert_or_higher: f.atAlert, time_sri_lanka: clock(f.at) };
    default: return { post: type, facts: f };
  }
}

/** The voice guide. The numbers in the EXAMPLES are made up and will never pass the checker if copied. */
export const LUNA_INSTRUCTIONS = `You write one short public post for @waterlevelslk, an automated account that shares river-level news for Sri Lanka.

VOICE
- You sound like a calm, caring local person who keeps an eye on the rivers. Not a bot, not a news wire, not a government notice.
- Short, plain English as Sri Lankans write it. Lead with what matters to people, e.g. "Kalu Ganga at Ratnapura is rising and just crossed the alert mark".
- No hype, no drama, no capital-letter shouting. All clears feel reassuring. Storm updates are concise and steady. The morning post is friendly.
- No emoji, except at most ONE of the two symbols 🌧️ or ⚠️ in an alert, storm or rain post. At most one hashtag, only from allowed_hashtags, and usually none.
- Never say "official" (the account's bio and pinned post already say it is not official), except when relaying a bulletin, to name it.

VARIETY (this account posts many times a day; the posts must not read like copies)
- recent_posts are what this account said last. Do not reuse ANY sentence or any run of six or more words from them (except the closing line). Change the order too: sometimes lead with the forecast, sometimes with the place, sometimes with the number, sometimes with a short human remark.
- Do not start like any recent post, and do not use the same tip or the same closing wording as the last two posts. Do not open with a clock time ("At 11:04 am, ..."): put the time inside the sentence or leave it out of the opening.
- An evening summary is a wrap-up of the day ("This evening", "Tonight", "As the day ends"); a morning summary is a greeting. Even when the numbers match an earlier post, the words must not: change the frame, e.g. lead with the rain or with one station instead of the count, say "above their alert marks" / "past the alert line" / "at or over alert" instead of repeating "are at alert level or higher", and use different verbs.
- A tip is optional: use one in at most one post out of three, and only when it adds something. Never write "Take care near the river" or "Take care near the water" (overused). Rotate between very different kinds, e.g. "worth a look if you live along it", "I'll check again in an hour", "no need to do anything yet, just good to know", "pass it on to family downstream", "if you're travelling through Ratnapura tonight, allow some extra time", or none at all. Tips stay generic and never go beyond the facts (no evacuation advice unless the facts say evacuation).

CLOSING (the input field "closing" tells you which)
- none (most posts: summaries, alert-level rises, all-clears, reservoirs, calm storm updates): end the post with your last useful sentence. No "Not an official warning", no "Emergency: 117", no 117 at all. The bio and the pinned post already say it.
- short (only when flood risk is serious: Minor or Major flood level, or a forecast that the river could reach one): end with a very short line, "Emergency: 117." or "Unofficial · 117." (use either, varying it naturally). Nothing longer, never "Not an official warning".
- relay (passing on an official bulletin): say we are only passing it on and are not the source, plus 117, e.g. "We're only passing this on, not the source. Emergency: 117."

FACTS ARE THE LAW
- Use only the facts in the JSON. Every number, time, place and river you write must come from it. Copy numbers as given (ft, cusecs, mm, %). Write times exactly as given in time_sri_lanka (e.g. "4:10 pm"). Do not add numbers of your own, no dates other than the ones given, no causes.
- Forecasts are only forecasts. Give the next-hour figure as "about" with the likely range if one is given. If may_cross is given, say the river "could reach" or "may reach" that level in the next hour (never "reaching" or "to reach" without could/may). NEVER write "expected to reach", "will reach", "will cross", "will flood" or any other certain wording about the future.
- If a status is "alert level" do not call it minor or major flood; use the status word as given. Do not say rising unless the facts say rising (or the post is about a gauge that just rose).
- Never talk about street flooding, low-lying ground, canals or what the rain will do to streets. Only rivers, gauges, reservoirs and rain amounts.
- No links, no @mentions. The link (if any) is added for you.

LENGTH: the hard limit is max_characters (260) characters in total including any closing line. Aim for 200 to 250. Count before you answer; if it is close, drop a clause. Never go over.

SHAPE BY KIND
- alert or storm about one river: the place and what happened, the number, at most one forecast sentence, the closing. Two or three short sentences before the closing at most.
- several rivers rising (rivers_rising_total): ONE short national post: how many rivers are rising towards or past their alert marks, name only the rivers listed (at most 3, each with its station and level), and "and N more" only if other_rivers_not_listed is above zero. No forecasts.
- morning or evening summary: name at most 3 stations, one rain sentence (the heaviest figure only), and leave out the reservoir count unless it is zero or short to say. One or two sentences before the closing.
- reservoir, clear, warning: one or two sentences.

EXAMPLES (all numbers below are MADE UP for illustration; never copy them, use only the facts you are given):
alert (closing none):
- Kalu Ganga at Ratnapura is rising and just crossed the alert mark: 21.3 ft at 4:10 pm (mark 21 ft).
- Hanwella on the Kelani Ganga has crossed the alert mark, 28.4 ft at 9:40 pm and still climbing slowly. Worth a look if you live along it.
alert (closing short, because Minor/Major or "could reach"):
- Hanwella on the Kelani Ganga has reached the minor flood level, 31.2 ft at 9:40 pm and still climbing slowly. Emergency: 117.
- Ratnapura is at 21.3 ft and rising, about 21.9 ft in the next hour (likely 21.6 to 22.2), and it could reach the minor flood level. Unofficial · 117.
- ⚠️ Major flood level at Nagalagam Street on the Kelani Ganga: 8.9 ft at 6:15 am. Please keep away from the river edge and check back soon. Emergency: 117.
clear (closing none):
- Good news from Ratnapura: the Kalu Ganga is back below the alert mark, 19.8 ft at 7:30 am and easing.
- Glencourse has dropped under the alert level again (5.1 ft at 2:05 pm). Nothing to worry about from the gauge right now.
reservoir (closing none):
- Deduru Oya reservoir is spilling, about 1,250 cusecs in the 25 Oct reading. That water goes into the Deduru Oya, so people along it may want to check in today.
- Castlereagh has stopped letting water out (24 Oct reading).
warning (closing relay):
- The Irrigation Department has put out a flood alert for the Kalu Ganga basin, issued at 3:20 pm, and mentions a release of about 9,000 cusecs. Please follow their instructions. We're only passing it on, not the source. Emergency: 117.
morning (closing none):
- Morning! All 38 gauges are below their alert marks today, and not much rain is forecast. Have a good one.
- Morning. 2 of 38 gauges are at alert level or higher (Hanwella and Glencourse), 1 more is close, and up to 60 mm of rain is forecast near Ratnapura.
storm (closing none, or short when serious):
- Kelani Ganga at 8:00 pm: Hanwella is over the alert mark at 28.4 ft and still rising. Forecast for the next hour is about 28.9 ft (likely 28.6 to 29.2).
- Quick update on the Kalu Ganga, 9:00 pm: Ratnapura 22.1 ft, steady just above the alert mark. Forecast next hour about 22.2 ft.
several rivers (closing none, or short when serious):
- Rivers are rising across the south-west at 4:10 pm: Kalu Ganga at Ratnapura 21.3 ft, Kelani Ganga at Hanwella 28.4 ft and Gin Ganga at Baddegama 10.2 ft, plus 2 more.
rain (closing none):
- Heavy rain is forecast near Ratnapura, up to 120 mm over the next 24 hours 🌧️. No river gauge is at alert level yet. Forecasts can change.

Answer with JSON {"text": "..."} holding only the post text.`;

const GENERIC_MUST = new Set(["alert", "minor", "major", "clear", "forecast"]);
const ALLOWED_EMOJI = new Set(["\u{1F327}", "⚠"]);

/** "2.30pm" / "2:30 PM" -> "2:30 pm", so a time written another way reads as the same numbers. */
const normaliseTimes = (t: string) => t.replace(/\b(\d{1,2})[.:](\d{2})\s*([ap])\.?m\b\.?/gi, (_, h: string, m: string, a: string) => `${Number(h)}:${m} ${a.toLowerCase()}m`);

/** Words of a text for comparing posts: links and the closing (disclaimer) sentences removed, "21.3" and "4:10" kept whole. A word is "lower case|CAP": names and numbers are flagged because a list of them is dictated by the facts. */
const sentencesOf = (t: string): string[][] =>
  t.replace(URL_RE, " ").split(/\n|(?<!\d)[.!?]+(?!\d)/)
    .filter((x) => !/official|\b117\b|not the (original )?source/i.test(x))
    .map((x) => (x.match(/[\p{L}\p{N}]+(?:[.:'][\p{L}\p{N}]+)*/gu) ?? []).map((w) => (/^[\p{Lu}\p{N}]/u.test(w) ? "^" : "") + w.toLowerCase()));

const UNIT_WORDS = new Set(["ft", "mm", "cusecs", "hours", "hour", "pm", "am", "next", "near", "over", "forecast", "about", "likely"]);

/** A sentence (4+ words) or a run of 6+ words that this text shares with any of the recent posts, or null. Runs that are mostly names, or hold two numbers, are dictated by the facts and do not count. */
export function sharedWithRecent(text: string, recent: string[]): string | null {
  const mine = sentencesOf(text);
  const plain = (ws: string[]) => ws.map((w) => w.replace(/^\^/, "")).join(" ");
  const grams = (ws: string[]) => { const o: string[][] = []; for (let i = 0; i + 6 <= ws.length; i++) o.push(ws.slice(i, i + 6)); return o.filter((g) => { const names = g.filter((w) => w.startsWith("^")).length; return !(names >= 4 || g.filter((w) => /^\^\d/.test(w)).length >= 2 || (names >= 2 && g.filter((w) => UNIT_WORDS.has(w)).length >= 2)); }).map(plain); };
  for (const r of recent) {
    const theirs = sentencesOf(r);
    const sents = new Set(theirs.filter((w) => w.length >= 4).map(plain));
    const gs = new Set(theirs.flatMap(grams));
    for (const w of mine) {
      if (w.length >= 4 && sents.has(plain(w))) return plain(w);
      const hit = grams(w).find((g) => gs.has(g));
      if (hit) return hit;
    }
  }
  return null;
}

const openingOf = (t: string) => t.replace(URL_RE, " ").toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").split(/\s+/).filter(Boolean).slice(0, 3).join(" ");

export type LunaCtx = {
  type: string;
  /** The compact facts the model was given (what numbers are checked against). */
  facts: unknown;
  link: string;
  withLink: boolean;
  hashtags: string[];
  must: string[];
  recent: string[];
  relay?: boolean;
  /** Minor / Major, or a forecast that could reach one: needs the short "Emergency: 117" closing. */
  serious?: boolean;
};

/** Why model text may not go out (text is the full post, link included when it has one); empty = fine. */
export function validateLlmText(text: string, c: LunaCtx): string[] {
  const problems: string[] = [];
  const factsLow = JSON.stringify(c.facts).toLowerCase();
  const body = text.replace(c.withLink ? c.link : "\u0000", " ");
  if (tweetLength(text) > MAX_TWEET) problems.push(`too long (${tweetLength(text)} characters, the limit is ${MAX_TWEET})`);
  if (c.withLink ? !text.includes(c.link) : false) problems.push("link missing");
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|lk|gov|org|net|app|io|ly)\b/i.test(body)) problems.push("contains a link or web address");
  if (/@\w/.test(text)) problems.push("contains an @mention");
  const ok = allowedNumbers(c.facts);
  for (const n of new Set(numbersIn(normaliseTimes(body)))) if (!ok.has(n)) problems.push(`number ${n} is not in the facts`);
  const WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  for (const w of new Set(body.toLowerCase().match(/\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g) ?? [])) if (!ok.has(WORDS[w])) problems.push(`number "${w}" is not in the facts`);
  if (c.relay) {
    if (!/\b117\b/.test(text)) problems.push("emergency number 117 missing");
    if (!/not the (original )?source/i.test(text)) problems.push('closing must say we are "not the source"');
  } else if (c.serious) {
    if (!/\b117\b/.test(text)) problems.push('serious flood risk: end with the short closing "Emergency: 117." (or "Unofficial · 117.")');
    if (/\bofficial/i.test(text)) problems.push('do not write "official" / "not an official warning": the short closing is only "Emergency: 117." or "Unofficial · 117."');
  } else if (/\bofficial|\bemergency/i.test(text)) problems.push("routine post: no disclaimer or emergency line (the bio and pinned post already say it)");
  const low = body.toLowerCase();
  for (const w of c.must) if (!low.includes(w.toLowerCase())) problems.push(`"${w}" missing`);
  const tags = text.match(TAG_RE) ?? [];
  if (tags.length > 1) problems.push("more than one hashtag");
  for (const t of tags) if (!c.hashtags.includes(t)) problems.push(`unexpected hashtag ${t}`);
  const emoji = text.match(EMOJI_RE) ?? [];
  if (emoji.length > 1) problems.push("more than one emoji");
  for (const e of emoji) if (!ALLOWED_EMOJI.has(e)) problems.push(`emoji ${e} not allowed`);
  if (emoji.length && ["gauge_clear", "summary", "reservoir_stop"].includes(c.type)) problems.push("no emoji in this kind of post");
  for (const w of ["major", "minor"]) if (new RegExp(`\\b${w}\\b`, "i").test(body) && !factsLow.includes(w)) problems.push(`says "${w}" but the facts do not`);
  if (/evacuat/i.test(body) && !factsLow.includes("evacuat")) problems.push("mentions evacuation, which the facts do not");
  if (/\b(rising|rose|risen|climbing|surging|swelling)\b/i.test(body) && !factsLow.includes("rising") && !["gauge_rise", "rivers_rising"].includes(c.type)) problems.push("says the water is rising but the facts do not");
  if (/\b(falling|dropping|receding|easing|going down)\b/i.test(body) && !factsLow.includes("falling") && !["gauge_clear", "reservoir_stop"].includes(c.type)) problems.push("says the water is falling but the facts do not");
  const lowSpot = body.match(/low[- ]?(spots?|ground|lying)|\bcanals?\b|street[- ]flood|flooded (streets|roads)|water on the (streets|roads)|flood(ing)? (on|in) the (streets|roads)/i);
  if (lowSpot && !factsLow.includes(lowSpot[0].toLowerCase())) problems.push(`talks about "${lowSpot[0]}": only rivers, gauges, reservoirs and rain amounts`);
  if (c.type === "summary" && /\b(calm|all clear|all (of )?\d+ gauges are below)/i.test(body) && /"gauges_at_alert_or_higher":[1-9]/.test(JSON.stringify(c.facts))) problems.push("calls it calm but some gauges are at alert level or higher");
  if (/\b(expected to (reach|cross|hit|exceed)|will (reach|cross|hit|exceed|flood|overflow)|going to (reach|flood))\b/i.test(body)) problems.push('states a forecast as certain ("expected to reach" / "will reach" / "will flood"): say "could reach" or "may reach"');
  if (/(?<!could |may |might |has |have |just |already )\b(reach(es|ing)?|cross(es|ing)?|hit(s|ting)?)\s+(the\s+|its\s+)?(minor|major)\b/i.test(body)) problems.push('states a forecast crossing as certain ("reaching minor flood level"): say "could reach" or "may reach"');
  const shared = sharedWithRecent(text, c.recent);
  if (shared) problems.push(`repeats wording from a recent post ("${shared}"): say it differently, change the structure and the tip`);
  const open = openingOf(text);
  if (open && c.recent.some((r) => openingOf(r) === open)) problems.push(`starts with the same words as a recent post ("${open}"): begin differently`);
  return problems;
}

/** What the model is told the limit is: 20 characters under the real one, because it counts badly. */
export const MODEL_TARGET = 260;

export type LunaResult = { text: string; used: "llm" | "template"; why?: string; attempts: number };

/**
 * Asks the model to write the post from compact facts. Up to 3 tries (each retry gets the problems and the previous answer; a too-long answer is asked to be shorter);
 * if both fail, or there is no model, the template text is returned. Never throws.
 * @param post     the composed template post (fallback + hashtags + link + must words)
 * @param o.type   the engine's event type (gauge_rise, storm, summary ...)
 * @param o.facts  the event's raw facts (turned into compact JSON by lunaFacts)
 * @param o.recent the last few posts' texts, so the model varies its openings
 */
export async function lunaWrite(post: Post, o: { type: string; facts: unknown; recent?: string[]; withLink: boolean; llm: Llm | null; offReason?: string }): Promise<LunaResult> {
  const fallback = o.withLink ? post.text : post.textNoLink;
  if (!o.llm) return { text: fallback, used: "template", why: o.offReason ?? "no model configured", attempts: 0 };
  const compact = lunaFacts(o.type, o.facts);
  const recent = (o.recent ?? []).slice(0, 5);
  const relay = o.type === "warning";
  const ctx: LunaCtx = {
    type: o.type, facts: compact, link: post.link, withLink: o.withLink, hashtags: post.hashtags.slice(0, 2), recent, relay, serious: !!post.serious,
    must: (relay ? post.must.slice(1) : post.must).filter((w) => w && !GENERIC_MUST.has(w.toLowerCase())).slice(0, 2),
  };
  const max = MODEL_TARGET - (o.withLink ? TCO_LENGTH + 1 : 0); // told to the model; the checker's hard limit stays 280
  const input = { kind: post.kind, closing: relay ? "relay: say we are only passing it on, not the source, plus 117" : post.serious ? 'short: end with "Emergency: 117." or "Unofficial · 117." (no other disclaimer)' : "none: do not add any disclaimer, emergency line or 117", max_characters: max, allowed_hashtags: ctx.hashtags, facts: compact, recent_posts: recent.map((r) => r.replace(URL_RE, "").trim()) };
  let last = "";
  let problems: string[] = [];
  const seen = new Set<string>(); // every problem found so far, so the 3rd try also avoids what the 1st one did
  // Up to 3 calls: the 2nd gets the problems; a 3rd gets the problems again, and a shorter-please when it was too long.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const payload = attempt === 1 ? input : { ...input, your_previous_answer: last, problems_to_fix: [...seen], ...(problems.some((x) => /too long/.test(x)) ? { shorten: `Cut it to at most ${max} characters: fewer clauses, one sentence less.` } : {}) };
    let out: string | null = null;
    try {
      out = await o.llm(LUNA_INSTRUCTIONS, JSON.stringify(payload));
    } catch {
      return { text: fallback, used: "template", why: "model call failed", attempts: attempt };
    }
    if (!out) return { text: fallback, used: "template", why: "model gave nothing", attempts: attempt };
    last = out.trim().replace(/^["“]|["”]$/g, "").trim();
    const full = o.withLink ? `${last}\n${post.link}` : last;
    problems = validateLlmText(full, ctx);
    problems.forEach((x) => seen.add(x));
    if (!problems.length) return { text: full, used: "llm", attempts: attempt };
  }
  return { text: fallback, used: "template", why: `model text rejected 3 times: ${problems.join("; ")}`, attempts: 3 };
}
