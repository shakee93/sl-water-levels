# Moving to waterlevels.lk

The site moves from `https://sl-water-levels.vercel.app` to `https://waterlevels.lk`. This branch is ready to merge
**after** steps 1-3 below. Nothing in it works for visitors until the domain answers on Vercel.

## What the code does (this PR)

- **One address.** `lib/seo.ts` `SITE` is `https://waterlevels.lk`; pages import it. Canonical links, hreflang, sitemap,
  structured data, `llms.txt`, push links, X posts and the series, Slack digests, user agents and scripts all use it.
  Atom feed entry ids keep the old `tag:` (ids must never change).
- **Page-for-page permanent redirects** from the old host (`next.config.ts`, host-matched), query strings kept, so search
  engines move each page's ranking.
- **Still working on the old host:** `/api/*` (apps, scripts, forms on pages already open), `/mcp`, `/_next/*`, `sw.js`,
  the manifest and icons. Installed apps and existing push subscriptions keep receiving alerts; tapping one opens the new
  address.
- **Alerts carried across.** The hand-over also passes the old push endpoint; turning alerts on at waterlevels.lk sends it
  as `replaces`, and `/api/push` re-points the old subscription row (all settings kept) instead of adding a second one.
- **Saved data hand-over.** Since 26 Oct 2026, phones with saved places, street levels or a location carry the cookie
  `sl_has_data` (`app/SavedDataMarker.tsx`, already live on main). On the old host those visitors (only them) are
  rewritten to `/api/move`, which copies their saved keys into the URL fragment (never sent to a server), clears the
  cookie and opens the same page on waterlevels.lk; `app/ImportHandover.tsx` stores the keys there without overwriting
  anything, then reloads once. Search engines never carry the cookie, so they only ever see the 301.

## Switch day

1. **Register** `waterlevels.lk` (LK Domain Registry). Name servers: Vercel's (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`),
   or keep the registry's and add the records Vercel shows.
2. **Vercel** (freshpixl / sl-water-levels -> Settings -> Domains): add `waterlevels.lk` and `www.waterlevels.lk`
   (www redirects to the apex). Wait for "Valid Configuration" and the certificate. Keep `sl-water-levels.vercel.app`
   assigned: the redirects run on it.
3. **Check** `https://waterlevels.lk` loads the current site (it serves the same deployment).
4. **Merge this PR.** After the deploy:
   - `curl -sI https://sl-water-levels.vercel.app/kelani-ganga/hanwella` -> `308`/`301` to `https://waterlevels.lk/kelani-ganga/hanwella`
   - `curl -sI https://sl-water-levels.vercel.app/api/levels` -> `200` (not redirected)
   - `curl -s https://waterlevels.lk/sitemap.xml | head` -> new addresses
   - On a phone with saved places: open the old address -> lands on waterlevels.lk with the places still there.
5. **Google Search Console:**
   - Add property -> **URL prefix** `https://waterlevels.lk/` -> verify with **HTML tag**: it verifies at once, because every
     page already carries our `google-site-verification` tag (`app/[lang]/layout.tsx`). (A Domain property needs a DNS TXT
     record instead; send it and it is added in Vercel DNS.)
   - Keep the old property. In the OLD property: Settings -> **Change of address** -> pick `https://waterlevels.lk/` ->
     the tool checks the redirects -> Confirm.
   - In the new property: Sitemaps -> submit `https://waterlevels.lk/sitemap.xml`. URL inspection on the home page ->
     Request indexing.
   - Bing Webmaster Tools: add the site, then Configuration -> **Site move**.
6. **Umami** (cloud.umami.is -> Settings -> Websites -> Sri Lanka Water Levels -> Edit): change **Domain** to
   `waterlevels.lk`. Keep the same website (same id `a15ed279-…`), so all history stays in one place; the tracker in the
   page does not need changing and counts both addresses during the switch. Optional: filter by hostname to compare.
7. **X:** edit @waterlevelslk's website field and bio to `waterlevels.lk`; update the pinned post if it has the old link.
8. **Push:** nothing to do (VAPID keys are not tied to the domain). Phones keep getting alerts through the old address;
   when someone opens the new site the Alerts card asks them to turn alerts on again, and that replaces the old
   subscription server-side (same settings, never two alerts).
9. **Later (3-6 months):** remove the old-host exceptions once traffic there is near zero. Never remove the redirects.

Expect a 1-4 week dip in search traffic while Google re-crawls; the per-page redirects carry it across.
