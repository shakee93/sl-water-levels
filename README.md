# sl-water-levels data archive

Daily snapshots of every river-gauge reading from the Sri Lanka Department of
Irrigation's ArcGIS feed (`gauges_2_view`). The live feed only keeps about
7 days, so this branch is the long-term history. It is written by
`.github/workflows/snapshot.yml` on `main` (twice a day) using
`scripts/snapshot.mjs`. The archive starts on 2026-10-15; anything older had
already dropped out of the feed.

## Layout

- `YYYY/YYYY-MM-DD.csv`: every reading taken on that **Sri Lanka calendar
  day** (Asia/Colombo, UTC+05:30). Today's file is partial until the next run.
  Rows are sorted by basin, gauge, then time.
- `stations.json`: the latest copy of the station list (`hydrostations`
  layer), with names, basins and coordinates.

Raw URL pattern:
`https://raw.githubusercontent.com/shakee93/sl-water-levels/data/2026/2026-10-21.csv`

## Columns

| column | meaning |
|---|---|
| `objectid` | ArcGIS row id, unique per reading (used to de-duplicate) |
| `basin`, `gauge` | river basin and station name (whitespace trimmed) |
| `time_utc` | reading time, ISO 8601 UTC |
| `time_colombo` | the same time in Sri Lanka local time |
| `water_level` | gauge reading. Units are not published: alert threshold >= 4 usually means feet, <= 1.5 usually means metres |
| `rain_fall` | rainfall (mm). **Blank means not measured at this gauge, not zero** |
| `alertpull`, `minorpull`, `majorpull` | alert / minor-flood / major-flood thresholds at the time of the reading |
| `creation_ms`, `edit_ms` | raw epoch-millisecond timestamps from ArcGIS |
