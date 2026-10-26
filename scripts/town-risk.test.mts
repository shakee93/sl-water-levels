// @ts-nocheck (node strip-types test: explicit .ts extensions)
// node --experimental-strip-types scripts/town-risk.test.mts
import assert from "node:assert/strict";
import { assessTown, type GaugeIn, type TownRiskInput } from "../lib/townRisk.ts";
import { readFileSync } from "node:fs";
import { PLACES } from "../lib/places.ts";
import { FAR_GAUGE_KM } from "../lib/townRisk.ts";

const g = (o: Partial<GaugeIn> = {}): GaugeIn => ({ station: "Nagalagam Street", name: "Nagalagam Street", basin: "Kelani Ganga", tier: "normal", level: 2, unit: "ft", ts: 0, rate3hM: 0, km: 3, ...o });
const base = (o: Partial<TownRiskInput> = {}): TownRiskInput => ({ drainage: "canal-backwater", primary: g(), secondary: null, forecast: null, rain: null, release: null, warning: null, now: 0, ...o });
const rain = (o = {}) => ({ past6hMm: 0, past24hMm: 0, next6hMm: 0, next24hMm: 0, next24hP90Mm: null, next6hP90Mm: null, ...o });

// slugs are unique
assert.equal(new Set(PLACES.map((p) => p.slug)).size, PLACES.length);

// calm
assert.equal(assessTown(base()).tone, "normal");
// heavy rain on a calm river: one step
assert.equal(assessTown(base({ rain: rain({ next6hMm: 60 }) })).tone, "watch");
assert.equal(assessTown(base({ rain: rain({ past24hMm: 120 }) })).tone, "watch");
// rain does not stack beyond one step
assert.equal(assessTown(base({ primary: g({ tier: "alert" }), rain: rain({ next6hMm: 80 }) })).tone, "minor");
assert.equal(assessTown(base({ primary: g({ tier: "minor" }), rain: rain({ next6hMm: 80 }) })).tone, "minor");
assert.equal(assessTown(base({ primary: g({ tier: "major" }), rain: rain({ next6hMm: 80 }) })).tone, "major");
// upland: rain stops at watch; river alert unchanged
assert.equal(assessTown(base({ drainage: "upland", primary: g({ tier: "alert" }), rain: rain({ next6hMm: 80 }) })).tone, "alert");
// light rain does nothing; ensemble never changes the tone
assert.equal(assessTown(base({ rain: rain({ next24hMm: 30, next24hP90Mm: 200 }) })).tone, "normal");
// rain the river gauges measured: a heads-up ("watch") on a calm river, never more, never on top of a higher tone
const mh = { gaugeName: "Holombuwa", hours: 3, mm: 43 };
const m1 = assessTown(base({ measured: mh }));
assert.equal(m1.tone, "watch");
assert.ok(m1.reasons.some((r) => r.key === "r.rainMeasured" && r.warn));
assert.equal(assessTown(base({ measured: { ...mh, local: true } })).reasons.some((r) => r.key === "r.rainMeasuredLocal"), true);
assert.equal(assessTown(base({ primary: g({ tier: "alert" }), measured: mh })).tone, "alert");
assert.equal(assessTown(base({ measured: mh, rain: rain({ next6hMm: 60 }) })).tone, "watch");
assert.equal(assessTown(base({ primary: g({ tier: "watch" }), measured: mh })).reasons.find((r) => r.key === "r.rainMeasured").warn, false);
// canal early rule
assert.equal(assessTown(base({ primary: g({ tier: "watch", rate3hM: 0.05 }) })).tone, "alert");
assert.equal(assessTown(base({ drainage: "riverbank", primary: g({ tier: "watch", rate3hM: 0.05 }) })).tone, "watch");
// personal level
assert.equal(assessTown(base({ primary: g({ level: 4.6 }) }), 4.5).tone, "minor");
assert.equal(assessTown(base({ primary: g({ level: 4.0 }) }), 4.5).tone, "watch");
assert.equal(assessTown(base({ primary: g({ level: 4.0, rate3hM: 0.05 }) }), 4.5).tone, "alert");
assert.equal(assessTown(base({ primary: g({ level: 2 }) }), 4.5).tone, "normal");
// warnings are floors, and never push past minor
assert.equal(assessTown(base({ warning: { severity: "alert", source: "DMC", area: "Kelani Ganga" } })).tone, "alert");
assert.equal(assessTown(base({ warning: { severity: "major flood", source: "DMC", area: "x" } })).tone, "minor");
// no gauge
assert.equal(assessTown(base({ primary: g({ tier: "stale" }) })).tone, "stale");
assert.equal(assessTown(base({ primary: g({ tier: "stale" }), rain: rain({ next6hMm: 60 }) })).tone, "watch");
// secondary takes over
assert.equal(assessTown(base({ primary: g({ tier: "stale" }), secondary: g({ station: "Hanwella", name: "Hanwella", tier: "alert" }) })).tone, "alert");


