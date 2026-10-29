// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types scripts/feedback.test.mts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validateAnswer, validateDetails, validateWater, cleanNote, cleanLocation, roundCoord, distKm, noteTags, isUrgent, deviceOf, colomboDay, fbCookieName,
  NOTE_MAX, MIN_FILL_MS, LIMIT_PER_IP_PER_TARGET_DAY, LIMIT_PER_IP_PER_DAY, LIMIT_PER_IP_PER_10_MIN,
} from "../lib/feedback.ts";
import { tally, obsVsVerdict, byDistance, againstForecast, publicFeedback, digestText, K_MIN, oncePerPerson, oncePerPersonAcross, tooMildLines } from "../lib/feedbackLearn.mjs";
import { fbFor } from "../lib/i18n/feedback.ts";

const isTown = (s) => s === "hanwella" || s === "wellampitiya";
const isStation = (s) => s === "Hanwella" || s === "Nagalagam Street";
const ok = { op: "answer", page: "station", station: "Hanwella", answer: "worse", tone: "alert", lang: "si", hp: "", ms: 4000 };

// ---- validation: first tap
assert.deepEqual(validateAnswer(ok, isTown, isStation), { ok: true, value: { page: "station", station: "Hanwella", town: null, answer: "worse", tone: "alert", lang: "si" } });
assert.equal(validateAnswer({ ...ok, answer: "maybe" }, isTown, isStation).reason, "invalid");
assert.equal(validateAnswer({ ...ok, station: "Nowhere" }, isTown, isStation).reason, "invalid");
assert.equal(validateAnswer({ ...ok, station: undefined }, isTown, isStation).reason, "invalid");
assert.equal(validateAnswer({ ...ok, page: "river" }, isTown, isStation).reason, "invalid");
assert.equal(validateAnswer(null, isTown, isStation).reason, "invalid");
assert.equal(validateAnswer([], isTown, isStation).reason, "invalid");
// honeypot and speed => bot (route answers "thanks", stores nothing)
assert.equal(validateAnswer({ ...ok, hp: "http://spam" }, isTown, isStation).reason, "bot");
assert.equal(validateAnswer({ ...ok, ms: MIN_FILL_MS - 1 }, isTown, isStation).reason, "bot");
assert.equal(validateAnswer({ ...ok, ms: "4000" }, isTown, isStation).reason, "bot");
// town page: needs a real town, and the gauge (if given) must be real
const town = { ...ok, page: "town", town: "hanwella", station: "Hanwella" };
assert.equal(validateAnswer(town, isTown, isStation).ok, true);
assert.equal(validateAnswer(town, isTown, isStation).value.town, "hanwella");
assert.equal(validateAnswer({ ...town, town: "atlantis" }, isTown, isStation).reason, "invalid");
assert.equal(validateAnswer({ ...town, station: "Nowhere" }, isTown, isStation).reason, "invalid");
// unknown tone and language fall back, never pass through
assert.equal(validateAnswer({ ...ok, tone: "<script>" }, isTown, isStation).value.tone, null);
assert.equal(validateAnswer({ ...ok, lang: "fr" }, isTown, isStation).value.lang, "en");

// ---- validation: second step
const tok = "0123456789abcdef01234567";
const d = validateDetails({ token: tok, river: "banks", rain: "heavy", note: "water near the bridge", lat: 6.9012, lon: 79.8651, hp: "" });
assert.equal(d.ok, true);
assert.deepEqual(d.value.loc, { lat: 6.9, lon: 79.87 });
assert.equal(d.value.river, "banks");
assert.equal(validateDetails({ token: "short" }).reason, "invalid");
assert.equal(validateDetails({ token: tok.toUpperCase() }).reason, "invalid");
assert.equal(validateDetails({ token: tok, hp: "x" }).reason, "bot");
const junk = validateDetails({ token: tok, river: "lava", rain: 5, lat: "6.9", lon: null });
assert.equal(junk.ok, true);
assert.equal(junk.value.river, null);
assert.equal(junk.value.rain, null);
assert.equal(junk.value.loc, null);
// a rude note drops only the note
const rude = validateDetails({ token: tok, river: "high", note: "this is shit" });
assert.equal(rude.value.note, null);
assert.equal(rude.value.noteReason, "rude");
assert.equal(rude.value.river, "high");

