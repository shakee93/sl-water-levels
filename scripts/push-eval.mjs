// What to tell ONE subscriber on this check, given their settings (lib/pushPrefs.ts), their memory (what they were told
// per place) and what the site says now. Pure: no I/O, no clock, so scripts/push.test.mts can drive it. Used by
// scripts/push-notify.mjs. The shared "rise / all-clear / flap" rules stay in lib/myPlaces.ts pushStep; this file only
// decides, per subscriber, which of those steps they hear about:
//   - rise:   the level reached what they chose (river Alert / Minor / Major, street water "likely" when wanted);
//   - clear:  only to someone who was actually told, and only if they want all-clear messages;
//   - heads:  street water "possible" (opt-in), once, until it has been gone for two checks in a row;
//   - release: a reservoir upstream starts releasing (opt-in), once, same reset rule.
// Quiet hours HOLD a message (the state is not advanced, so it is re-checked and sent after quiet hours if still true),
// except Major flood and street "likely", which always come through.
import { pushStep, CLEAR_RUNS } from "../lib/myPlaces.ts";
import { baseKey, subLevel, qualifies, bypassesQuiet, inQuiet } from "../lib/pushPrefs.ts";

const toStep = (s) => ({ level: s.l, notified: s.n, lastRiseMs: s.r, clearRuns: s.c });
const fromStep = (p, told) => ({ l: p.level, n: p.notified, r: p.lastRiseMs, c: p.clearRuns, t: told ? 1 : 0 });

/**
 * @param prefs   Prefs (parsePrefs output)
 * @param state   this subscriber's stored memory (or null)
 * @param keys    their place keys, as stored (may carry "@level")
 * @param glances Map key -> Glance (the site's answer)
 * @param seeds   Map baseKey -> shared push_place_state row {level, notified, lastRiseMs, clearRuns}: used only the first time
 *                this subscriber is evaluated for a place, so a place already announced is not announced again
 * @returns { messages: [{kind, key, g, level}], state }
 */