// ---------------------------------------------------------------------------------------------
// Edge cases (each derived by hand from the rules at the top of lib/townRisk.ts)
const fc = (o = {}) => ({ status: "ok", h1Level: 2.1, h24Level: 3, maxLevel: 3, currentLevel: 2, metresPerUnit: 0.3048, crossings: [], ...o });
const cross = (o = {}) => ({ threshold: "alert", wording: "likely", etaTs: 5 * 3_600_000, ...o });
const keys = (r) => r.reasons.map((x) => x.key);

// -- stale / unusable gauges
assert.equal(assessTown(base({ primary: g({ tier: "stale" }), secondary: g({ tier: "stale" }) })).tone, "stale");
assert.equal(assessTown(base({ primary: null })).tone, "stale");
assert.equal(assessTown(base({ primary: g({ level: null }) })).tone, "stale");
assert.equal(assessTown(base({ primary: g({ tier: "stale" }) })).hourKey, "dir.unknown");
// gauge too far away is not used; the nearer secondary is
assert.equal(assessTown(base({ primary: g({ km: FAR_GAUGE_KM + 1, tier: "alert" }), secondary: g({ station: "Hanwella", name: "Hanwella", tier: "normal", km: 20 }) })).gauge.station, "Hanwella");
assert.equal(assessTown(base({ primary: g({ km: FAR_GAUGE_KM + 1, tier: "alert" }) })).tone, "stale");
assert.ok(!keys(assessTown(base({ primary: g({ km: FAR_GAUGE_KM + 1 }) }))).includes("r.noGauge"), "a far gauge is not blamed for 'no recent reading'");
// stale gauge with an official warning still gets the floor, no gauge line claims a level
{
  const r = assessTown(base({ primary: g({ tier: "stale" }), warning: { severity: "alert", source: "DMC", area: "Colombo" } }));
  assert.equal(r.tone, "alert");
  assert.ok(keys(r).includes("r.noGauge"));
  assert.ok(!keys(r).includes("r.river"));
}

// -- gauge without published flood levels (Ampara): no estimate, unless the visitor saved a street level
{
  const none = g({ tier: "none", level: 3.2, unit: "m", station: "Ampara", name: "Ampara", basin: "Gal Oya" });
  const a = assessTown(base({ drainage: "riverbank", primary: none }));
  assert.equal(a.tone, "stale");
  assert.ok(keys(a).includes("r.noMarks"));
  assert.equal(assessTown(base({ drainage: "riverbank", primary: none }), 3.3).tone, "watch"); // 3.2 >= 0.85 * 3.3
  assert.equal(assessTown(base({ drainage: "riverbank", primary: none }), 3.2).tone, "minor");
  assert.equal(assessTown(base({ drainage: "riverbank", primary: none }), 9).tone, "normal");
  assert.ok(!keys(assessTown(base({ drainage: "riverbank", primary: none }), 9)).some((k) => k === "r.river"), "no tier wording for a gauge without marks");
  assert.equal(assessTown(base({ drainage: "riverbank", primary: none, rain: rain({ next6hMm: 70 }) })).tone, "watch"); // rain alone: watch
}

