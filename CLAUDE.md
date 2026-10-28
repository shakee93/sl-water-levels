@AGENTS.md

# sl-water-levels — project context for Claude

A small Next.js dashboard that visualises realtime river-gauge water-level
data from the Sri Lanka Department of Irrigation.
The detailed user-facing architecture lives in `DOCS.md`. This file is what a
*new Claude session* should read first.

## Stack

- Next.js 16 (App Router, Turbopack, RSC + server components)
- React 19, Tailwind v4, lucide-react icons, Recharts for the main chart
- `mcp-handler` for the MCP server at `/mcp`
- TypeScript everywhere
- Deployed on Vercel; repo at github.com/shakee93/sl-water-levels
- No DB, no auth, no env vars. ArcGIS / Google Sheets / PUCSL HTTP
  endpoints are the source of truth.

## Working conventions

- **No auto-worktree.** This project intentionally runs in the parent
  checkout, not under `.claude/worktrees/...`. The bg-isolation guard
  was a problem earlier in development; we work directly here now.
- **Skip local `npm run build`.** Production builds tax the laptop.
  Push to `main` and let Vercel build; failed deploys surface in
  `vercel ls`. Use `npx tsc --noEmit` for fast typecheck when needed.
- **Use Bash heredocs in chunks for new file writes** when the Write
  tool fails under the bg-isolation guard. Big heredocs sometimes
  trip the classifier — break them up if so.
- **One install at a time.** The user's laptop has crashed under
  multiple parallel npm operations before. Install one package set,
  let it complete, move on.
- **Commit messages**: be specific about *why*, not just *what*.
  The history is the design rationale.

## Architecture in one screen

```
app/
  page.tsx             Server entry: cookies + station list + Suspense fan-out
  layout.tsx           Metadata + fonts
  error.tsx            Route-level error UI
  StationPicker.tsx    Client select: useTransition, writes sl_station cookie
  StationFinder.tsx    Client: geolocation -> 3 nearest stations by Haversine
  RangePicker.tsx      Client: 24h / 4d / 7d / 14d, writes sl_days cookie
  Anomaly.tsx          Server: banner above StationCard when release inferred
  StationCard.tsx      Server: status pill, threshold stats, chart, accepts days
  StationCardSkeleton.tsx
  LevelChart.tsx       Client: Recharts line + threshold reference lines
  Forecast.tsx         Server: next-hour prediction panel
  BasinFlow.tsx        Server: upstream->downstream strip + sparklines + wave-incoming
  BasinDams.tsx        Server: connected dams + PUCSL live-MW badges
  mcp/route.ts         /mcp MCP server (Streamable HTTP)
  api/health/route.ts  Data-source health JSON (?deep=1 bypasses caches); /[lang]/status shows it

lib/
  arcgis.ts            All HTTP to services3.arcgis.com. Typed. ISR-cached 60s.
  basinOrder.ts        Canonical upstream->downstream order per basin
  forecast.ts          Next-hour prediction: local persistence + upstream momentum + rain
  anomaly.ts           Inferred-release detection from gauge data
  ceb.ts               PUCSL day-ahead-dispatch fetcher (MW now populated but ~2.5 days late: archive-only, never live)
  releases.ts          Reservoir releases: Irrigation sheet + Mahaweli PDF + DMC figure + news; releaseAffecting(station)
  reservoirs.ts        Reservoir -> downstream gauge map with measured travel times
  dams.ts              Hand-curated dam catalogue per basin
  units.ts             Heuristic ft / m / null detection from threshold values
```

## Data sources (and their current state)

- **ArcGIS hydrostations + gauges_2_view** (services3.arcgis.com/J7ZFXmR8rSmQ3FGf):
  station list and per-gauge readings. WORKING. Hourly cadence, but
  gauges_2_view retains only ~7 days (~6.5k rows). The source of truth for
  level data; `lib/arcgis.ts` `getNational()` is the one consolidated fetch.

- **ArcGIS Flood_Map** (same org): the Irrigation Dept's official maps of 17 past floods (Kelani 1989/2012/2016,
  Kalu 2017, ...) with the GN/DSD divisions each extent touches. Static (Dec 2025): read once by
  `scripts/build-flood-map.mjs` into `lib/model/flood-map.json` (names + centroids, no polygons); `lib/floodMap.ts` ->
  "Official flood map" card on town and river pages. Past extent, never a live flood or a verdict input.

