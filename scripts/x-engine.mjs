// What is worth saying on X right now: turns one snapshot of the site (levels, reservoirs, street water, official
// bulletins, rain) plus the memory of what was already said into a list of events. Pure: no I/O, no clock (now is
// passed in), so scripts/x-post.test.mts drives it. The words are in lib/xCompose.ts; the sending is scripts/x-post.mjs.
//
// The rise / all-clear / flap rules are the ones push alerts use (lib/myPlaces.ts pushStep), so X and push agree:
//   - a rise to Alert (2), Minor (3) or Major (4) above anything already said is an event; the first sighting never is;
//   - a rise within 3 h of the last one, after a clear in between, is recorded but silent (totals wobble around a mark);
//   - de-escalation (4 -> 3 -> 2) is silent; an all-clear comes after 2 checks in a row at "watch" or below, and only
//     for a place we actually posted about.
// A source that could not be read (null) leaves its part of the memory untouched: unknown is never "calm".
import { pushStep } from "../lib/myPlaces.ts";
import { colomboDay } from "../lib/xCompose.ts";

export const DEFAULTS = {
  dailyMax: 15, // posts a day for routine items; urgent items may go up to urgentMax
  urgentMax: 40,
  evening: false, // second summary at ~18:00 (monsoon season)
  spillMinCusecs: 300, // a reservoir "starts spilling" above this
  releaseMinCusecs: 2000, // gate releases only count when large
  heavyRainMm: 100, // forecast rain in 24 h that starts storm mode on its own
  stormGauges: 3, // gauges at Alert or higher that start storm mode
  stormEveryMin: 55,
  stormQuietMin: 180, // an unchanged storm update is repeated at most this often
  maxStormRivers: 3,
  warningMaxAgeMs: 6 * 3_600_000,
  reservoirFlapMs: 12 * 3_600_000,
  morningFrom: 6 * 60 + 30,
  morningTo: 11 * 60,
  eveningFrom: 18 * 60,
  eveningTo: 21 * 60,
};

const TIER_LEVEL = { normal: 0, watch: 1, alert: 2, minor: 3, major: 4 };
export const tierLevel = (tier) => (tier in TIER_LEVEL ? TIER_LEVEL[tier] : null);
const FLAP_MS = 3 * 3_600_000;

const toStep = (s) => ({ level: s.l, notified: s.n, lastRiseMs: s.r, clearRuns: s.c });
const fromStep = (p, told) => ({ l: p.level, n: p.notified, r: p.lastRiseMs, c: p.clearRuns, t: told ? 1 : 0 });
const bucket = (now) => Math.floor(now / 1_800_000);

export const emptyState = () => ({ v: 1, g: {}, rs: {}, st: {}, wn: {}, md: null, ev: null, storm: { on: false, off: 0, last: {}, rain: 0 } });

const gaugeFact = (s) => ({
  station: s.station,
  river: s.river,
  tier: s.status,
  level: s.level,
  mark: s.marks?.[s.status] ?? null,
  alertMark: s.marks?.alert ?? null,
  trend: s.trend,
  nextHour: s.nextHour
    ? { level: s.nextHour.level_ft, low: s.nextHour.low_ft, high: s.nextHour.high_ft, direction: s.nextHour.direction, crossing: s.nextHour.crossing }
    : null,
  url: s.url,
  at: s.observedAt ? Date.parse(s.observedAt) : null,
});

/** A station we can speak about: a tier we know, a level in feet, a time. */
const usable = (s) => tierLevel(s.status) != null && typeof s.level === "number" && s.unit === "ft" && s.observedAt;

const byRiver = (list, key) => {
  const m = new Map();
  for (const x of list) m.set(x.river, [...(m.get(x.river) ?? []), x]);
  return [...m.entries()].map(([river, items]) => ({ river, items, key: `${key}:${river}` }));
};

/**
 * @param snap  { now, stations|null, reservoirs|null, street: {towns:[{slug,name,street|undefined,rain24}], zone}|null, warnings|null, rain: {mm,place}|null, site }
 * @param state memory from the last run (emptyState() the first time)
 * @param cfg   DEFAULTS overrides
 * @returns { events, state }  events are in order of importance; state is the new memory (always advance it, posted or not)
 */
