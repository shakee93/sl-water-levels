// What is worth posting on Instagram right now: turns one snapshot of the site (the same one the X account reads: levels,
// reservoirs, official bulletins, rain) plus the memory of what was already posted into a mode and a short list of posts.
// Pure: no I/O, no clock (now is in the snapshot), so scripts/ig-post.test.mjs drives it. Words are in lib/igCompose.ts, sending is
// scripts/ig-post.mjs. Rules: research/instagram-plan.md and DOCS.md "Instagram".
//
// Event detection is NOT written twice: rises of a river gauge to Alert / Minor / Major and new official bulletins come from the X
// account's engine (scripts/x-engine.mjs evaluate: the same pushStep rules as push alerts, first sighting never an event, a source
// that could not be read never means calm). Instagram keeps its OWN copy of that memory (state.x) so the two accounts never
// interfere. What Instagram adds is the mode, the per-gauge story, the 3 h all-clear hold, the caps and the keep-alive posts.
//
// Modes (official steps decide, a forecast never does):
//   disaster  any gauge at Alert or above, or an official DMC / Irrigation flood bulletin in force (or a story we told is still
//             waiting for its all-clear)  -> STORIES (one per gauge reaching Alert / Minor / Major, one more when it moves up a step,
//             an all-clear after a 3 h hold below Alert, one per new bulletin, the morning "Rivers right now"), plus ONE feed post
//             when a gauge reaches Minor or Major (the worst river).
//   weather   no gauge at Alert, but a Met Department advisory (heavy rain, cyclone) or a very heavy rain forecast is active
//             -> ONE daily feed post in the morning: "Rivers right now" + the rain outlook. No stories.
//   calm      nothing active -> keep-alive feed posts, at most 3 a week: rain, reservoirs spilling, river of the week, survey, embed.
//   null      the levels or the bulletins could not be read: unknown is never calm, nothing is posted.
import { evaluate, emptyState, summaryEvent, tierLevel } from "./x-engine.mjs";
import { colomboDay } from "../lib/xCompose.ts";

const H = 3_600_000;
export const IG_DEFAULTS = {
  storiesMax: 20, // disaster: stories a day
  feedMaxDisaster: 3, // disaster: feed posts a day
  otherMax: 1, // weather / calm: posts a day (all kinds together)
  keepWeekMax: 3, // calm: keep-alive posts in any 7 days
  keepGapMs: 30 * H, // calm: at least this long between two
  quietFrom: 22 * 60, // 22:00 Colombo ...
  quietTo: 6 * 60, // ... to 06:00: nothing for weather / calm; disaster stories still go
  clearHoldMs: 3 * H, // all-clear only after this long below Alert
  morningFrom: 6 * 60 + 30,
  morningTo: 11 * 60,
  calmFrom: 9 * 60, // keep-alive posts go out between these times
  calmTo: 20 * 60,
  heavyRainMm: 100, // forecast rain in 24 h that makes a weather day on its own
  rainMinMm: 15, // calm: the rain post needs a gauge that measured at least this much in 24 h
  reservoirMaxAgeDays: 2,
};

export const emptyIgState = () => ({ v: 1, x: emptyState(), hold: {}, md: null });
export const quiet = (minutes, cfg = IG_DEFAULTS) => minutes >= cfg.quietFrom || minutes < cfg.quietTo;

const FLOOD_SEV = ["alert", "minor flood", "major flood", "evacuation"];
const pathOf = (url) => { try { return new URL(url).pathname.replace(/^\/+|\/+$/g, ""); } catch { return String(url ?? ""); } };
const lastPart = (url) => pathOf(url).split("/").pop() || null;
const firstPart = (url) => pathOf(url).split("/")[0] || null;
const hasStory = (g) => !!lastPart(g.url);