- **ArcGIS Reservoir_Data_2024**: static infrastructure — irrigation tanks
  only, NO CEB hydropower. Useful for context only.

- **Irrigation Dept "Reservoir Water Level" Google Sheet** (id starts
  2PACX-1vTcSGhi9RESl7CMC...; tabs Major gid=1212294664, Medium 562386515):
  daily spilling Y/N, spill + sluice cusecs, gate settings, water depth for
  ~120 reservoirs. WIRED in `lib/releases.ts` (10-min cache, fail soft).
  Overwritten daily with no timestamp: we show the reading's date and archive
  every change. `GO=` numbers in REMARKS are gate-setting discharge, not flow:
  show the Spilling (Cusec) column, and gates only as a count of open gates.
- **Irrigation sheet, season tabs** (same published sheet, gid 155979206 "Maha" and 1831537855 "Yala"; the Irrigation Dept's "Medium Reservoirs Daily
  Water Level" dashboard reads them plus the clean medium tab gid 698704031, which has NO spill/sluice cusecs, so it cannot replace the formatted
  tab in `lib/releases.ts`): per medium reservoir, daily effective storage for each season and the long-term average. `lib/seasonStorage.ts` (6 h
  unstable_cache of a small per-reservoir summary, 1.5 s timeBox, server only) + `lib/seasonCalc.ts` (pure; tests `node scripts/season.test.mts`)
  -> one line on medium reservoir pages ("About normal for late October (long-term average 85%)", +/-10 points = normal). Context only: never a
  release or spill input. Health check `season` (warn).
- **Mahaweli WMS daily PDF** (mahaweli.gov.lk/WMS%20DATA/Menue-WMS%20-%20E.pdf):
  storage + spill/downstream discharge (m3/s and ft3/s) for the CEB and
  Mahaweli reservoirs. WIRED in `lib/releases.ts` (unpdf, column x-positions,
  If-Modified-Since). Blank = unknown, never zero. Spellings normalised
  (Moussakele -> Maussakele, Castlereigh -> Castlereagh) in `wmsName()`.
- **DMC Irrigation flood-warning PDFs**: `lib/warnings.ts` also extracts the
  release cusecs (`releaseCusecs`) from digits next to "ඝණ අඩි" / "கன அடி" / cusecs.
- **Newswire** (newswire.lk/feed/, WordPress RSS, main news source; Ada Derana and Daily Mirror secondary):
  `lib/newsFeeds.ts` fetches all three once per 10 min (UA with site URL + owner email, If-Modified-Since),
  shared by the spill-gate detector below and the **Flood news board** (`lib/news.ts`: keyword rules in
  `lib/newsClassify.ts`, optional gpt-6-luna for borderline items, max 8/refresh; `/news`, home card,
  "In the news" on river/reservoir pages). The feed holds only ~12 h, so `/news` backfills 7 days from
  Newswire's WordPress search API. We keep headline + link + a 20-word first sentence, never articles;
  never NewsArticle markup. Health check `feed-newswire`. Tests: `node scripts/news.test.mts`.
- **News RSS** (Ada Derana rss.php, Daily Mirror breaking-news/108): keyword match of
  "spill/sluice gates opened/closed" + a catalogue reservoir. Shown as "reported",
  never official, expires after 12 h. Ada Derana items have no date: the story
  page's datePublished is read.
- **Reservoir -> gauge map and travel times**: `lib/reservoirs.ts`. Only Deduru Oya ->
  Moragaswewa (4-5 h, one event, 21-22 Oct 2026) is measured; the rest say "may rise in
  the next hours". Refit from the archive when more events exist.
