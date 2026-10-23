# AEO / GEO plan: getting found, quoted and cited by answer engines

Written 24 Oct 2026. Covers what the site had, what shipped, and what only the owner can do.

## 1. Audit (before)

Fetched live with GPTBot, ClaudeBot, PerplexityBot and Googlebot user agents. Every agent got HTTP 200 on pages, sitemap and APIs; nothing in Vercel or `proxy.ts` blocked a bot (the proxy only rewrites locales and skips `/api`, `/mcp`, `_next` and dotted paths).

| Area | Found |
| --- | --- |
| robots.txt | 80 bytes: `User-Agent: *`, `Allow: /`, sitemap line. No named crawlers. |
| llms.txt | 404 (the Next 404 page, 10 KB). |
| Sitemap | 1,188 URLs, hreflang on every entry, 649 KB. Good. `lastmod` only on gauge, river, reservoir and history URLs; none on `/flood`, 135 town pages, `/help`, `/about`. |
| Metadata | Title, description, canonical, hreflang (en, si, ta, x-default), OG and Twitter on all page types. OG images exist for home, river, station, reservoir, town. Station meta description printed raw metre values without a unit for DMC gauges. |
| JSON-LD | Home: a bare WebSite. Station: BreadcrumbList, Place with no coordinates, Dataset pointing only at the ArcGIS service. Town: Breadcrumb + Place. Reservoir and help: a graph. No publisher or Person anywhere, no WebPage/dateModified, no FAQPage on station, river, reservoir or town, no Speakable. |
| Visible answer | No sentence a model could lift: station and town pages open with a verdict card (rendered by a client component), river pages with a status line. |
| Machine-readable data | `/api/releases`, `/api/health`, `/api/forecasts`, `/api/flood-report`; no endpoint for current levels or reservoirs. `/mcp` exists (5 tools) but was not described anywhere. |
| Feeds | None. |
| Performance for crawlers | TTFB 0.15 to 0.5 s on cached pages. Home is 315 KB of HTML, server-rendered; nothing key is client-only (the chart has a text summary). |
| Monitoring | `/api/health` for data sources only; nothing watching robots, sitemap or JSON-LD. |

## 2. What shipped

**Crawl access.** `app/robots.ts` names 28 crawlers explicitly (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User, Claude-SearchBot, anthropic-ai, PerplexityBot, Perplexity-User, Google-Extended, GoogleOther, Googlebot, Bingbot, Applebot, Applebot-Extended, DuckAssistBot, MistralAI-User, cohere-ai, YouBot, Meta-ExternalAgent, Meta-ExternalFetcher, Amazonbot, CCBot, Diffbot and others) plus `*`, all allowed, with `Sitemap` and `Host`.

**llms.txt and llms-full.txt** (`app/llms.txt`, `app/llms-full.txt`, text in `lib/llms.ts`). What the site is, who runs it, how to read levels and marks, limits (not official, 117), how to cite, every page pattern, every API and the MCP server, sources and cadence, plus a live "right now" summary. The long file lists every gauge with its current level and marks, every reservoir and all 135 town pages. Generated per request, CDN-cached 10 minutes, never prerendered (so a build never depends on ArcGIS). Sinhala and Tamil pages are covered by the one-line pointer; separate per-language files were not worth it because the facts are identical.

**Answer-first blocks** (`lib/answers.ts`, `app/Answer.tsx`). One server-rendered sentence under the heading of every station, river, reservoir and town page, in en/si/ta, e.g. "As of Sat, 24 Oct, 1:02 am (Sri Lanka time), the Kelani Ganga at Hanwella was 11.7 ft, below the 21.3 ft alert level, and falling." It uses the same snapshot as the chart and verdict, in feet. Below each page, a visible "Common questions" list (3 questions per page type); the FAQPage JSON-LD is generated from the same array, so it can never say anything the page does not. Sinhala and Tamil are machine-drafted and labelled "machine-translated" like the rest of the site; they need native review.

**Structured data** (`lib/seo.ts`). One `@graph` per page: WebPage (with `dateModified` = time of the latest reading, `publisher`, `isPartOf`, Speakable pointing at the answer sentence), BreadcrumbList, Place/GeoCoordinates for gauges, towns and reservoirs, FAQPage, and on the station page a Dataset with creator = Department of Irrigation, publisher = the owner, `variableMeasured`, `temporalCoverage`, `spatialCoverage` and three distributions (our JSON, the source service, the data branch). Home carries WebSite, the publisher Person (sameAs x.com/shakeeb_x and github.com/shakee93), WebPage and the site-wide Dataset. `<` is escaped inside the script tag. SearchAction was deliberately not added: the search box has no URL of its own, and declaring one that does not work is worse than none. Station meta description now shows feet.

**Endpoints.** `/api/levels` (filters `river`, `station`, `town`) and `/api/reservoirs` (filters `slug`, `status`): feet, marks, status, trend, ISO timestamps, age, source, licence link, notes, CORS `*`, CDN-cached 60 s. `/feed.xml` Atom feed of gauges at alert level or above and reservoirs releasing water (stable entry ids per state). All documented on the new `/data` page (English, canonical to `/data`) and in llms.txt; linked from About. `/mcp` is described on both.

