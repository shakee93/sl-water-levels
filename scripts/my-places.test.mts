// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types scripts/my-places.test.mts
import assert from "node:assert/strict";
import {
  parseKey, parseKeys, MAX_PLACES, levelOf, overall, pushStep, PUSH_FLAP_MS, outcomes, scorecard, shownCount, worstPerDay, K_MIN,
} from "../lib/myPlaces.ts";

// ---- keys
assert.deepEqual(parseKey("t:wellampitiya"), { kind: "t", slug: "wellampitiya", lv: null, key: "t:wellampitiya" });
assert.equal(parseKey("t:wellampitiya@3.456")?.key, "t:wellampitiya@3.46");
assert.equal(parseKey("t:Bad Slug"), null);
assert.equal(parseKey("t:x@-2"), null);
assert.equal(parseKey("t:x@abc"), null);
assert.equal(parseKey("s:Nagalagam Street")?.name, "Nagalagam Street");
assert.equal(parseKey("s:"), null);
assert.equal(parseKey("x:y"), null);
assert.equal(parseKey("s:a|b"), null);
assert.equal(parseKeys("t:a|t:a|bogus|s:B").length, 2, "dedupes and drops invalid");
assert.equal(parseKeys(Array.from({ length: 30 }, (_, i) => `t:p${i}`).join("|")).length, MAX_PLACES);
assert.deepEqual(parseKeys(null), []);

// ---- levels and the overall line
const g = (o) => ({ key: "t:a", kind: "t", name: "A", href: "/flood/a", tone: "normal", street: null, trend: "steady", levelText: null, rain24: null, rainNext24: null, gaugeStation: null, ts: 1, ...o });
assert.equal(levelOf(g({})), 0);
assert.equal(levelOf(g({ tone: "watch" })), 1);
assert.equal(levelOf(g({ tone: "alert" })), 2);
assert.equal(levelOf(g({ tone: "normal", street: "possible" })), 0, "heavy rain over a low spot is a personal note, never a level");
assert.equal(levelOf(g({ tone: "normal", street: "likely" })), 0);
assert.equal(levelOf(g({ tone: "watch", street: "likely" })), 1);
assert.equal(levelOf(g({ tone: "minor", street: "possible" })), 3);
assert.equal(levelOf(g({ tone: "alert", street: "possible" })), 2);
assert.equal(levelOf(g({ tone: "stale" })), null, "no data is unknown, never calm");
assert.equal(levelOf(g({ tone: "none" })), null, "no published flood levels is unknown, never calm");
assert.equal(levelOf(g({ tone: "stale", street: "possible" })), null, "rain does not make a place readable");
assert.equal(overall([]).kind, "empty");
assert.deepEqual(overall([g({}), g({})]), { kind: "calm", n: 2 });
assert.equal(overall([g({}), g({ tone: "stale" })]).kind, "unknown", "one calm + one unknown is not 'all calm'");
assert.equal(overall([g({ tone: "stale" })]).kind, "unknown");
const att = overall([g({}), g({ key: "t:b", tone: "alert" }), g({ key: "t:c", tone: "watch" })]);
assert.equal(att.kind, "attention");
assert.equal(att.worst.key, "t:b");
assert.equal(att.calmOthers, 1);

// ---- push state machine
const H = 3_600_000;
let t = 1_000 * H;
let s = pushStep(null, 0, t);
assert.equal(s.send, null, "first sight never sends");
assert.equal(pushStep(null, 2, t).next.notified, 2, "first sight at alert counts as announced (so the all-clear comes)");
s = pushStep(s.next, 1, (t += H / 2));
assert.equal(s.send, null, "calm-ish -> keep an eye: silent");
s = pushStep(s.next, 2, (t += H / 2));
assert.equal(s.send, "rise", "rise to get-ready");
s = pushStep(s.next, 2, (t += H / 2));
assert.equal(s.send, null, "same level again: silent");
s = pushStep(s.next, 3, (t += H / 2));
assert.equal(s.send, "rise", "escalation is always sent");
s = pushStep(s.next, 2, (t += H / 2));
assert.equal(s.send, null, "de-escalation silent");
s = pushStep(s.next, 3, (t += H / 2));
assert.equal(s.send, null, "back to a level already announced: silent");
s = pushStep(s.next, 1, (t += H / 2));
assert.equal(s.send, null, "first calm check: not yet");
s = pushStep(s.next, 2, (t += H / 2));
assert.equal(s.next.clearRuns, 0, "a wobble resets the all-clear count");
assert.equal(s.send, null);
s = pushStep(s.next, 0, (t += H / 2));
s = pushStep(s.next, 1, (t += H / 2));
assert.equal(s.send, "clear", "two calm checks in a row: one all-clear");
assert.equal(s.next.notified, 0);
s = pushStep(s.next, 0, (t += H / 2));
assert.equal(s.send, null, "all-clear is sent once");
// flap guard: rise again soon after the previous rise, after a clear -> recorded, silent
const lastRise = s.next.lastRiseMs;
s = pushStep(s.next, 2, lastRise + PUSH_FLAP_MS - 1);
assert.equal(s.send, null, "flap within 3 h is silent");
assert.equal(s.next.notified, 2, "...but recorded, so the all-clear later still comes");
// unknown changes nothing
const before = s.next;
assert.deepEqual(pushStep(before, null, t + H).next, before);
assert.equal(pushStep(before, null, t + H).send, null);
// a rise long after the last rise is sent
let c = pushStep({ level: 0, notified: 0, lastRiseMs: 0, clearRuns: 0 }, 2, PUSH_FLAP_MS + 1);
assert.equal(c.send, "rise");