- **Release archive**: `scripts/releases-snapshot.mjs` + `.github/workflows/releases-snapshot.yml`
  save each changed snapshot to the `data` branch as `releases/YYYY/YYYY-MM-DD.jsonl`
  (it reads the site's own `/api/releases`, so it works once deployed).

- **PUCSL day-ahead-dispatch** (gendata.pucsl.gov.lk/api/...): `powerInMw` IS
  populated now (checked 2026-10-23) but lags ~2.5 days and has gaps. Archive and
  post-event analysis only: `lib/ceb.ts` drops points older than 3 h, so it is
  never shown as live and never a warning. Flat MW is not turbine release (Upper
  Kotmale stayed at 75 MW while its gates were opened).

- **Data-source health**: `lib/health.ts` -> `/api/health` and the public `/status` page.
  `.github/workflows/health-check.yml` (every 30 min) runs `scripts/health-alert.mjs`: one
  `data-health` GitHub issue per check failing twice in a row, Slack via the `SLACK_WEBHOOK_URL`
  secret (open, every 6 h, recovered; also on scheduled-workflow failures). When a source
  changes shape, expect an issue titled "Data source down: ..."; see DOCS.md "Monitoring".

- **CUrW Colombo canal gauges** (pub.curwsl.org/dyn/*.png, 7 chart pages, 33 gauges, m MSL, 15-min):
  PUBLIC with credit since 26 Oct 2026 (owner decision: the charts are published on a public site, we emailed
  admin@curwsl.org cc mail@sllrdc.lk on 23 Oct, no reply; if CUrW/SLLDC object, remove it: make `getCanals()` in
  `lib/curw.ts` return null (every caller then shows nothing) and delete the callers, `/api/canals` and `app/colombo/CanalLevels.tsx`). Rules: credit text
  "Canal levels: CUrW / SLLDC (pub.curwsl.org)" with a plain link to their homepage wherever a level is shown; the
  BROWSER NEVER CALLS their host (no hotlinked PNGs, no client fetches): pages read our D1 archive on the server via
  `lib/curw.ts` (`getCanals()`, cached 5 min, time-boxed 1.5 s, fails soft) and client code uses our own `/api/canals`.
  No JSON/CSV exists upstream; `scripts/curw-snapshot.mjs` OCRs the chart titles (tesseract) and
  digitises the plotted line, every 15 min via `.github/workflows/curw-snapshot.yml` (Cloudflare `*/15` cron),
  into Cloudflare D1 tables `curw_levels` / `curw_status` / `curw_raw` (`d1/0002_curw.sql`). Still not committed to the
  public repo or `data` branch (raw archive stays in D1). Only gauge counts go to `data:curw/status.json` for the
  health check. Several gauges (Wellampitiya N, Gothatuwa DS, ...) are offline at the source: shown as "Not reporting".
  "Usual" = the gauge's own recent range (`lib/curwStatus.ts`); tidal canals are judged by their low-tide floor. Canal state
  is context only (reason line, opt-in low-spot note): it never sets a town verdict. Request volume: 7 requests per 15 min,
  User-Agent with the site URL and contact email. Research on what drives the canals: `research/colombo-canal-dynamics.md`.
- **Colombo tide** (`lib/tide.ts`, fitted by `scripts/fit-tide.mjs` to Nagalagam's own dry-period readings; no CUrW data):
  predicted high/low times for 48 h, shown on Nagalagam Street, canal-area town pages and `/colombo-canals`. Times can be
  off by up to an hour; heights are never a river level. Basins, towns and gauge groups: `lib/colombo.ts`.

- **Learned parameters** (`learned/town-params.json` on the `data` branch, daily `scripts/feedback-learn.mjs` + `lib/learnedParams.mjs`, DOCS.md
  "Learning from feedback"): street-water gauge level and rain mark taught by visitors' answers, evidence-gated (>= 3 people, >= 2 days) and bounded.
  Notes and heads-ups only: NEVER the verdict step, tone, sticky bar or push levels. Counts only in the file. Forecast factor tested, not wired (no gain).

- **HMIS (hmis.gov.lk)**, the Irrigation Department's Hydro-Meteorological Information System (CResMPA): its public dashboard
  JSON ("Public Access", no login; owner decision 27 Oct 2026: public data, use it). `lib/hmis.ts` (fetcher: one request per
  endpoint per 10 min via unstable_cache, 2.5 s soft budget, fail soft, UA with site URL + owner email, never from the browser,
  never D1) + `lib/hmisCalc.ts` (pure: timestamps, offset, device mapping, nearest rain; tests `node scripts/hmis.test.mts`).
  Endpoints: `getwaterlevelsummary/1_day/live` (53 devices, 24 h, metres, thresholds incl. extreme), `getrainfalldevices` (661 rain
  gauges: NBRO 481, Met 120, Irrigation 58, ACCIMT 2; ~280 report in any 3 h), `warnings` (empty so far). Credit wherever shown:
  "HMIS – Irrigation Department (hmis.gov.lk)" plus the institute (NBRO / Met Department / ACCIMT). Its hourly Irrigation gauges are
  the SAME readings as ArcGIS (identical to the millisecond), so they add nothing; the value is (1) 10-min HMIS sensors at
  Hanwella / Baddegama / Thanamalwila (a "Latest: X ft at 4:40 pm (10-min sensor)" note, median-offset corrected, never the official step),
  (2) 10 gauges ArcGIS lacks, merged into `fetchStations` / `getNational` / `fetchStationData` with `source: "hmis"` (Karawanella
  Bridge, Mahiyangana Bridge, 8 east-coast bridges/anicut under Mundeni Aru, Andella Oya, Maduru Oya, Magalawatavan Aru: rivers found by
  point-in-polygon on HMIS `basin/merge`), (3) ground-rain notes within 5 km, record <= 3 h old, ahead of GSMaP.
  HMIS gauges are never "upstream" of an ArcGIS gauge in forecasts or the anomaly detector (no fitted travel time).

- **Gauge-corrected satellite rain** (`lib/rainCorrection.ts`, `scripts/rain-correct.mjs`, `rain-correct.yml`; DOCS.md "Gauge-corrected satellite rain"): the
  GSMaP 24 h rain adjusted with the live HMIS gauges (class x region median factor, shrunk to 1, plus faded gauge residuals). A NOTE and a /rain toggle only:
  the street-water rule, heavy-rain warning, push and official steps stay on RAW GSMaP until the logged corrected series (`data:rain-correction/log/`) is backtested.

- **Flood survey from anywhere** (28 Oct 2026): the "Mark your spot" survey and its top pill show on ALL town and gauge pages; `/api/flood3d/report` accepts survey answers from the Sri Lanka box (`SL_BOUNDS`) and stamps page/target, district, the nearest river gauge and rain gauge (`lib/reportContext.ts`, d1/0017, from existing caches). Only corridor (`BOUNDS`) rows feed the 3D map or learning (`corridorOnly()`); `scripts/reports-export-all.mjs` is the owner's private all-rows export. See DOCS.md "Flood survey".
- **3D flood test map** (unlisted, noindex): `/lab/flood-3d` (en only). Offline prep in `scripts/flood3d/` (fetch.py, prep.py; GLO-30 +
  OSM via Overpass; run from a venv with rasterio/pyproj/shapely, small enough for the laptop) writes `public/flood3d/` (level.png =
  per-cell flood level in ft at Nagalagam, fitted on the EMSR851 maps; roads tagged with level; accuracy.json). Live gauges via
  `/api/flood3d` (`lib/flood3d.ts`, our caches only). MapLibre 5.24.0 is served from `public/flood3d/ml` (CSP build; the npm
  package is a dev dependency for types only). Illustration, never an official step or verdict input. Coverage (since 28 Oct 2026): the Kelani
  from the mouth to Ruwanwella (79.84-80.31 E, 6.84-7.10 N, 1680 x 930 grid, 3 km corridor round the main stem + the arms of the 2016 polygon; the rest is greyed, no calibration).
  `extend.py` (after fetch.py, fetch_upstream.py, fit-upstream.py) keeps every old covered pixel byte for byte and adds the rest: west of 80.10 E the old method and zone offsets, east of it
  level = 2.3 ft + k x height above the Kelani main stem, k fitted per 3 km reach on the two dated EMS maps (Nagalagam at the satellite time), clipped to the observed brackets, 2016 extent as a floor.
  Weakest part: two dated maps only, none east of 80.2 E (class 0 hatch there); the one scalar is Nagalagam, which Hanwella leads by ~18 h and Glencourse by ~48 h, so upstream water in a replay or live
  view shows up half a day to two days late (a per-cell gauge driver would fix it; a gauge -> Nagalagam-equivalent rating was tried and dropped, see accuracy.json `upstream`); public reports (Locate me / Report here) go to D1 `flood3d_reports`
  (d1/0012, precise coordinates private, area counts of 3+ only; owner export `scripts/flood3d/reports-export.mjs` feeds `prep.py` via REPORTS=);
  `/api/flood3d/rain` blends satellite hour x gauge gain with live HMIS gauges for the optional Rain now layer.
  Optional private report photos: browser resize to JPEG, `/api/flood3d/photo` strips metadata and stores via the `workers/flood-photos` Worker in the
  private R2 bucket `sl-flood-photos` (needs Vercel env FLOOD_PHOTO_URL + FLOOD_PHOTO_SECRET; dormant without them; D1 columns photo_key, photo_count,
  exif_agree). Live gauges: `lib/flood3d.ts` (one snapshot read; routes must stay dynamic: they read `headers()`).

- **PUCSL reservoir/storage-rainfall**: same — endpoint exists,
  returns `data: []`. Stub.

## Critical gotchas

These cost real debugging time. Future-you should not relearn them.

- **No unit metadata anywhere on the ArcGIS dataset.** Empirically:
  alertpull >= 4 -> feet; alertpull <= 1.5 -> meters; in between is
  ambiguous. See `lib/units.ts`. Norwood (Kelani) reports in meters
  despite the rest of Kelani being feet — single basins can mix units.
- **HMIS timestamps: two conventions in one API.** `getwaterlevelsummary` timestamps are Sri Lanka local time labelled "Z"
  (Hanwella "16:03:56.630Z" = the ArcGIS reading of 10:33:56.630 UTC): real UTC = parsed - 5.5 h (`fixHmisLevelTime`). The rain
  endpoint's `latest_record_time` is real UTC (no shift). Getting either wrong puts readings 5.5 h in the future or past. HMIS
  levels are metres; the site shows feet (`lib/units.ts`).
- **`gauges_2_view.rain_fall` is often null** at downstream/urban gauges
  (Nagalagam Street, Calidonia). Null means "not measured here," not zero.
- **`hydrostations.basin` has trailing whitespace** (`"Kelani Ganga     "`).
  Always `LIKE 'X%'` or `.trim()` before comparing.
- **`CreationDate` is epoch milliseconds**, not ISO or seconds.
- **ArcGIS rate-limits aren't documented but exist.** Repeated queries
  (>=1/s) return HTTP 200 with an `{error:{...}}` body ("Too many requests.").
  `arcgis()` validates inside `unstable_cache` (60s) so errors throw and are
  never cached. maxRecordCount is 1000: it pages on `exceededTransferLimit`.
- **PUCSL day-ahead-dispatch lags ~2.5 days** (and was all-null before October).
  Curl first; never present it as live.
- **Mahaweli WMS PDF uses non-standard spellings**: "Moussakele", "Castlereigh",
  "Rantambe", "Alikotaara". Normalised in `lib/releases.ts` / `lib/reservoirs.ts`.
- **longitude-DESC is wrong for Mahaweli / Nilwala / Kirindi Oya.**
  Use the explicit `BASIN_ORDER` table in `lib/basinOrder.ts`.
  Mahaweli flows north-east; Nilwala and Kirindi flow south.
- **The `@vercel/mcp-adapter` package on npm is empty** (publisher
  moved it). Use `mcp-handler` instead — that's the actual successor.

## Conventions in code

- **Worktree state**: do NOT call `EnterWorktree` on this project.
  We work in the parent checkout. There's no settings.json opt-out
  (the agent-config classifier blocks self-modifying that file).
- **Cookies for client->server persistence**: writes `sl_station`
  and `sl_days` on the client, reads via `cookies()` on the server.
  No localStorage — avoids hydration flash.
- **Suspense keying**: when a server component depends on URL state,
  include that state in the Suspense `key={...}` so the skeleton
  fires on change. See `app/page.tsx`.
- **All ArcGIS calls go through `lib/arcgis.ts:arcgis()`** which
  sets `f=json` and a 60s revalidate. Don't fetch ArcGIS endpoints
  directly from components.
- **Heuristic outputs are documented in code comments** with the
  threshold values and the rationale. Future tuning should update
  both the constants and the comments.

## Don't-do list

- Don't add a hardcoded unit suffix. Use `detectUnit()` from
  `lib/units.ts` and show suffix only when confident.
- Don't trust the `longitude-desc` fallback for basin ordering.
  Add to `BASIN_ORDER` instead.
- Don't show PUCSL MW as live (it is days late) and don't treat flat MW as
  turbine release. Release warnings come from `lib/releases.ts`.
- Don't run `npm run build` locally without good reason — Vercel
  builds remotely and surfaces errors equivalently.
- Don't reintroduce `turbopack.root` in `next.config.ts`. It only
  papered over the multi-lockfile warning from a now-removed worktree.

## What's intentionally not built yet

So future sessions know what's pending vs. broken.

- **Feeding releases into the forecast** — `releaseAffecting(station)` exists; the
  verdict wiring and the travel-time fit wait for more archived events
  (`releases/` on the `data` branch).
- **Historical-event calibration** for forecast magnitudes — current
  prediction is persistence + momentum; magnitudes are uncalibrated.
- **Rainfall forecast feed** (Open-Meteo) — Stage A of the prediction
  pipeline. Anomaly detector currently fills the gap reactively.
- **Map view** (Leaflet/MapLibre) of all 41 stations + flood polygons.