/** The mode and why (a sentence for the Slack message). */
export function decideMode(snap, hold, cfg = IG_DEFAULTS) {
  if (!snap.stations) return { mode: null, why: "the river levels could not be read: unknown is never calm, nothing is posted" };
  const live = snap.stations.filter((s) => tierLevel(s.status) != null && s.observedAt);
  const atAlert = live.filter((s) => tierLevel(s.status) >= 2);
  const flood = (snap.warnings ?? []).filter((w) => FLOOD_SEV.includes(w.severity) && w.source !== "Department of Meteorology");
  const wrap = Object.values(hold ?? {}).filter((h) => h.told > 0).length;
  if (atAlert.length || flood.length || wrap) {
    const parts = [atAlert.length ? `${atAlert.length} gauge${atAlert.length === 1 ? "" : "s"} at Alert or above` : null, flood.length ? `${flood.length} official flood bulletin${flood.length === 1 ? "" : "s"} in force` : null, !atAlert.length && !flood.length ? `${wrap} all-clear${wrap === 1 ? "" : "s"} still waiting for the ${cfg.clearHoldMs / H} h hold` : null].filter(Boolean);
    return { mode: "disaster", why: parts.join(", "), atAlert: atAlert.length, flood: flood.length };
  }
  if (snap.warnings == null) return { mode: null, why: "the official bulletins could not be read: unknown is never calm, nothing is posted" };
  const advisories = snap.warnings.filter((w) => w.severity === "advisory" || w.source === "Department of Meteorology");
  const heavy = !!snap.rain && snap.rain.mm >= cfg.heavyRainMm;
  if (advisories.length || heavy) return { mode: "weather", why: advisories.length ? `${advisories.length} weather advisory in force` : `${snap.rain.mm} mm of rain forecast in 24 h`, atAlert: 0, flood: 0 };
  return { mode: "calm", why: "no gauge at Alert, no official bulletin, no weather alert", atAlert: 0, flood: 0 };
}

const gaugeFact = (g) => ({ station: g.station, river: g.river, tier: g.tier, level: g.level, trend: g.trend, nextHour: g.nextHour && typeof g.nextHour.level === "number" ? { level: g.nextHour.level } : null });

/**
 * @param snap  { now, site, stations|null, reservoirs|null, warnings|null, rain, fallen } (scripts/x-post.mjs buildSnapshot)
 * @param prev  memory from the last run (emptyIgState() the first time)
 * @param ctx   { used: {story, feed}, keepWeek, lastKeepMs, lastByType: {rain: ms, ...} } counted from ig_posts by the caller
 * @returns { situation, items, held, state }. items are the posts to make (already within the caps and quiet hours), most important
 *          first; held are the ones the caps stopped. state is the new memory: ALWAYS save it, posted or not.
 */
