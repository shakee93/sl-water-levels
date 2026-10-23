# Sri Lanka Water Levels — data & architecture

This doc explains the two things this repo sits on top of:

1. The Sri Lanka Department of Irrigation's public ArcGIS feature services.
2. The Next.js app + MCP server that surface them.

---

## 1. The ArcGIS dataset

The SL Dept of Irrigation publishes its hydrology data as a set of
[ArcGIS feature services](https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services).
There is no API key, no documentation page, and no rate-limit guarantee —
but the endpoints are fully open and CORS-enabled, which is enough.

### Layers this app reads

| Service                                 | What it holds                                                |
|-----------------------------------------|--------------------------------------------------------------|
| `hydrostations/FeatureServer/0`         | Station catalogue: `station`, `basin`, `latitude`, `longitude`. |
| `gauges_2_view/FeatureServer/0`         | Every reading from every gauge: `gauge`, `basin`, `water_level`, `rain_fall`, `CreationDate`, `alertpull`, `minorpull`, `majorpull`. |

A bunch of *other* layers exist on the same server (`24hr_rainfall`,
`river_basins`, `Flood_Map`, event-specific flood inundation layers,
reservoirs, sluices, canals, soil maps, admin boundaries) — we don't
use them yet but they're available under the same query pattern.

### How a query looks

Every layer follows the same `/query` pattern. The interesting params:

```
…/<service>/FeatureServer/<layerId>/query
  ?where=<SQL-ish predicate>
  &outFields=<comma list, or *>
  &orderByFields=<field ASC|DESC>
  &resultRecordCount=<n, default 2000, hard cap ~32000>
  &returnGeometry=false
  &f=json|geojson|csv|pbf
```

Examples we actually use:

```
# Every Kelani Ganga gauge with coords
hydrostations/FeatureServer/0/query
  ?where=basin LIKE 'Kelani Ganga%'
  &outFields=station,basin,latitude,longitude
  &f=json

# Last few days of readings for one station
gauges_2_view/FeatureServer/0/query
  ?where=gauge='Nagalagam Street'
  &outFields=*
  &orderByFields=CreationDate DESC
  &resultRecordCount=2000
  &f=json

# Bulk pull readings for every station in a basin in one shot
gauges_2_view/FeatureServer/0/query
  ?where=gauge IN ('Norwood','Kithulgala','Holombuwa', …)
  &outFields=*
  &orderByFields=CreationDate DESC
  &resultRecordCount=4000
  &f=json
```

### Gotchas

These cost real debugging time. Worth writing down:

- **No unit metadata anywhere.** Neither the service definition nor the
  field aliases name a unit. Locals know that Kelani Ganga gauges report
  in **feet** while many others are in **metres**. We strip the explicit
  "m" suffix from the UI to avoid lying. If you need a unit, ask a human.

- **Trailing whitespace in basin names.** `hydrostations` returns
  `"Kelani Ganga     "` (with trailing spaces). Always `LIKE 'Kelani Ganga%'`
  rather than `= 'Kelani Ganga'`, or `.trim()` before comparing.

- **`CreationDate` is epoch milliseconds.** Not ISO, not seconds. Pass to
  `new Date(ms)` and convert to `Asia/Colombo` for display.

- **`rain_fall` is often `null`.** Many gauges don't have a rain sensor.
  Null means *not measured here*, not zero.

- **Rate limits exist but aren't documented.** Repeated queries (≥1/s)
  start returning `{"error": {"message": "Unable to perform query. Too
  many requests."}}`. Cache hard.

- **Identity quirks.** Some "stations" in `hydrostations` don't appear in
  `gauges_2_view` (or only do so intermittently). If you want a "live
  stations" list, filter to those with at least one recent reading.

- **Date filters in `where=`** use ArcGIS's odd SQL dialect:
  `CreationDate BETWEEN CURRENT_TIMESTAMP - 4 AND CURRENT_TIMESTAMP`
  works (the "- 4" is interpreted as days). For explicit bounds:
  `timestamp '2026-05-17 18:30:00'`.

