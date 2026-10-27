#!/usr/bin/env node
// Checks that addresses answer with the right status and redirect, and that 100 sitemap URLs are plain 200s.
//   node scripts/redirect-check.mjs [baseUrl]        (default https://waterlevels.lk)
//   node scripts/redirect-check.mjs --quick          (the table only: ~25 requests, used by the SEO workflow)
// Exits 1 on any failure. Redirects are never followed, so a chain shows up as a wrong status.
const args = process.argv.slice(2);
const quick = args.includes("--quick");
const base = (args.find((a) => !a.startsWith("--")) ?? "https://waterlevels.lk").replace(/\/$/, "");
const UA = "waterlevels-redirect-check (+https://waterlevels.lk)";

// [path, expected status, expected Location path (redirects only)]
const TABLE = [
  // junk is a real 404, not a 200 with a not-found page
  ["/nonexistent-xyz", 404],
  ["/basins/not-a-river", 404],
  ["/kelani-ganga/not-a-gauge", 404],
  ["/flood/not-a-town", 404],
  ["/reservoirs/not-a-reservoir", 404],
  ["/history/not-a-river", 404],
  ["/about/whatever", 404],
  ["/si/nonexistent-xyz", 404],
  ["/ta/flood/not-a-town", 404],
  ["/river/not-a-river", 404],
  // case
  ["/Kelani-Ganga", 308, "/kelani-ganga"],
  ["/Flood/Wellampitiya", 308, "/flood/wellampitiya"],
  ["/Flood/Wellampitiya?x=1", 308, "/flood/wellampitiya?x=1"],
  ["/si/Kelani-Ganga", 308, "/si/kelani-ganga"],
  ["/About", 308, "/about"],
  // old or guessed names
  ["/basins", 308, "/rivers"],
  ["/flood-estimates", 308, "/flood"],
  ["/towns", 308, "/flood"],
  ["/towns/wellampitiya", 308, "/flood/wellampitiya"],
  ["/dams", 308, "/reservoirs"],
  ["/river/kelani-ganga", 308, "/kelani-ganga"],
  ["/rivers/kelani-ganga", 308, "/kelani-ganga"],
  ["/basins/kelani-ganga", 308, "/kelani-ganga"],
  ["/reservoir/not-checked-here", 404],
  ["/si/basins", 308, "/si/rivers"],
  ["/en/about", 308, "/about"],
  ["/en/Kelani-Ganga", 308, "/kelani-ganga"],
  // real pages stay 200
  ["/", 200],
  ["/rivers", 200],
  ["/flood", 200],
  ["/flood/wellampitiya", 200],
  ["/reservoirs", 200],
  ["/reservoirs/spilling", 200],
  ["/history", 200],
  ["/kelani-ganga", 200],
  ["/si/flood", 200],
  ["/rain-map", 308, "/rain"],
  ["/sitemap.xml", 200],
  ["/robots.txt", 200],
  ["/api/health", 200],
];

let fails = 0;
const get = (url) => fetch(url, { redirect: "manual", headers: { "user-agent": UA } });
const pad = (s, n) => String(s).padEnd(n);

for (const [path, status, loc] of TABLE) {
  let res;
  try { res = await get(base + path); } catch (e) { console.log(`FAIL ${pad(path, 36)} ${e.message}`); fails++; continue; }
  let ok = res.status === status;
  let got = String(res.status);
  if (ok && loc) {
    const l = res.headers.get("location") ?? "";
    const gotLoc = l.startsWith("http") ? l.replace(/^https?:\/\/[^/]+/, "") : l;
    got += ` -> ${gotLoc}`;
    ok = gotLoc === loc;
  }
  if (ok && status === 404) {
    // every robots / googlebot meta says noindex, none says index, and the title is not the home title
    const html = await res.text();
    const metas = [...html.matchAll(/<meta[^>]+name="(?:robots|googlebot)"[^>]*>/g)].map((x) => x[0]);
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
    if (!metas.length || metas.some((x) => !/noindex/.test(x)) || !/not found/i.test(title)) { ok = false; got += ` title=${JSON.stringify(title)} robots=${JSON.stringify(metas)}`; }
  }
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${pad(path, 36)} ${got}${ok ? "" : `   (want ${status}${loc ? " -> " + loc : ""})`}`);
}

if (!quick) {
  const xml = await (await get(base + "/sitemap.xml")).text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/^https?:\/\/[^/]+/, ""));
  const step = Math.max(1, Math.floor(locs.length / 100));
  const sample = locs.filter((_, i) => i % step === 0).slice(0, 100);
  let bad = 0;
  // a few at a time: be gentle with the site
  for (let i = 0; i < sample.length; i += 5) {
    await Promise.all(sample.slice(i, i + 5).map(async (p) => {
      try {
        const r = await get(base + (p || "/"));
        if (r.status !== 200) { bad++; console.log(`FAIL sitemap ${p} -> ${r.status} ${r.headers.get("location") ?? ""}`); }
      } catch (e) { bad++; console.log(`FAIL sitemap ${p} ${e.message}`); }
    }));
  }
  console.log(`${bad ? "FAIL" : "ok  "} sitemap sample: ${sample.length - bad}/${sample.length} of ${locs.length} URLs are 200 with no redirect`);
  fails += bad;
}
console.log(fails ? `\n${fails} check(s) failed` : "\nall checks passed");
process.exit(fails ? 1 : 0);
