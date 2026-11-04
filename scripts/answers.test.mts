// @ts-nocheck (node strip-types test; a resolve hook adds the .ts extensions the app's extensionless imports lack)
// node --experimental-strip-types --no-warnings scripts/seo-meta.test.mts
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const root = pathToFileURL(new URL("..", import.meta.url).pathname + "/").href;
register(
  "data:text/javascript," +
    encodeURIComponent(`
const root = ${JSON.stringify(root)};
export async function resolve(spec, ctx, next) {
  if (spec.startsWith("@/")) spec = root + spec.slice(2);
  try { return await next(spec, ctx); } catch (e) {
    for (const ext of [".ts", ".tsx", "/index.ts"]) { try { return await next(spec + ext, ctx); } catch {} }
    throw e;
  }
}`),
);
const { stationAnswer, stationFaq, nextHourSentence, townFaq, directionKey } = await import("../lib/answers.ts");
const { forecastHeadline } = await import("../lib/forecastText.ts");
const { readingLooksUnreliable } = await import("../lib/units.ts");
const { gaugeMeta } = await import("../lib/seoMeta.ts");

const t = ((k: string) => k) as any;
const ts = Date.UTC(2026, 10, 4, 5, 0);
const st = (station: string, level: number, o: any = {}) =>
  ({ station, basin: "Kalu Ganga", unit: "ft", thresholds: { alert: 17.1, minor: 24.6, major: 31.2 }, tier: "normal", levelTier: "normal", latest: { water_level: level, ts }, rate3hM: null, trend24h: [], metresPerUnit: 0.3048, ...o }) as any;
const nh = (o: any = {}) => ({ level_ft: 5, low_ft: null, high_ft: null, change_ft: 0.02, direction: "rising", slow: true, crossing: null, issuedAt: "x", method: "trend", experimental: true, rainRisk: null, modelView: null, readingAgeMin: null, ...o }) as any;

// unreliable readings: no number, no trend, no comparison with a mark
assert.ok(readingLooksUnreliable("Weraganthota", -8.2, "ft"));
assert.ok(readingLooksUnreliable("Foo", -0.1, "ft"));
assert.ok(readingLooksUnreliable("Foo", 0, null));
assert.ok(!readingLooksUnreliable("Foo", 0, "ft"));
assert.ok(!readingLooksUnreliable("Hanwella", 12, "ft"));
for (const [s, lv, unit] of [["Weraganthota", -8.2, "ft"], ["Ampara", 0, null]] as const) {
  const a = stationAnswer("en", t, st(s, lv, { unit, rate3hM: 0.02 }));
  assert.ok(/looks wrong/.test(a) && !/below|alert level|rising|-8\.2|0\.0/.test(a), a);
  assert.ok(!stationFaq("en", st(s, lv, { unit, rate3hM: 0.02 }), a, nh()).some((f) => /next hour|today/i.test(f.q)), "no trend or next-hour answer for an unreliable gauge");
}
const m = gaugeMeta("en", { gauge: "Weraganthota", basin: "Mahaweli Ganga", oneGauge: false, unreliable: true });
assert.ok(/unreliable/.test(m.description) && !/forecast/.test(m.description));

// the top sentence names its window, one steady threshold
assert.match(stationAnswer("en", t, st("Hanwella", 10, { rate3hM: -0.08 / 3.2808 })), /falling over the last 3 hours/);
assert.match(stationAnswer("en", t, st("Hanwella", 10, { rate3hM: 0.002 })), /steady over the last 3 hours/);

// next hour: the word is the tile's, "stay about the same" only for Steady with nothing in reach
assert.match(nextHourSentence("en", nh({ direction: "steady", change_ft: 0.02 }))!, /stay about the same/);
assert.doesNotMatch(nextHourSentence("en", nh({ direction: "rising", change_ft: 0.02 }))!, /stay about the same/);
assert.doesNotMatch(nextHourSentence("en", nh({ direction: "steady", change_ft: 0.02, crossing: "may reach alert level" }))!, /stay about the same/);
assert.doesNotMatch(nextHourSentence("en", nh({ direction: "steady", change_ft: 0.4 }))!, /stay about the same/);
// owner decision 4 Nov 2026: measured word first, then what the model expects
assert.match(nextHourSentence("en", nh({ direction: "falling", change_ft: 0.3, modelView: "up" }))!, /falling now, but the forecast expects it to turn up/);
assert.match(nextHourSentence("en", nh({ direction: "rising", change_ft: -0.3, modelView: "down" }))!, /rising now, but the forecast expects it to ease/);
// an old reading is said
assert.match(nextHourSentence("en", nh({ readingAgeMin: 70 }))!, /latest reading is 70 minutes old/);
// si / ta: "could" stays a possibility and the unit order is one per language
assert.doesNotMatch(nextHourSentence("si", nh({ direction: "rising", change_ft: 0.4, level_ft: 6 }))!, /අපේක්ෂා කෙරේ/);
assert.match(nextHourSentence("si", nh({ direction: "rising", change_ft: 0.4, level_ft: 6 }))!, /අඩි 6\.0/);
assert.match(nextHourSentence("ta", nh({ direction: "falling", change_ft: -0.4, level_ft: 6 }))!, /6\.0 அடி/);