export function evaluate(snap, prevState, cfgIn = {}) {
  const cfg = { ...DEFAULTS, ...cfgIn };
  const { now } = snap;
  const state = JSON.parse(JSON.stringify({ ...emptyState(), ...(prevState ?? {}) }));
  state.storm = { ...emptyState().storm, ...state.storm };
  const events = [];
  const b = bucket(now);
  const site = snap.site ?? "";

  // ---- river gauges: rise / all-clear
  const rises = [];
  const clears = [];
  const stations = snap.stations;
  if (stations) {
    const live = new Set();
    for (const s of stations) {
      if (!usable(s)) continue;
      live.add(s.id);
      const lvl = tierLevel(s.status);
      const mine = state.g[s.id];
      const prev = mine ? toStep(mine) : null;
      const step = pushStep(prev, lvl, now);
      let told = mine ? mine.t === 1 : false;
      if (step.send === "rise") {
        rises.push(s);
        told = true;
      } else if (step.send === "clear") {
        if (told) clears.push(s);
        told = false;
      }
      state.g[s.id] = fromStep(step.next, told);
    }
  }

  for (const grp of byRiver(rises, "rise")) {
    const worst = Math.max(...grp.items.map((s) => tierLevel(s.status)));
    events.push({
      type: "gauge_rise", kind: "alert", urgent: worst >= 3, river: grp.river, gauges: grp.items.map(gaugeFact),
      dedupe: `rise:${grp.items.map((s) => `${s.id}=${s.status}`).sort().join(",")}:${b}`,
      priority: 20 + worst,
    });
    state.storm.last[grp.river] = { ...(state.storm.last[grp.river] ?? {}), t: now, sig: grp.items.map((s) => `${s.station}:${s.level.toFixed(1)}`).join() };
  }
  for (const grp of byRiver(clears, "clear")) {
    events.push({
      type: "gauge_clear", kind: "clear", urgent: false, river: grp.river, gauges: grp.items.map(gaugeFact),
      dedupe: `clear:${grp.items.map((s) => s.id).sort().join(",")}:${b}`, priority: 5,
    });
  }

  // ---- reservoirs: start / stop letting water out
  if (snap.reservoirs) {
    const today = colomboDay(now).day;
    const starts = [];
    const stops = [];
    const age = (day) => (day ? (Date.parse(today) - Date.parse(day)) / 86_400_000 : null);
    for (const r of snap.reservoirs) {
      if (r.status === "nodata") continue;
      const a = age(r.readingDay ?? r.flow?.day);
      if (a == null || a > 2) continue; // an old reading is unknown, not "stopped"
      const cus = r.flow?.cusecs;
      const active = (r.status === "spilling" && typeof cus === "number" && cus >= cfg.spillMinCusecs) || (r.status === "releasing" && typeof cus === "number" && cus >= cfg.releaseMinCusecs);
      const prev = state.rs[r.id];
      if (!prev) {
        state.rs[r.id] = { on: active ? 1 : 0, off: 0, t: 0, ms: null };
      } else if (active) {
        if (!prev.on) {
          const flap = prev.ms != null && now - prev.ms < cfg.reservoirFlapMs;
          state.rs[r.id] = { on: 1, off: 0, t: flap ? prev.t : 1, ms: flap ? prev.ms : now };
          if (!flap) starts.push(r);
        } else state.rs[r.id] = { ...prev, off: 0 };
      } else if (prev.on) {
        const off = prev.off + 1;
        if (off >= 2) {
          if (prev.t) stops.push(r);
          state.rs[r.id] = { on: 0, off: 0, t: 0, ms: prev.ms };
        } else state.rs[r.id] = { ...prev, off };
      }
    }
    const rf = (r) => ({ name: r.name, river: r.river, status: r.status, cusecs: r.flow.cusecs, storagePercent: r.storagePercent, day: r.flow.day ?? r.readingDay, source: r.source, url: r.url });
    for (const grp of byRiver(starts.map((r) => ({ ...r, river: r.river ?? "" })), "res")) {
      events.push({ type: "reservoir_start", kind: "reservoir", urgent: false, reservoirs: grp.items.map(rf), dedupe: `rsv:${grp.items.map((r) => r.id).sort().join(",")}:${b}`, priority: 10 });
    }
    if (stops.length) {
      events.push({
        type: "reservoir_stop", kind: "reservoir", urgent: false,
        reservoirs: stops.map((r) => ({ name: r.name, river: r.river, day: r.readingDay ?? r.flow?.day ?? today, url: r.url })),
        dedupe: `rsvstop:${stops.map((r) => r.id).sort().join(",")}:${b}`, priority: 4,
      });
    }
  }

  // ---- street water in the canal towns: "likely" only (possible is a quiet heads-up that never posts)
  if (snap.street) {
    const known = snap.street.towns.filter((t) => t.street !== undefined);
    const key = snap.street.zone ?? "colombo-east";
    if (known.length) {
      const likely = known.filter((t) => t.street === "likely");
      const lvl = likely.length ? 3 : known.some((t) => t.street === "possible") ? 1 : 0;
      const mine = state.st[key];
      const step = pushStep(mine ? toStep(mine) : null, lvl, now);
      let told = mine ? mine.t === 1 : false;
      const first = likely.find((t) => t.slug === "wellampitiya") ?? likely[0] ?? known.find((t) => t.slug === "wellampitiya") ?? known[0];
      const ng = stations?.find((s) => s.station === "Nagalagam Street" && usable(s)) ?? null;
      if (step.send === "rise") {
        told = true;
        const rains = likely.map((t) => t.rain24).filter((x) => typeof x === "number");
        events.push({
          type: "street_likely", kind: "street", urgent: true,
          street: { towns: likely.map((t) => t.name), rain24Mm: rains.length ? Math.max(...rains) : null, windowH: 24, gaugeStation: ng?.station ?? null, gaugeLevel: ng?.level ?? null, url: `${site}/flood/${first.slug}`, at: now },
          dedupe: `street:${key}:likely:${b}`, priority: 30,
        });
      } else if (step.send === "clear") {
        if (told) events.push({ type: "street_clear", kind: "street", urgent: false, street: { towns: known.map((t) => t.name), url: `${site}/flood/${first.slug}`, at: now }, dedupe: `street:${key}:clear:${b}`, priority: 6 });
        told = false;
      }
      state.st[key] = fromStep(step.next, told);
    }
  }

  // ---- official bulletins (DMC / Irrigation Department / Met): each new one with Alert or worse, once
  if (snap.warnings) {
    for (const [k, t] of Object.entries(state.wn)) if (now - t > 3 * 86_400_000) delete state.wn[k];
    for (const w of snap.warnings) {
      if (!["alert", "minor flood", "major flood", "evacuation"].includes(w.severity)) continue;
      const issued = w.issuedAt ? Date.parse(w.issuedAt) : NaN;
      if (!Number.isFinite(issued) || now - issued > cfg.warningMaxAgeMs || !w.basins?.length) continue;
      if (state.wn[w.url] != null) continue;
      state.wn[w.url] = now;
      const basinSlug = w.basins[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      events.push({
        type: "warning", kind: "warning", urgent: w.severity !== "alert",
        warning: { source: w.source, severity: w.severity, basins: w.basins.map((x) => x.trim()), issuedAt: issued, releaseCusecs: w.releaseCusecs ?? null, bulletinUrl: w.url, url: `${site}/${basinSlug}` },
        dedupe: `warning:${w.url}`, priority: 40,
      });
    }
  }

  // ---- storm mode: hourly updates for rivers that are rising or high, or a heavy-rain heads-up
  if (stations) {
    const us = stations.filter(usable);
    const lv = (s) => tierLevel(s.status);
    const high = us.filter((s) => lv(s) >= 2);
    const rising = us.filter((s) => lv(s) >= 1 && /rising/.test(s.trend ?? "") && s.nextHour?.crossing);
    const trigger = high.length >= cfg.stormGauges || high.some((s) => lv(s) >= 3) || rising.length >= 3;
    const rainHeavy = !!snap.rain && snap.rain.mm >= cfg.heavyRainMm;
    const st = state.storm;
    if (trigger || rainHeavy) {
      st.on = true;
      st.off = 0;
    } else if (st.on) {
      st.off += 1;
      if (st.off >= 2) st.on = false;
    }
    if (st.on) {
      const affected = byRiver(us.filter((s) => lv(s) >= 2 || (lv(s) >= 1 && /rising/.test(s.trend ?? "") && s.nextHour?.crossing)), "storm")
        .sort((a, b) => Math.max(...b.items.map(lv)) - Math.max(...a.items.map(lv)) || b.items.length - a.items.length)
        .slice(0, cfg.maxStormRivers);
      for (const grp of affected) {
        const last = st.last[grp.river] ?? { t: 0, sig: "" };
        const all = us.filter((s) => s.river === grp.river && lv(s) >= 1).sort((a, b) => lv(b) - lv(a) || b.level - a.level).slice(0, 4);
        const sig = all.map((s) => `${s.station}:${s.level.toFixed(1)}`).join();
        const since = (now - last.t) / 60_000;
        if (since < cfg.stormEveryMin) continue;
        if (sig === last.sig && since < cfg.stormQuietMin) continue;
        st.last[grp.river] = { t: now, sig };
        events.push({
          type: "storm", kind: "storm", urgent: true,
          storm: { river: grp.river, at: now, gauges: all.map(gaugeFact), url: all[0].url },
          dedupe: `storm:${grp.river}:${b}`, priority: 25,
        });
      }
      if (rainHeavy && affected.length === 0 && now - st.rain >= 3 * 3_600_000) {
        st.rain = now;
        events.push({ type: "rainwatch", kind: "storm", urgent: true, rainwatch: { mm: snap.rain.mm, place: snap.rain.place, windowH: 24, atAlert: high.length, at: now, url: site || "https://sl-water-levels.vercel.app" }, dedupe: `rainwatch:${b}`, priority: 24 });
      }
    }
  }

  // ---- morning (and optional evening) summary, once a Colombo day each
  if (stations) {
    const { day, minutes } = colomboDay(now);
    const due = (period) => {
      if (period === "morning") return state.md !== day && minutes >= cfg.morningFrom && minutes < cfg.morningTo;
      return cfg.evening && state.ev !== day && minutes >= cfg.eveningFrom && minutes < cfg.eveningTo;
    };
    for (const period of ["morning", "evening"]) {
      if (!due(period)) continue;
      events.push(summaryEvent(snap, period, now, b, site));
      if (period === "morning") state.md = day;
      else state.ev = day;
    }
  }

  events.sort((a, c) => c.priority - a.priority);
  return { events, state };
}

export function summaryEvent(snap, period, now, b = bucket(now), site = snap.site ?? "") {
  const us = (snap.stations ?? []).filter((s) => s.status !== "stale" && s.status !== "none" && tierLevel(s.status) != null);
  const atAlert = us.filter((s) => tierLevel(s.status) >= 2).sort((a, c) => tierLevel(c.status) - tierLevel(a.status) || c.level - a.level);
  const spilling = (snap.reservoirs ?? []).filter((r) => (r.status === "spilling" || r.status === "releasing") && r.flow?.cusecs > 0).length;
  return {
    type: "summary", kind: period, urgent: false, exempt: true, priority: 15,
    summary: {
      period, at: now, reporting: (snap.stations ?? []).filter((s) => s.status !== "stale").length, assessed: us.length,
      atAlert: atAlert.map((s) => ({ station: s.station, tier: s.status })), nearAlert: us.filter((s) => s.status === "watch").length,
      rain: snap.rain ?? null, rainWindowH: 24, spilling, url: site || "https://sl-water-levels.vercel.app",
    },
    dedupe: `${period}:${colomboDay(now).day}`,
  };
}

/**
 * Applies the daily limits. `used` = { normal, urgent }: posts already made today (Colombo day).
 * Summaries are exempt; routine events stop at cfg.dailyMax posts in total; urgent ones at cfg.urgentMax.
 * @returns { send: events[], held: events[] }
 */
export function applyCaps(events, used, cfgIn = {}) {
  const cfg = { ...DEFAULTS, ...cfgIn };
  let total = used.normal + used.urgent;
  const send = [];
  const held = [];
  for (const e of events) {
    const limit = e.exempt ? Infinity : e.urgent ? cfg.urgentMax : cfg.dailyMax;
    if (total >= limit) held.push(e);
    else {
      send.push(e);
      total += 1;
    }
  }
  return { send, held };
}