// ---- rounding: 0.01 degree, never more precise; outside the island is dropped
assert.equal(roundCoord(6.91249), 6.91);
assert.equal(roundCoord(79.8651), 79.87);
assert.deepEqual(cleanLocation(6.912345678, 79.861234567), { lat: 6.91, lon: 79.86 });
assert.equal(String(cleanLocation(7.123456, 80.987654).lat).length <= 4, true);
assert.equal(cleanLocation(51.5, -0.12), null);
assert.equal(cleanLocation(NaN, 80), null);
assert.equal(cleanLocation("7", "80"), null);
assert.equal(cleanLocation(null, null), null);
const dk = distKm({ lat: 6.9, lon: 79.87 }, { lat: 6.9, lon: 79.88 });
assert.ok(dk > 1 && dk < 1.2, `0.01 degree of longitude is about 1.1 km, got ${dk}`);
assert.equal(distKm({ lat: 7, lon: 80 }, { lat: 7, lon: 80 }), 0);

// ---- free text
assert.equal(cleanNote("Water on the road near the junction").text, "Water on the road near the junction");
assert.equal(cleanNote("see https://evil.example/x?a=1 now").text, "see now");
assert.equal(cleanNote("visit www.spam.lk today").text, "visit today");
assert.equal(cleanNote("mail me a.b@mail.com ok").text, "mail me ok");
assert.equal(cleanNote("call 077 123 4567 or +94 77-123-4567 please").text, "call or please");
assert.equal(cleanNote("water 3 ft, rain 40 mm").text, "water 3 ft, rain 40 mm", "short numbers survive");
assert.equal(cleanNote("හන්දිය අසල පාරේ වතුර").text, "හන්දිය අසල පාරේ වතුර");
assert.equal(cleanNote("பாலம் அருகே தண்ணீர்").text, "பாலம் அருகே தண்ணீர்");
assert.equal(cleanNote("a".repeat(900)).reason, "spam");
assert.equal(cleanNote("flood ".repeat(200)).reason, "spam");
assert.equal(cleanNote("x".repeat(3) + " ".repeat(5) + "y".repeat(3)).text.length <= NOTE_MAX, true);
assert.equal(cleanNote(("ab cd ".repeat(300) + "q").replace(/ab cd/g, (m, i) => (i % 12 ? m : "ok" + (i / 6 | 0)))).text.length <= NOTE_MAX, true);
assert.equal(cleanNote("   ").reason, "empty");
assert.equal(cleanNote("12345").reason, "empty", "no letters");
assert.equal(cleanNote("you fuck").reason, "rude");
assert.equal(cleanNote("Scunthorpe flood class").text, "Scunthorpe flood class", "word boundaries: no false hits");
assert.equal(cleanNote(42).reason, "spam");
assert.equal(cleanNote(null).reason, "empty");
assert.ok(cleanNote("z\u0000z​z ok").text === "zzz ok");
assert.deepEqual(noteTags("water on the road near the bridge, heavy rain"), ["water", "rain", "road_home", "place"]);
assert.deepEqual(noteTags(null), []);
assert.ok(noteTags("thanks, very useful").includes("praise"));

// ---- urgent, device, cookie, day
assert.equal(isUrgent("worse", "flooding"), true);
assert.equal(isUrgent("worse", "banks"), false);
assert.equal(isUrgent("yes", "flooding"), false);
assert.equal(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148"), "mobile");
assert.equal(deviceOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), "desktop");
assert.equal(deviceOf(null), "desktop");
assert.equal(fbCookieName("station", "Nagalagam Street"), "sl_fb_s_nagalagam-street");
assert.equal(fbCookieName("town", "hanwella"), "sl_fb_t_hanwella");
assert.ok(!/[\s;=,]/.test(fbCookieName("station", "Weird; Name = x,y")));
assert.equal(colomboDay(Date.parse("2026-10-26T20:00:00Z")), "2026-10-27", "20:00 UTC is already tomorrow in Colombo");

