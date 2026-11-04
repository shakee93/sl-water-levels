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

const { riverMeta, riverFacts, gaugeMeta, TITLE_MAX, DESC_MAX } = await import("../lib/seoMeta.ts");
const { riverAnswer, riverFaq } = await import("../lib/answers.ts");
const { representativeGauge } = await import("../lib/seoNames.ts");

// ---- a minimal gauge snapshot (only what the builders read)
const st = (station: string, level: number, tier: string, th = { alert: 17.1, minor: 24.6, major: 31.2 }, unit = "ft") =>
  ({ station, basin: "Kalu Ganga", unit, thresholds: th, tier, levelTier: tier, latest: { water_level: level, ts: Date.UTC(2026, 10, 4, 5, 0) }, rate3hM: null }) as any;
const kalu = [
  st("Putupaula", 9.1, "normal"),
  st("Rathnapura", 9.94, "normal"),
  st("Kalawellawa", 16.7, "alert", { alert: 16.5, minor: 22, major: 28 }),
  ...Array.from({ length: 8 }, (_, i) => st(`G${i}`, 3 + i, "normal")),
];

// ---- river title: status and flood level lead, no digits, within the limit
const m = riverMeta("en", "Kalu Ganga", { gauges: [], facts: riverFacts("en", "Kalu Ganga", kalu) });
assert.equal(m.title, "Kalu Ganga (Kaluganga) Water Level Today – Live Status");
const k = riverMeta("en", "Kelani Ganga", { gauges: [] });
assert.equal(k.title, "Kelani River Water Level Today – Live Status & Flood Level");
for (const b of ["Kelani Ganga", "Gin Ganga", "Kumbukkan Oya", "Mahaweli Ganga", "Nilwala Ganga", "Very Long River Oya"]) {
  const t = riverMeta("en", b, { gauges: [] }).title;
  assert.ok(t.length <= TITLE_MAX, `${b}: ${t.length} ${t}`);
  assert.ok(!/\d/.test(t), `no digits in ${t}`);
}
assert.match(riverMeta("en", "Very Long River Oya", { gauges: [] }).title, /\(Live, Map\)$/); // too long: the old wording

// ---- river description: leads with a real level, <= 155, one "Kaluganga"
assert.ok(m.description.startsWith("Kalu Ganga (Kaluganga) status now: Kalawellawa 16.7 ft (Alert); 1 of 11 gauges at or above alert."), m.description);
assert.match(m.description, /Ratnapura 9\.9 ft\./);
assert.ok(m.description.length <= DESC_MAX, `${m.description.length}`);
assert.equal((m.description.match(/Kaluganga/g) ?? []).length, 1);
assert.ok(!/Updated hourly/.test(m.description));
const calm = kalu.map((s) => (s.station === "Kalawellawa" ? st("Kalawellawa", 9, "normal") : s));
const mc = riverMeta("en", "Kalu Ganga", { gauges: [], facts: riverFacts("en", "Kalu Ganga", calm) });
assert.match(mc.description, /^Kalu Ganga \(Kaluganga\) status now: all 11 gauges normal \(Ratnapura 9\.9 ft\)\. /, mc.description);
assert.ok(mc.description.length <= DESC_MAX);
// near alert is Normal (official steps only); a stale gauge is not counted
const watch = riverFacts("en", "Kalu Ganga", [st("Rathnapura", 16, "watch"), st("X", 1, "stale")]);
assert.equal(watch.flagged, 0);
assert.equal(watch.reporting, 1);
// no reading at all: the generic line, still without "Updated hourly"
assert.ok(!/Updated hourly/.test(riverMeta("en", "Kalu Ganga", { gauges: ["Ratnapura"] }).description));
// si / ta carry the level too
for (const l of ["si", "ta"] as const) assert.match(riverMeta(l, "Kalu Ganga", { gauges: [], facts: riverFacts(l, "Kalu Ganga", kalu) }).description, /16\.7 ft/);