// a tidal gauge's tide-only rise is not "rising"
assert.equal(directionKey(st("Hanwella", 10, { rate3hM: 0.003 })), "steady");
assert.equal(directionKey(st("Hanwella", 10, { rate3hM: 0.03 })), "risingSlow");

// the town FAQ never prints a raw placeholder, in any language
for (const l of ["en", "si", "ta"] as const) {
  for (const f of townFaq(l, "Horana", "x", { name: "Millakanda", km: "14 km" })) assert.doesNotMatch(f.a + f.q, /\{\w+\}/, `${l}: ${f.q}`);
}
assert.match(townFaq("en", "Horana", "x", { name: "Millakanda", km: "14 km" }).map((f) => f.a).join(" "), /Millakanda, 14 km away/);

// the forecast headline in si / ta, from the same facts (English unchanged)
const f = (headlineParts: any) => ({ headline: "ENGLISH", headlineParts });
assert.equal(forecastHeadline(f({ k: "unclear" }), "en"), "ENGLISH");
assert.equal(forecastHeadline({ headline: "ENGLISH" }, "si"), "ENGLISH", "older cached runs without parts stay English");
for (const l of ["si", "ta"] as const) {
  for (const p of [
    { k: "unclear" }, { k: "trend", dir: "steady", level: "5.0 ft", pred: "5.0 ft", rate: null }, { k: "trend", dir: "falling", level: "4.1 ft", pred: "4.0 ft", rate: "0.08 ft" },
    { k: "below", mark: "alert", hedge: true, spanH: 24 }, { k: "below", mark: "minor", hedge: false, spanH: 6 }, { k: "about", level: "5.0 ft", spanH: 24 },
    { k: "reach", r: { likely: false, mark: "alert", etaH: 3, spanH: 24, pct: 25 } }, { k: "above", mark: "alert", then: "keeps", spanH: 24 },
    { k: "above", mark: "alert", then: "stay", spanH: 24, reach: { likely: true, mark: "minor", etaH: null, spanH: 24, pct: 30 } }, { k: "none", why: "stale" },
  ]) {
    const h = forecastHeadline(f(p), l);
    assert.notEqual(h, "ENGLISH");
    assert.doesNotMatch(h, /undefined|\{/, `${l} ${JSON.stringify(p)}: ${h}`);
  }
}
assert.match(forecastHeadline(f({ k: "trend", dir: "falling", level: "4.1 ft", pred: "4.0 ft", rate: "0.08 ft" }), "si"), /4\.1 ft/);

console.log("answers tests passed");

// ---- embed widget: every "w.*" key is translated in si / ta (the builder pages e.*, p.*, wd.* stay English on purpose)
const { EMBED_DICTS } = await import("../lib/i18n/embed.ts");
for (const l of ["si", "ta"] as const) {
  const same = Object.keys(EMBED_DICTS.en).filter((k) => k.startsWith("w.") && EMBED_DICTS[l][k] === EMBED_DICTS.en[k]);
  assert.deepEqual(same, [], `${l} widget keys still English`);
}

// ---- outbound wording (never who gets a post or push, or when)
const { pushText } = await import("../lib/i18n/return.ts");
assert.match(pushText("en", "rise", [{ name: "Hanwella", level: 3, street: null }]).body, /117/, "117 at Minor flood");
assert.doesNotMatch(pushText("en", "rise", [{ name: "Hanwella", level: 2, street: null }]).body, /117/);
assert.doesNotMatch(pushText("en", "clear", [{ name: "Hanwella", level: 0, street: null }]).body, /No action needed/);
assert.match(pushText("en", "morning", [{ name: "A", level: 0, street: null }], { unreadable: 1 }).body, /cannot check 1 of your places/);
const { composeCaption } = await import("../lib/igCompose.ts");
const cap = composeCaption({ type: "gauge_rise", gauge: { station: "Hanwella", river: "Kelani Ganga", tier: "minor", level: 24.9, trend: "rising" } } as any, { feed: false }).text;
assert.ok(/24\.9/.test(cap.split("\n").slice(1, 3).join("\n")) && /117/.test(cap.split("\n")[1] + cap.split("\n")[2]), "si / ta Instagram lines carry level and 117");
console.log("outbound wording ok");

// river answer: only Alert-step gauges say so first, with the right verb
const { riverAnswer } = await import("../lib/answers.ts");
const kal = [st("Putupaula", 20, { tier: "alert" }), st("Rathnapura", 9, {})];
const ra = riverAnswer("en", t, "Kalu Ganga", kal);
assert.match(ra, /no gauge on the Kalu Ganga is at a flood level\. 1 of the 2 reporting gauges is at Alert/);

// tide line: the day after tomorrow is not "tomorrow"
const { tideDayKey } = await import("../lib/tide.ts");
const noon = Date.UTC(2026, 10, 4, 6, 0);
assert.equal(tideDayKey(noon + 3_600_000, noon), "tide.today");
assert.equal(tideDayKey(noon + 24 * 3_600_000, noon), "tide.tomorrow");
assert.equal(tideDayKey(noon + 48 * 3_600_000, noon), "tide.later");
console.log("river / tide ok");