// ---- caps: the same shape as the flood report, and the route uses all three
assert.equal(LIMIT_PER_IP_PER_TARGET_DAY < LIMIT_PER_IP_PER_DAY, true);
assert.equal(LIMIT_PER_IP_PER_10_MIN <= LIMIT_PER_IP_PER_DAY, true);
const route = readFileSync(new URL("../app/api/feedback/route.ts", import.meta.url), "utf8");
for (const c of ["LIMIT_PER_IP_PER_10_MIN", "LIMIT_PER_IP_PER_DAY", "LIMIT_PER_IP_PER_TARGET_DAY"]) assert.ok(route.includes(`${c} `) || route.includes(`${c},`) || route.includes(`${c})`), c);
assert.ok(/rate_limited/.test(route) && /ipHash/.test(route));
assert.ok(!/ip_hash, ?\?/.test("") && !/\[[^\]]*\bip\b[^\]]*\]/.test(route.replace(/const ip =[^\n]*/, "")), "the raw address is never a bound parameter");
// the table exists in the migration and in the route's own creation, with the same columns
const sql = readFileSync(new URL("../d1/0008_feedback.sql", import.meta.url), "utf8");
const cols = (t) => [...t.matchAll(/^\s*([a-z_0-9]+)\s+(?:INTEGER|TEXT|REAL)/gm)].map((m) => m[1]);
const routeCreate = route.match(/CREATE TABLE IF NOT EXISTS forecast_feedback \((.*?)\)`,/s)[1];
const inline = [...routeCreate.matchAll(/(?:^|, )([a-z_0-9]+) (?:INTEGER|TEXT|REAL)/g)].map((m) => m[1]).sort();
assert.deepEqual(cols(sql.split("CREATE TABLE IF NOT EXISTS forecast_feedback")[1].split("CREATE INDEX")[0]).sort(), inline);

// ---- learning: joins and aggregates
const R = (o) => ({ station: "Hanwella", answer: "yes", river_obs: null, dist_km: null, shown_tier: "normal", err1h: null, inBand1h: null, created_ms: 1000, note: null, ...o });
const rows = [
  R({ answer: "yes", river_obs: "normal", dist_km: 0.4, err1h: 0.02, inBand1h: 1 }),
  R({ answer: "yes", river_obs: "normal", dist_km: 0.9, err1h: -0.01, inBand1h: 1 }),
  R({ answer: "worse", river_obs: "banks", dist_km: 4, err1h: 0.4, inBand1h: 0, shown_tier: "alert", note: "water at the bridge" }),
  R({ answer: "worse", river_obs: "flooding", dist_km: 6, err1h: 0.3, inBand1h: 0, shown_tier: "alert" }),
  R({ answer: "better", river_obs: "normal", dist_km: 12, shown_tier: "minor" }),
  R({ answer: "unsure" }),
];
const t = tally(rows);
assert.equal(t.n, 6);
assert.equal(t.agreePct, 40); // 2 of the 5 that judged
assert.equal(t.worsePct, 40);
assert.equal(t.betterPct, 20);
const ov = obsVsVerdict(rows);
assert.deepEqual([ov.n, ov.higher, ov.same, ov.lower], [5, 2, 2, 1]); // banks vs alert: rank 2 > 1 higher; flooding higher; normal/normal same x2; normal vs minor lower
const bd = byDistance(rows);
assert.deepEqual(bd.map((b) => [b.label, b.n]), [["under 1 km", 2], ["3 to 10 km", 2], ["over 10 km", 1]]);
assert.equal(bd[0].agreePct, 100);
assert.equal(bd[1].agreePct, 0, "far from the gauge nobody agreed: the gauge may not represent that area");
const af = againstForecast(rows);
assert.equal(af.meanErrWorse, 0.35, "when people said worse, the river ended above our forecast");
assert.ok(af.meanErrYes < 0.05);
assert.equal(af.inBandWhenYesPct, 100);
// public output: aggregates only, k >= 3, nothing else
const pub = publicFeedback([...rows, R({ station: "Other", answer: "yes" }), R({ station: "Other", answer: "worse" })]);
assert.equal(K_MIN, 3);
assert.deepEqual(Object.keys(pub.stations), ["Hanwella"], "a gauge with 2 answers is not published");
assert.deepEqual(Object.keys(pub.stations.Hanwella).sort(), ["agreePct", "betterPct", "n", "worsePct"]);
assert.equal(publicFeedback([R({}), R({})]).overall, null);
assert.ok(!JSON.stringify(pub).includes("bridge"), "notes never reach the public file");
// the digest is private and includes notes and distance
const dg = digestText({ day: "2026-10-27", rows, urgentCount: 1 });
assert.ok(/water at the bridge/.test(dg) && /6 answers/.test(dg) && /Hanwella 2 of 6/.test(dg) && /roads or in homes/.test(dg));
assert.ok(/no answers/.test(digestText({ day: "d", rows: [] })));

// ---- one visitor counts once within 30 minutes (29 Oct 2026: Colombo 08:33 and Dematagoda 08:34, same answers)
{
  const M = 60_000, t0 = 1_800_000_000_000;
  const a = { id: 1, created_ms: t0, day: "d", person_day: "A", station: "Nagalagam Street", answer: "worse" };
  const b = { id: 2, created_ms: t0 + M, day: "d", person_day: "A", station: "Dematagoda", answer: "worse" };
  const c = { id: 3, created_ms: t0 + 31 * M, day: "d", person_day: "A", station: "Hanwella", answer: "worse" };
  const o = { id: 4, created_ms: t0 + 2 * M, day: "d", person_day: "B", station: "Hanwella", answer: "yes" };
  const n1 = { id: 5, created_ms: t0, answer: "yes" }, n2 = { id: 6, created_ms: t0 + M, answer: "yes" };
  assert.deepEqual(oncePerPerson([b, o, a, c]).map((r) => r.id), [1, 4, 3], "second answer a minute later dropped; 31 min later counts again");
  assert.equal(oncePerPerson([n1, n2]).length, 2, "rows without a person key all count");
  assert.equal(oncePerPerson([{ ...a, person_day: null, ip_hash: "h" }, { ...b, person_day: null, ip_hash: "h" }]).length, 1, "ip hash + day is the fallback key");
  assert.equal(tally(oncePerPerson([a, b, o])).worse, 1);
  // across forms: a feedback answer and a map report in the same second are one person
  const [fb, , f3] = oncePerPersonAcross([[a], [], [{ id: 9, created_ms: t0, person_day: "A" }, { id: 10, created_ms: t0, person_day: "C" }]]);
  assert.equal(fb.length, 1);
  assert.deepEqual(f3.map((r) => r.id), [10], "the earlier list wins a tie");
  // the digest and the public aggregate count the person once; the raw array is untouched
  const raw = [a, b, c, o];
  assert.ok(/3 answers/.test(digestText({ day: "d", rows: raw })));
  assert.equal(raw.length, 4);
  assert.equal(publicFeedback(raw.map((r) => ({ ...r, station: "X" }))).overall.n, 3);
}

// ---- "worse" while we showed Normal or Watch: its own digest line, once per person, place and rain included
{
  const base = { created_ms: 1_800_000_000_000, day: "d", answer: "worse", page: "station", station: "Hanwella", shown_tier: "normal", shown_level: 8.4, notified: 0 };
  const lines = tooMildLines([
    { ...base, person_day: "A", water_at: "road", place_pick: "kolonnawa", rain_3h_mm: 12.34, rain_24h_mm: 40 },
    { ...base, created_ms: base.created_ms + 60_000, person_day: "A", station: "Other" },
    { ...base, person_day: "B", shown_tier: "alert" },
    { ...base, person_day: "C", notified: 1 },
    { ...base, person_day: "D", answer: "yes" },
  ]);
  assert.equal(lines.length, 1);
  assert.ok(/Someone at Kolonnawa says it is worse than shown: water on the road; we showed Normal at Hanwella 8.4 ft; rain at their spot 12.3 mm in 3 h, 40 mm in 24 h; /.test(lines[0]), lines[0]);
  assert.ok(/water on the road/.test(digestText({ day: "d", rows: [{ ...base, person_day: "A", water_at: "road" }] })));
}

// ---- languages: every key in every language, same placeholders
for (const lang of ["en", "si", "ta"]) {
  const f = fbFor(lang);
  assert.ok(f("fb.impact", { n: 12, m: 9, name: "Hanwella" }).includes("12"));
  assert.ok(f("fb.impact", { n: 12, m: 9, name: "Hanwella" }).includes("Hanwella"));
  assert.ok(!/\{\w+\}/.test(f("fb.noteCount", { n: 1, max: 500 })));
}
const src = readFileSync(new URL("../lib/i18n/feedback.ts", import.meta.url), "utf8");
assert.deepEqual(validateWater({ token: tok, water_at: "inside", hp: "" }).value, { token: tok, waterAt: "inside" });
assert.equal(validateWater({ token: tok, water_at: "roof" }).reason, "invalid");
assert.equal(validateWater({ token: "x", water_at: "road" }).reason, "invalid");
assert.equal(validateWater({ token: tok, water_at: "road", hp: "bot" }).reason, "bot");
const keys = (blk) => [...blk.matchAll(/"(fb\.[\w.]+)":/g)].map((m) => m[1]);
const [en, si, ta] = [src.split("const si")[0], src.split("const si")[1].split("const ta")[0], src.split("const ta")[1]].map(keys);
assert.deepEqual(si, en);
assert.deepEqual(ta, en);
console.log("feedback tests passed");
