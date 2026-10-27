// Checks that what crawlers and answer engines read from the live site is still healthy:
//   robots.txt names the AI crawlers, llms.txt / llms-full.txt answer, the sitemap is big and dated,
//   the IndexNow key file is served, /api/levels and /feed.xml work, and on one page of each kind
//   (home, river, station, reservoir, town, about, data) every JSON-LD block parses, the answer
//   sentence is in the HTML, every FAQ question in the JSON-LD is also visible text, and there is
//   one h1, a canonical link, hreflang links and no noindex.
// Usage: node scripts/seo-check.mjs [--site https://waterlevels.lk]
// Exit code 1 when anything fails. No dependencies.
const SITE = (process.argv.includes("--site") ? process.argv[process.argv.indexOf("--site") + 1] : process.env.SITE_URL || "https://waterlevels.lk").replace(/\/$/, "");
const UA = "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot) seo-check";
const fails = [];
const ok = (m) => console.log(`ok    ${m}`);
const bad = (m) => (console.log(`FAIL  ${m}`), fails.push(m));
const check = (cond, m) => (cond ? ok(m) : bad(m));

async function get(path, retries = 1) {
  for (let i = 0; i <= retries; i++) {
    try {
      const t0 = Date.now();
      const r = await fetch(SITE + path, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60_000), redirect: "manual" });
      return { status: r.status, type: r.headers.get("content-type") || "", text: await r.text(), ms: Date.now() - t0 };
    } catch (e) {
      if (i === retries) return { status: 0, type: "", text: String(e), ms: 0 };
    }
  }
}

function jsonLdOf(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try { out.push(JSON.parse(m[1])); } catch (e) { out.push({ __error: String(e) }); }
  }
  return out;
}
const flat = (blocks) => blocks.flatMap((b) => (b["@graph"] ? b["@graph"] : [b]));
const strip = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

async function page(label, path, { faq = false, answer = false, noHreflang = false } = {}) {
  const r = await get(path);
  if (r.status !== 200) return bad(`${label} ${path}: HTTP ${r.status}`);
  ok(`${label} ${path}: 200 in ${r.ms} ms, ${Math.round(r.text.length / 1024)} KB`);
  const html = r.text;
  const blocks = jsonLdOf(html);
  check(blocks.length > 0 && !blocks.some((b) => b.__error), `${label}: ${blocks.length} JSON-LD blocks all parse`);
  const nodes = flat(blocks);
  check(nodes.every((n) => n.__error || n["@type"]), `${label}: every JSON-LD node has an @type`);
  check(blocks.every((b) => b["@context"] === "https://schema.org" || b.__error), `${label}: JSON-LD @context is schema.org`);
  check((html.match(/<h1[\s>]/g) || []).length === 1, `${label}: exactly one h1`);
  check(/<link rel="canonical"/.test(html), `${label}: canonical link`);
  if (!noHreflang) check((html.match(/<link rel="alternate" hrefLang=/gi) || []).length >= 3, `${label}: hreflang links`);
  check(!/<meta name="robots" content="[^"]*noindex/.test(html), `${label}: not noindex`);
  const text = strip(html);
  if (answer) check(/class="answer-line/.test(html), `${label}: answer sentence present`);
  if (faq) {
    const f = nodes.find((n) => n["@type"] === "FAQPage");
    check(!!f && f.mainEntity?.length >= 2, `${label}: FAQPage with questions`);
    for (const q of f?.mainEntity ?? []) check(text.includes(q.name), `${label}: FAQ "${q.name}" is visible on the page`);
  }
  for (const n of nodes) if (n["@type"] === "Dataset") {
    check(n.name && n.description && n.license && n.distribution, `${label}: Dataset has name, description, license, distribution`);
    for (const k of ["publisher", "creator"]) for (const o of [].concat(n[k] ?? [])) check(o && typeof o === "object" && o["@type"], `${label}: Dataset ${k} has an @type (not a bare @id)`);
  }
}