**Discovery and freshness.** Sitemap now has accurate `lastmod` on `/flood` (newest reading), each town (its gauge's reading), `/help` and `/about` (the page review date in `CONTENT_UPDATED`), plus `/data`. The home page advertises the Atom feed. IndexNow key file `public/e003239ac7a5178cc4f97e46e533c488.txt` and `scripts/indexnow.mjs` (refuses to send unless the key file is live; `--dry-run`, `--core`). It is not wired to any job and has not been run.

**E-E-A-T.** About page gets a "Who runs this site" block (owner named, independent, how to check, how to report errors, last reviewed date) and AboutPage + Person JSON-LD. `RESEARCH_PAGE_LIVE` in `lib/seo.ts` flips on a link to `/research` once that page exists.

**Monitoring.** `scripts/seo-check.mjs` (run every 30 minutes by `.github/workflows/health-check.yml`, and by hand with `--site`) checks robots names the AI crawlers, llms files answer, sitemap size and lastmod coverage, the IndexNow key is live, the APIs and feed work, and on home, about, data, a station, a river, a reservoir and a town: every JSON-LD block parses, one h1, canonical, hreflang, no noindex, the answer sentence is present and every FAQ question is visible text.

## 3. Not done, on purpose

- Image sitemap: OG images are generated per page and are not images that rank; low value.
- SearchAction (see above).
- Per-language llms.txt (same facts).
- A hosted IndexNow ping from the snapshot jobs (it submits to an outside service; do it after step 4 below).
- `/research` content (another agent). Footer link not added.

## 4. Owner checklist (only you can do these)

1. **Bing Webmaster Tools** (feeds Copilot, ChatGPT search, DuckDuckGo, Perplexity partly). Go to bing.com/webmasters, sign in, Add site, choose "Import from Google Search Console" if GSC is done, else add `https://sl-water-levels.vercel.app` and verify with the meta tag or by adding a CNAME if you get a custom domain. Then Sitemaps, Submit `https://sl-water-levels.vercel.app/sitemap.xml`. Turn on Settings, "IndexNow".
2. **IndexNow.** After this deploy is live, open `https://sl-water-levels.vercel.app/e003239ac7a5178cc4f97e46e533c488.txt` and confirm it shows the key. Run `node scripts/indexnow.mjs --core` once. Later, for meaningful changes (a new reservoir spilling): `node scripts/indexnow.mjs <url>`.
3. **Google Search Console.** search.google.com/search-console, you already have the verification tag in the layout. Add the URL-prefix property, Sitemaps, submit `sitemap.xml`. Use URL Inspection on `/`, one station, one town and `/data`, then "Request indexing". Check Enhancements for Breadcrumbs, FAQ, Dataset. Use the Rich Results Test (search.google.com/test/rich-results) on one station URL.
4. **Custom domain.** A `vercel.app` subdomain cannot be shared in a Wikidata item or trusted as long-term as your own domain. If you buy one (for example `srilankawaterlevels.lk` or `.com`), add it in Vercel, then set `SITE` in `lib/seo.ts` and the other `SITE` constants, 301 the old host, and re-verify in both consoles.
5. **Wikidata.** wikidata.org, Create a new item: label "Sri Lanka Water Levels", description "website for live river levels and flood information in Sri Lanka", instance of "website", official website, country of origin Sri Lanka, language of work (English, Sinhala, Tamil), inception 2026, creator = a Wikidata item for you if you are notable enough (otherwise skip the creator). Only add statements you can reference with an independent source; an item with no reliable source can be deleted.
6. **Wikipedia.** Do not add the site yourself (conflict of interest). If a Sri Lankan outlet writes about it, ask an editor on the article talk page (for example "Kelani River" or "2016 Sri Lanka floods") to consider the source. Realistic until then: none.
7. **OpenStreetMap.** On the Kelani and other major gauge nodes, add `website=https://sl-water-levels.vercel.app/<river>/<station>` only where a gauge node exists (`man_made=monitoring_station`, `monitoring:water_level=yes`). Follow the "on the ground" rule: the website tag should describe that object, which a station page does.
8. **Public data portals.** Register the dataset with the Sri Lanka Open Data Portal (data.gov.lk) if open, and on Kaggle Datasets or Zenodo with a DOI for the `data` branch export (Zenodo can archive the GitHub repo directly: zenodo.org, Login with GitHub, flip the repo switch, make a GitHub release). A DOI gives a citable reference models like.
9. **Be cited by others.** Email the Disaster Management Centre media unit, Daily Mirror, Ada Derana, Newswire and the Sri Lanka Red Cross a two-line pitch with the link `/flood` and `/data`. Ask for a plain link when they quote a level. The research page, when published, is the best asset to attach.
10. **Social profiles.** Make the X bio of @shakeeb_x say "Sri Lanka Water Levels: sl-water-levels.vercel.app" and link back; pin a post with the link. Create a GitHub org or pinned repo description with the same one-line description as `<meta description>`; add the site URL in the repo "Website" field and topics `sri-lanka`, `flood`, `water-level`, `open-data`. These are the `sameAs` the site already declares.
11. **Publisher programs.** ChatGPT and Perplexity have no open publisher application for small sites at the time of writing; nothing to apply for. Keep OAI-SearchBot and PerplexityBot allowed (done) and appear in Bing. Check `chatgpt.com` and `perplexity.ai` monthly with "Is Hanwella flooding now?" and note whether the site is cited.
12. **Vercel dashboard.** Project, Firewall: confirm "Bot Protection" and "AI Bots" managed rules are off (they were not blocking in tests: GPTBot, ClaudeBot, PerplexityBot and Googlebot all got 200). Do not enable "Block AI bots". Settings, Domains: nothing else needed.
13. **Native review** of the Sinhala and Tamil answer sentences and FAQ in `lib/answers.ts` and the About block in `app/AboutTrust.tsx` (they follow the site's existing "machine-translated" label until reviewed).
14. **Measure.** In Bing Webmaster Tools and GSC watch impressions for "Wellampitiya flood", "Hanwella water level", "Kelani Ganga water level". In Umami, watch referrers from chatgpt.com, perplexity.ai, copilot.microsoft.com, gemini.google.com and claude.ai.