export function evalSub({ prefs, state, keys, glances, seeds = new Map(), now }) {
  const st = { pl: { ...(state?.pl ?? {}) }, hp: { ...(state?.hp ?? {}) }, rl: { ...(state?.rl ?? {}) }, md: state?.md ?? null };
  const messages = [];
  const quiet = inQuiet(prefs, now);
  const live = new Set();
  for (const key of keys) {
    const bk = baseKey(key);
    live.add(bk);
    if (prefs.muted.includes(bk)) {
      delete st.pl[bk]; delete st.hp[bk]; delete st.rl[bk]; // un-muting later starts fresh and silent
      continue;
    }
    const g = glances.get(key);
    if (!g) continue;

    // ---- rise / all-clear
    const lvl = subLevel(prefs, g);
    if (lvl != null) {
      const mine = st.pl[bk];
      const seed = !mine ? seeds.get(bk) : null;
      const prev = mine ? toStep(mine) : seed ? { level: seed.level, notified: seed.notified, lastRiseMs: seed.lastRiseMs, clearRuns: seed.clearRuns } : null;
      const wasTold = mine ? mine.t === 1 : !!seed && seed.notified >= 2 && (seed.notified >= prefs.riverMin || (prefs.streetLikely && seed.notified >= 3));
      const step = pushStep(prev, lvl, now);
      let told = wasTold;
      let next = step.next;
      let hold = false;
      if (!prev) {
        told = lvl >= 2 && qualifies(prefs, g); // first sight never sends; a place already high counts as announced
      } else if (step.send === "rise") {
        if (!qualifies(prefs, g)) {
          next = { ...next, lastRiseMs: prev.lastRiseMs }; // below what they asked for: not a message, so no flap clock either
        } else if (quiet && !bypassesQuiet(prefs, g)) {
          hold = true;
        } else {
          messages.push({ kind: "rise", key, g, level: step.level });
          told = true;
        }
      } else if (step.send === "clear") {
        if (!wasTold || !prefs.allClear) {
          told = false;
        } else if (quiet) {
          hold = true;
        } else {
          messages.push({ kind: "clear", key, g, level: step.level });
          told = false;
        }
      }
      if (!hold) st.pl[bk] = fromStep(next, told);
    }

    // ---- street water "possible": early heads-up (opt-in)
    if (prefs.streetPossible) {
      const h = st.hp[bk];
      if (g.street) {
        if (!h) st.hp[bk] = { on: 1, off: 0 }; // already under way when first seen: silent
        else if (!h.on) {
          const covered = g.street === "likely" && prefs.streetLikely; // the rise message already says it
          if (covered) st.hp[bk] = { on: 1, off: 0 };
          else if (!quiet) {
            messages.push({ kind: "heads", key, g, level: g.street === "likely" ? 3 : 1 });
            st.hp[bk] = { on: 1, off: 0 };
          }
        } else st.hp[bk] = { on: 1, off: 0 };
      } else if (!h) st.hp[bk] = { on: 0, off: 0 };
      else if (h.on) st.hp[bk] = h.off + 1 >= CLEAR_RUNS ? { on: 0, off: 0 } : { on: 1, off: h.off + 1 };
    } else delete st.hp[bk];

    // ---- reservoir upstream releasing (opt-in); undefined = the site could not say: nothing changes
    if (prefs.reservoir) {
      const r = st.rl[bk];
      if (g.release) {
        if (!r) st.rl[bk] = { on: 1, off: 0 };
        else if (!r.on) {
          if (!quiet) {
            messages.push({ kind: "release", key, g, level: 0 });
            st.rl[bk] = { on: 1, off: 0 };
          }
        } else st.rl[bk] = { on: 1, off: 0 };
      } else if (g.release === null) {
        if (!r) st.rl[bk] = { on: 0, off: 0 };
        else if (r.on) st.rl[bk] = r.off + 1 >= CLEAR_RUNS ? { on: 0, off: 0 } : { on: 1, off: r.off + 1 };
      }
    } else delete st.rl[bk];
  }
  // forget places that are no longer pinned
  for (const m of [st.pl, st.hp, st.rl]) for (const k of Object.keys(m)) if (!live.has(k)) delete m[k];
  return { messages, state: st };
}

export const BROADCAST_HOST = "sl-water-levels.vercel.app";

/** Checks the owner's broadcast input. Returns { ok: true, payload } (no endpoints involved) or { ok: false, error }. */
export function broadcastPayload({ title, body, url, language }) {
  const t = String(title ?? "").trim(), b = String(body ?? "").trim(), u = String(url ?? "").trim();
  const lang = String(language ?? "all").trim() || "all";
  if (!t || t.length > 80) return { ok: false, error: "title is required, 80 characters at most" };
  if (!b || b.length > 240) return { ok: false, error: "body is required, 240 characters at most" };
  if (!["all", "en", "si", "ta"].includes(lang)) return { ok: false, error: "language must be all, en, si or ta" };
  let path = "/";
  if (u) {
    let parsed;
    try { parsed = new URL(u); } catch { return { ok: false, error: "url must be a full https://sl-water-levels.vercel.app/... address" }; }
    if (parsed.protocol !== "https:" || parsed.hostname !== BROADCAST_HOST || parsed.username || parsed.password || parsed.port) return { ok: false, error: `url must be on ${BROADCAST_HOST}` };
    path = parsed.pathname + parsed.search + parsed.hash;
  }
  return { ok: true, language: lang, payload: { title: t, body: b, url: path, tag: "announce", lang: lang === "all" ? undefined : lang } };
}

/** Who gets a broadcast: everyone who did not turn announcements off, in the chosen language. */
export const broadcastRecipients = (subs, language) => subs.filter((s) => s.prefs.announce && (language === "all" || s.lang === language));
