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
**Gauge-only 1 / 3 / 6 h model (added 2026-10-24; `lib/model/gaugeModel.mjs`, `lib/model/gauge-model.json`,
`node scripts/fit-gauge-model.mjs`, `node --experimental-strip-types scripts/gauge-model.test.mts`).** The first live
check (516 forecasts, 22-24 Oct) showed the rain-ridge next hour barely beat "no change" (0.10 vs 0.12 ft) and the
trend-only gauges were worse (0.38 vs 0.32 ft). The fix was more history, not more inputs: the fit script merges our
archive with the hourly feed scraped by github.com/nuuuwan/lk_irrigation (MIT; 2025-11-23 on, ~8,000 readings per gauge,
metres, converted back to feet for ft gauges) = 11 months including the Nov-Dec 2025 floods. Per gauge and horizon it
fits a least-absolute-deviation (IRLS ridge) regression of the level change on the gauge's own 1/2/3/6/12 h changes, its
level against the last-12-h mean, the 1/3/6 h changes at the other gauges on the river, and (only where it wins by 5% in
CV: Nagalagam Street, Peradeniya, Putupaula, Thalgahagoda) a harmonic tide term (M2 S2 N2 K1 O1, fixed periods). The
80% range is the empirical 10/90% quantile of the cross-validated residuals in three volatility bins (recent hourly
movement), widened 15% in `lib/forecast.ts` (`GM_WIDEN`). Horizons that do not beat "level stays put" by 3% in BOTH the
blocked CV and the holdout ship as persistence with the empirical range (never an extrapolated trend). Trend-only gauges
now use it too (1 h, with a range). It replaces the rain-ridge point and range at 1/3/6 h where it is skilled (or where
the rain-ridge horizon was already persistence). Since 2026-10-26 the storm-aware version (below) also replaces the rain-ridge at 12/24 h.
*Backtest, not live results (the last 60 days held out, never used to fit or choose; mean over gauges of MAE in each
gauge's own unit, 36 gauges, 30 of them the previously fitted ones):* next hour error 0.027 vs 0.040 for "no change" (-32%;
the old model structure re-scored the same way: -10%), 3 h -25%, 6 h -21%; 80% range covers 79% (83% with the 15% widening)
and is about 0.07 m wide at 1 h (was ~0.25 m); rising / falling called right in 54% of the hours that really moved at 1 h
(always saying "steady" scores 0% there). 31 of 36 gauges are skilled at 1 h, 23 at 3 h, 21 at 6 h; Hanwella -69%,
Nagalagam Street -61% (tide), Glencourse -47%. Not skilled: Horowpothana, Katharagama, Kuda Oya, Thaldena, Yaka Wewa and
the sparse gauges Weraganthota, Thanthirimale, Galgamuwa. Catchment rain (Open-Meteo historical forecasts) was tested as an extra
feature: it changed the 1 h error by < 1% and 6 h by ~1%, so it is not in this model; satellite (GSMaP) rain has only
3 days of archive and was not testable. Live accuracy is now automatic: `.github/workflows/accuracy-snapshot.yml` (every 3 h) runs `scripts/accuracy-snapshot.mjs`, which scores the
D1 prediction log (per horizon 1/3/6/12/24 h, all gauges and per gauge, last 30 days and since launch, split into `model` = issued since the
gauge-only model went live 24 Oct, `model-early` and `trend`, with the "no change" baseline) into `accuracy/latest.json` on the `data` branch.
`lib/accuracy.ts` reads it (1 h cache, 1.5 s time box, fails soft) for About #next-hour, /data, llms.txt, llms-full.txt, the MCP
`get_next_hour_forecast` and the small line under each gauge chart (hidden below 10 checks). Refit: `git fetch origin data`, then the script (about a minute), commit the JSON.
`snapshot.mjs` also archives hourly catchment rain and daily GloFAS discharge to `rain/` and `glofas/` on
the `data` branch so later refits can use real history.

#### Storm-aware forecast (v3, added 2026-10-26)

*Owner's question: "weather is the most important factor. A storm like Ditwah forms more rain. Does the prediction take that into
account?"* Honest state before this: the 1/3/6 h model did not use rain (it added < 1% on average, because most hours are calm) and the
12/24 h model (8-day rain ridge, one rain event) was worse than "no change" live (12 h 0.99 vs 0.72 ft, 24 h 1.43 vs 1.13 ft).