// -- units: the street level and the reading are always in the same (gauge) unit, so ft and m behave identically
for (const [unit, scale] of [["ft", 1], ["m", 0.3048]] as const) {
  const lv = (x: number) => x * scale;
  assert.equal(assessTown(base({ primary: g({ unit, level: lv(4.6) }) }), lv(4.5)).tone, "minor", unit);
  assert.equal(assessTown(base({ primary: g({ unit, level: lv(4.0) }) }), lv(4.5)).tone, "watch", unit);
  assert.equal(assessTown(base({ primary: g({ unit, level: lv(3.0) }) }), lv(4.5)).tone, "normal", unit);
}
{
  // reasons are shown in feet (metre gauges converted)
  const ft = assessTown(base({ primary: g({ unit: "ft", level: 5 }) }), 4.5);
  assert.match(ft.reasons.find((x) => x.kind === "personal").vars.level, /^5\.0 ft$/);
  const m = assessTown(base({ primary: g({ unit: "m", level: 1.4 }) }), 1.25);
  assert.match(m.reasons.find((x) => x.kind === "personal").vars.mine, /^4\.1 ft$/); // 1.25 m
  // a reading with unknown unit has no suffix
  const u = assessTown(base({ primary: g({ unit: null, level: 5 }) }), 4.5);
  assert.equal(u.reasons.find((x) => x.kind === "personal").vars.level, "5");
}
// rising is judged in metres per hour whatever the gauge unit
assert.equal(assessTown(base({ primary: g({ unit: "m", tier: "watch", rate3hM: 0.05 }) })).tone, "alert");
assert.equal(assessTown(base({ primary: g({ unit: "ft", tier: "watch", rate3hM: 0.05 }) })).tone, "alert");
assert.equal(assessTown(base({ primary: g({ tier: "watch", rate3hM: 0.003 }) })).tone, "watch"); // below the rising threshold

// -- bad personal levels are ignored
for (const bad of [0, -1, NaN, Infinity]) assert.equal(assessTown(base({ primary: g({ level: 9 }) }), bad).tone, assessTown(base({ primary: g({ level: 9 }) })).tone, String(bad));
assert.equal(assessTown(base({ primary: g({ level: -0.4 }) }), 4.5).tone, "normal"); // negative reading
// personal level below the official alert mark makes the verdict stricter than the gauge tier
assert.equal(assessTown(base({ primary: g({ tier: "normal", level: 3.4 }) }), 3.4).tone, "minor");
// ... and above the official marks it never lowers the tone
assert.equal(assessTown(base({ primary: g({ tier: "minor", level: 6 }) }), 9).tone, "minor");
assert.equal(assessTown(base({ primary: g({ tier: "major", level: 8 }) }), 20).tone, "major");
// forecast reaching the street's level while rising -> get ready; same forecast while steady -> nothing
assert.equal(assessTown(base({ primary: g({ level: 3, rate3hM: 0.05 }), forecast: fc({ maxLevel: 4.6 }) }), 4.5).tone, "alert");
assert.equal(assessTown(base({ primary: g({ level: 3, rate3hM: 0 }), forecast: fc({ maxLevel: 4.6 }) }), 4.5).tone, "normal");
assert.equal(assessTown(base({ primary: g({ level: 3, rate3hM: 0.05 }), forecast: fc({ status: "unavailable", maxLevel: 4.6 }) }), 4.5).tone, "normal");

