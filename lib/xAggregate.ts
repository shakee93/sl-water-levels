// One post per run (owner, 27 Oct 2026: "if there are multiple tweets, aggregate it ... so we don't keep spamming").
// Pure: takes the events scripts/x-engine.mjs found and returns ONE combined post, most severe first. No I/O, no clock;
// scripts/x-aggregate.test.mts drives it, scripts/x-post.mjs sends it.
//
// Length: X_LONG_POSTS=1 (an X Premium account: up to 25,000 characters through the API) lifts the limit; otherwise the
// 280 weighted-character limit applies (links = 23, see tweetLength) and, when the lines do not fit, the most severe
// ones are kept and the post ends "+N more on waterlevels.lk". Never a thread.
// @ts-ignore node strip-types needs explicit extensions
import { MAX_TWEET, tweetLength, clock, allowedNumbers, numbersIn, ALWAYS_OK_NUMBERS } from "./xCompose.ts";

export const LONG_TWEET = 25_000;
/** Long posts (X_LONG_POSTS=1) stay short and human: aim for 400-700 characters, name at most 10 places. */
export const LONG_SOFT = 700;
/** Places named at most in a long post (a wall of text is no use either); the rest become "and N more". */
export const LONG_MAX_ITEMS = 10;
/** A post went out less than this long ago: routine updates wait and fold into the next combined post. */
export const MIN_GAP_MS = 45 * 60_000;
/** A held update older than this is dropped (the gauge has moved on; the next run says what is true now). */
export const DEFER_MAX_AGE_MS = 3 * 3_600_000;

