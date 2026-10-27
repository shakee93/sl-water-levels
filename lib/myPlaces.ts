// "My places": the places a visitor pinned (towns and river gauges), what we say about them at a glance, and the
// rules for when a pinned place deserves a push notification. Pure (no imports, no clock, no I/O) so the home page,
// the /api routes, the GitHub Actions sender (scripts/push-notify.mjs, run with node --experimental-strip-types) and
// scripts/my-places.test.mts all share it.
//
// A place key is a short string: "t:<town slug>" (e.g. t:wellampitiya), "s:<gauge name>" (e.g. s:Nagalagam Street).
// A town key may carry the visitor's own street level in the gauge's unit: "t:wellampitiya@3.4" (see lib/myLevels.ts).

export const MAX_PLACES = 12;
/** Smallest number of residents we ever show or count in public ("fewer than 3" is never revealed). */
export const K_MIN = 3;

export type ParsedKey =
  | { kind: "t"; slug: string; lv: number | null; key: string }
  | { kind: "s"; name: string; key: string };

const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;

export function parseKey(raw: string): ParsedKey | null {
  if (typeof raw !== "string" || raw.length > 90) return null;
  if (raw.startsWith("t:")) {
    const [slug, lvRaw] = raw.slice(2).split("@");
    if (!SLUG.test(slug)) return null;
    let lv: number | null = null;
    if (lvRaw != null) {
      const n = Number(lvRaw);
      if (!Number.isFinite(n) || n <= 0 || n > 1000) return null;
      lv = Math.round(n * 100) / 100;
    }
    return { kind: "t", slug, lv, key: lv == null ? `t:${slug}` : `t:${slug}@${lv}` };
  }
  if (raw.startsWith("s:")) {
    const name = raw.slice(2).trim();
    if (!name || name.length > 60 || /[|\u0000-\u001f]/.test(name)) return null;
    return { kind: "s", name, key: `s:${name}` };
  }
  return null;
}

/** "t:a|s:B" -> parsed keys, de-duplicated, invalid ones dropped, at most MAX_PLACES. */
export function parseKeys(raw: string | null | undefined): ParsedKey[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: ParsedKey[] = [];
  for (const part of raw.split("|")) {
    const k = parseKey(part);
    if (!k || seen.has(k.key)) continue;
    seen.add(k.key);
    out.push(k);
    if (out.length >= MAX_PLACES) break;
  }
  return out;
}

export type GlanceTone = "normal" | "watch" | "alert" | "minor" | "major" | "stale" | "none";

/** What the site says about one pinned place right now. Language-free: the page words it. */
export type Glance = {
  key: string;
  kind: "t" | "s";
  name: string;
  /** Unprefixed site path of the place's page. */
  href: string;
  tone: GlanceTone;
  /** The river-and-warnings tone (towns); absent for gauges, where it is `tone`. Same as `tone` now that rain never changes it. */
  baseTone?: GlanceTone;
  /** A reservoir upstream of this place's gauge is releasing water (official figures or a news report), or null. */
  release?: { name: string; confirmed: boolean; etaHours: number | null } | null;
  /** Heavy rain (50 mm or more, or the heavier scenario 100 mm) is forecast over the hills above this place's gauge in the next 24 h (lib/rainRisk.ts). Only looked up for gauges that are not calm; null/absent = no or unknown. */
  /** "measured" = the gauges themselves measured very heavy rain at or above this place's gauge (lib/measuredRain.ts); it also covers the forecast case (the sentence then names the measured rain). */
  rainRisk?: boolean | "measured" | null;
  /** Satellite heavy-rain level over the town ("low spot" rule, towns in a rain zone only). Never part of `tone`; the page shows it only to a visitor who marked their spot as low (lib/lowSpots.ts). */
  street: "possible" | "likely" | null;
  trend: "up" | "down" | "steady" | "unknown";
  /** Level text as the site shows it ("2.7 ft"), or null. */
  levelText: string | null;
  /** Rain over the last 24 hours at the place, mm; null = not measured. */
  rain24: number | null;
  /** Rain expected in the next 24 hours, mm; null = unknown. */
  rainNext24: number | null;
  /** Gauge the estimate rests on (lets the page apply the visitor's own street level). */
  gaugeStation: string | null;
  /** River basin of that gauge (trimmed), so the news alert can match stories to "my places"; absent when unknown. */
  basin?: string | null;
  /** Reading time, epoch ms. */
  ts: number | null;
};

