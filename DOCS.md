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

Stations with a fitted model (Kelani: Hanwella, Glencourse, Nagalagam Street) get a 1/3/6/12/24 h
forecast; every other gauge keeps the old one-hour trend extrapolation, labelled "trend only". For each
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