// ---- closure + k-anonymity
assert.equal(shownCount(2), null);
assert.equal(shownCount(K_MIN), K_MIN);
assert.deepEqual(worstPerDay([
  { day: "2026-10-22", state: "none" }, { day: "2026-10-22", state: "likely" }, { day: "2026-10-22", state: "possible" },
  { day: "2026-10-23", state: null }, { day: "2026-10-24", state: "none" },
]), [{ day: "2026-10-22", state: "likely" }, { day: "2026-10-24", state: "none" }]);
const rain = [{ day: "2026-10-22", state: "possible" }, { day: "2026-10-23", state: "likely" }, { day: "2026-10-24", state: "none" }, { day: "2026-10-25", state: "possible" }];
const ans = [{ day: "2026-10-22", wet: 6, dry: 1 }, { day: "2026-10-23", wet: 1, dry: 1 }, { day: "2026-10-24", wet: 9, dry: 0 }, { day: "2026-10-25", wet: 1, dry: 4 }];
const o = outcomes(rain, ans);
assert.equal(o.length, 2, "2 answers on 23 Oct is below the minimum: no outcome; 24 Oct the rule said nothing");
assert.equal(o[0].day, "2026-10-25");
assert.equal(o[0].result, "dry");
assert.equal(o[1].result, "wet");
assert.equal(scorecard(rain, ans), null, "too few judged warnings for a running score");
// only "likely" is a warning and is scored; "possible" days (22 and 25 Oct) are a heads-up and are not
const rain3 = [...rain, { day: "2026-10-26", state: "likely" }, { day: "2026-10-27", state: "likely" }, { day: "2026-10-28", state: "likely" }, { day: "2026-10-29", state: "none" }];
const ans3 = [...ans, { day: "2026-10-26", wet: 5, dry: 0 }, { day: "2026-10-27", wet: 0, dry: 4 }, { day: "2026-10-28", wet: 3, dry: 0 }];
assert.deepEqual(scorecard(rain3, ans3), { warnedDays: 4, checkedDays: 3, confirmedDays: 2 });
assert.equal(scorecard(rain, []), null);
assert.equal(scorecard([{ day: "d", state: "none" }], ans), null);
console.log("my-places: ok");

// ---- strings: every language has every key and the same placeholders
import { rtFor, pushText, seasonKey } from "../lib/i18n/return.ts";
const en2 = rtFor("en");
for (const lang of ["si", "ta"]) {
  const x = rtFor(lang);
  for (const k of ["mp.calmN", "cl.score", "im.thanks", "pn.riseTitle", "pn.morningAttn", "mp.todayRain", "off.body", "cl.river"]) {
    const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    assert.equal(ph(x(k)), ph(en2(k)), `${lang} ${k} placeholders`);
  }
}
assert.equal(seasonKey(10), "season.inter2");
assert.equal(seasonKey(7), "season.sw");
assert.equal(seasonKey(1), "season.ne");
assert.equal(seasonKey(3), "season.inter1");
assert.equal(pushText("en", "rise", [{ name: "Wellampitiya", level: 3, street: "likely", riverLevel: 0 }]).title, "Heavy rain near Wellampitiya: your low spot is likely to get water");
assert.ok(!/flood|Water on the streets/i.test(pushText("en", "rise", [{ name: "Wellampitiya", level: 3, street: "likely", riverLevel: 0 }]).body.replace("does not mean the area is flooding", "")), "no flood claim in the low-spot push");
assert.equal(pushText("en", "rise", [{ name: "Wellampitiya", level: 3, street: "likely", riverLevel: 3 }]).title, "Wellampitiya: Minor flood", "when the river is at that level the river verdict wins");
assert.equal(pushText("en", "rise", [{ name: "Wellampitiya", level: 2, street: "possible" }]).title, "Wellampitiya: Alert", "a river alert is 'Alert' even when the quiet street heads-up is also on");
assert.equal(pushText("en", "rise", [{ name: "Hanwella", level: 4, street: null }]).body, "Open for the latest. Call 117 if you need help.");
assert.equal(pushText("en", "clear", [{ name: "Hanwella", level: 0, street: null }]).title, "Hanwella: back to normal");
assert.equal(pushText("en", "morning", [{ name: "A", level: 0, street: null }, { name: "B", level: 0, street: null }]).body, "All 2 places are calm.");
console.log("strings: ok");
