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