// ---- representative gauge: table, then demand order, then first
assert.equal(representativeGauge("Kalu Ganga", ["Putupaula", "Ratnapura"]), "Ratnapura");
assert.equal(representativeGauge("Kelani Ganga", ["Glencourse", "Hanwella"]), "Hanwella");
assert.equal(representativeGauge("Kalu Ganga", ["Ellagawa", "Putupaula"]), "Putupaula"); // table gauge not reporting -> most searched
assert.equal(representativeGauge("Unknown Oya", ["Zed", "Yan"]), "Zed");
assert.equal(representativeGauge("Unknown Oya", []), null);

// ---- gauge title / description
const g = gaugeMeta("en", { gauge: "Ratnapura", basin: "Kalu Ganga", oneGauge: false, level: "9.9 ft", status: "Normal", alert: "17.1 ft", minor: "24.6 ft", major: "31.2 ft" });
assert.equal(g.title, "Ratnapura Water Level Today & Flood Level (Kalu Ganga)");
assert.equal(g.description, "Ratnapura water level, latest reading: 9.9 ft (Normal). Flood levels: alert 17.1 ft, minor 24.6 ft, major 31.2 ft. Kalu Ganga gauge with a next-hour forecast.");
assert.deepEqual(g.alias, "Also searched as Rathnapura.");
// Hanwella keeps the title that already performs
assert.equal(gaugeMeta("en", { gauge: "Hanwella", basin: "Kelani Ganga", oneGauge: false }).title, "Hanwella Water Level Today (Kelani River, Live)");
// a long gauge name falls back (still within the limit); marks that do not exist are left out
const long = gaugeMeta("en", { gauge: "Kalawellawa (Millakanda)", basin: "Kelani Ganga", oneGauge: false, level: "3 ft", status: "", alert: "—", minor: "—", major: "—" });
assert.ok(long.title.length <= TITLE_MAX, long.title);
assert.match(long.description, /No official flood levels are published/);
const some = gaugeMeta("en", { gauge: "X", basin: "Kalu Ganga", oneGauge: false, level: "3 ft", status: "Alert", alert: "2 ft", minor: "—", major: "—" });
assert.match(some.description, /Flood levels: alert 2 ft\. /);
assert.ok(!/—/.test(some.description));
// a one-gauge river: the river's query leads
assert.match(gaugeMeta("en", { gauge: "Dunamale", basin: "Aththanagalu Oya", oneGauge: true }).title, /^Aththanagalu Oya Water Level Today & Flood Level \(Dunamale\)$/);

// ---- answers: levels even when calm; flood-level and status FAQs
const a = riverAnswer("en", ((k: string) => k) as any, "Kalu Ganga", calm);
assert.match(a, /below their alert levels \(Ratnapura 9\.9 ft, Putupaula 9\.1 ft, /);
const af = riverAnswer("en", ((k: string) => k) as any, "Kalu Ganga", kalu);
assert.match(af, /Kalawellawa \(16\.7 ft\)/);
assert.match(af, /Other gauges: Ratnapura 9\.9 ft/);
const faq = riverFaq("en", "Kalu Ganga", a, ["Putupaula", "Ratnapura"], [], null, kalu);
const q = faq.map((x) => x.q);
assert.ok(q.includes("What is the flood level on the Kalu Ganga?"), q.join("|"));
assert.ok(q.includes("What is the status of the Kalu Ganga?"));
assert.match(faq.find((x) => x.q.startsWith("What is the flood level"))!.a, /Ratnapura: alert 17\.1 ft, minor flood 24\.6 ft, major flood 31\.2 ft/);
for (const l of ["si", "ta"] as const) assert.equal(riverFaq(l, "Kalu Ganga", "x", [], [], null, kalu).length, riverFaq("en", "Kalu Ganga", "x", [], [], null, kalu).length);

console.log("seo-meta tests passed");