const TONE_RANK: Record<GlanceTone, number> = { normal: 0, none: 0, stale: 0, watch: 1, alert: 2, minor: 3, major: 4 };

/**
 * One number for "how worried should this place make us": 0 calm, 1 keep an eye, 2 get ready, 3 flooding likely,
 * 4 move to safety. From the river and official warnings only: heavy rain over a low spot is a personal note, not a
 * level. null = we cannot say (no fresh data, or no flood levels published).
 */
export function levelOf(g: Pick<Glance, "tone">): number | null {
  if (g.tone === "stale" || g.tone === "none") return null;
  return TONE_RANK[g.tone];
}

export type Overall =
  | { kind: "empty" }
  | { kind: "calm"; n: number }
  /** Something needs a look: `worst` is the place to read first; `others` the rest, calm or not. */
  | { kind: "attention"; worst: Glance; others: number; calmOthers: number }
  | { kind: "unknown"; n: number };

/** The one-line answer to "are my places OK?". Missing data is never reported as calm. */
export function overall(gs: Glance[]): Overall {
  if (gs.length === 0) return { kind: "empty" };
  let worst: Glance | null = null;
  let worstL = 0;
  let unknown = 0;
  let calm = 0;
  for (const g of gs) {
    const l = levelOf(g);
    if (l == null) {
      unknown++;
      continue;
    }
    if (l >= 1 && l > worstL) {
      worst = g;
      worstL = l;
    }
    if (l === 0) calm++;
  }
  if (worst) return { kind: "attention", worst, others: gs.length - 1, calmOthers: calm };
  if (unknown === gs.length) return { kind: "unknown", n: gs.length };
  if (unknown > 0) return { kind: "unknown", n: unknown }; // some calm, some unknown: say so, do not claim "all calm"
  return { kind: "calm", n: gs.length };
}

// ---- push notifications -------------------------------------------------------------------------------------

/** A rise ping is held back if another one for the same place went out less than this long ago. */
export const PUSH_FLAP_MS = 3 * 3_600_000;
/** An all-clear needs the place to read calm (level <= 1) on this many checks in a row (checks are ~30 min apart). */
export const CLEAR_RUNS = 2;
/** Levels at or above this are worth a ping (get ready and up; heavy rain over a marked low spot counts as level 3 only for the people who marked it, lib/pushPrefs.ts). A plain "keep an eye" never is. */
export const PUSH_MIN_LEVEL = 2;

export type PushState = {
  /** Last observed level (0-4). */
  level: number;
  /** Highest level the subscribers were told about since the last all-clear (0 = none). */
  notified: number;
  lastRiseMs: number | null;
  clearRuns: number;
};

export type PushStep = { next: PushState; send: "rise" | "clear" | null; level: number };

/**
 * Advances one place's notification state by one observation. `newLevel` null = unknown: nothing changes.
 *  - rise: level >= 2 and above anything we already said, unless a rise went out < 3 h ago and the place was
 *    cleared in between (then it is recorded but silent: totals wobble around a threshold);
 *  - de-escalation (4 -> 3 -> 2) is silent;
 *  - clear: after a rise was announced, `CLEAR_RUNS` checks in a row at level <= 1 send ONE all-clear.
 * The first sighting never sends; a place already at level >= 2 then counts as announced so its all-clear still comes.
 */