**What changed.** (1) `lib/model/storm-model.json` (fitted by `node scripts/fit-storm-model.mjs --rain rain-history.json`, rain from
`node scripts/fetch-rain-history.mjs`, tests `node --experimental-strip-types scripts/storm-model.test.mts`) gives every gauge with a rain grid a
gauge-only 12 h and 24 h model (same recipe as 1/3/6 h) that replaces the old ridge at all horizons it covers. (2) On **storm hours only**
(catchment rain over the last 24 h or forecast for the next 24 h reaches 50 mm) a rain correction is added to the gauge-only answer,
for the gauge/horizons where the leave-one-storm-out test said it helps (7 of 36 gauges at 1 h, 7 at 3 h, 12 at 6 h, 13 at 12 h, 17 at 24 h). It is
one non-negative linear model per horizon shared by all gauges (each gauge's size set by its own typical 24 h swing), on four numbers: rain in the
gauge's routing window (lag from `scripts/station-configs.json`), the same on wet ground (72 h antecedent rain), rain forecast before the horizon,
and the same on wet ground. Calm hours are the gauge-only answer exactly, so they cannot get worse. (3) The storm range is the gauge's own
held-out storm residuals, stretched by one factor per horizon (1.55 / 1.60 / 1.75 / 1.90 / 2.00) until coverage over all storm hours reached 78%, and
its upper end is at least the answer under the heavier ECMWF ensemble rain (p90). (4) The "Heavy rain forecast upstream" warning (below).
Rain for the past 72 h now comes from the same Open-Meteo call (`past_days=4`).

**Backtest (not live results).** 11 months of hourly gauge history (36 gauges with a rain grid, 23 Nov 2025 - 25 Oct 2026). Rain: Open-Meteo Previous
Runs API, observed hourly rain and the forecast made ONE DAY EARLIER for future hours (no hindsight, and a little older than what the site sees live,
so skill is on the cautious side). Gauge-only baseline: blocked 7-fold CV. Storm correction: **leave one storm out** (15 storms at 50 mm: Ditwah 26-29 Nov
2025, 9 Dec, 17 Dec, 5 Jan, 31 Jan, 20 Feb, 7 May, 11 May, 22 May, 27 Jun, 30 Jul (9 days), 20 Sep (5 days), 3 Oct, 12 Oct, 20 Oct), 48 h purged around
the held-out storm. Bands are nested (computed only from the other storms). Mean miss in feet over all gauge-hours (gauges kept in their own unit, then
converted), storm hours = rain over the last or next 24 h >= 50 mm:

| Storm hours, all 36 gauges | 1 h | 3 h | 6 h | 12 h | 24 h |
|---|---|---|---|---|---|
| "No change" miss (ft) | 0.31 | 0.84 | 1.46 | 2.31 | 3.51 |
| Gauge-only model | 0.21 | 0.66 | 1.24 | 2.14 | 3.40 |
| + rain on every gauge (no selection, honest) | 0.21 | 0.66 | 1.25 | 2.03 | 2.93 |
| Shipped (rain only where it won; slightly flattered by that choice) | 0.20 | 0.65 | 1.18 | 1.94 | 2.85 |
| Old 80% range covered (gauge-only, storms) | 68% | 64% | 59% | 52% | 46% |
| Storm range covered (nested) | 79% | 78% | 79% | 78% | 78% |
| Storm range width (ft) vs old | 0.64 vs 0.32 | 2.2 vs 0.9 | 4.9 vs 1.6 | 9.6 vs 2.6 | 14 vs 3.6 |

| **Ditwah only** (26-29 Nov 2025, held out), 36 gauges | 1 h | 3 h | 6 h | 12 h | 24 h |
|---|---|---|---|---|---|
| "No change" miss (ft) | 0.40 | 1.12 | 1.99 | 3.26 | 5.50 |
| Gauge-only | 0.26 | 0.89 | 1.75 | 3.14 | 5.34 |
| + rain everywhere | 0.26 | 0.88 | 1.80 | 2.92 | 4.31 |
| Shipped | 0.26 | 0.85 | 1.61 | 2.65 | 4.04 |
| Shipped gauges only (7 / 7 / 12 / 13 / 17 gauges): gauge-only -> shipped | 0.17 -> 0.14 | 0.78 -> 0.59 | 2.08 -> 1.68 | 4.24 -> 2.96 | 7.14 -> 4.80 |
| Storm range covered (old range) | 66% (59%) | 66% (53%) | 63% (46%) | 65% (37%) | 60% (32%) |

By how heavy the rain is (all 36 gauges, shipped, 24 h): 50-100 mm hours miss 2.45 ft vs 2.60 gauge-only (-6%); 100 mm or more 4.12 vs 5.91 (-30%);
the gain is almost all in the biggest storms. Calm hours (279,000 gauge-hours, rain < 50 mm either way): unchanged by construction, gauge-only vs "no change"
0.072 vs 0.096 ft at 1 h, 0.33 vs 0.39 at 6 h, 0.67 vs 0.69 at 24 h. At 24 h the old ridge did not exist in this backtest (it was fitted on 8 days),
so "replaces where the new one beats it" rests on the live miss of the ridge being worse than "no change" and the new model being at least "no change" everywhere
(unskilled horizons ship persistence with an empirical range).

**Peaks and flood-mark crossings (the weak spot).** At storm hours when the river was about to rise 0.5 ft or more within 24 h (2,681 cases), the forecast's
highest point over the five horizons saw 19% of the coming rise with the gauge-only model and 40% with the storm correction (peak height miss 4.4 -> 3.7 ft,
peak timing miss 10.4 -> 6.8 h, forecast peaks still too low by a median 1.7 ft). Flood marks reached from below in storm hours (47 alert, 29 minor, 18 major crossings at
gauges with published marks), point forecast crossing the mark by at least N hours before it happened:

| Alert crossings (47) | >= 1 h | >= 3 h | >= 6 h | >= 12 h |
|---|---|---|---|---|
| Gauge-only, line | 28 | 9 | 3 | 1 |
| Storm-aware, line | 34 | 18 | 12 | 8 |
| Gauge-only, top of range | 36 | 24 | 16 | 4 |
| Storm-aware, top of range | 43 | 29 | 24 | 15 |

(minor: 20 / 11 / 6 / 5 of 29 by the line, 23 / 16 / 13 / 11 by the top of the range; major: 11 / 6 / 5 / 5 of 18 by the line, 14 / 8 / 7 / 7 by the top of the range.)
The price is false alarms: of storm hours within 3 ft below a mark where the top of the range reached it, the river really got there within 24 h 35% of the time
(alert; 49% for the gauge-only range), 41% minor, 52% major. Median lead time (top of range, alert) 6 h, was 3 h. In plain words: a big storm is still
hard to forecast; the model sees more of it, earlier, with a wide honest range, and the rain warning exists because the line alone still under-reads.

**Rain warning thresholds** (`lib/rainRisk.ts`, from the same data: forecast catchment rain for the next 24 h against how far the river rose in those 24 h,
all gauges, hours): under 10 mm 13% rose 1 ft or more (mean rise 0.4 ft); 10-25 mm 34% (1.2 ft); 25-50 mm 50% (2.2 ft); **50-100 mm 65% (3.7 ft; 31% rose 4 ft or more)**;
**100 mm or more 85% (6.6 ft; 61% rose 4 ft or more)**. So the line "Heavy rain forecast upstream in the next 24 hours (about N mm). The river may rise faster than the
line shows." shows at >= 50 mm forecast (deterministic, area average above the gauge), or when the heavier ensemble member (p90) reaches 100 mm ("Very heavy rain is possible ...").
Shown under the chart (`app/StationCard.tsx`), appended to the next-hour sentence (`lib/answers.ts`), in `/api/levels` `nextHour.rainRisk`, MCP, llms.txt (How it is made) and the push text when
a river alert fires (`pn.rainRisk`; `Glance.rainRisk`, looked up only for places that are not calm). si/ta wording is a DRAFT, flagged on the page.
**Not done / limits:** no archived ensemble exists, so the p90 widening could only be checked with a stand-in (forecast rain x1.6, which changed nothing: the storm range was already wider);
GSMaP satellite rain was not backfilled (no need: Open-Meteo observed rain was available for the whole period; GSMaP stays a live display only); the correction is pooled across gauges, so
it is weaker at gauges with their own quirks (dam releases, tides); storm ranges are very wide (24 h about 14 ft on average) because that is what the errors were.
Live accuracy for this version is its own segment (`model-v3` in `accuracy/latest.json`, `stormModelSince`); compare it with `model` (gauge-only, 24 Oct to 26 Oct) as checks accumulate.

**Measured heavy rain (added 26 Oct 2026, `lib/measuredRain.ts`).** The line above only reads FORECAST rain. On 26 Oct 2026 Holombuwa's own rain sensor read 31.9 mm (08:03 to 09:10)
and 34.7 mm (09:10 to 10:06) and the river went 4.4 ft to 15.3 ft in 5 hours, past minor flood (13.1 ft), while `nextHour.rainRisk` stayed null: the forecast missed a local cloudburst.
So the gauges' own rain now trips the same warning. `gauges_2_view.rain_fall` is mm since the gauge's PREVIOUS reading (blank = not measured, never zero), so a window sum prorates each
reading over the interval it covers (previous reading to this one); exact duplicate timestamps count once, blanks add nothing, an interval over 3 h is not attributed to any hour,
and a gauge whose newest reading is over 2 h old says nothing. Windows end at the gauge's newest reading. Gauges used: the station itself and every gauge before it in
`BASIN_ORDER` (lib/basinOrder.ts) for its river; a river not listed there only has its own gauge; one gauge with data is enough. **Trips at 25 mm in 1 h or 40 mm in 3 h** at any of them.
Line: "Very heavy rain was measured at {gauge} in the last {N} hours ({mm} mm). The river may rise fast." (with both: that sentence, then the forecast sentence, one closing).
`rainRisk.kind` is `forecast`, `measured` or `both` (`/api/levels` `nextHour.rainRisk`: `kind`, `level` and `mm_24h` are null for `measured`, `measured: {gauge, upstream, hours, mm}`, `line`).
Shown in the same places as the forecast warning: under the chart, next-hour sentence, API, MCP, llms.txt, push text (`pn.rainMeasured`, `Glance.rainRisk = "measured"`, no network call),
and X storm mode (a gauge off the calm tier with measured rain starts storm mode; the storm post names the rain; `GaugeFact.measuredRain`). si/ta wording is a DRAFT.

*Backtest (`node scripts/measured-rain-backtest.mts <data-branch export> --live`).* The rain archive only exists from 15 Oct 2026 (the 11-month level history has no `rain_fall`), so this is
14 days and a handful of storms, NOT 11 months: 6,594 station-hours on the gauges in `BASIN_ORDER`, base rate of a rise of 1 ft or more in the next 6 h = 6.6%. Rain at the gauge or upstream of it:
15 mm/1 h or 25 mm/3 h: 306 hours fired, 23% followed by a 1 ft rise (3.5 times the base rate), 16% of all such rises caught; **25 / 40 (shipped): 116 hours, 18% (2.7x), 5% caught, 6 rises of 3 ft or more**;
25 / 50: 23%; 30 / 50: 18%; 40 / 60: 28%, 3% caught. Precision is modest because big downstream rivers (Hanwella, Nagalagam Street, Putupaula) often get less than 1 ft from the same rain
that lifts a small tributary 8 ft (Holombuwa: 3 of 3 firing hours, rise up to 7.7 ft; Glencourse 6 of 10); it is a "check the river" flag, like the forecast one. 25 / 40 was kept as the starting
point; revisit when more events are archived. Holombuwa on the day: the warning is ON at 09:10 (40 mm in 3 h; level 5.9 ft) and at 10:06 (67 mm; 9.7 ft), while the river reached 13.1 ft about an hour later and 15.3 ft by 13:00.

*Storm model.* The storm gate (`gaugeSteps`) also switches on when measured heavy rain trips (for gauges that have a storm entry and a catchment rain series): the storm range replaces the calm one.
The correction itself still reads the catchment rain series, and for Holombuwa only the 6, 12 and 24 h steps have a storm model, so the 1 and 3 h steps are unchanged.
*Refit with measured-rain features: tried, not shipped.* `node scripts/measured-rain-experiment.mts <export> --live` fits a non-negative correction on the shipped gauge-only model's residuals on
storm hours from measured rain at the gauge and upstream (3 h and 6 h), leaving one day out: error as a share of the gauge's typical swing, 1 h: shipped 0.158, with measured rain 0.158; 3 h 0.304 vs 0.307; 6 h 0.308 vs 0.313
(93 to 105 held-out storm hours each). No gain, so no model change, no "v4", and no change to calm hours. What the shipped model said at Holombuwa: at 09:10 (5.9 ft) it said 6.4 ft in 1 h and 6.7 ft in 3 h; the river read
10.0 ft and 15.3 ft. At 10:06 (9.7 ft): 11.2 ft and 11.8 ft; actual 13.1 and 15.3 ft. The model cannot know a cloudburst is under way from level changes alone; 12 days is too short to fit rain features that do better.
Revisit when a monsoon season of `rain_fall` is archived (the data branch keeps it: `.github/workflows/snapshot.yml`). GSMaP satellite rain (data branch `gsmap/`, since 23 Oct) is not used: too short to backtest.

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

**Status since 26 Oct 2026: the rain rule is a personal opt-in for low-lying spots, not a town warning.** The owner (who lives in
the lowest spot of Wellampitiya) pointed out that about 98% of a town's streets stay dry when the rule fires, and that the rule is
often wrong. So heavy satellite rain no longer changes any public output: not the town verdict or tone, the "Why" list, the
next-24-hours line, the index rows, the social image, the answer sentences / llms.txt, the APIs, or X posts (X never posts it).
What remains:
- `assessTown().lowSpot` (`lib/townRisk.ts`): `{level: possible|likely, mm}` from the clipped 24 h sum (60 / 100 mm, unchanged).
  It never touches `tone`. The Kelani at its minor flood level (below) is a river reading: it still lifts the town to "Flooding
  likely" for everyone and is part of `baseTone`.
- Town pages of canal towns (`rainZone`) show a small neutral panel "Low ground near the canals" below the rain chart
  (`app/flood/LowSpot.tsx`; no verdict, badge or colour): at 60 mm or more it states the rain as a fact and how past events went
  (only a few low spots beside the canals got water), with a "My spot is low - tell me" button; below 60 mm one muted invite line.
- The choice is stored on the device (`localStorage sl_low_spots`, `lib/lowSpots.ts`) and, when alerts are on, in the push prefs
  (`lowSpots: ["t:wellampitiya"]`, `lib/pushPrefs.ts`; also a per-town switch in Alert settings). Default off for everyone.
- Only for people who opted in: the Your places row (`app/MyPlaces.tsx`) shows the river verdict as the main word and a quiet
  second line ("Heavy rain: your low spot may get water" at 60 mm, "Very heavy rain: your low spot is likely to get water" at
  100 mm), and one push at 100 mm ("Heavy rain near X: your low spot is likely to get water") plus the all-clear. No push at
  60 mm; the push waits through quiet hours. `Glance.street` carries the rain level to the card and the sender; `levelOf` ignores it.
- The owner Slack ping (`scripts/street-rain-log.mjs`) is labelled "low-spot rain heads-up". D1 logging, the shadow test and
  the research page are unchanged (the page's "What the site does" paragraph says the above). "How our warnings did" and
  `/api/town-outcome` were removed. Wording everywhere: no "Water on the streets likely"; the honest line "an early heads-up from
  rain totals; it is often wrong and does not mean the area is flooding" is shown with the panel and in the push body.

The rest of this section describes the rule itself, as validated.

The rule in `lib/townRisk.ts` step 6 was backtested on 14 documented floods (16 with the merged ledger) and then
validated on every day of the GSMaP_NOW archive, 2017-2026 (`research/wellampitiya-flood-rule-backtest.md`, section
"Validation (complete)"; public write-up at `/research/wellampitiya-street-flooding`). The validated rule:

- **Rain number** = the 24 h sum of hourly GSMaP_NOW means over the 4-pixel box (6.85/6.95 N x 79.85/79.95 E) with
  **each hour clipped at 15 mm before summing** (cuts impossible NOW spikes such as 118 mm in one hour).
  `scripts/gsmap-snapshot.mjs` (via `lib/streetRainWindow.mjs`) writes it as `zones.colombo-east.mm24hClipped`
  in `gsmap/latest.json`; hour = mean of the :00 and :30 files, window = the last 24 clock hours. The raw total stays in
  `mm24h` (display and logging only; the rule never reads it). Files from before the clip have no `mm24hClipped`: the
  rain half of the rule is then off until the next snapshot.
- **Likely** (now: the personal "very heavy rain" note at 100 mm; the Kelani-at-minor part is a river level, tone minor): clipped 24 h rain >= 100 mm, **or the Kelani at its minor
  flood level**: Nagalagam Street >= 5 ft, or Hanwella at/above the minor mark the gauge itself publishes (24.6 ft = 7.5 m
  in 2026; never hardcoded). Only readings under 3 h old count. `riverTrigger()` in `lib/streetRainLog.ts`; the site reads
  the gauges in `lib/townData.ts`, the logging job reads `/api/levels`.
- **Possible** (now: the personal "heavy rain" note at 60 mm): clipped 24 h rain >= 60 mm. A quiet
  heads-up, often wrong (about 8 alarm episodes a year with no flood on record): never a verdict, **never sends
  a push alert**. Only "likely" (and its all-clear) pushes, and only to people who marked a low spot.
- No burst (1 / 6 / 12 h) term and no season thresholds: neither beat the plain 24 h sum.
- Expected scores (16 floods, 8.65 years): likely = 11 of 16 floods caught (69%, 95% CI 44-86%), about 1.3 alarm episodes a
  year with no documented flood; possible = 12 of 16, about 8.4 a year. "No documented flood" is not "no flood": the
  unmatched counts are an upper bound. The panel note (`low.honest`, en/si/ta; si/ta are drafts for native
  review) states these in plain words. Re-test after the next wet season: the 15 mm cap was chosen from 4 caps on the same
  floods.

This is how it is checked live. Everything lands in the Cloudflare D1 database `sl-water-levels` (the prediction
log's database) and is **private**: nothing public reads it and nothing about other people's answers is shown.
Tables are in `d1/0003_street_flood.sql`.

- **Rain log** (`street_rain_log`): `scripts/street-rain-log.mjs`, a step in `gsmap-snapshot.yml` after the data push,
  stores per run (about every 30 min) the zone's 1 / 3 / 6 / 24 h rain, **`mm24h_clipped`** (the rule's number),
  **`river_trigger`** (1 = Kelani at minor level, 0 = no, NULL = gauges unreadable) and the rule state (`none` /
  `possible` / `likely`). **State changes** go to `street_rain_changes` (same two columns). The script applies the
  migration itself every run: the CREATE TABLEs, then `ALTER TABLE ... ADD COLUMN` for `mm24h_clipped` and `river_trigger`
  only when `PRAGMA table_info` does not list them (idempotent). Rows before 24 Oct 2026 have NULL there and were judged
  on the old unclipped 60 / 100 mm rule. If the gauges cannot be read in a run, a `likely` is not cleared by that
  (state stays unknown). State logic: `lib/streetRainLog.ts`.
- **Owner ping**: on a rise (none to possible or likely, possible to likely) and when it clears, one Slack message
  via `SLACK_WEBHOOK_URL`, labelled "low-spot rain heads-up (early)" or "(higher level)", with the counted and uncapped rain numbers, why
  (rain and/or river), the Wellampitiya page link and "Did your street flood?". Only residents who marked a low spot are pinged, and only for "likely". A rise within
  3 h of the previous rise message is held back; likely to possible is silent. A message that failed is retried for 6 h.
  Dry run: `node --experimental-strip-types scripts/street-rain-log.mjs <dir containing gsmap/latest.json> --dry-run --prev none [--river 0|1]`.
- **Resident answers** (`street_flood_reports`): the "Did the streets near you get water today?" control
  (`app/flood/FloodReport.tsx`) on every town page posts to `POST /api/flood-report`. Stored: town slug, answer
  (`deep` ankle or more / `little` / `dry`), optional `now` / `earlier`, page language, time, and a per-day salted
  HMAC of the IP address (rate limiting only; rotates daily; the address is never stored). One answer per browser
  per town per day (cookie `sl_fr_<town>`), caps per address, a hidden honeypot field and a minimum time on the page
  (bots get a quiet "thanks", nothing stored). The Vercel site has no D1 binding, so the route uses the D1 HTTP API
  (`lib/d1.ts`) and needs **`CLOUDFLARE_API_TOKEN`** (token with D1 Edit) in the Vercel environment variables;
  optional `FLOOD_REPORT_SALT`. Without the token the route answers 503 and the page says "try again later".
- **Monthly review**: `scripts/export-street-flood.sh YYYY-MM <outDir>` (wrangler logged in) writes `rain_log.json`
  (incl. `mm24h_clipped`, `river_trigger`), `changes.json`, `reports.json` and `reports_by_day.json` (answers per town and
  day next to that day's highest clipped 24 h rain `max_mm24h_clipped` and rule state). Keep the output private. Handy ad-hoc SQL (`npx wrangler d1 execute sl-water-levels --remote --command "..."`):

  ```sql
  -- state changes, newest first
  SELECT datetime((changed_ms+19800000)/1000,'unixepoch') AS colombo, from_state, to_state, mm1h, mm6h, mm24h, notified
    FROM street_rain_changes ORDER BY changed_ms DESC LIMIT 20;
  -- answers vs the rule, per day (hits = "deep"/"little" answers on days the rule said possible/likely)
  SELECT r.day, r.town, SUM(r.answer='deep') deep, SUM(r.answer='little') little, SUM(r.answer='dry') dry,
         (SELECT MAX(mm24h_clipped) FROM street_rain_log WHERE date((data_end_ms+19800000)/1000,'unixepoch') = r.day) max_clipped_mm24h,
         (SELECT MAX(river_trigger) FROM street_rain_log WHERE date((data_end_ms+19800000)/1000,'unixepoch') = r.day) river_at_minor
    FROM street_flood_reports r GROUP BY r.day, r.town ORDER BY r.day DESC;
  ```
  How to read it: days with `deep` answers and no `possible` / `likely` state are misses; `possible` / `likely` days
  with only `dry` answers are false alarms. Answers are self-selected (people who flooded answer more), so count
  towns and days, not people.

### Shadow test of a candidate rule (since 24 Oct 2026)

Nothing users see changes. Every logging run also computes what a candidate "possible" tier WOULD have said and stores it
next to the live state. Evidence and why: `research/wellampitiya-flood-rule-backtest.md`, "Antecedent wetness and upstream
rain" (G1 to G5): floods follow wetter weeks when wetness is measured by rain gauges (AUC 0.72), not by the satellite (0.50).

- **Candidate** (`shadowStreetState()` in `lib/streetRainLog.ts`): river at minor level = likely; clipped 24 h rain >= 100 mm =
  likely; **possible from 45 mm when the week was wet by gauges (index >= 96 mm), otherwise from 60 mm**; below 45 mm none.
  Backtest (fixed thresholds, chosen on the same 16 floods, so optimistic): 14 of 16 floods, about 5.3 unmatched alarms a
  year, against 12 of 16 and 8.4 for today's possible. Out of sample: 12 to 14 of 16 at 4.6 to 8.4 a year against 10 to 11.
- **Gauge wetness** (`lib/gaugeRain.mjs`, exactly the backtest's definition): daily area rain = mean of the gauges that
  reported; index = sum of k^i x rain(day - 2 - i) with **k = 0.9 a day and a 2-day lag** (so none of the event's own rain
  is in it), a missing day adds 0, and **at least 5 of the 7 days ending 2 days before must have a value or the index is
  unknown**. Wet = 96 mm or more. Check: the code gives 151 mm for 22 Oct 2026 and 60 mm for 12 Oct 2026, the report's 152 and 60.
- **Which gauges.** Backtest: Met Dept SYNOP Colombo 43466, Katunayake 43450, Ratmalana 43467 (03 UTC report, 24 h to
  08:30 Colombo, from OGIMET). Live, preferred: the same three from OGIMET. Fallback when OGIMET gave too few days:
  Irrigation Dept ArcGIS `gauges_2_view.rain_fall` (hourly mm, summed per Colombo calendar day) for **Hanwella, Glencourse,
  Dunamale and Badalgama**, the rain-reporting gauges nearest Colombo (18 to 37 km; Hanwella/Glencourse on the Kelani
  stand in for Kaduwela/Avissawella, Badalgama for Katunayake). Nagalagam Street (4 km away) is not used: its rain column
  is always 0, which would bias the index down. A gauge-day needs 16+ hourly readings, a day needs 2+ gauges. **The ArcGIS
  network is a different network (inland, calendar-day windows), so its index is not the number the 96 mm was set on:**
  `gauge_source` says which was used, and both indexes are stored (`api_ogimet_mm`, `api_arcgis_mm`) so the review can
  compare them (September and October 2026 overlap).
- **Archive** (`scripts/rain-gauges-snapshot.mjs`, a step of `gsmap-snapshot.yml`, before the data push): `rain-gauges/YYYY.jsonl`
  on the `data` branch, one line per Colombo day `{"d","og":{station:mm},"ag":{gauge:{mm,n}}}`, plus `state.json`. OGIMET is
  asked at most every 3 h (4 s between stations; the first run backfills 45 days, later runs 14) and the ArcGIS feed's 7 days are re-read every run, keeping the more
  complete count. Both are best effort and never fail the run. This archive is useful on its own (Colombo-area gauge rain
  history the satellite under-reads).
- **D1** (`d1/0005_street_shadow.sql`; the logging script applies it every run, columns via `PRAGMA table_info`):
  `street_rain_log.shadow_state` (`none` / `possible` / `likely` / **NULL = unknown**), `api_gauge_mm`, `gauge_source`
  (`ogimet` / `arcgis`), `api_ogimet_mm`, `api_arcgis_mm`; and `street_rain_shadow_changes` (every change of the shadow
  state with the live state of the same run). **Missing gauge data gives NULL, never `none`**: NULL only arises when the
  clipped rain is 45 to 60 mm (the only band the gauges decide) or when there is no rain total and no river trigger.
  No Slack or push of its own; the only trace is a "(Shadow rule: x.)" tail on a Slack ping the live rule already sends, when
  they disagree.
- **Export**: `scripts/export-street-flood.sh YYYY-MM <dir>` now also writes `shadow_changes.json` and `shadow_by_day.json`
  (every day of the month: runs, highest clipped rain, highest live state, highest shadow state, runs with unknown shadow,
  gauge index, residents' deep / little / dry answers for the day), and the shadow columns in `rain_log.json`; `reports_by_day.json`
  gains `max_shadow_state_0none_1possible_2likely`, `shadow_unknown_runs` and `api_gauge_mm`.
- **How to judge it** (monthly, and in December over the whole north-east monsoon): states are 0 none, 1 possible, 2 likely.
  1. List the days where `max_shadow` > `max_live`: those are the days the candidate would have said "possible" earlier. For
     each, count residents' answers that day (`deep` / `little` against `dry`; count towns and days, not people, and answers are
     self-selected). Candidate wins if these days have more `deep` / `little` than the days where live said possible and the
     candidate did not.
  2. List days with live >= 1 and shadow 0: false alarms the candidate would have removed. Any `deep` answers on them are floods
     the candidate would have missed (the backtest misses were E02 and N07).
  3. Count `shadow_unknown_runs`: unknown is not dry. Do not score those days either way.
  4. Compare `api_ogimet_mm` and `api_arcgis_mm` on days both exist. If ArcGIS runs much lower or higher, decide the fallback
     threshold separately or drop the fallback.
  5. Only a handful of events happen in a season (16 floods in 8.65 years): one more or fewer matters more than any threshold.
     Do not change the live rule on fewer than about 5 heavy-rain days with residents' answers; leave "likely" alone either way.

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
   "Get ready" or worse (for someone who marked their spot as low ground, very heavy rain at 100 mm counts too; nothing else about rain pings), and ONE all-clear after two calm checks in a row (closure matters). Never for
   a plain "keep an eye", never twice for a wobble (3 h flap guard, `pushStep` in `lib/myPlaces.ts`). Optional short morning summary at a time they choose,
   skipped when a person's places cannot be read. Each subscriber's own settings decide which of these they hear (see "Alert settings" below). Subscriptions: D1 `push_subscriptions` (endpoint + two public keys + place keys +
   language; nothing else; "Turn off alerts" deletes the row; dead endpoints are deleted). PWA: `app/manifest.ts`, `public/sw.js`
   (network first, last-known page offline, push handler), a quiet dismissible install card after a second-day visit or a pinned place
   (`app/ReturnShell.tsx`). Sender: `scripts/push-notify.mjs`, run at the end of `gsmap-snapshot.yml` (every 30 min) and by
   `push-notify.yml` (morning, stats, manual test and broadcast). Telegram channel option for later: a bot posting the same rise/all-clear text from
   `pushText` to a public channel needs only a bot token and a call in the sender.
3. **Closure and trust: removed.** The town-page "How our warnings did" section (what we said about street water, neighbours' answers, a score) and `GET /api/town-outcome` were removed on 26 Oct 2026 with the public rain warning; the answers are still collected (`street_flood_reports`) and reviewed monthly.
4. **Contribution reward.** After "Did the streets near you get water today?" the thank-you says what the answer joined ("joins 14 from
   Wellampitiya this month") and, for rule towns, that answers tune the 100 mm warning, and invites a return tomorrow to see how the
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
# 4. Check delivery: subscribe on the site, then (manual runs are dry runs unless dry_run=false)
gh workflow run push-notify.yml -f mode=test -f dry_run=false
```

#### Alert settings (what each subscriber chose)

"Alert settings" (Your places card, next to the alerts switch; and More on phones) lets each browser choose, per subscription:
which of its pinned places to hear about (all by default); the lowest river level that should send an alert (**Get ready**
= Alert level, the default and what everyone had before; **Flooding likely** = Minor level; **Move to safety** = Major flood);
"my spot floods in heavy rain" per canal town (default off for everyone: one push at 100 mm of satellite rain and its all-clear, only
for the places they marked; see the Street-flood validation section); a reservoir upstream starts releasing water (default off); all-clear (default on); a morning summary at a
chosen half hour from 05:00 to 09:00 Colombo (default off); quiet hours in Colombo time (default off; **Major flood always comes through**, everything else waits and is sent when quiet hours end, if still true); occasional
announcements from the site (default on); and a "Send me a test alert" button.

- **Stored** in D1 `push_prefs` (`d1/0004_push.sql`, created idempotently like the other push tables): one JSON text of choices and, in a second column, the
  sender's memory of what that person was told per place. No row means the defaults. Deleted with the subscription. Edited through `POST /api/push/prefs`
  (the push endpoint is the key, like turning alerts off), without subscribing again. Rules and sanitising: `lib/pushPrefs.ts`.
- **Applied** by `scripts/push-eval.mjs` inside `scripts/push-notify.mjs`: the shared rise / flap / all-clear state machine (`pushStep`) now runs per subscriber on
  the level they asked for; a rise below their chosen level advances silently; an all-clear goes only to someone who was actually told, and only if they want it.
  A subscriber is seeded from the shared `push_place_state` the first time, so nobody is told twice about a flood already announced.
- **The test button** shows a notification on this phone through its own service worker, at most once a minute. It proves permission and display; it does
  not travel through the push service, because the site deliberately never holds the private VAPID key (only GitHub Actions does).
  For a true end-to-end check use `gh workflow run push-notify.yml -f mode=test -f dry_run=false` (newest subscription only).
- Tests: `node --experimental-strip-types --no-warnings scripts/push-prefs.test.mts` (defaults, filtering, levels, quiet hours, all-clear, broadcast, stats)
  and `scripts/push.test.mts` (the whole sender).

#### Owner broadcast (manual only)

One message from the owner to every subscriber who has not turned off "Occasional announcements from the site". It never runs by itself: it exists only as a
manual `workflow_dispatch` run, and the job refuses to start a broadcast from any other trigger. `dry_run` defaults to **true**, which prints only the recipient
count (never an endpoint) and sends nothing. The url must be on `https://sl-water-levels.vercel.app` (empty = the home page); title up to 80 and body up to 240
characters; `language` is all, en, si or ta (by the language the person uses the site in; the text is sent as you wrote it). Announcements ignore quiet hours:
send them in the daytime (Colombo). The dry run says how many recipients are in their quiet hours right now.

```
# 1. count only (nothing is sent)
gh workflow run push-notify.yml -f mode=broadcast -f title="New: choose your alerts" -f body="Open Alert settings to pick what you hear about." -f url="https://sl-water-levels.vercel.app/en" -f language=all
# 2. send for real
gh workflow run push-notify.yml -f mode=broadcast -f title="New: choose your alerts" -f body="Open Alert settings to pick what you hear about." -f url="https://sl-water-levels.vercel.app/en" -f language=all -f dry_run=false
gh run list --workflow push-notify.yml --limit 3     # then: gh run view <id> --log
```

#### Subscriber stats for the owner

The 06:10 Colombo run posts one line to Slack (`SLACK_WEBHOOK_URL`): subscribers, new in 24 h, by push service (apple / google / mozilla), by language, top five
followed places, how many chose their own settings, messages sent in 24 h. Counts only, no endpoints. Run it any time: `gh workflow run push-notify.yml -f mode=stats -f dry_run=false`
(with `dry_run=true`, the default, the line is only printed in the run log).

### What to measure

Umami events (already on the site): `alerts_on`, `alerts_off`, `share_places`, `pwa_prompt`, `pwa_installed`. Push opt-in rate =
`alerts_on` / visitors with a pinned place. Push volume and failures: `SELECT kind, SUM(sent), SUM(gone), SUM(failed) FROM push_log GROUP BY kind`
(counts only). Active subscriptions: `SELECT COUNT(*) FROM push_subscriptions`. Return visits: Umami returning-visitor share on `/`
before and after. Answers per month per town: `street_flood_reports`. Watch for: all-clear pushes outnumbering rises (hysteresis too loose),
`gone` rising (people muting).

## X account

An automated X (Twitter) account that posts river alerts, all-clears, storm updates and a morning summary. Everything is
built and runs in **dry-run**: each post is sent to the owner's Slack marked `DRY RUN`, nothing goes to X, until the owner
creates the account, adds the keys and flips one switch.

### How it works

| Piece | Where |
|---|---|
| Decides what changed (gauges, reservoirs, official bulletins, storm mode, morning/evening summary) | `scripts/x-engine.mjs` (reuses `pushStep` from `lib/myPlaces.ts`, so X and push alerts agree on rise / all-clear / flap) |
| Writes the posts (gpt-6-luna with the voice guide and checker; templates as the fallback) | `lib/xCompose.ts` |
| Gate (off / dry / live), OAuth 1.0a signing, `POST /2/tweets` | `lib/xClient.ts` |
| One run: read the site, decide, compose, send, remember | `scripts/x-post.mjs` |
| Schedule | `.github/workflows/x-post.yml`: started after every satellite-rain snapshot (every 30 min), plus a 06:30 Colombo cron; one run at a time (`concurrency: x-post`) |
| Memory | D1 tables `x_posts` (every post, status, estimated cost) and `x_state` (what was last said per gauge / reservoir / street zone / bulletin); `d1/0006_x_posts.sql`, created idempotently by each run |
| Tests | `node --experimental-strip-types --no-warnings scripts/x-post.test.mts` |

Data read: `/api/levels` (levels, status, next-hour forecast), `/api/reservoirs` (spill / release), `/api/warnings`
(current DMC / Irrigation bulletins, new), and `/api/places-state` (rain expected). Heavy rain over a canal town's low spots is never posted. A source that cannot be read leaves its memory unchanged: unknown is never "calm".

Post types: **alert** (a gauge rising to Alert / Minor flood / Major flood; gauges of one river rising together are one post; when 3 or more rivers rise to Alert (or are rising towards it in storm mode) in the same run they become ONE national "rivers rising" post naming the worst 3, while Minor / Major crossings keep their own posts),
**all-clear** (after 2 calm checks, only for something we posted about), **reservoir** starts or stops letting water out
(spill from 300 cusecs, gate release from 2,000), **official warning** (a new bulletin
issued in the last 6 h, passed on once), **storm mode** (3+ gauges at Alert, any Minor/Major, 3+ rising towards a mark, or 100 mm
forecast: hourly update per affected river, at most 3 rivers, an unchanged update waits 3 h; with its next-hour forecast and range, called
a forecast) and the **morning summary** (06:30 to 11:00 Colombo, once a day; `X_EVENING=on` adds one at 18:00 to 21:00).
Limit: 15 routine posts a day (`X_DAILY_MAX`); urgent ones (Minor/Major, storm, official warnings) up to 40.

Words: **gpt-6-luna writes every post** (all kinds, official-warning relays included) in a calm, caring, local human voice, with the
deterministic template as the fallback. The model (Responses API, same conventions as `lib/openai.ts`: plain fetch, JSON-schema output,
`store: false`, per-run call cap `AI_MAX_CALLS_PER_HOUR`, default 60) is given a compact JSON of the facts (river, station, level in ft, mark,
trend, next-hour forecast and range, time in Sri Lanka, rain mm, reservoir cusecs, warning summary, post kind) plus the last 5 posts so it
varies its wording, and a voice guide with a few made-up example posts per kind (`LUNA_INSTRUCTIONS` in `lib/xCompose.ts`). It never writes
links (the code adds one when `X_LINKS` allows). Its text is accepted only if `validateLlmText()` passes: every number is in the facts
(formats like 22.0 vs 22 and "4.10pm" are fine; 117 aside), at most 280 characters the way X counts them, no disclaimer on routine posts (the bio and pinned post say "Not official · 117"; summaries, Alert-level rises, all-clears, reservoirs, calm storm updates), the short closing "Emergency: 117." / "Unofficial · 117." only on serious ones (Minor / Major reached, or a forecast that could reach one), "we are only passing it on, not the source" plus 117 on a relayed bulletin, no links, no @mentions, at most one hashtag from the
template's list, at most one of the emoji 🌧️ / ⚠️ (alerts, storms, rain only), no "official" / "emergency" in a routine post, no "reaching minor flood level" (a crossing is only ever "could reach" / "may reach"), no "major"/"minor",
"rising"/"falling" or evacuation the facts do not support, no talk of low ground, canals or street flooding, an opening that differs from
the last posts, no sentence and no run of 6 or more words (names and number lists aside, closing line excluded) shared with any of the last 5 posts, and no certain
forecast ("expected to reach", "will reach", "will flood"; the model says "could reach" / "may reach"). The model is told the limit is 260 characters (the hard limit stays 280). If it fails, the model gets the list of problems and up to two more tries (at most 3 calls per post; a too-long answer is asked to be shorter); after that the plain template is posted. Which path was
used is recorded in D1 (`x_posts.ai`: 1 = written by the model, 0 = template) and every Slack preview says "written by gpt-6-luna, every
number checked" or "plain template (why)". `X_AI_POLISH=off` switches the writer off; `X_AI_TEMPERATURE` (unset by default, because reasoning
models may reject it) adds a temperature. Cost: 1 to 3 calls per post at gpt-6-luna prices ($0.10 / $0.50 per million tokens), a fraction of a
cent a day. `OPENAI_API_KEY` is **not** in GitHub today (only in Vercel): until `gh secret set OPENAI_API_KEY` is run the templates are used,
the Slack previews say so, and nothing else changes. Thread replies and the Sinhala / Tamil drafts stay template text (`gh variable set X_LANGS
--body en,si,ta` adds the drafts; needs `X_REPLIES=on`; off by default). Tests: `node --experimental-strip-types --no-warnings scripts/x-luna.test.mts`.

**Enable the AI writer (owner):** the key that was pasted in chat earlier should be treated as exposed: create a NEW key at
platform.openai.com/api-keys, revoke the old one, then put the new key in both places (you type it at the prompt, it is never printed):
`gh secret set OPENAI_API_KEY` (GitHub, used by the X workflow) and `vercel env add OPENAI_API_KEY production` followed by a redeploy
(Vercel, used by the site's advisories). Check with `gh workflow run x-post.yml -f mode=sample`: the previews should say "written by gpt-6-luna".

### Cost controls (the X API is pay-per-use)

Third-party reports of the 2026 pay-per-use prices: about $0.015 per post but about $0.20 per post containing a link, and no free tier
for new developers except approved public-utility apps. **Verify the current prices on X's developer pricing page**, and first
**apply for X's free public-utility access** (flood warnings should qualify). So, by default:

- **Links are off.** Posts name the river / station / town; the site address lives in the bio and a pinned post. `gh variable set X_LINKS --body alerts` adds the page link to Major-flood rises, major official warnings and street-flood "likely" only; `all` adds it everywhere.
- **No thread replies** (each reply is a paid post). `gh variable set X_REPLIES --body on` enables the detail reply.
- **Monthly budget guard:** `X_MONTHLY_BUDGET_USD` (default 10) with estimates `X_COST_POST` (0.015) and `X_COST_LINK_POST` (0.20). At 80% of the budget routine posts (summaries, storm updates, reservoirs, minor rises) stop and Slack is told; Major-flood rises and all-clears always go out. The estimated cost of every post is stored in `x_posts.cost_usd` (dry runs too, so the dry-run Slack shows the estimate):
  `npx wrangler d1 execute sl-water-levels --remote --command "SELECT substr(day,1,7) m, mode, COUNT(*) posts, ROUND(SUM(cost_usd),2) usd FROM x_posts WHERE status IN ('posted','dry') GROUP BY 1,2"`

### What the owner must do

1. **Create the X account** (a new profile, e.g. "Sri Lanka Water Levels"). Suggested bio (143 characters):
   `Automated Sri Lanka river & flood updates from Dept. of Irrigation data. Not official. Emergency: 117. By @shakeeb_x · sl-water-levels.vercel.app`
   Avatar: the site icon (`app/icon.svg`) on a blue background. Pinned post: "Automated river-level alerts for Sri Lanka from Department of Irrigation gauges. Not an official warning service. Emergency: 117. Live levels: https://sl-water-levels.vercel.app".
2. **Label it automated:** Settings and privacy, Your account, Account information, Automation: choose "Managing account" = your personal @shakeeb_x. (The "Automated" label then shows on the profile.)
3. **Apply for developer access** at developer.x.com: first the free public-utility programme if offered, otherwise pay-per-use with a small credit. Use case text: "Automated public-safety river level and flood-status updates for Sri Lanka, from public government data; no replies, no mass mentions."
4. **Create a project and app** in the developer console (console.x.com; sign in with your personal account, that is fine). In the app's **User authentication settings** choose permissions **Read and write**, enable **OAuth 1.0a** (pick the app type that supports OAuth 1.0a user context, e.g. "Web App, Automated App or Bot") and allow the **PIN-based (oob) callback** (a callback URL such as `https://sl-water-levels.vercel.app` and website URL are required by the form but are not used). Copy the **API Key** and **API Key Secret**. Do **not** use the console's own Access Token: it belongs to the account that owns the app (your personal one).
5. **Authorise the BOT account (one time):** `node scripts/x-authorize.mjs` (`scripts/x-authorize.mjs`). It asks for the API Key and Secret (typing is hidden), prints a link; open the link in a browser **logged in as the bot account**, press Authorize, paste the PIN back. It prints only the account name (check it is the bot) and stores `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` straight into GitHub secrets with `gh secret set`, never on screen or in a file. (By hand instead: `gh secret set X_API_KEY` etc.) Optional: `gh secret set OPENAI_API_KEY` so gpt-6-luna writes the posts (see Words above).
6. **Review in dry-run first:** run `gh workflow run x-post.yml -f mode=sample` (3 sample posts from today's data to Slack), and watch the `DRY RUN` posts that arrive when something changes.
7. **Buy API credits first** (console, Billing: pay-per-use credits; with $0 credits every post would fail). The pipeline stays in dry-run until you set the variable, so nothing is spent before you are ready. Then **go live:** `gh variable set X_POSTING --body live`. Optional: `gh variable set X_LINKS --body alerts`, `X_MONTHLY_BUDGET_USD`, `X_EVENING --body on`.
8. **Show the account on the site:** add the handle (no `@`) as the Vercel environment variable `X_HANDLE` (Production) and redeploy: `vercel env add X_HANDLE production`. The footer and About page then show "Automated updates: @handle". Until it is set nothing is shown.

### How to pause

- **Kill switch:** `gh variable set X_POSTING --body off` (the job does nothing: no X, no Slack). Back to review mode: `gh variable set X_POSTING --body dry`.
- After an X error (429 rate limit, 401/403) the job pauses itself (until the reset time, or 1 h / 6 h), tells Slack once, queues the post for one retry within 2 h, and never retries in a loop. `X_POSTING=live` with a missing key stays in dry-run and tells Slack which key is missing.
- To stop the schedule entirely: `gh workflow disable x-post.yml`.

### X automation rules (compliance notes)

- Label the account as automated and tie it to a human managing account (step 2); the bio says so.
- No duplicate or near-duplicate spam: every post is deduplicated (D1 `x_posts.dedupe_key`, claimed before sending), grouped (several gauges of one river = one post), flap-guarded (3 h) and limited per day; X also rejects exact duplicate text (403), which is skipped and reported.
- No misleading claims: only data from the Department of Irrigation, Mahaweli Authority, DMC and the satellite rain rule, every number checked against the data, forecasts called forecasts, "Not an official warning. Emergency: 117." on every post (relayed bulletins say we are not the source).
- Replies are the one exception to "own updates only", and only to people who mention us or reply to our posts (see "X replies" below); never unprompted mentions, follows or likes. Reposts only of the listed official accounts (see "X reposts"). No trending-hashtag piggybacking (at most `#SriLanka`, `#floods` and the river name).
- Respect rate limits: one request per post, 429 and 403 pause the pipeline. Check X's current Automation rules and Developer Agreement when applying.

## X replies

The account answers people who write to it: @-mentions and replies to our posts, and (behind a flag) direct messages. Everything is built and runs in **dry** mode: each draft goes to the owner's Slack marked `DRY RUN REPLY`, nothing is posted, until the owner sets `X_REPLIES_MODE=live`.

| Piece | Where |
|---|---|
| Intent, place resolution, facts, templates, checks, limits | `lib/xReply.ts` (pure) |
| Reading mentions / DMs, sending a DM, search, repost (OAuth 1.0a) | `lib/xRead.ts` |
| One run: poll, decide, send or draft, mirror to Slack, remember | `scripts/x-replies.mjs` |
| Schedule | `.github/workflows/x-replies.yml`, started every 5 minutes by `workers/scheduler` (a 20-minute GitHub cron is the backup; **the Worker must be redeployed** once: `cd workers/scheduler && npx wrangler deploy`) |
| Memory | D1 `x_replies` (one row per message: intent, status, draft or sent text, cost) and `x_state` keys `replies_since` (the `since_id`), `replies_me`, `replies_reads`; `d1/0007_x_replies.sql`, created idempotently by each run |
| Tests | `node --experimental-strip-types --no-warnings scripts/x-replies.test.mts` |

**Modes.** `X_REPLIES_MODE=dry` (default) | `live` | `off`. `live` also needs `X_POSTING=live` and the four keys, otherwise it stays dry and says why; `X_POSTING=off` (the kill switch) or `X_REPLIES_MODE=off` stops the job before it reads anything. Reading costs money even in dry mode (the X API bills per post read), so dry mode with real keys reads real mentions.

**What it does with a message** (the classifier is plain rules, not a model, because it decides whether we speak at all; English, Singlish, Sinhala, Tamil):

| Intent | Reply |
|---|---|
| question about a town, river, gauge or reservoir | looks the place up (same fuzzy search as the site, Sinhala and Tamil names too), reads live `/api/levels` + `/api/reservoirs`, and gpt-6-luna writes 1 to 3 short sentences from compact facts; plain template if the model's text fails the checks. Replies are in English (the si/ta wording is still a draft); it names the gauge and the reading time; it says it is the river gauge and never says whether a street or house is flooded or safe; a doubtful match starts "Assuming you mean ..."; no place found or data unreadable gets an honest fixed reply |
| report ("water in my street") | fixed thank-you that does **not** confirm anything, asks them to tap "Did the streets near you get water?" on the town page (search the name on our site), plus a Slack ping |
| correction ("your reading is wrong") | fixed thank-you, passed to the owner in Slack |
| emergency ("help", "trapped", "rescue", Sinhala / Tamil too) | fixed reply with 117, police 119, ambulance 1990, fire and rescue 110, and a **HIGH PRIORITY** Slack ping with `@channel` (also when the reply is held back by a rule, and when sending fails) |
| thanks, abuse, spam, other chatter, weather and so on | no reply (still shown in the Slack feed) |

**Checks on model text** (the posts' own `validateLlmText` plus reply rules): every number is in the facts (the person's own words are never part of the facts and may not add numbers), 280 characters, no links, no @mentions (the reply is attached to their post), no certain-sounding forecasts ("could reach", never "will"), no invented minor / major / rising / falling, no talk of streets, canals or low ground, it must name the place or gauge, and it ends with "not an official warning" and 117. One retry with the problems fed back, then the template. Links are never added to replies (the site address is in the bio): the wording is "search Wellampitiya on our site".

**Rules** (`mayReply`): only to messages addressed to us (a reply to our post, or our handle opens the text); never to ourselves, accounts that look like bots (name, handle or bio), protected accounts, `X_REPLY_BLOCK` handles; not older than `X_REPLY_MAX_AGE_MIN` (360); never twice to the same person within 10 minutes; at most 2 replies per conversation per day (1 for DMs); at most `X_REPLY_DAILY_CAP` (30) a day; emergencies skip the daily cap, the conversation limit and the budget (hard ceiling 10 over the cap) but never the bot, block, age or 10-minute rules. Identical text is rejected by X, so fixed replies have two wordings and a duplicate rejection tries the other once. A 429 or 401 pauses posting and replies together (shared `meta.pauseUntil`).

**Cost.** Each reply is estimated at `X_COST_POST` (0.015); each post read at `X_COST_READ` (0.005). `X_REPLY_READ_CAP` (150 posts a day) stops reading for the day (one Slack note). Replies and reads are summed with the posts against `X_MONTHLY_BUDGET_USD`: at 80% only emergencies are answered, at 100% nothing is read. (`x-post.mjs` still adds only its own posts to its own guard.) Quote posts that do not @-mention us are not seen; plain quotes would need one paid call per post.

**Slack feed.** Every message read becomes one Slack block: who, what they wrote, a link, the class, and the draft / sent reply or why there is none. It goes to `SLACK_X_WEBHOOK_URL` if that secret is set (a dedicated channel), else to `SLACK_WEBHOOK_URL`: `gh secret set SLACK_X_WEBHOOK_URL`. Reposts appear in the same feed.

**Direct messages (`X_DM=off` by default).** The X app is "Read and write" and has no DM permission, so nothing DM-related is called until the owner: (1) in the developer console, User authentication settings, sets permissions to **Read and write and Direct message**; (2) **regenerates the Access Token and Secret** (the old token keeps the old permissions) with `node scripts/x-authorize.mjs`; (3) `gh variable set X_DM --body on`. Then each run reads recent DM events; the first look only marks existing messages as seen; after that each new message gets one answer per conversation per day (an answer to a question, the report / correction / emergency wording, or a short welcome for anything else). If X refuses (403) the job tells Slack once a day and keeps answering mentions.

**Go live (owner).** Watch the Slack feed in dry mode for a few days; then `gh variable set X_REPLIES_MODE --body live`. Back to review mode: `gh variable set X_REPLIES_MODE --body dry`. Off: `--body off`.

## X reposts

`scripts/x-reposts.mjs` (`.github/workflows/x-reposts.yml`, every 30 minutes from the scheduler Worker) passes on official flood, rain, cyclone and landslide posts. Candidates come from recent search over **listed official accounts only** (`X_REPOST_ACCOUNTS`, default `dmc_lk,SLMetDept`; add news accounts only on purpose): `(from:a OR from:b) (flood OR rain OR warning OR cyclone OR landslide ...) -is:retweet -is:reply`, so X bills only matching posts; `X_REPOST_READ_CAP` (40 posts a day) caps it. Each new candidate (at most 6 hours old, not a reply) is judged by the OpenAI **Decisions API** (`decide()` in `lib/openai.ts`, gpt-6-luna): five yes/no probabilities, and it reposts only on a confident yes on all of them (worth reposting 85%, Sri Lanka 85%, a warning or update 80%, duplicate of what we shared recently at most 30%, promotional or unrelated at most 20%). The candidate's text is data and the model can only answer probabilities. At most `X_REPOST_DAILY_MAX` (3) a day, never the same post twice (D1 `x_reposts`), budget-guarded like replies. A failed model call means no repost.

`X_REPOST_MODE=dry` (default) shows `DRY RUN REPOST` in Slack with the decision and the reason (including declined ones); `live` needs `X_POSTING=live`; `off` stops it. The handles `dmc_lk` and `SLMetDept` are the defaults from the owner and are not verified: check them on X and set `X_REPOST_ACCOUNTS`. Reposting needs the existing "Read and write" permission.
