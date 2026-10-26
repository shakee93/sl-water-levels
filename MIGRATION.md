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
5. **Google Search Console:** add the property `https://waterlevels.lk` (domain property via DNS TXT is best), keep the
   old one, then Settings -> **Change of address** from the old property to the new one. Submit
   `https://waterlevels.lk/sitemap.xml`. Bing Webmaster Tools has the same "Site move" tool.
6. **X:** edit @waterlevelslk's website field and bio to `waterlevels.lk`; update the pinned post if it has the old link.
7. **Push:** nothing to do (VAPID keys are not tied to the domain). New subscribers sign up on waterlevels.lk; old ones
   keep getting alerts through the old host until they re-subscribe.
8. **Later (3-6 months):** remove the old-host exceptions once traffic there is near zero. Never remove the redirects.

Expect a 1-4 week dip in search traffic while Google re-crawls; the per-page redirects carry it across.