// -- rain: null is not zero
{
  const noRain = assessTown(base());
  assert.ok(!keys(noRain).includes("r.calm"), "no 'no heavy rain expected' without a rain feed");
  assert.equal(noRain.day.key, "n24.riverOnly");
  const withRain = assessTown(base({ rain: rain() }));
  assert.ok(keys(withRain).includes("r.calm"));
  assert.equal(withRain.day.key, "n24.none");
  assert.ok(!keys(withRain).some((k) => k.startsWith("r.rain")));
  assert.equal(assessTown(base({ rain: null, primary: g({ tier: "watch" }) })).tone, "watch");
}
// heavy rain that FELL does not claim heavy rain is expected
{
  const r = assessTown(base({ rain: rain({ past24hMm: 130, next24hMm: 2 }) }));
  assert.equal(r.tone, "watch");
  assert.notEqual(r.day.key, "n24.rain");
  assert.ok(keys(r).includes("r.rainPastHeavy"));
  assert.equal(assessTown(base({ rain: rain({ next6hMm: 55, next24hMm: 70 }) })).day.key, "n24.rain");
}
// ensemble 90th percentile: wording only, never the tone
{
  const r = assessTown(base({ rain: rain({ next24hMm: 20, next24hP90Mm: 160 }) }));
  assert.equal(r.tone, "normal");
  assert.equal(r.day.key, "n24.rainPossible");
}
// exact boundaries
assert.equal(assessTown(base({ rain: rain({ next6hMm: 50 }) })).tone, "watch");
assert.equal(assessTown(base({ rain: rain({ next6hMm: 49.9 }) })).tone, "normal");
assert.equal(assessTown(base({ rain: rain({ past24hMm: 100 }) })).tone, "watch");
assert.equal(assessTown(base({ rain: rain({ past24hMm: 99.9 }) })).tone, "normal");
// riverbank: rain moves watch -> alert too; upland stops at watch
assert.equal(assessTown(base({ drainage: "riverbank", primary: g({ tier: "watch" }), rain: rain({ next6hMm: 60 }) })).tone, "alert");
assert.equal(assessTown(base({ drainage: "upland", primary: g({ tier: "watch" }), rain: rain({ next6hMm: 60 }) })).tone, "watch");
assert.equal(assessTown(base({ drainage: "upland", primary: g({ tier: "normal" }), rain: rain({ next6hMm: 60 }) })).tone, "watch");