const LEVEL: Record<string, number> = { normal: 0, watch: 1, alert: 2, minor: 3, major: 4 };
const lvl = (t: string) => LEVEL[t] ?? 0;
const ft = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)} ft`;
const int = (n: number) => Math.round(n).toLocaleString("en-US");
const LABEL = ["", "Watch", "Alert", "Minor flood", "Major flood"];

type Ev = any;
export type Item = { line: string; severity: number; serious: boolean };

/** Urgent = may go out at once even right after another post: Minor / Major crossed, or an official warning. */
export function isUrgentNow(ev: Ev): boolean {
  if (ev.type === "gauge_rise") return ev.gauges.some((g: any) => lvl(g.tier) >= 3);
  if (ev.type === "warning") return true;
  return false;
}

/**
 * Held updates are re-read against the current snapshot before they are used (a level from 45 minutes ago is never shown as
 * current). Per gauge, matched by station name: found -> the fresh level / tier / trend / time; the gauge has dropped below
 * the event's threshold (a rise below its tier, a storm gauge back to normal, an all-clear that is Alert again) -> dropped,
 * and an event left with no gauge is dropped; no fresh reading -> kept as it was, flagged `stale` so the line shows its time.
 * Events without gauges (reservoirs, warnings, summary) pass through. `stations` null = nothing could be read: all stale.
 */
export function refreshEvents(events: Ev[], stations: any[] | null): Ev[] {
  const out: Ev[] = [];
  for (const ev of events) {
    const key = ev.type === "gauge_rise" || ev.type === "gauge_clear" ? "gauges" : ev.type === "storm" ? "storm" : ev.type === "rivers_rising" ? "rivers" : null;
    if (!key) { out.push(ev); continue; }
    const list: any[] = key === "gauges" ? ev.gauges : key === "storm" ? ev.storm.gauges : ev.rivers.gauges;
    const kept: any[] = [];
    for (const g of list) {
      const f = (stations ?? []).find((x) => x.station === g.station && x.river === g.river && typeof x.level === "number" && x.observedAt && x.unit === "ft" && x.status in LEVEL);
      if (!f) { kept.push({ ...g, stale: true }); continue; }
      const now = lvl(f.status);
      if (ev.type === "gauge_rise" && now < lvl(g.tier)) continue;
      if (ev.type === "storm" && now < 1) continue;
      if (ev.type === "rivers_rising" && now < 1) continue;
      if (ev.type === "gauge_clear" && now >= 2) continue;
      kept.push({ ...g, tier: f.status, level: f.level, trend: f.trend, at: Date.parse(f.observedAt), stale: false, nextHour: f.nextHour ? { level: f.nextHour.level_ft, low: f.nextHour.low_ft, high: f.nextHour.high_ft, direction: f.nextHour.direction, crossing: f.nextHour.crossing } : null });
    }
    if (!kept.length) continue;
    out.push(key === "gauges" ? { ...ev, gauges: kept } : key === "storm" ? { ...ev, storm: { ...ev.storm, gauges: kept } } : { ...ev, rivers: { ...ev.rivers, gauges: kept } });
  }
  return out;
}

/** The newest reading time among the events (gauge readings, the summary's time), or null. */
export function newestReading(events: Ev[]): number | null {
  const ts: number[] = [];
  for (const ev of events) {
    const gs: any[] = ev.gauges ?? ev.storm?.gauges ?? ev.rivers?.gauges ?? [];
    for (const g of gs) if (typeof g.at === "number") ts.push(g.at);
    if (ev.summary?.at) ts.push(ev.summary.at);
  }
  return ts.length ? Math.max(...ts) : null;
}

/** "Kelani Ganga" -> "Kelani", "Mahaweli Ganga" -> "Mahaweli"; Oya names stay ("Maha Oya"). */
export const riverName = (r: string) => `the ${r.replace(/\s+Ganga$/i, "").trim()}`;
const joinList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** One sentence that says the same thing about several places; `entries` can be cut from the end, `say(k)` writes the first k. */
export type Group = { river?: boolean; rain?: boolean; severity: number; serious: boolean; entries: number; say: (k: number) => string };

/**
 * The sentences of a batch of events, most severe first. Rivers at the same step share a sentence ("X and Y have reached
 * alert level"); one gauge per river (its worst); a held reading with no fresh data shows its own time.
 */
export function groupsOf(events: Ev[]): Group[] {
  const groups: Group[] = [];
  // all gauge-bearing events of one river become one entry (a rise and a storm update for the same river say one thing)
  const rivers = new Map<string, Map<string, any>>();
  const clears = new Map<string, any>();
  for (const ev of events) {
    const gs: any[] | null = ev.type === "gauge_rise" ? ev.gauges : ev.type === "storm" ? ev.storm.gauges : ev.type === "rivers_rising" ? ev.rivers.gauges : null;
    if (gs) {
      for (const g of gs) {
        const m = rivers.get(g.river) ?? new Map();
        const old = m.get(g.station);
        if (!old || (g.at ?? 0) >= (old.at ?? 0)) m.set(g.station, g);
        rivers.set(g.river, m);
      }
    } else if (ev.type === "gauge_clear") for (const g of ev.gauges) if (!clears.has(g.river) || g.level > clears.get(g.river).level) clears.set(g.river, g);
  }
  const reading = (g: any) => `${ft(g.level)}${g.stale ? ` at ${clock(g.at)}` : ""}`;
  const place = (g: any) => `${riverName(g.river)} at ${g.station} (${reading(g)})`;
  const byStep = new Map<number, any[]>();
  for (const m of rivers.values()) {
    const g = [...m.values()].sort((a, b) => lvl(b.tier) - lvl(a.tier) || b.level - a.level)[0];
    byStep.set(lvl(g.tier), [...(byStep.get(lvl(g.tier)) ?? []), g]);
  }
  const crossing = [...rivers.values()].some((m) => [...m.values()].some((g) => /minor|major/i.test(g.nextHour?.crossing ?? "")));
  for (const step of [4, 3, 2, 1, 0]) {
    const gs = (byStep.get(step) ?? []).sort((a, b) => b.level / (b.alertMark || 1) - a.level / (a.alertMark || 1));
    if (!gs.length) continue;
    const flood = step >= 3;
    const word = step === 4 ? "in major flood" : step === 3 ? "in minor flood" : step === 2 ? "reached alert level" : "rising";
    groups.push({
      river: true, severity: 50 + step * 10, serious: flood || (step === 2 && crossing), entries: gs.length,
      say: (k) => {
        const l = gs.slice(0, k);
        if (l.length === 1) {
          const g = l[0];
          const rising = /rising/.test(g.trend ?? "") && !g.stale;
          if (flood) return `${cap(riverName(g.river))} is ${word} at ${g.station} (${reading(g)})${rising ? " and still rising" : ""}.`;
          return `${cap(place(g))} ${step === 2 ? "has " : "is "}${word}${step < 2 || !rising ? "" : step === 2 ? " and is still rising" : " and still rising"}.`;
        }
        return `${cap(joinList(l.map(place)))} ${flood ? "are" : step === 2 ? "have" : "are"} ${word}.`;
      },
    });
  }
  for (const ev of events) {
    if (ev.type === "warning") {
      const w = ev.warning;
      groups.push({ severity: 100 + (w.severity === "alert" ? 0 : 10), serious: w.severity !== "alert", entries: 1, say: () => `The ${w.source} has issued a ${w.severity} warning for the ${joinList(w.basins.slice(0, 2).map((b: string) => b.replace(/\s+Ganga$/i, "")))}${w.releaseCusecs ? `, with ${int(w.releaseCusecs)} cusecs being released` : ""}.` });
    } else if (ev.type === "reservoir_start") {
      const rs = ev.reservoirs;
      groups.push({ severity: 30, serious: false, entries: rs.length, say: (k) => { const l = rs.slice(0, k); return `${joinList(l.map((r: any) => `${r.name} (${int(r.cusecs)} cusecs)`))} ${l.length === 1 ? "is" : "are"} letting water out.`; } });
    } else if (ev.type === "reservoir_stop") {
      const rs = ev.reservoirs;
      groups.push({ severity: 12, serious: false, entries: rs.length, say: (k) => { const l = rs.slice(0, k); return `${joinList(l.map((r: any) => r.name))} ${l.length === 1 ? "has" : "have"} stopped letting water out.`; } });
    } else if (ev.type === "rainwatch") {
      groups.push({ rain: true, severity: 40, serious: false, entries: 1, say: () => `Heavy rain is forecast near ${ev.rainwatch.place}, up to ${int(ev.rainwatch.mm)} mm in the next ${ev.rainwatch.windowH} hours.` });
    } else if (ev.type === "summary") {
      const s = ev.summary;
      const gaugeLines = rivers.size > 0;
      const bits = [!gaugeLines ? (s.atAlert.length ? `${s.atAlert.length} of ${s.assessed} river gauges are at alert level or higher.` : `All ${s.assessed} river gauges are below alert level.`) : null, s.rain && s.rain.mm >= 5 ? `Up to ${int(s.rain.mm)} mm of rain is forecast near ${s.rain.place} in the next ${s.rainWindowH} hours.` : null].filter(Boolean) as string[];
      if (bits.length) groups.push({ rain: gaugeLines, severity: 20, serious: false, entries: 1, say: () => `${!gaugeLines && s.period === "morning" ? "Good morning. " : ""}${bits.join(" ")}` });
    }
  }
  if (clears.size) {
    const gs = [...clears.values()];
    groups.push({ river: true, severity: 5, serious: false, entries: gs.length, say: (k) => { const l = gs.slice(0, k); return l.length === 1 ? `${cap(riverName(l[0].river))} is back below alert level at ${l[0].station} (${reading(l[0])}).` : `${cap(joinList(l.map(place)))} are back below alert level.`; } });
  }
  return groups.sort((a, b) => b.severity - a.severity);
}
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export type Combined = { headAt: number; text: string; shown: number; total: number; serious: boolean; long: boolean };

/**
 * The one combined post, in short plain sentences, most severe first: "6:16 am: The Kelani is in minor flood at Hanwella
 * (10.4 ft) and still rising. ...". Rivers at the same step share a sentence. One action line when something is at Alert or
 * worse, "Emergency: 117." when it is Minor/Major or an official warning. `link` ("" for none) goes once at the end.
 * Too long for 280 -> the least severe places are cut and "...and N more on waterlevels.lk" says so. Long mode keeps up to
 * LONG_MAX_ITEMS places. Never a thread.
 */
export function composeCombined(events: Ev[], o: { now: number; link?: string; long?: boolean }): Combined {
  const groups = groupsOf(events);
  const long = !!o.long;
  const limit = long ? LONG_TWEET : MAX_TWEET;
  const serious = groups.some((g) => g.serious);
  const actionable = groups.some((g) => g.severity >= 70 || (g.severity >= 100));
  const headAt = newestReading(events) ?? o.now;
  const total = groups.reduce((n, g) => n + g.entries, 0);
  const atRisk = groups.reduce((n, g) => n + (g.river && g.severity >= 70 ? g.entries : 0), 0);
  const keep = groups.map((g) => g.entries);
  const build = () => {
    const kept = keep.reduce((x, y) => x + y, 0);
    const rest = total - kept;
    // what was cut: rivers only -> say rivers; long posts name the step they were at
    const cutRivers = groups.filter((g, i) => keep[i] < g.entries).every((g) => g.river);
    const cutRiverN = groups.reduce((n, g, i) => n + (g.river ? g.entries - keep[i] : 0), 0);
    const cutGroups = groups.filter((g, i) => keep[i] < g.entries);
    const shortMore = () => {
      const rivers = cutGroups.every((g) => g.river && g.severity >= 70);
      if (rivers) return ` ${rest} more ${rest === 1 ? "river" : "rivers"} at alert level on waterlevels.lk.`;
      if (cutGroups.every((g) => g.rain)) return " Rain outlook on waterlevels.lk.";
      return " More on waterlevels.lk.";
    };
    const more = rest > 0 ? (long ? ` ...and ${cutRiverN || rest} more ${cutRiverN ? "rivers at alert level or higher" : "updates"}, see waterlevels.lk.` : shortMore()) : "";
    const say = (i: number) => (keep[i] > 0 ? groups[i].say(keep[i]) : null);
    const action = [actionable ? (atRisk === 1 ? "Near this river? Move valuables up." : "Near these rivers? Move valuables up.") : null, serious ? "Emergency: 117." : null].filter(Boolean).join(" ");
    if (long) {
      const p1 = groups.map((g, i) => (g.severity >= 80 ? say(i) : null)).filter(Boolean).join(" ");
      const p2 = (groups.map((g, i) => (g.severity < 80 ? say(i) : null)).filter(Boolean).join(" ") + more).trim();
      const paras = [p1, p2].filter(Boolean);
      paras[0] = `${clock(headAt)}: ${paras[0]}`;
      return [...paras, action, o.link || null].filter(Boolean).join("\n\n");
    }
    const body = groups.map((_, i) => say(i)).filter(Boolean).join(" ") + more;
    return [`${clock(headAt)}: ${body}`, action, o.link || null].filter(Boolean).join(" ");
  };
  const softLimit = long ? LONG_SOFT : limit;
  let cut = 0;
  if (long) { let over = total - LONG_MAX_ITEMS; for (let i = groups.length - 1; i >= 0 && over > 0; i--) { const d = Math.min(keep[i], over); keep[i] -= d; over -= d; } }
  const last = () => { for (let i = groups.length - 1; i >= 0; i--) if (keep[i] > 0) return i; return -1; };
  while (tweetLength(build()) > softLimit && keep.reduce((a, b) => a + b, 0) > 1) { keep[last()]--; cut++; }
  return { headAt, text: build(), shown: keep.reduce((a, b) => a + b, 0), total, serious, long };
}

/** Why a combined text may not go out; empty = fine. Numbers must come from the events, plus the clock in the heading. */
export function validateCombined(text: string, events: Ev[], headAt: number, long: boolean): string[] {
  const problems: string[] = [];
  if (tweetLength(text) > (long ? LONG_TWEET : MAX_TWEET)) problems.push(`too long (${tweetLength(text)})`);
  const ok = allowedNumbers(events.map((e) => e.gauges ?? e.reservoirs ?? e.warning ?? e.summary ?? e.storm ?? e.rivers ?? e.rainwatch));
  for (const n of [...ALWAYS_OK_NUMBERS, ...numbersIn(clock(headAt))]) ok.add(n);
  for (const m of text.matchAll(/and (\d+) more/g)) ok.add(Number(m[1]));
  for (const n of numbersIn(text)) if (!ok.has(n)) problems.push(`number ${n} is not in the data`);
  return problems;
}

/**
 * What to do with this run's events given the previous post time. Returns "send" (post one combined post now),
 * "defer" (a post went out less than minGapMs ago and nothing is urgent: keep them for the next run) or "none".
 */
export function decide(events: Ev[], lastPostMs: number | null, now: number, minGapMs = MIN_GAP_MS): "send" | "defer" | "none" {
  if (!events.length) return "none";
  if (events.some(isUrgentNow)) return "send";
  if (lastPostMs != null && now - lastPostMs < minGapMs) return "defer";
  return "send";
}

/** Daily-limit check for ONE combined post: routine up to dailyMax posts, urgent up to urgentMax, a summary is exempt. */
export function capBatch(events: Ev[], usedToday: number, cfg: { dailyMax: number; urgentMax: number }): boolean {
  if (events.some((e) => e.exempt)) return true;
  return usedToday < (events.some(isUrgentNow) ? cfg.urgentMax : cfg.dailyMax);
}

/** Stable key for a batch: the single event's own key, or a hash of all of them. */
export function batchKey(events: Ev[], bucket: number): string {
  if (events.length === 1) return events[0].dedupe;
  const s = events.map((e) => e.dedupe).sort().join("|");
  let h = 5381;
  for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return `combo:${bucket}:${h.toString(36)}`;
}