// ---- robots, llms, sitemap, key, feeds
const robots = await get("/robots.txt");
check(robots.status === 200, "robots.txt 200");
for (const bot of ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended", "Applebot-Extended", "Bingbot", "CCBot"]) check(robots.text.includes(`User-Agent: ${bot}`) || new RegExp(`User-Agent: ${bot}\\b`, "i").test(robots.text), `robots.txt names ${bot}`);
check(!/Disallow:\s*\/\s*$/m.test(robots.text), "robots.txt does not disallow /");
check(/Sitemap: .*sitemap\.xml/.test(robots.text), "robots.txt lists the sitemap");

for (const f of ["/llms.txt", "/llms-full.txt"]) {
  const r = await get(f);
  check(r.status === 200 && r.type.startsWith("text/plain") && r.text.length > (f === "/llms.txt" ? 1500 : 5000), `${f}: 200 text/plain, ${r.text.length} chars`);
  if (f === "/llms.txt") {
    check(/Cite as/.test(r.text) && /117/.test(r.text) && /\/api\/levels/.test(r.text), "llms.txt has citation, 117 and the API");
    const head = r.text.slice(0, 900);
    check(/next-hour forecast/i.test(head), "llms.txt summary leads with the next-hour forecast");
    check(/## Next-hour forecast/.test(r.text) && /nextHour/.test(r.text) && /not an official warning/.test(r.text), "llms.txt has a Next-hour forecast section with the API field and the warning caveat");
  }
}

const sm = await get("/sitemap.xml");
const locs = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
check(sm.status === 200 && locs.length > 500, `sitemap.xml: ${locs.length} URLs`);
check(!locs.some((u) => /localhost|\/en\//.test(u)), "sitemap has no localhost or /en/ URLs");
const lastmods = (sm.text.match(/<lastmod>/g) || []).length;
check(lastmods / Math.max(1, locs.length) > 0.8, `sitemap: ${lastmods}/${locs.length} URLs have lastmod`);

const key = (await get("/robots.txt")) && (await import("node:fs")).readdirSync(new URL("../public/", import.meta.url)).find((f) => /^[a-f0-9]{32}\.txt$/.test(f));
if (key) { const k = await get(`/${key}`); check(k.status === 200 && k.text.trim() === key.replace(".txt", ""), "IndexNow key file is live"); }
else bad("IndexNow key file missing from public/");

let lv = await get("/api/levels");
let lvj = null; try { lvj = JSON.parse(lv.text); } catch {}
check(lv.status === 200 && lvj?.stations?.length > 30, `/api/levels: ${lvj?.stations?.length} stations`);
// The next-hour forecast is time-boxed, so the first call after a deploy can come back without it: retry a few times.
for (let i = 0; i < 4 && !lvj?.stations?.some((s) => s.nextHour); i++) {
  await new Promise((r) => setTimeout(r, 4000));
  lv = await get(`/api/levels?nocache=${Date.now()}`);
  try { lvj = JSON.parse(lv.text); } catch {}
}
const nhSt = lvj?.stations?.find((s) => s.status !== "stale" && s.nextHour);
check(!!nhSt && typeof nhSt.nextHour.level_ft === "number" && ["rising", "falling", "steady"].includes(nhSt.nextHour.direction) && nhSt.nextHour.issuedAt && nhSt.nextHour.method, `/api/levels: nextHour on a reporting gauge (${nhSt?.id}: ${nhSt?.nextHour?.level_ft} ft, ${nhSt?.nextHour?.direction})`);
const feed = await get("/feed.xml");
check(feed.status === 200 && feed.type.includes("atom") && feed.text.includes("<feed"), "/feed.xml is Atom");

// ---- one page of each kind
const pick = (re) => locs.find((u) => re.test(u.replace(SITE, "")) )?.replace(SITE, "") ?? null;
const station = lvj?.stations?.find((s) => s.id.includes("/"));
await page("home", "/", { });
await page("about", "/about");
await page("data", "/data", { noHreflang: true });
await page("research index", "/research");
await page("news", "/news");
for (const n of flat(jsonLdOf((await get("/news")).text))) if (n["@type"] === "ItemList") check(n.itemListElement?.every((i) => /^https?:\/\//.test(i.url) && i.name) && !JSON.stringify(n).includes("NewsArticle"), "news: ItemList of external links, no NewsArticle markup");
await page("research", "/research/wellampitiya-street-flooding", { answer: true });
for (const n of flat(jsonLdOf((await get("/research/wellampitiya-street-flooding")).text))) if (n["@type"] === "ScholarlyArticle") check(n.author?.sameAs?.length && n.datePublished && n.dateModified && n.citation?.length, "research: article has author sameAs, dates and citations");
if (station) await page("station", `/${station.id}`, { faq: true, answer: true });
const river = pick(/^\/[a-z0-9-]+$/);
const multi = locs.map((u) => u.replace(SITE, "")).find((u) => /^\/(kelani-ganga|kalu-ganga|mahaweli-ganga)$/.test(u));
if (multi) await page("river", multi, { faq: true, answer: true });
const rsv = pick(/^\/reservoirs\/(?!spilling$)[a-z0-9-]+$/); // /reservoirs/spilling is a list page, not one reservoir
if (rsv) await page("reservoir", rsv, { faq: true, answer: true });
const town = pick(/^\/flood\/[a-z0-9-]+$/);
if (town) await page("town", town, { faq: true, answer: true });

console.log(fails.length ? `\n${fails.length} check(s) failed` : "\nAll SEO checks passed");
process.exit(fails.length ? 1 : 0);