// -- forecast
{
  // likely crossing lifts normal/watch to alert, whatever the trend
  const r = assessTown(base({ drainage: "riverbank", forecast: fc({ crossings: [cross()] }) }));
  assert.equal(r.tone, "alert");
  assert.equal(r.day.key, "n24.reachAlert");
  // a "possible" crossing no longer says Get ready on its own: calm "watch" with the small-chance line (lib/verdictLift.ts)
  const poss = assessTown(base({ drainage: "riverbank", forecast: fc({ crossings: [cross({ wording: "possible" })] }) }));
  assert.equal(poss.tone, "watch");
  assert.equal(poss.day.key, "n24.reachSmallAlert");
  // possible + p >= 0.4 + central forecast close to the mark + rising (not tidal) = alert; far from the mark = still watch
  const near = { level: 4, probability: 0.45, wording: "possible" };
  const closeFc = fc({ currentLevel: 3, crossings: [cross(near)], horizons: [{ h: 6, level: 3.9 }] });
  assert.equal(assessTown(base({ drainage: "riverbank", primary: g({ station: "Hanwella", rising: true }), forecast: closeFc })).tone, "alert");
  assert.equal(assessTown(base({ drainage: "riverbank", primary: g({ station: "Hanwella", rising: false }), forecast: closeFc })).tone, "watch");
  assert.equal(assessTown(base({ drainage: "riverbank", primary: g({ station: "Hanwella", rising: true }), forecast: fc({ currentLevel: 3, crossings: [cross(near)], horizons: [{ h: 6, level: 3.3 }] }) })).tone, "watch");
  // a tidal gauge's raw 3 h rate is the tide: never counts as rising
  assert.equal(assessTown(base({ drainage: "riverbank", primary: g({ rate3hM: 0.05 }), forecast: closeFc })).tone, "watch");
  // likely at p >= 0.6 lifts regardless of rising; 0.55 "likely" does not on its own
  assert.equal(assessTown(base({ drainage: "riverbank", primary: g({ station: "Hanwella" }), forecast: fc({ crossings: [cross({ probability: 0.65 })] }) })).tone, "alert");
  assert.equal(assessTown(base({ drainage: "riverbank", primary: g({ station: "Hanwella" }), forecast: fc({ crossings: [cross({ probability: 0.55 })] }) })).tone, "watch");
  // unlikely / already crossings change nothing
  assert.equal(assessTown(base({ drainage: "riverbank", forecast: fc({ crossings: [cross({ wording: "unlikely" })] }) })).tone, "normal");
  // flood-level crossing wording; unknown ETA uses the "within 24 hours" wording
  assert.equal(assessTown(base({ drainage: "riverbank", forecast: fc({ crossings: [cross({ threshold: "minor", etaTs: null })] }) })).day.key, "n24.reachFloodDay");
  // unavailable forecast is ignored
  assert.equal(assessTown(base({ drainage: "riverbank", forecast: fc({ status: "unavailable", crossings: [cross()] }) })).tone, "normal");
  // trend-only forecast (no 24 h level): next hour comes from it, no crossing, still a sensible line
  const t = assessTown(base({ drainage: "riverbank", forecast: fc({ status: "degraded", h24Level: null, maxLevel: 2.2, h1Level: 2.3 }) }));
  assert.equal(t.hourKey, "dir.rising");
  assert.equal(t.tone, "normal");
  // hour direction uses metres: 0.1 ft = 0.03 m/h -> slow; 0.4 ft = 0.12 m -> rising; 0.01 ft -> steady
  assert.equal(assessTown(base({ forecast: fc({ h1Level: 2.1 }) })).hourKey, "dir.slow");
  assert.equal(assessTown(base({ forecast: fc({ h1Level: 2.4 }) })).hourKey, "dir.rising");
  assert.equal(assessTown(base({ forecast: fc({ h1Level: 2.01 }) })).hourKey, "dir.steady");
  assert.equal(assessTown(base({ forecast: fc({ h1Level: 1.7 }) })).hourKey, "dir.falling");
}

// -- releases
{
  const rel = { confirmed: true, reservoir: "Castlereagh", cusecs: 12000, etaHours: 6 };
  // confirmed release + rising + near alert -> alert (not for upland)
  assert.equal(assessTown(base({ drainage: "riverbank", primary: g({ tier: "watch", rate3hM: 0.05 }), release: rel })).tone, "alert");
  assert.equal(assessTown(base({ drainage: "upland", primary: g({ tier: "watch", rate3hM: 0.05 }), release: rel })).tone, "watch");
  // a calm river is not lifted by a release
  assert.equal(assessTown(base({ drainage: "riverbank", primary: g({ tier: "normal", rate3hM: 0.05 }), release: rel })).tone, "normal");
  // unconfirmed (news) release is a line, never a lift
  assert.equal(assessTown(base({ drainage: "riverbank", primary: g({ tier: "watch", rate3hM: 0.05 }), release: { ...rel, confirmed: false } })).tone, "watch");
  assert.ok(keys(assessTown(base({ drainage: "riverbank", primary: g({ tier: "watch", rate3hM: 0.05 }), release: { ...rel, confirmed: false } }))).includes("r.releaseNews"));
  // a confirmed release without a figure that lifted the tone still says why
  const nf = assessTown(base({ drainage: "riverbank", primary: g({ tier: "watch", rate3hM: 0.05 }), release: { ...rel, cusecs: null } }));
  assert.equal(nf.tone, "alert");
  assert.ok(keys(nf).includes("r.releaseNoFigure"));
}

