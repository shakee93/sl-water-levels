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
    return `${river}: ${gs.length} gauges are at Alert level or higher (${listMore(names, more)}) at ${time}.`;
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
    ? { level_ft: r1(g.nextHour.level), likely_low_ft: g.nextHour.low != null ? r1(g.nextHour.low) : undefined, likely_high_ft: g.nextHour.high != null ? r1(g.nextHour.high) : undefined, direction: g.nextHour.direction, crossing: g.nextHour.crossing ?? undefined }
    : undefined,
  time_sri_lanka: clock(g.at),
});

/** The compact JSON the model gets for one event (`type` is the engine's event type). Numbers are already rounded the way a post prints them. */
export function lunaFacts(type: string, f: any): Record<string, unknown> {
  switch (type) {
    case "gauge_rise": return { post: "river gauge rose to a flood mark", river: f[0].river, gauges: f.slice(0, 4).map(gaugeLuna) };
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
- Add one concrete, gentle tip only when it helps (e.g. "if you're near the river in Ratnapura, keep an eye on it this evening"). Tips stay generic: keep an eye on it, take care near the water, check again later. Never give instructions the facts do not support (no evacuation advice unless the facts say evacuation).
- No hype, no drama, no capital-letter shouting. All clears should feel reassuring. Storm updates are concise and steady. The morning post is friendly ("Morning! Rivers are calm across the island today...").
- No emoji, except at most ONE of the two symbols 🌧️ or ⚠️ in an alert, storm or rain post. At most one hashtag, only from allowed_hashtags, and usually none.
- Vary how you begin. recent_posts shows what this account said last: do not start with the same words as any of them, and do not reuse their phrasing.
- Never say "official" except inside the closing line (and when relaying a bulletin, to name it).

FACTS ARE THE LAW
- Use only the facts in the JSON. Every number, time, place and river you write must come from it. Copy numbers as given (ft, cusecs, mm, %). Write times exactly as given in time_sri_lanka (e.g. "4:10 pm"). Do not add numbers of your own, no dates other than the ones given, no causes, no guesses about what will happen later.
- Forecasts are forecasts: call them a forecast and give them as "about" with the likely range if one is given.
- If a status is "alert level" do not call it minor or major flood; use the status word as given. Do not say rising unless the facts say rising (or the post is about a gauge that just rose).
- Never talk about street flooding, low-lying ground, canals or what the rain will do to streets. Only rivers, gauges, reservoirs and rain amounts.
- No links, no @mentions. The link (if any) is added for you.

CLOSING
End with a short natural line that says it is not an official warning and gives the emergency number 117, e.g. "Not an official warning. Emergency: 117." or "Just what the gauge says, not an official warning. Emergency: 117." For a relayed bulletin say that we are only passing it on and are not the source, plus 117, e.g. "We're only passing this on, not the source. Emergency: 117."

LENGTH: at most max_characters characters including the closing line.

EXAMPLES (all numbers below are MADE UP for illustration; never copy them, use only the facts you are given):
alert:
- Kalu Ganga at Ratnapura is rising and just crossed the alert mark: 21.3 ft at 4:10 pm (mark 21 ft). If you're near the river in Ratnapura, keep an eye on it this evening. Not an official warning. Emergency: 117.
- Hanwella on the Kelani Ganga has reached the minor flood level, 31.2 ft at 9:40 pm and still climbing slowly. Take care near the water tonight. Just the gauge reading, not an official warning. Emergency: 117.
- ⚠️ Major flood level at Nagalagam Street on the Kelani Ganga: 8.9 ft at 6:15 am. Please stay away from the river edge and keep checking back. Not an official warning. Emergency: 117.
clear:
- Good news from Ratnapura: the Kalu Ganga is back below the alert mark, 19.8 ft at 7:30 am and easing. Still worth a glance if you live by the river. Not an official warning. Emergency: 117.
- Glencourse has dropped under the alert level again (5.1 ft at 2:05 pm). Nothing to worry about from the gauge right now. Not an official warning. Emergency: 117.
reservoir:
- Deduru Oya reservoir is spilling, about 1,250 cusecs in the 25 Oct reading. That water goes into the Deduru Oya, so if you live along it keep an eye on the river today. Not an official warning. Emergency: 117.
- Good to know: Castlereagh has stopped letting water out (24 Oct reading). Not an official warning. Emergency: 117.
warning:
- The Irrigation Department has put out a flood alert for the Kalu Ganga basin, issued at 3:20 pm, and mentions a release of about 9,000 cusecs. Please follow their instructions. We're only passing it on, not the source. Emergency: 117.
morning:
- Morning! Rivers are calm across the island today: all 38 gauges are below their alert marks, and not much rain is expected in the next 24 hours. Have a good one. Not an official warning. Emergency: 117.
- Morning. 2 of 38 river gauges are at alert level or higher, Hanwella and Glencourse, and 1 more is close. Rain of up to 60 mm is forecast near Ratnapura. Worth a look if you live on the Kelani Ganga. Not an official warning. Emergency: 117.
storm:
- Kelani Ganga at 8:00 pm: Hanwella is over the alert mark at 28.4 ft and still rising. Forecast for the next hour is about 28.9 ft (likely 28.6 to 29.2). Not an official warning. Emergency: 117.
- Quick update on the Kalu Ganga, 9:00 pm: Ratnapura 22.1 ft, steady just above the alert mark. Forecast next hour about 22.2 ft. Take care near the river. Not an official warning. Emergency: 117.
rain:
- Heavy rain is forecast near Ratnapura, up to 120 mm over the next 24 hours 🌧️. No river gauge is at alert level yet. Forecasts can change. Not an official warning. Emergency: 117.

Answer with JSON {"text": "..."} holding only the post text.`;

const GENERIC_MUST = new Set(["alert", "minor", "major", "clear", "forecast"]);
const ALLOWED_EMOJI = new Set(["\u{1F327}", "⚠"]);

/** "2.30pm" / "2:30 PM" -> "2:30 pm", so a time written another way reads as the same numbers. */
const normaliseTimes = (t: string) => t.replace(/\b(\d{1,2})[.:](\d{2})\s*([ap])\.?m\b\.?/gi, (_, h: string, m: string, a: string) => `${Number(h)}:${m} ${a.toLowerCase()}m`);

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
  if (!/\b117\b/.test(text)) problems.push("emergency number 117 missing");
  if (c.relay ? !/not the (original )?source/i.test(text) : !/not (an )?official/i.test(text)) problems.push(c.relay ? 'closing must say we are "not the source"' : 'closing must say "not an official warning"');
  const low = body.toLowerCase();
  for (const w of c.must) if (!low.includes(w.toLowerCase())) problems.push(`"${w}" missing`);
  const tags = text.match(TAG_RE) ?? [];
  if (tags.length > 1) problems.push("more than one hashtag");
  for (const t of tags) if (!c.hashtags.includes(t)) problems.push(`unexpected hashtag ${t}`);
  const emoji = text.match(EMOJI_RE) ?? [];
  if (emoji.length > 1) problems.push("more than one emoji");
  for (const e of emoji) if (!ALLOWED_EMOJI.has(e)) problems.push(`emoji ${e} not allowed`);
  if (emoji.length && ["gauge_clear", "summary", "reservoir_stop"].includes(c.type)) problems.push("no emoji in this kind of post");
  if (!c.relay && /official/i.test(text.replace(/not (an )?official( warning)?/gi, " "))) problems.push('says "official" outside the closing line');
  for (const w of ["major", "minor"]) if (new RegExp(`\\b${w}\\b`, "i").test(body) && !factsLow.includes(w)) problems.push(`says "${w}" but the facts do not`);
  if (/evacuat/i.test(body) && !factsLow.includes("evacuat")) problems.push("mentions evacuation, which the facts do not");
  if (/\b(rising|rose|risen|climbing|surging|swelling)\b/i.test(body) && !factsLow.includes("rising") && c.type !== "gauge_rise") problems.push("says the water is rising but the facts do not");
  if (/\b(falling|dropping|receding|easing|going down)\b/i.test(body) && !factsLow.includes("falling") && !["gauge_clear", "reservoir_stop"].includes(c.type)) problems.push("says the water is falling but the facts do not");
  const lowSpot = body.match(/low[- ]?(spots?|ground|lying)|\bcanals?\b|street[- ]flood|flooded (streets|roads)|water on the (streets|roads)|flood(ing)? (on|in) the (streets|roads)/i);
  if (lowSpot && !factsLow.includes(lowSpot[0].toLowerCase())) problems.push(`talks about "${lowSpot[0]}": only rivers, gauges, reservoirs and rain amounts`);
  if (c.type === "summary" && /\b(calm|all clear|all (of )?\d+ gauges are below)/i.test(body) && /"gauges_at_alert_or_higher":[1-9]/.test(JSON.stringify(c.facts))) problems.push("calls it calm but some gauges are at alert level or higher");
  const open = openingOf(text);
  if (open && c.recent.some((r) => openingOf(r) === open)) problems.push(`starts with the same words as a recent post ("${open}"): begin differently`);
  return problems;
}

export type LunaResult = { text: string; used: "llm" | "template"; why?: string; attempts: number };

/**
 * Asks the model to write the post from compact facts. Up to 2 tries (the second gets the problems and the first answer);
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
    type: o.type, facts: compact, link: post.link, withLink: o.withLink, hashtags: post.hashtags.slice(0, 2), recent, relay,
    must: (relay ? post.must.slice(1) : post.must).filter((w) => w && !GENERIC_MUST.has(w.toLowerCase())).slice(0, 2),
  };
  const max = MAX_TWEET - (o.withLink ? TCO_LENGTH + 1 : 0);
  const input = { kind: post.kind, max_characters: max, allowed_hashtags: ctx.hashtags, facts: compact, recent_posts: recent.map((r) => r.replace(URL_RE, "").trim()) };
  let last = "";
  let problems: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const payload = attempt === 1 ? input : { ...input, your_previous_answer: last, problems_to_fix: problems };
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
    if (!problems.length) return { text: full, used: "llm", attempts: attempt };
  }
  return { text: fallback, used: "template", why: `model text rejected twice: ${problems.join("; ")}`, attempts: 2 };
}
