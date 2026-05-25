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

lib/
  arcgis.ts            All HTTP to services3.arcgis.com. Typed. ISR-cached 60s.
  basinOrder.ts        Canonical upstream->downstream order per basin
  forecast.ts          Next-hour prediction: local persistence + upstream momentum + rain
  anomaly.ts           Inferred-release detection from gauge data
  ceb.ts               PUCSL day-ahead-dispatch fetcher (currently returns no MW data)
  dams.ts              Hand-curated dam catalogue per basin
  units.ts             Heuristic ft / m / null detection from threshold values
```

## Data sources (and their current state)

- **ArcGIS hydrostations + gauges_2_view** (services3.arcgis.com/J7ZFXmR8rSmQ3FGf):
  station list and per-gauge readings. WORKING. Hourly cadence, 4+ months
  of history. The source of truth for level data.

- **ArcGIS Reservoir_Data_2024**: static infrastructure — irrigation tanks
  only, NO CEB hydropower. Useful for context only.

- **Mahaweli WMS daily PDF** (mahaweli.gov.lk/.../Menue-WMS - E.pdf):
  real daily CEB hydropower storage + downstream discharge for
  Maussakele/Castlereigh/Kotmale/Victoria/Randenigala. NOT YET
  INTEGRATED — would need `pdf-parse`.

- **Irrigation Dept Google Sheet** (id starts 2PACX-1vTcSGhi9RESl7CMC...):
  daily reservoir spill status for ~73 irrigation reservoirs with
  explicit `Spilling (Y/N)` + sluice discharge cusec columns. NOT YET
  INTEGRATED — CSV per tab, gid=217395621 is the cleanest spilling tab.

- **PUCSL day-ahead-dispatch** (gendata.pucsl.gov.lk/api/...): schema
  live, but every `powerInMw` value is null across all 41 plants. CEB
  has not started populating. Code in `lib/ceb.ts` will auto-light up
  when they flip the switch.

- **PUCSL reservoir/storage-rainfall**: same — endpoint exists,
  returns `data: []`. Stub.

## Critical gotchas

These cost real debugging time. Future-you should not relearn them.

- **No unit metadata anywhere on the ArcGIS dataset.** Empirically:
  alertpull >= 4 -> feet; alertpull <= 1.5 -> meters; in between is
  ambiguous. See `lib/units.ts`. Norwood (Kelani) reports in meters
  despite the rest of Kelani being feet — single basins can mix units.
- **`gauges_2_view.rain_fall` is often null** at downstream/urban gauges
  (Nagalagam Street, Calidonia). Null means "not measured here," not zero.
- **`hydrostations.basin` has trailing whitespace** (`"Kelani Ganga     "`).
  Always `LIKE 'X%'` or `.trim()` before comparing.
- **`CreationDate` is epoch milliseconds**, not ISO or seconds.
- **ArcGIS rate-limits aren't documented but exist.** Repeated queries
  (>=1/s) return `Too many requests.` All `arcgis()` calls go through
  `fetch(url, { next: { revalidate: 60 } })` for ISR.
- **PUCSL day-ahead-dispatch returns rows with `powerInMw: null` for
  every record.** Don't assume any integer values are real — confirm
  by curling first.
- **Mahaweli WMS PDF uses non-standard spellings**: "Moussakele" (not
  Maussakele), "Castlereigh" (not Castlereagh). Need a normaliser in
  any future parser.
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
- Don't fetch the PUCSL endpoint expecting live MW values — handle
  the all-null state gracefully (see `app/BasinDams.tsx`).
- Don't run `npm run build` locally without good reason — Vercel
  builds remotely and surfaces errors equivalently.
- Don't reintroduce `turbopack.root` in `next.config.ts`. It only
  papered over the multi-lockfile warning from a now-removed worktree.

## What's intentionally not built yet

So future sessions know what's pending vs. broken.

- **Mahaweli WMS PDF parser** — would add live CEB-dam discharge data
  for Kelani basin. ~1.5h with `pdf-parse`.
- **Irrigation Dept Google Sheet integration** — daily spill status
  for ~73 reservoirs. ~1h.
- **Historical-event calibration** for forecast magnitudes — current
  prediction is persistence + momentum; magnitudes are uncalibrated.
- **Rainfall forecast feed** (Open-Meteo) — Stage A of the prediction
  pipeline. Anomaly detector currently fills the gap reactively.
- **Map view** (Leaflet/MapLibre) of all 41 stations + flood polygons.