// -- warnings
{
  const w = (severity) => ({ severity, source: "DMC", area: "Kelani Ganga" });
  assert.equal(assessTown(base({ warning: w("none") })).tone, "normal");
  assert.equal(assessTown(base({ warning: w("advisory") })).tone, "watch");
  assert.equal(assessTown(base({ warning: w("minor flood") })).tone, "alert");
  assert.equal(assessTown(base({ warning: w("evacuation") })).tone, "minor");
  // a floor never lowers
  assert.equal(assessTown(base({ primary: g({ tier: "major" }), warning: w("advisory") })).tone, "major");
  // the warning line is listed first
  assert.equal(assessTown(base({ warning: w("alert") })).reasons[0].kind, "official");
  // rain + advisory: rain step then floor, still just watch
  assert.equal(assessTown(base({ warning: w("advisory"), rain: rain({ next6hMm: 60 }) })).tone, "watch");
}

// -- stacking never exceeds the documented caps
assert.equal(assessTown(base({ primary: g({ tier: "alert", rate3hM: 0.1 }), rain: rain({ past6hMm: 90, next24hMm: 200 }), warning: { severity: "alert", source: "x", area: "y" }, release: { confirmed: true, reservoir: "r", cusecs: 1, etaHours: 1 } }), 1).tone, "minor");
assert.equal(assessTown(base({ primary: g({ tier: "watch", rate3hM: 0.1 }), rain: rain({ next6hMm: 99 }) })).tone, "minor"); // canal-early alert, +1 rain
assert.equal(assessTown(base({ primary: g({ tier: "watch", rate3hM: 0.1 }) })).tone, "alert");
// every result is internally consistent
for (const tier of ["normal", "watch", "alert", "minor", "major", "none", "stale"]) {
  for (const drainage of ["canal-backwater", "riverbank", "upland"]) {
    for (const rn of [null, rain(), rain({ next6hMm: 80 })]) {
      for (const my of [null, 2, 4.5]) {
        const r = assessTown(base({ drainage, primary: g({ tier }), rain: rn }), my);
        assert.ok(["normal", "watch", "alert", "minor", "major", "stale"].includes(r.tone));
        assert.equal(r.actionKey, r.tone === "alert" ? "a.alert" : r.tone === "minor" ? "a.minor" : r.tone === "major" ? "a.major" : null);
        for (const x of r.reasons) for (const v of Object.values(x.vars)) assert.ok(!/NaN|undefined|null/.test(String(v)), `${tier}/${drainage}: ${x.key} ${v}`);
        assert.ok(!/NaN|undefined/.test(JSON.stringify(r.day)));
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Gazetteer sanity
for (const p of PLACES) {
  assert.ok(p.stations.length >= 1, `${p.name} has a gauge`);
  assert.match(p.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, p.slug);
  assert.ok(p.lat > 5.8 && p.lat < 9.9 && p.lon > 79.5 && p.lon < 82, `${p.name} is inside Sri Lanka`);
}
for (const n of ["Wellampitiya", "Kolonnawa", "Kotikawatta", "Mulleriyawa", "Orugodawatta", "Kelaniya"]) assert.equal(PLACES.find((p) => p.name === n).drainage, "canal-backwater", n);
assert.equal(PLACES.find((p) => p.name === "Ratnapura").drainage, "riverbank");
assert.equal(PLACES.find((p) => p.name === "Kandy").drainage, "upland");
assert.equal(PLACES.find((p) => p.name === "Nuwara Eliya").drainage, "upland");

// Translations: every language keeps every placeholder of the English string
{
  const src = readFileSync(new URL("../lib/i18n/town.ts", import.meta.url), "utf8");
  const parse = (from: string, to: string) => {
    const body = src.slice(src.indexOf(from), to ? src.indexOf(to) : undefined);
    const m = new Map<string, string>();
    for (const l of body.split("\n")) { const x = /^\s+"([^"]+)": (".*"),?$/.exec(l); if (x) m.set(x[1], JSON.parse(x[2])); }
    return m;
  };
  const en = parse("const en = {", "const si: D");
  const si = parse("const si: D", "const ta: D");
  const ta = parse("const ta: D", "const DICTS");
  const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  assert.ok(en.size > 100);
  for (const [name, d] of [["si", si], ["ta", ta]] as const) {
    assert.equal(d.size, en.size, `${name} has every key`);
    for (const [k, v] of en) {
      assert.ok(d.has(k), `${name} missing ${k}`);
      assert.equal(ph(d.get(k)), ph(v), `${name} ${k} placeholders`);
      assert.ok(d.get(k).trim().length > 0, `${name} ${k} empty`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Low-spot rain level: satellite 24 h rain 60 mm = "possible", 100 mm = "likely". It is a personal opt-in note (lib/lowSpots.ts):
// it NEVER changes the verdict, the reasons or the next-24-hours line. The Kelani at its minor flood level is a river reading
// and does lift the tone. mm24h in StreetRainIn is the CLIPPED sum (each hour capped at 15 mm); mm24hRaw is display only.
{
  const sr = (mm24h: number, mm24hRaw: number | null = mm24h) => ({ mm24h, mm24hRaw, mm6h: 10, mm1h: 1, endsAt: 0 });
  const t = (o = {}) => assessTown(base({ streetRain: sr(0), ...o }));
  // thresholds, edge by edge; the tone never moves
  for (const [mm, level] of [[0, null], [59, null], [59.9, null], [60, "possible"], [99, "possible"], [99.9, "possible"], [100, "likely"], [250, "likely"]] as const) {
    const r = t({ streetRain: sr(mm) });
    assert.equal(r.tone, "normal", `${mm} mm: rain alone leaves the verdict to the river`);
    assert.equal(r.lowSpot?.level ?? null, level, `${mm} mm level`);
    assert.equal(r.actionKey, null);
    assert.ok(!keys(r).some((k) => k.startsWith("r.street")), "no street line in Why");
    assert.notEqual(r.day.key, "n24.street");
  }
  assert.equal(t({ streetRain: sr(112) }).lowSpot?.mm, 112);
  // missing / stale data (null) or a town without the rule (undefined): no level, no calm claim
  for (const streetRain of [null, undefined]) assert.equal(t({ streetRain }).lowSpot, null);
  assert.equal(t({ streetRain: null, primary: g({ tier: "stale" }) }).tone, "stale"); // no data and no gauge: still "no estimate"
  // heavy satellite rain does not turn "no estimate" or any river tier into something else
  assert.equal(t({ streetRain: sr(70), primary: g({ tier: "stale" }) }).tone, "stale");
  assert.equal(t({ streetRain: sr(250), primary: null }).tone, "stale");
  for (const tier of ["watch", "alert", "major"] as const) assert.equal(t({ streetRain: sr(250), primary: g({ tier }) }).tone, tier);
  assert.equal(t({ streetRain: sr(250), primary: g({ tier: "watch" }) }).baseTone, "watch");
  // the Open-Meteo model is not part of this rule: model rain alone never sets the level, and its own step is unchanged
  const om = t({ streetRain: sr(10), rain: rain({ past24hMm: 300 }) });
  assert.equal(om.lowSpot, null);
  assert.equal(om.tone, "watch");
  assert.equal(t({ streetRain: sr(110), rain: rain({ past24hMm: 300 }) }).tone, "watch"); // satellite adds nothing on top
  // official warning: unchanged by the rule
  assert.equal(t({ streetRain: sr(70), warning: { severity: "alert", source: "DMC", area: "Kelani Ganga" } }).tone, "alert");
  // the rule reads the clipped sum, not the raw one: raw 140 mm with a 59 mm clipped sum is nothing, raw 80 / clipped 100 is "likely"
  assert.equal(t({ streetRain: sr(59, 140) }).lowSpot, null);
  assert.equal(t({ streetRain: sr(100, 80) }).lowSpot?.level, "likely");
  // river trigger: the Kelani at its minor flood level lifts the town to "Flooding likely" with NO rain at all, or with satellite data missing
  const riv = { triggered: true, gauge: "Hanwella", level: "25.1 ft" };
  {
    const r = t({ streetRain: sr(0), streetRiver: riv });
    assert.equal(r.tone, "minor");
    assert.equal(r.baseTone, "minor"); // a river reading: part of the base tone the alerts follow
    assert.equal(r.lowSpot, null);
    assert.deepEqual(r.reasons.find((x) => x.key === "r.streetRiver")?.vars, { gauge: "Hanwella", level: "25.1 ft" });
    assert.equal(r.day.key, "n24.street");
    assert.equal(r.actionKey, "a.minor");
    assert.equal(t({ streetRain: null, streetRiver: riv }).tone, "minor"); // the river half does not need the satellite
    assert.equal(t({ streetRain: sr(130), streetRiver: riv }).lowSpot?.level, "likely");
    // not triggered, or town without the rule: nothing
    assert.equal(t({ streetRain: sr(0), streetRiver: { triggered: false, gauge: "", level: "" } }).tone, "normal");
    assert.equal(t({ streetRain: sr(0), streetRiver: null }).tone, "normal");
    assert.equal(t({ streetRain: sr(0), streetRiver: undefined }).tone, "normal");
    // a major river still wins on tone
    assert.equal(t({ streetRain: sr(0), streetRiver: riv, primary: g({ tier: "major" }) }).tone, "major");
  }
  // which towns carry the rule: only the validated ones, all canal-backwater
  const zoned = PLACES.filter((p) => p.rainZone).map((p) => p.name).sort();
  assert.deepEqual(zoned, ["Angoda", "Dematagoda", "Gothatuwa", "Kolonnawa", "Kotikawatta", "Meethotamulla", "Mulleriyawa", "Orugodawatta", "Wellampitiya"]);
  for (const p of PLACES.filter((p) => p.rainZone)) {
    assert.equal(p.drainage, "canal-backwater", p.name);
    // inside the 4-pixel box the thresholds were fitted on (6.8-7.0 N, 79.8-80.0 E)
    assert.ok(p.lat > 6.8 && p.lat < 7.0 && p.lon > 79.8 && p.lon < 80.0, `${p.name} inside the rain box`);
  }
  // translations carry the new strings with the same placeholders (checked in full below too)
}

// Live station list: gauge-in-town and distance checks (skipped offline)
try {
  const res = await fetch("https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services/hydrostations/FeatureServer/0/query?where=1%3D1&outFields=basin,station,latitude,longitude&returnGeometry=false&f=json", { signal: AbortSignal.timeout(15000) });
  const hs = new Map((await res.json()).features.map((f) => [f.attributes.station.replace(/\s+/g, " ").trim(), f.attributes]));
  const km = (a, b) => { const r = (d) => (d * Math.PI) / 180; const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
  assert.ok(hs.size > 30);
  for (const p of PLACES) {
    for (const s of p.stations) assert.ok(hs.has(s), `${p.name}: unknown gauge "${s}"`);
    const d0 = km(p, { lat: hs.get(p.stations[0]).latitude, lon: hs.get(p.stations[0]).longitude });
    if (d0 < 1.5) assert.notEqual(p.drainage, "upland", `${p.name} has a gauge in town, so it is on the river`);
    const nearest = Math.min(...p.stations.map((s) => km(p, { lat: hs.get(s).latitude, lon: hs.get(s).longitude })));
    assert.ok(nearest <= FAR_GAUGE_KM, `${p.name}: nearest listed gauge is ${nearest.toFixed(0)} km away`);
  }
} catch (e) {
  if (e instanceof assert.AssertionError) throw e;
  console.log("(station list unreachable, skipped gauge-distance checks)");
}
console.log("town-risk ok");
