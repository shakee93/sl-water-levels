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
/** Items shown at most in a long post (a wall of text is no use either). */
export const LONG_MAX_ITEMS = 40;
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

const trend = (t: string | null) => (t === "rising" ? ", rising" : t === "rising slowly" ? ", rising slowly" : t === "falling" ? ", falling" : "");

/** The brief lines of a batch of events, one per river / reservoir / warning, most severe first. */
export function itemsOf(events: Ev[]): Item[] {
  const items: Item[] = [];
  // all gauge-bearing events of one river become one line (a rise and a storm update for the same river say one thing)
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
    } else if (ev.type === "gauge_clear") for (const g of ev.gauges) clears.set(g.station, g);
  }
  for (const [river, m] of rivers) {
    const gs = [...m.values()].sort((a, b) => lvl(b.tier) - lvl(a.tier) || b.level - a.level);
    const top = lvl(gs[0].tier);
    const shown = gs.slice(0, 2).map((g, i) => `${g.station} ${ft(g.level)}${g.stale ? ` at ${clock(g.at)}` : i === 0 ? trend(g.trend) : ""}`);
    const more = gs.length - shown.length;
    const label = top >= 2 ? LABEL[top] : "Rising";
    const cross = gs.find((g) => g.nextHour?.crossing)?.nextHour?.crossing;
    items.push({
      line: `${label}: ${river}, ${shown.join(", ")}${more > 0 ? ` +${more} more` : ""}${cross && top < 3 && /minor|major/i.test(cross) ? `; forecast: could reach ${/major/i.test(cross) ? "Major" : "Minor"} flood level` : ""}`,
      severity: 50 + top * 10, serious: top >= 3 || /minor|major/i.test(cross ?? ""),
    });
  }
  for (const ev of events) {
    if (ev.type === "warning") {
      const w = ev.warning;
      items.push({ line: `Official ${w.severity} warning (${w.source}): ${w.basins.slice(0, 2).join(", ")}${w.releaseCusecs ? `, release ${int(w.releaseCusecs)} cusecs` : ""}`, severity: 100 + (w.severity === "alert" ? 0 : 10), serious: w.severity !== "alert" });
    } else if (ev.type === "reservoir_start") {
      const rs = ev.reservoirs;
      items.push({ line: `Letting water out: ${rs.slice(0, 2).map((r: any) => `${r.name} ${int(r.cusecs)} cusecs`).join(", ")}${rs.length > 2 ? ` +${rs.length - 2} more` : ""}`, severity: 30, serious: false });
    } else if (ev.type === "reservoir_stop") {
      const rs = ev.reservoirs;
      items.push({ line: `Stopped letting water out: ${rs.slice(0, 2).map((r: any) => r.name).join(", ")}${rs.length > 2 ? ` +${rs.length - 2} more` : ""}`, severity: 12, serious: false });
    } else if (ev.type === "rainwatch") {
      items.push({ line: `Heavy rain forecast, next ${ev.rainwatch.windowH} hours: up to ${int(ev.rainwatch.mm)} mm near ${ev.rainwatch.place}`, severity: 40, serious: false });
    } else if (ev.type === "summary") {
      const s = ev.summary;
      const parts = [s.atAlert.length ? `${s.atAlert.length} of ${s.assessed} gauges at Alert or higher` : `all ${s.assessed} gauges below Alert`];
      if (s.rain && s.rain.mm >= 5) parts.push(`up to ${int(s.rain.mm)} mm rain forecast near ${s.rain.place}`);
      items.push({ line: `${s.period === "morning" ? "Morning" : "Evening"}: ${parts.join("; ")}`, severity: 20, serious: false });
    }
  }
  if (clears.size) {
    const gs = [...clears.values()];
    items.push({ line: `All clear: ${gs.slice(0, 3).map((g) => `${g.station} ${ft(g.level)}${g.stale ? ` at ${clock(g.at)}` : ""}`).join(", ")}${gs.length > 3 ? ` +${gs.length - 3} more` : ""}`, severity: 5, serious: false });
  }
  return items.sort((a, b) => b.severity - a.severity);
}

export type Combined = { headAt: number; text: string; shown: number; total: number; serious: boolean; long: boolean };

/**
 * The one combined post. `link` (a full URL, or "" for none) is placed once at the end. Keeps as many of the most severe
 * lines as fit; the rest become "+N more on waterlevels.lk". Long mode (X Premium) keeps up to LONG_MAX_ITEMS lines.
 */
export function composeCombined(events: Ev[], o: { now: number; link?: string; long?: boolean }): Combined {
  const items = itemsOf(events);
  const long = !!o.long;
  const limit = long ? LONG_TWEET : MAX_TWEET;
  const serious = items.some((i) => i.serious);
  const headAt = newestReading(events) ?? o.now;
  const head = `Water levels, ${clock(headAt)}`;
  const build = (k: number) => {
    const rest = items.length - k;
    return [head, ...items.slice(0, k).map((i) => i.line), rest > 0 ? `+${rest} more on waterlevels.lk` : null, serious ? "Emergency: 117." : null, o.link || null].filter(Boolean).join("\n");
  };
  const max = long ? Math.min(items.length, LONG_MAX_ITEMS) : items.length;
  let k = max;
  while (k > 1 && tweetLength(build(k)) > limit) k--;
  // a long post that hit the item cap still says how many were left out
  return { headAt, text: build(k), shown: k, total: items.length, serious, long };
}

/** Why a combined text may not go out; empty = fine. Numbers must come from the events, plus the clock in the heading. */
export function validateCombined(text: string, events: Ev[], now: number, long: boolean): string[] {
  const problems: string[] = [];
  if (tweetLength(text) > (long ? LONG_TWEET : MAX_TWEET)) problems.push(`too long (${tweetLength(text)})`);
  const ok = allowedNumbers(events.map((e) => e.gauges ?? e.reservoirs ?? e.warning ?? e.summary ?? e.storm ?? e.rivers ?? e.rainwatch));
  for (const n of [...ALWAYS_OK_NUMBERS, ...numbersIn(clock(now))]) ok.add(n);
  for (const m of text.matchAll(/\+(\d+) more/g)) ok.add(Number(m[1]));
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