- **Result paging.** A single query caps at `resultRecordCount` features
  (max ~32000). For more, paginate with `&resultOffset=` and watch
  `exceededTransferLimit` in the response.

---

## 2. The app

### Stack

- **Next.js 16** (App Router, Turbopack, React Server Components).
- **Tailwind v4** for styling, **lucide-react** for icons, **Recharts** for
  the main time-series chart. Basin-flow sparklines are hand-rolled SVG.
- **mcp-handler** for the `/mcp` MCP server route.
- No DB, no auth, no env vars. The ArcGIS endpoints are the source of truth.
- Deployed on Vercel; production at <https://sl-water-levels.vercel.app>.

### File layout

```
app/
  page.tsx              Server entry: cookies + station list + Suspense fan-out
  layout.tsx            Metadata + fonts + html shell
  error.tsx             Route-level error UI (retry button)
  StationPicker.tsx     Client: <select> + useTransition + cookie write
  StationCard.tsx       Server: status pill, threshold stat grid, chart
  StationCardSkeleton.tsx
  LevelChart.tsx        Client: Recharts line + threshold reference lines
  BasinFlow.tsx         Server: upstream→downstream strip + sparklines
  mcp/route.ts          MCP server (Streamable HTTP, mounted at /mcp)
lib/
  arcgis.ts             All HTTP to ArcGIS. Typed. ISR-cached at 60s.
  basinOrder.ts         Canonical station ordering per known basin.
```

### What the page does in one request

```
URL: /?station=Hanwella
                │
                ▼
app/page.tsx (RSC)
  ├─ cookies()                        → last-seen station
  ├─ fetchStations()                  → station list (cached 60s)
  └─ <Suspense key="Hanwella">
       └─ <StationCard stationName="Hanwella" />
            └─ fetchStationData(...)  → readings + thresholds
     <Suspense key="flow-Hanwella">
       └─ <BasinFlow basin="Kelani Ganga" selectedStation="Hanwella" />
            └─ fetchBasinSnapshot(...) → all Kelani gauges in 1 bulk query
```

When the picker changes the station:

```
StationPicker.onChange
  ├─ document.cookie = sl_station=…    (so refresh / direct-load remembers)
  └─ startTransition(() => router.push(`/?station=…`))
       ↓
  Suspense keys change
  → StationCardSkeleton + BasinFlow re-mount
  → server re-renders, new RSC HTML streams in
```

### Why Suspense + a key

`useTransition` alone keeps the old UI on screen during the navigation.
A `key={station}` on `<Suspense>` makes React tear down the subtree as
soon as the URL changes, showing the skeleton during the round-trip.
Cheap pattern, big perceived-speed win.

### Remembering the last station

There's no DB and no localStorage flash. The picker writes a one-year
cookie (`sl_station=…`) on change. The server reads that cookie on the
next request, and if `?station=` is absent it falls back to the cookie
value, then to a hardcoded `DEFAULT_STATION`. Result: refresh / direct
URL load returns to wherever you left off, with no client-side hop.

### Caching

Every ArcGIS call goes through `fetch(url, { next: { revalidate: 60 } })`,
so the Next ISR layer collapses concurrent users hitting the same station
into one upstream request per minute. This is what keeps us under the
ArcGIS rate limit at zero ops cost.

### `lib/arcgis.ts` API

```ts
fetchStations(): Promise<Station[]>
fetchStationData(stationName: string, days = 4): Promise<StationData>
fetchBasinSnapshot(basinName: string): Promise<BasinStation[]>
statusFor(level, thresholds): { label, tone }
```

Shapes:

```ts
Station        = { basin, station }
StationData    = { station, basin, thresholds, readings, latest }
BasinStation   = { station, basin, latitude, longitude,
                   latest, prior, thresholds, trend24h }
thresholds     = { alert, minor, major }   // any may be null
Reading        = { ts, water_level, rain_fall }
```

### Upstream → downstream ordering

`lib/basinOrder.ts` holds a small table of canonical orderings:

```ts
BASIN_ORDER = {
  "Kelani Ganga": [
    "Norwood", "Kithulgala", "Holombuwa", "Deraniyagala",
    "Glencourse", "Hanwella", "Nagalagam Street",
  ],
}
```

For basins not in the table we fall back to **longitude descending**
(east first), which works because most SL rivers flow east-to-west off
the central highlands to the sea. It's a rough heuristic — fine for a
UI hint, not for analytics.

### The "wave incoming" insight

In `BasinFlow.buildWaveInsight`:

1. Compute `ratePerHour` (level / hour) for every station from
   `latest` vs `prior` (~3h ago) reading.
2. If any upstream station is rising at > 0.05 unit/h **and** the
   selected station's rate is < 60% of that, surface a banner.

It's a heuristic flag, not a forecast. The thresholds were picked by
eye and would need per-basin tuning to be more than a hint.

### Status thresholds

Each reading row carries three numbers — `alertpull`, `minorpull`,
`majorpull` — published by Irrigation per gauge. `statusFor()` maps
the latest level against them:

```
level ≥ majorpull   → "Major flood"   (red)
level ≥ minorpull   → "Minor flood"   (orange)
level ≥ alertpull   → "Alert"         (yellow)
otherwise           → "Normal"        (green)
```

The same logic powers the colour dots in `BasinFlow` and the status
pill on `StationCard`.

### The forecast (`lib/forecast.ts`, `lib/weather.ts`, `lib/model/`)

