# Sri Lanka Water Levels

Minimal Next.js dashboard that visualises realtime river-gauge readings from the
Sri Lanka Department of Irrigation. Pick a station and see water level over the
last 4 days plotted against the alert / minor-flood / major-flood thresholds.

## Data source

The app reads directly from public ArcGIS feature services hosted by SL Dept of
Irrigation:

- Stations: `hydrostations/FeatureServer/0`
- Readings: `gauges_2_view/FeatureServer/0`

Both under `https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services`.
No API key, no backend, no DB.

## Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. Append `?station=Nagalagam%20Street` (or any other
station name from the picker) to deep-link.

## Deploy

Push to GitHub and import the repo on Vercel — no env vars or build settings
needed.

## How it works

See [DOCS.md](./DOCS.md) for the ArcGIS data model, the gotchas we hit
talking to it, and the architecture of the app (RSC + Suspense, cookie
persistence, caching, basin-flow ordering, MCP endpoint).

## MCP

This app exposes itself as an MCP server at `/mcp`. Add it to Claude Code:

```bash
claude mcp add --transport http sl-water-levels https://sl-water-levels.vercel.app/mcp
```

Tools: `list_basins`, `list_stations`, `get_station_readings`,
`get_basin_snapshot`.