export function planIg(snap, prev, ctx, cfgIn = {}) {
  const cfg = { ...IG_DEFAULTS, ...cfgIn };
  const now = snap.now;
  const site = snap.site ?? "";
  const { day, minutes } = colomboDay(now);
  const state = JSON.parse(JSON.stringify({ ...emptyIgState(), ...(prev ?? {}) }));
  state.hold ??= {};
  const items = [];

  if (!snap.stations) return { situation: decideMode(snap, state.hold, cfg), items, held: [], state };

  // ---- shared event detection (rises and new bulletins). Surge merging is switched off: Instagram wants one story per gauge.
  const xr = evaluate(snap, state.x ?? emptyState(), { surgeRivers: 1e9 });
  state.x = xr.state;
  const rises = xr.events.filter((e) => e.type === "gauge_rise");
  const bulletins = xr.events.filter((e) => e.type === "warning");

  // ---- hold: a gauge we told about is cleared only after `clearHoldMs` continuously below Alert
  const risen = [];
  for (const ev of rises) for (const g of ev.gauges) {
    const key = pathOf(g.url);
    const lvl = tierLevel(g.tier);
    state.hold[key] = { told: Math.max(state.hold[key]?.told ?? 0, lvl), below: null };
    risen.push({ ev, g, key, lvl });
  }
  const clears = [];
  const toClear = [];
  for (const s of snap.stations) {
    const lvl = tierLevel(s.status);
    if (lvl == null || !s.observedAt || typeof s.level !== "number" || s.unit !== "ft") continue; // unknown stays as it was
    const key = pathOf(s.url);
    const h = state.hold[key];
    if (!h || !(h.told > 0)) continue;
    if (lvl >= 2) h.below = null;
    else {
      h.below ??= now;
      if (now - h.below >= cfg.clearHoldMs) { clears.push(s); toClear.push(key); }
    }
  }

  const situation = decideMode(snap, state.hold, cfg);
  for (const k of toClear) delete state.hold[k]; // after the mode: this run is still "disaster", so the all-clear goes out
  const mode = situation.mode;
  if (!mode) return { situation, items, held: [], state };

  const morningOk = state.md !== day && minutes >= cfg.morningFrom && minutes < cfg.morningTo;
  const us = snap.stations.filter((s) => tierLevel(s.status) != null && s.observedAt && s.status !== "stale" && s.status !== "none");
  const atAlertNow = us.filter((s) => tierLevel(s.status) >= 2);
  const home = (weather) => ({ atAlert: atAlertNow.length, nearAlert: us.filter((s) => s.status === "watch").length, assessed: us.length, rain: snap.rain ?? null, weather });

  if (mode === "disaster") {
    for (const b of bulletins) {
      const slug = lastPart(b.warning.url);
      if (!slug) continue;
      items.push({ format: "story", kind: "warning", priority: 40, dedupe: `story:warning:${b.warning.bulletinUrl}`, media: { kind: "river", slug }, cap: { type: "warning", warning: { source: b.warning.source, severity: b.warning.severity, basins: b.warning.basins } }, label: `${b.warning.basins[0]} bulletin` });
    }
    const bucket = Math.floor(now / 1_800_000);
    for (const { g, lvl } of risen) {
      if (!hasStory(g)) continue;
      items.push({ format: "story", kind: "gauge_rise", priority: 20 + lvl, dedupe: `story:rise:${pathOf(g.url)}=${g.tier}:${bucket}`, media: { kind: "gauge", slug: lastPart(g.url) }, cap: { type: "gauge_rise", gauge: gaugeFact(g) }, label: `${g.station} ${g.tier}` });
    }
    for (const s of clears) {
      items.push({ format: "story", kind: "gauge_clear", priority: 5, dedupe: `story:clear:${pathOf(s.url)}:${bucket}`, media: { kind: "gauge", slug: lastPart(s.url) }, cap: { type: "gauge_clear", gauge: { station: s.station, river: s.river, tier: s.status, level: s.level } }, label: `${s.station} all-clear` });
    }
    if (morningOk) {
      state.md = day;
      items.push({ format: "story", kind: "morning", priority: 15, dedupe: `story:morning:${day}`, media: { kind: "home", slug: "now" }, cap: { type: "home", home: home(false) }, label: "Rivers right now" });
    }
    // ONE feed post when a gauge reaches Minor or Major: the worst river (highest step, then furthest above its Alert mark)
    const serious = risen.filter((r) => r.lvl >= 3).sort((a, c) => c.lvl - a.lvl || (c.g.alertMark ? c.g.level / c.g.alertMark : 0) - (a.g.alertMark ? a.g.level / a.g.alertMark : 0))[0];
    const slug = serious ? firstPart(serious.g.url) : null;
    if (serious && slug) {
      items.push({ format: "feed", kind: "gauge_rise", priority: 50, dedupe: `feed:rise:${serious.g.river}:${serious.g.tier}:${day}`, media: { kind: "river", slug }, cap: { type: "gauge_rise", gauge: gaugeFact(serious.g) }, label: `${serious.g.river} ${serious.g.tier}` });
    }
  } else if (mode === "weather") {
    if (morningOk && !quiet(minutes, cfg)) {
      state.md = day;
      items.push({ format: "feed", kind: "weather_morning", priority: 15, dedupe: `feed:weather:${day}`, media: { kind: "home", slug: "now" }, cap: { type: "home", home: home(true) }, label: "Rivers right now + rain outlook" });
    }
  } else if (mode === "calm") {
    const k = calmItem(snap, ctx, cfg, day, minutes);
    if (k) items.push(k);
  }
  void site;

  // quiet hours: weather and calm posts never go out at night (disaster stories still do; a disaster feed post is urgent too)
  const kept = mode === "disaster" ? items : items.filter(() => !quiet(minutes, cfg));
  const { send, held } = applyIgCaps(kept, mode, ctx?.used ?? { story: 0, feed: 0 }, cfg);
  return { situation, items: send, held, state };
}

const ORDER = ["rain", "reservoirs", "river", "survey", "embed"];

/** How many reservoirs are spilling or releasing, counted like the reservoirs picture (with or without a published flow figure),
 * so a caption never says 26 under a picture that says 31. The "largest" named in the caption still needs a figure. */
export const releasingCount = (snap, day, maxAgeDays = IG_DEFAULTS.reservoirMaxAgeDays) =>
  (snap.reservoirs ?? []).filter((r) => {
    if (!(r.status === "spilling" || r.status === "releasing")) return false;
    const d = r.flow?.day ?? r.readingDay;
    return !d || !day || (Date.parse(day) - Date.parse(d)) / 86_400_000 <= maxAgeDays; // an old reading is not "spilling now"
  }).length;