Every gauge with a rain grid (18 basins) and a fitted model that beat
"level stays put" in leave-one-day-out testing gets a 1/3/6/12/24 h forecast (30 gauges as of 2026-10-22; the rest are
labelled "trend only" and the note names the measured reason, e.g. "no more accurate than 'level stays put' at any
horizon", or "too few readings"). Horizons without skill ship as persistence with the observed change distribution as the
band, so every fitted gauge has a 24 h range. Catchment rain is the area average over the grid cells of the sub-catchment
upstream of the gauge (`lib/model/catchments.json`, built by `scripts/build-catchments.mjs` from the Irrigation Department
`river_basins` polygons: a 0.075-0.15 deg lattice, "upstream" = not nearer the river mouth than the gauge; approximate).
For topmost gauges it is the only upstream signal. Leaders and lags per gauge come from
`scripts/derive-configs.mjs` (lagged cross-correlation) into `scripts/station-configs.json`. For each
station and horizon a ridge regression predicts the change in level from the gauge's own 3 h change,
lagged changes at upstream "leader" gauges (Glencourse leads Hanwella by ~3 h, Deraniyagala/Kithulgala by
8-9 h) and catchment rain in a window that mostly lies in the future (so it is fed Open-Meteo forecast
rain, with ECMWF ensemble members at the 10th/50th/90th percentile of 24 h rain as scenarios). The
band is a split-normal built from leave-one-day-out residual quantiles, inflated while the archive is
short, widened for model disagreement and a floor that grows with horizon, mixed over the rain scenarios;
threshold-crossing probabilities come from the same mixture. GloFAS (6 h cache) only ever raises an
"elevated outlook" flag when its 7-day ensemble maximum passes the p95 for the main-stem cell. Coefficients
live in `lib/model/coefficients.json`, produced by `node scripts/fit-forecast.mjs` from the `data` branch
(refit weekly and commit); `node scripts/backtest-forecast.mjs` scores them against "level stays put".
Rules enforced in code (see the header of `lib/forecast.ts`): forecasts are "experimental" with probabilities
capped at 90% until the archive spans a monsoon season (150 days); "likely" needs >= 50%, "possible"
20-50%; an arrival time needs two adjacent horizons to agree; a stale gauge gives no forecast, and a stale
leader or failed rain fetch is named on the page, widens the band and drops the arrival time.
**Limits:** the first fit used 8 days, one rain event and no flood, so it under-predicts sharp rises (the
event start by ~1 m), has no skill beyond ~12 h (24 h ships as persistence blended with the 12 h outlook),
and knows nothing about dam releases or tides (Nagalagam Street is tidal). Treat it as a heads-up, not a warning;
official flood warnings come from the Department of Irrigation and the Disaster Management Centre.
`snapshot.mjs` also archives hourly catchment rain and daily GloFAS discharge to `rain/` and `glofas/` on
the `data` branch so later refits can use real history.

### MCP server at `/mcp`

`app/mcp/route.ts` mounts an MCP Streamable-HTTP server using
[`mcp-handler`](https://www.npmjs.com/package/mcp-handler). Tools:

- `list_basins`
- `list_stations(basin?)`
- `get_station_readings(station, days?)`
- `get_basin_snapshot(basin)`

Internally they call the same `lib/arcgis.ts` functions the UI uses, so
data semantics stay in lockstep. Register in Claude Code with:

```bash
claude mcp add --transport http sl-water-levels \
  https://sl-water-levels.vercel.app/mcp
```

---

## 3. Reproducing locally

```bash
git clone https://github.com/shakee93/sl-water-levels
cd sl-water-levels
npm install
npm run dev
```

No env vars. No database. Append `?station=Hanwella` to the URL to
deep-link a specific station.

## Official warnings and plain-language advisory (OpenAI)

Both need `OPENAI_API_KEY` (server env only, never `NEXT_PUBLIC_`); without it the page renders a deterministic
English advisory and no official warnings.

- `lib/warnings.ts`: scrapes the DMC report listings (River Water Level and Flood Warning, Weather Reports). Each row has a
  title, date and 24h Colombo time, so `issuedAt` and "current (<24h)" are parsed, not guessed. Routine "Water level & Rainfall"
  tables, sea/lightning notices and translations are skipped. PDF text is extracted with `unpdf`, hashed, and analysed once per
  bulletin (Decisions API, `gpt-6-luna`: a predicate per basin plus a severity choice; Responses API for one summary sentence,
  rejected if it contains a number not in the bulletin). Results are cached by content, listings for 30 min.
- `lib/advisory.ts`: the model only rewords a fact sheet built from the computed forecast, in English, Sinhala and Tamil
  (the latter two machine-translated). Output is rejected if it contains a number not in the fact sheet, lacks "117" at tier
  alert or above, or is not in the right script; the deterministic template is the fallback. Cached per station, forecast hour, tier.
- `lib/openai.ts`: plain-fetch client and the cost guard (`AI_MAX_CALLS_PER_HOUR`, default 60 per server instance; counts, never content, are logged).

## Monitoring (data-source health)

Sources break silently (a sheet layout change, a moved endpoint, stale data, an exhausted quota), so
the site watches itself and tells the owner.

- **`GET /api/health`** (`lib/health.ts`): JSON `{ ok, checkedAt, deep, checks: [{ id, name, ok,
  severity: "critical" | "warn", detail, userImpact, lastGoodAt?, ageMinutes? }] }`. Always HTTP 200;
  read `ok` per check. Plain mode reuses the cached fetchers; `?deep=1` bypasses the caches so a stale
  cache can't hide a dead source (only the monitor uses it). Checks:
  - gauges (critical): >= 35 of the 42 stations have a reading under 3 h old and the newest is under 2 h.
  - Irrigation reservoir sheet: >= 100 rows, newest row dated today or yesterday (Colombo), expected
    columns present. Warn; **critical** when 0 rows parse or the columns changed.
  - Mahaweli WMS PDF (reachable, >= 30 rows, Last-Modified under 48 h), DMC bulletin list, OpenAI key
    (a free `GET /v1/models`, cached 24 h, so at most one call a day), Open-Meteo rain / ensemble /
    GloFAS, the two news RSS feeds. All warn.
  - Our pipelines via the public GitHub API (cached 10 min; 60 requests/hour unauthenticated, and a
    rate-limited answer counts as "not checked", never a failure): newest gauge-archive commit on
    `data` under 14 h; last successful `releases-snapshot.yml` run under 2 h (3 h overnight; the
    run is used instead of a `releases/*.jsonl` commit because the snapshot only commits when
    something changed); last successful `store-forecasts.yml` run under 2 h; the last run of
    `snapshot.yml` / `export-predictions.yml` must not have failed; last successful
    `gsmap-snapshot.yml` run under 75 min; and the **scheduler** check (`pipe-scheduler`): the newest
    completed `health-check.yml` run must have started under 70 min ago (it runs every 30 min, started
    by the Cloudflare worker and GitHub's cron; the run asking is still running, so it is ignored).
    All warn.
- **`/status`** (all locales, `noindex`, linked from the footer as "Data status"): each source as OK /
  Delayed (a warn check failing) / Down (a critical one), with "updated 12 min ago". Strings in
  `lib/i18n/status.ts`. Stale gauges already show the "Data delayed" line on station and home pages
  (`nat.delayedNone`, `river.delayed`), so nothing else on those pages changes.
- **`.github/workflows/health-check.yml`** runs every 30 min: fetch `/api/health?deep=1` (retry once),
  then `scripts/health-alert.mjs`:
  - A check must fail on 2 consecutive runs before anything happens (single blips are ignored).
  - Then ONE GitHub issue labelled `data-health`, titled "Data source down: <name>", with the
    problem, since-when, and what visitors see; never a second one while it is open. It comments
    (and re-posts to Slack) every 6 h while failing and closes itself with a comment when the check
    recovers.
  - State between runs is one issue labelled `data-health-state` (JSON in its body): do not close it.
  - A confirmed critical failure also fails the workflow run, which makes GitHub email the owner.
    A missing or invalid health response counts as a critical "Website" failure.
  - Dry run: `node scripts/health-alert.mjs health.json --dry-run --state /tmp/state.json` prints
    the issues and Slack messages it would send and touches nothing; run it twice to see an open.
- **Slack**: the repository secret `SLACK_WEBHOOK_URL` (an incoming webhook) gets a message when a
  check opens (red), every 6 h while still failing, and when it recovers (green, with how long it
  was down). The four scheduled workflows (`snapshot`, `releases-snapshot`, `store-forecasts`,
  `export-predictions`) each end with an `if: failure()` step that posts "Workflow failed: <name> -
  <run url>". Everything is skipped silently when the secret is empty, and the URL is never printed.
  Manual runs of the health workflow (`gh workflow run health-check.yml`) first send one test message
  (untick `slack_test` to skip).
- **Optional Telegram** (not wired up): to add it, create a bot with @BotFather, add secrets
  `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, and POST to
  `https://api.telegram.org/bot<token>/sendMessage` from the `slack()` helper in
  `scripts/health-alert.mjs`.

## Street-flood validation (is the satellite-rain rule right?)

The rule in `lib/townRisk.ts` step 6 (24 h satellite rain over the Greater Colombo east box: 60 mm =
"possible", 100 mm = "likely") was backtested on 14 documented floods (`research/wellampitiya-flood-rule-backtest.md`).
This is how it is checked live. Everything lands in the Cloudflare D1 database `sl-water-levels` (the prediction
log's database) and is **private**: nothing public reads it and nothing about other people's answers is shown.
Tables are in `d1/0003_street_flood.sql`.

- **Rain log** (`street_rain_log`): `scripts/street-rain-log.mjs`, a step in `gsmap-snapshot.yml` after the data push,
  stores per run (about every 30 min) the zone's 1 / 3 / 6 / 24 h rain and the rule state (`none` / `possible` /
  `likely`). **State changes** go to `street_rain_changes`. The script applies the migration itself every run.
  State logic: `lib/streetRainLog.ts`.
- **Owner ping**: on a rise (none to possible or likely, possible to likely) and when it clears, one Slack message
  via `SLACK_WEBHOOK_URL` with the rain numbers, the Wellampitiya page link and "Did your street flood?". A rise within
  3 h of the previous rise message is held back; likely to possible is silent. A message that failed is retried for 6 h.
  Dry run: `node --experimental-strip-types scripts/street-rain-log.mjs <dir containing gsmap/latest.json> --dry-run --prev none`.
- **Resident answers** (`street_flood_reports`): the "Did the streets near you get water today?" control
  (`app/flood/FloodReport.tsx`) on every town page posts to `POST /api/flood-report`. Stored: town slug, answer
  (`deep` ankle or more / `little` / `dry`), optional `now` / `earlier`, page language, time, and a per-day salted
  HMAC of the IP address (rate limiting only; rotates daily; the address is never stored). One answer per browser
  per town per day (cookie `sl_fr_<town>`), caps per address, a hidden honeypot field and a minimum time on the page
  (bots get a quiet "thanks", nothing stored). The Vercel site has no D1 binding, so the route uses the D1 HTTP API
  (`lib/d1.ts`) and needs **`CLOUDFLARE_API_TOKEN`** (token with D1 Edit) in the Vercel environment variables;
  optional `FLOOD_REPORT_SALT`. Without the token the route answers 503 and the page says "try again later".
- **Monthly review**: `scripts/export-street-flood.sh YYYY-MM <outDir>` (wrangler logged in) writes `rain_log.json`,
  `changes.json`, `reports.json` and `reports_by_day.json` (answers per town and day next to that day's highest 24 h rain
  and rule state). Keep the output private. Handy ad-hoc SQL (`npx wrangler d1 execute sl-water-levels --remote --command "..."`):

  ```sql
  -- state changes, newest first
  SELECT datetime((changed_ms+19800000)/1000,'unixepoch') AS colombo, from_state, to_state, mm1h, mm6h, mm24h, notified
    FROM street_rain_changes ORDER BY changed_ms DESC LIMIT 20;
  -- answers vs the rule, per day (hits = "deep"/"little" answers on days the rule said possible/likely)
  SELECT r.day, r.town, SUM(r.answer='deep') deep, SUM(r.answer='little') little, SUM(r.answer='dry') dry,
         (SELECT MAX(mm24h) FROM street_rain_log WHERE date((data_end_ms+19800000)/1000,'unixepoch') = r.day) max_mm24h
    FROM street_flood_reports r GROUP BY r.day, r.town ORDER BY r.day DESC;
  ```
  How to read it: days with `deep` answers and no `possible` / `likely` state are misses; `possible` / `likely` days
  with only `dry` answers are false alarms. Answers are self-selected (people who flooded answer more), so count
  towns and days, not people.

---

## Reasons to come back (return-visit features)

Design rule: every loop must be useful, honest and optional. No streaks, no counters that shame, no fake urgency, nothing that
makes a calm day look alarming or a dangerous day look fun. No account anywhere; what is remembered lives in the visitor's
browser, except an opted-in push subscription. Strings: `lib/i18n/return.ts` (Sinhala and Tamil are drafts needing native review).

1. **Your places (personal glance).** The star on a gauge or town page already saved a place in `localStorage` (`sl_favourites`);
   the home page now opens on "Your places": one plain line answering "are my places OK?" ("All 3 of your places are calm" or
   "Wellampitiya: Get ready. 2 other places are calm"), then a row per place with verdict, trend and rain. The instant, personal
   answer is the reward, and it is the thing worth returning for. Missing data is never shown as calm. The visitor's own street level
   (`sl_my_levels`) is applied, so it matches their town page. Code: `app/MyPlaces.tsx`, `lib/placeGlance.ts` (same
   `loadTown`/`assessTown` as the pages), `GET /api/places-state`, `lib/myPlaces.ts`.
2. **Alerts at the right time (Web Push) + installable app.** "Tell me when it changes" sends ONE push when a pinned place rises to
   "Get ready / water on the streets possible" or worse, and ONE all-clear after two calm checks in a row (closure matters). Never for
   a plain "keep an eye", never twice for a wobble (3 h flap guard, `pushStep` in `lib/myPlaces.ts`). Optional short morning summary,
   skipped when a person's places cannot be read. Subscriptions: D1 `push_subscriptions` (endpoint + two public keys + place keys +
   language; nothing else; "Turn off alerts" deletes the row; dead endpoints are deleted). PWA: `app/manifest.ts`, `public/sw.js`
   (network first, last-known page offline, push handler), a quiet dismissible install card after a second-day visit or a pinned place
   (`app/ReturnShell.tsx`). Sender: `scripts/push-notify.mjs`, run at the end of `gsmap-snapshot.yml` (every 30 min) and by
   `push-notify.yml` (morning, manual test). Telegram channel option for later: a bot posting the same rise/all-clear text from
   `pushText` to a public channel needs only a bot token and a call in the sender.
3. **Closure and trust: "How our warnings did".** On towns with the street-rain rule: what we said recently ("Yesterday we said water
   on the streets was possible") and what neighbours reported, a running score once 3 warned days could be judged, and one line of
   river-forecast accuracy from the prediction log (`forecast_verification`, 24 h, share of real levels inside the stated range, last
   30 days, needs 100 checks). Code: `app/flood/TownOutcome.tsx`, `lib/townOutcome.ts`, `GET /api/town-outcome`.
4. **Contribution reward.** After "Did the streets near you get water today?" the thank-you says what the answer joined ("joins 14 from
   Wellampitiya this month") and, for rule towns, that answers tune the 60 mm warning, and invites a return tomorrow to see how the
   warning did. Counts below 3 are never shown (k-anonymity: `K_MIN`, `shownCount`); the API returns totals only.
5. **Daily anticipation without alarm.** One "Today" line (rain expected over the next day: dry / some / about N mm) and a calm season
   line (monsoon context from the month) on the Your places card; optional morning push (above). The season line is hidden when
   something needs attention.
6. **Send to family.** "Send to family" shares the first pinned place's page (its OG card already shows the town verdict) through the
   phone's share sheet or WhatsApp.

### What the owner must set (nothing breaks until then: the buttons simply stay hidden)

```
# 1. Generate a VAPID pair once (keep the private key out of git)
cd sl-water-levels && node -e 'const k=require("web-push").generateVAPIDKeys();console.log(k)'
# 2. Public key: Vercel (production), then redeploy
vercel env add VAPID_PUBLIC_KEY production
# 3. Both keys: GitHub Actions secrets
gh secret set VAPID_PUBLIC_KEY
gh secret set VAPID_PRIVATE_KEY
# 4. Check delivery: subscribe on the site, then
gh workflow run push-notify.yml -f mode=test
```

### What to measure

Umami events (already on the site): `alerts_on`, `alerts_off`, `share_places`, `pwa_prompt`, `pwa_installed`. Push opt-in rate =
`alerts_on` / visitors with a pinned place. Push volume and failures: `SELECT kind, SUM(sent), SUM(gone), SUM(failed) FROM push_log GROUP BY kind`
(counts only). Active subscriptions: `SELECT COUNT(*) FROM push_subscriptions`. Return visits: Umami returning-visitor share on `/`
before and after. Answers per month per town: `street_flood_reports`. Watch for: all-clear pushes outnumbering rises (hysteresis too loose),
`gone` rising (people muting).
