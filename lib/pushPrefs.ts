// What one subscriber wants to be alerted about. Pure (no imports, no I/O, no clock) so the settings route, the
// settings sheet (app/AlertSettings.tsx), the sender (scripts/push-notify.mjs) and scripts/push.test.mts share it.
// Stored next to the subscription in D1 (push_prefs, one JSON text per browser). A browser with no row, or a row
// with a missing field, gets DEFAULT_PREFS, which equals what every subscriber had before settings existed:
// river at Alert level ("Get ready") or worse, street water "likely", all-clear, no morning summary.
// No personal data: choices only (which place keys are muted, which kinds, a time of day).

export const PREFS_VERSION = 1;
export type RiverMin = 2 | 3 | 4; // 2 = Alert level ("Get ready"), 3 = Minor level ("Flooding likely"), 4 = Major flood ("Move to safety")

export type Prefs = {
  v: 1;
  /** Place keys (without the "@level" suffix) that must stay silent; a newly pinned place is on by default. */
  muted: string[];
  riverMin: RiverMin;
  /** Street water "likely" (canal towns). */
  streetLikely: boolean;
  /** Street water "possible": an early heads-up that is often wrong (about 8 times a year). */
  streetPossible: boolean;
  /** A reservoir upstream starts releasing water. */
  reservoir: boolean;
  allClear: boolean;
  morning: boolean;
  /** HH:MM Colombo, on a half hour. */
  morningAt: string;
  /** Quiet hours in Colombo time; null = off. Major flood and street "likely" still come through. */
  quiet: { from: string; to: string } | null;
  /** Occasional announcements from the site (owner broadcasts). */
  announce: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  v: 1,
  muted: [],
  riverMin: 2,
  streetLikely: true,
  streetPossible: false,
  reservoir: false,
  allClear: true,
  morning: false,
  morningAt: "06:00",
  quiet: null,
  announce: true,
};

export const MORNING_TIMES = ["05:00", "05:30", "06:00", "06:30", "07:00", "07:30", "08:00", "08:30", "09:00"];
export const QUIET_DEFAULT = { from: "22:00", to: "06:00" };
export const MAX_MUTED = 12;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** "t:wellampitiya@3.4" -> "t:wellampitiya": mute and un-mute by the place, not by the visitor's own street level. */
export const baseKey = (k: string): string => k.split("@")[0];

/** Any stored or posted value -> a complete, valid Prefs. Unknown or malformed fields fall back to the default. */
export function parsePrefs(raw: unknown, legacyMorning = false): Prefs {
  const o = isObj(raw) ? raw : {};
  const quiet = isObj(o.quiet) && typeof o.quiet.from === "string" && typeof o.quiet.to === "string" && TIME.test(o.quiet.from) && TIME.test(o.quiet.to) && o.quiet.from !== o.quiet.to ? { from: o.quiet.from, to: o.quiet.to } : null;
  const muted = Array.isArray(o.muted) ? [...new Set(o.muted.filter((k): k is string => typeof k === "string" && k.length <= 90 && /^[ts]:/.test(k)).map(baseKey))].slice(0, MAX_MUTED) : [];
  const riverMin: RiverMin = o.riverMin === 3 || o.riverMin === 4 ? o.riverMin : 2;
  const at = typeof o.morningAt === "string" && MORNING_TIMES.includes(o.morningAt) ? o.morningAt : DEFAULT_PREFS.morningAt;
  return {
    v: 1,
    muted,
    riverMin,
    streetLikely: bool(o.streetLikely, true),
    streetPossible: bool(o.streetPossible, false),
    reservoir: bool(o.reservoir, false),
    allClear: bool(o.allClear, true),
    morning: bool(o.morning, legacyMorning),
    morningAt: at,
    quiet,
    announce: bool(o.announce, true),
  };
}

export const prefsEqual = (a: Prefs, b: Prefs) => JSON.stringify(a) === JSON.stringify(b);
export const isDefaultPrefs = (p: Prefs) => prefsEqual(p, DEFAULT_PREFS);

/** Colombo is UTC+05:30 all year (no daylight saving). */
export function colombo(ms: number): { minutes: number; day: string } {
  const c = new Date(ms + 330 * 60_000);
  return { minutes: c.getUTCHours() * 60 + c.getUTCMinutes(), day: c.toISOString().slice(0, 10) };
}

/** Is `ms` inside this subscriber's quiet hours (Colombo time, may wrap past midnight)? */
export function inQuiet(p: Prefs, ms: number): boolean {
  if (!p.quiet) return false;
  const m = colombo(ms).minutes, from = minutesOf(p.quiet.from), to = minutesOf(p.quiet.to);
  return from < to ? m >= from && m < to : m >= from || m < to;
}

// ---- what a place says to this subscriber

type Tone = "normal" | "watch" | "alert" | "minor" | "major" | "stale" | "none";
/** The few Glance fields the rules read (lib/myPlaces.ts Glance). baseTone = the tone before the street-rain rule (towns). */
export type GlanceLike = { tone: Tone; baseTone?: Tone | null; street: "possible" | "likely" | null; release?: { name: string; confirmed: boolean; etaHours: number | null } | null };

const RANK: Record<Tone, number> = { normal: 0, none: 0, stale: 0, watch: 1, alert: 2, minor: 3, major: 4 };
const riverTone = (g: GlanceLike): Tone => (g.baseTone === undefined ? g.tone : g.baseTone ?? "stale");
/** 0 calm .. 4 move to safety, from the river (and rain, official warnings) alone: the street rule is not part of it. */
export const riverRank = (g: GlanceLike): number => RANK[riverTone(g)];

/**
 * The level the state machine (lib/myPlaces.ts pushStep) follows for this subscriber: the river, plus street water
 * "likely" (level 3) when they want it. null = we cannot say (no fresh river data and no street answer): nothing changes.
 */
export function subLevel(p: Prefs, g: GlanceLike): number | null {
  const t = riverTone(g);
  const street = p.streetLikely && g.street === "likely";
  if ((t === "stale" || t === "none") && !street) return null;
  return Math.max(RANK[t], street ? 3 : 0);
}

/** Does a rise at this moment match what the subscriber asked for? (Lower levels still advance the state silently.) */
export function qualifies(p: Prefs, g: GlanceLike): boolean {
  return riverRank(g) >= p.riverMin || (p.streetLikely && g.street === "likely");
}

/** Major flood, and street water "likely" for those who want it, always come through quiet hours. */
export function bypassesQuiet(p: Prefs, g: GlanceLike): boolean {
  return riverRank(g) >= 4 || (p.streetLikely && g.street === "likely");
}

/** Is today's morning summary due for this subscriber? `lastDay` = the Colombo day it was last sent. Never after midday. */
export function morningDue(p: Prefs, ms: number, lastDay: string | null): boolean {
  if (!p.morning) return false;
  const { minutes, day } = colombo(ms);
  if (lastDay === day) return false;
  return minutes >= minutesOf(p.morningAt) && minutes < 12 * 60 && !inQuiet(p, ms);
}