export function pushStep(prev: PushState | null, newLevel: number | null, now: number): PushStep {
  if (newLevel == null) {
    const keep = prev ?? { level: 0, notified: 0, lastRiseMs: null, clearRuns: 0 };
    return { next: keep, send: null, level: keep.level };
  }
  if (!prev) {
    const announced = newLevel >= PUSH_MIN_LEVEL ? newLevel : 0;
    return { next: { level: newLevel, notified: announced, lastRiseMs: null, clearRuns: 0 }, send: null, level: newLevel };
  }
  const next: PushState = { ...prev, level: newLevel };
  let send: PushStep["send"] = null;

  if (newLevel >= PUSH_MIN_LEVEL) {
    next.clearRuns = 0;
    if (newLevel > prev.notified) {
      const escalation = prev.notified > 0; // already told about a lower level: always say it got worse
      const flap = !escalation && prev.lastRiseMs != null && now - prev.lastRiseMs < PUSH_FLAP_MS;
      next.notified = newLevel;
      if (!flap) {
        send = "rise";
        next.lastRiseMs = now;
      }
    }
  } else if (newLevel <= 1 && prev.notified > 0) {
    next.clearRuns = prev.clearRuns + 1;
    if (next.clearRuns >= CLEAR_RUNS) {
      send = "clear";
      next.notified = 0;
      next.clearRuns = 0;
    }
  } else {
    next.clearRuns = 0;
  }
  return { next, send, level: newLevel };
}

// ---- closure: did what we said happen? --------------------------------------------------------------------------

export type DayRain = { day: string; /** worst street-rule state seen that day */ state: "none" | "possible" | "likely" };
export type DayAnswers = { day: string; wet: number; dry: number };

export type Outcome =
  /** We said "possible"/"likely" on that day and enough neighbours answered. */
  | { day: string; said: "possible" | "likely"; result: "wet" | "dry" | "mixed"; wet: number; dry: number; total: number };

const SAID_RANK = { none: 0, possible: 1, likely: 2 } as const;

/**
 * Per day the rule warned (possible/likely), what the neighbours reported. Counts below K_MIN are never revealed:
 * a day with fewer than K_MIN answers produces no outcome at all. "wet" = a clear majority said water on the street.
 */
export function outcomes(rain: DayRain[], answers: DayAnswers[]): Outcome[] {
  const byDay = new Map(answers.map((a) => [a.day, a]));
  const out: Outcome[] = [];
  for (const r of rain) {
    if (SAID_RANK[r.state] === 0) continue;
    const a = byDay.get(r.day);
    if (!a) continue;
    const total = a.wet + a.dry;
    if (total < K_MIN) continue;
    const result = a.wet >= 2 * a.dry ? "wet" : a.dry >= 2 * a.wet ? "dry" : "mixed";
    out.push({ day: r.day, said: r.state as "possible" | "likely", result, wet: a.wet, dry: a.dry, total });
  }
  return out.sort((x, y) => (x.day < y.day ? 1 : -1));
}

export type Scorecard = { warnedDays: number; confirmedDays: number; checkedDays: number };
/** A running score is only shown once this many warned days could be judged ("1 of 1" says nothing). */
export const MIN_SCORE_DAYS = 3;

/**
 * Public accuracy of the street-rain rule so far: of the days it said "likely", how many had enough answers to judge
 * and, of those, how many residents confirmed water. Null until MIN_SCORE_DAYS days could be judged.
 */
export function scorecard(rain: DayRain[], answers: DayAnswers[]): Scorecard | null {
  // only "likely" is a warning; "possible" is a quiet heads-up that is often wrong, so it is not scored
  const warned = rain.filter((r) => r.state === "likely");
  if (warned.length === 0) return null;
  const o = outcomes(warned, answers);
  if (o.length < MIN_SCORE_DAYS) return null;
  return { warnedDays: warned.length, checkedDays: o.length, confirmedDays: o.filter((x) => x.result === "wet").length };
}

/** Counts shown to people: anything below K_MIN is hidden (returns null), so one neighbour is never identifiable. */
export const shownCount = (n: number): number | null => (n >= K_MIN ? n : null);

/** Worst state per Colombo day from street_rain_log-style rows (state may be null = rule off). */
export function worstPerDay(rows: { day: string; state: string | null }[]): DayRain[] {
  const m = new Map<string, "none" | "possible" | "likely">();
  for (const r of rows) {
    if (r.state !== "none" && r.state !== "possible" && r.state !== "likely") continue;
    const cur = m.get(r.day);
    if (!cur || SAID_RANK[r.state] > SAID_RANK[cur]) m.set(r.day, r.state);
  }
  return [...m.entries()].map(([day, state]) => ({ day, state })).sort((a, b) => (a.day < b.day ? -1 : 1));
}