/** The one keep-alive post for a calm day, or null (too soon, too many this week, outside the window, nothing eligible). */
export function calmItem(snap, ctx, cfg, day, minutes) {
  if (minutes < cfg.calmFrom || minutes >= cfg.calmTo) return null;
  if ((ctx?.keepWeek ?? 0) >= cfg.keepWeekMax) return null;
  if (ctx?.lastKeepMs != null && snap.now - ctx.lastKeepMs < cfg.keepGapMs) return null;
  const spilling = (snap.reservoirs ?? []).filter((r) => {
    if (!(r.status === "spilling" || r.status === "releasing") || !(r.flow?.cusecs > 0)) return false;
    const d = r.flow?.day ?? r.readingDay;
    return !!d && (Date.parse(day) - Date.parse(d)) / 86_400_000 <= cfg.reservoirMaxAgeDays;
  }).sort((a, b) => b.flow.cusecs - a.flow.cusecs);
  const us = (snap.stations ?? []).filter((s) => tierLevel(s.status) != null && s.observedAt && s.unit === "ft" && typeof s.level === "number");
  const rivers = [...new Set(us.map((s) => s.river))].filter((r) => us.filter((s) => s.river === r).length >= 2).sort();
  const week = Math.floor(Date.parse(day) / (7 * 86_400_000));
  const eligible = {
    rain: !!snap.fallen && snap.fallen.mm >= cfg.rainMinMm,
    reservoirs: spilling.length > 0,
    river: rivers.length > 0,
    survey: true,
    embed: true,
  };
  const type = ORDER.filter((t) => eligible[t]).sort((a, b) => (ctx?.lastByType?.[a] ?? 0) - (ctx?.lastByType?.[b] ?? 0) || ORDER.indexOf(a) - ORDER.indexOf(b))[0];
  const base = { format: "feed", kind: `keepalive:${type}`, priority: 10 };
  switch (type) {
    case "rain":
      return { ...base, dedupe: `keep:rain:${day}`, media: { kind: "rain", slug: "now" }, cap: { type: "rain", rain: { place: snap.fallen.place, mm: snap.fallen.mm } }, label: "Rain, last 24 hours" };
    case "reservoirs":
      return { ...base, dedupe: `keep:reservoirs:${day}`, media: { kind: "reservoirs", slug: "now" }, cap: { type: "reservoirs", reservoirs: { count: releasingCount(snap, day, cfg.reservoirMaxAgeDays), top: { name: spilling[0].name, cusecs: spilling[0].flow.cusecs, day: spilling[0].flow.day ?? spilling[0].readingDay ?? null } } }, label: "Reservoirs spilling" };
    case "river": {
      const name = rivers[week % rivers.length];
      const list = us.filter((s) => s.river === name);
      const rep = list.slice().sort((a, b) => tierLevel(b.status) - tierLevel(a.status) || (b.marks?.alert ? b.level / b.marks.alert : 0) - (a.marks?.alert ? a.level / a.marks.alert : 0))[0];
      const slug = firstPart(rep.url);
      if (!slug) return null;
      return { ...base, dedupe: `keep:river:${slug}:${week}`, media: { kind: "river", slug }, cap: { type: "river", river: { name, gauges: list.length, station: rep.station, level: rep.level, tier: rep.status } }, label: `River of the week: ${name}` };
    }
    case "survey":
      return { ...base, dedupe: `keep:survey:${day}`, media: { kind: "home", slug: "now" }, cap: { type: "survey" }, label: "Flood survey call" };
    default:
      return { ...base, dedupe: `keep:embed:${day}`, media: { kind: "home", slug: "now" }, cap: { type: "embed" }, label: "Embed call" };
  }
}

/**
 * Daily caps. `used` = { story, feed } already made today (Colombo day; dry runs count like real posts).
 * disaster: at most storiesMax stories and feedMaxDisaster feed posts; other modes: otherMax posts in total.
 * @returns { send, held } both most important first
 */
export function applyIgCaps(items, mode, used, cfgIn = {}) {
  const cfg = { ...IG_DEFAULTS, ...cfgIn };
  const sorted = items.slice().sort((a, b) => b.priority - a.priority);
  const send = [];
  const held = [];
  if (mode === "disaster") {
    let s = used.story, f = used.feed;
    for (const it of sorted) {
      if (it.format === "story" ? s < cfg.storiesMax : f < cfg.feedMaxDisaster) {
        send.push(it);
        if (it.format === "story") s++; else f++;
      } else held.push(it);
    }
  } else {
    let total = used.story + used.feed;
    for (const it of sorted) {
      if (total < cfg.otherMax) { send.push(it); total++; } else held.push(it);
    }
  }
  return { send, held };
}

/** The picture's address: the JPEG variant of the share picture, story 1080x1920 for stories, square 1080x1080 for feed posts. */
export const imageUrl = (site, item) => `${site.replace(/\/$/, "")}/api/story/${item.media.kind}/${encodeURIComponent(item.media.slug)}.jpg?format=${item.format === "story" ? "story" : "portrait"}`;
