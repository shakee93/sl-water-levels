# How each river reacts to rain

Generated 26 Oct 2026 from `scripts/river-rain-response.mjs` (numbers) and written up by hand (summaries). Backtest numbers, not live results.

**What it is.** 11 months of hourly river levels (23 Nov 2025 to 26 Oct 2026, 36 gauges with a rain grid) against hourly rain over each gauge's catchment from the JAXA GSMaP_NOW satellite product, corrected per catchment against the rain gauges and capped at 15 mm/h (see DOCS.md "Measured-rain storm model (v4)"). All rain figures are catchment AREA averages; a rain gauge in a cloudburst reads more.

**Definitions.** *Lag near / up* = hours from rain to the river's rise, for rain on the cells beside the gauge and on the cells of the gauges upstream (the lag, 0 to 36 h, at which hourly rain best matches the next 3 h rise; blank when the correlation is under 0.15). *Rain for a 1 ft rise* = the smallest catchment rain over the window (mm) that was followed, at least half the time and at least three times the gauge's own base rate, by a rise of 1 ft or more within 24 h, on at least 2 separate storms. *Alert* = the same for crossing the alert mark. *Window* = the rain window (1, 3, 6, 12 or 24 h; the shortest within 0.03 of the best AUC). *Rise per 10 mm* = median ft of rise within 24 h per 10 mm of window rain on hours with 10 mm or more (wet / dry ground = 72 h rain above / below the median). *Peak lag* = hours from the heaviest hour to the level peak. *Confidence*: high = at least 4 storms, 25 hours and AUC 0.7; medium = 3 storms and AUC 0.6; otherwise low or none and nothing is published for the gauge (lib/model/rain-thresholds.json, the station page).

**Rain sources.** Gauge `rain_fall` is reported by 38 of 39 gauges in the archive (since 15 Oct 2026, 14 days); Nagalagam Street's reads a constant 0 (dead). Satellite bias = rain gauge total / satellite total over those days, shrunk to the wet zone (0.92) or dry zone (0.81) value. Open-Meteo / satellite = median ratio of Open-Meteo's own past 6 h to the satellite's in hours with 8 mm or more (0.2 to 0.56 everywhere: Open-Meteo under-reads storms). Catchment areas are approximate: number of rain-grid cells x the cell size of that basin's grid (polygons are not in the repo).

**Buffers.** Dam releases and reservoir storage change how a river answers rain and are not in this table: see `lib/reservoirs.ts` and `lib/releases.ts` (Deduru Oya dam to Moragaswewa, 4 to 5 hours; the Mahaweli reservoir chain; the CEB Laxapana / Kelani upper reservoirs). Tidal gauges: Nagalagam Street (Mutwal / the lagoon), and in part Baddegama, Putupaula, Kalawellawa near the sea.

## Aththanagalu Oya

Dunamale is a small coastal catchment (about 280 km2) answering in about 5 hours, rising 12 ft in Ditwah and 4 ft by midday on 26 Oct. About 50 mm over the catchment in a day (25 mm in 12 h) has usually come before a 1 ft rise (5 storms; confidence medium). Open-Meteo reads only about 0.4 times the satellite there in storms.

| Gauge | Area km2 | Cells (all / near / up) | Up-channel gauges (travel h) | Lag near / up (h) | Rain for a 1 ft rise (window) | Alert | Rise per 10 mm (wet / dry) | Peak lag h (storms) | Satellite bias, Open-Meteo/sat | Storms, confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| Dunamale | 280 | 4 / 4 / 0 | - | 5 / - | 50 mm / 24 h | - | 0.1 (0.1 / 0.1) | 15 (24) | 0.67, 0.39 | 5, medium |

Worked examples (peak level, rise, heaviest 24 h of catchment rain): Dunamale: Ditwah 23 ft (+12.3, 151.7 mm), 25-26 Oct 11.2 ft (+4.3, 93.1 mm).

## Deduru Oya

Moragaswewa is slow: rain over the catchment shows in the river about 18 hours later and the peak comes about 30 hours after the heaviest rain. About 35 mm in a day has usually come before a 1 ft rise (50 mm before the alert level; 6 storms; confidence high). The reservoir releases from the Deduru Oya dam (documented in lib/reservoirs.ts: 4 to 5 hours to the gauge) act on top of rain and are not part of this table.

| Gauge | Area km2 | Cells (all / near / up) | Up-channel gauges (travel h) | Lag near / up (h) | Rain for a 1 ft rise (window) | Alert | Rise per 10 mm (wet / dry) | Peak lag h (storms) | Satellite bias, Open-Meteo/sat | Storms, confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| Moragaswewa | 3310 | 12 / 12 / 0 | - | 18 / - | 35 mm / 24 h | 50 mm / 24 h | 0.1 (0.2 / 0.1) | 30 (15) | 0.9, 0.29 | 6, high |

Worked examples (peak level, rise, heaviest 24 h of catchment rain): Moragaswewa: Ditwah 27.2 ft (+11.5, 147.7 mm), 25-26 Oct 14.1 ft (+10.4, 100.6 mm).

## Gin Ganga

Thawalama (upper) rose 7 ft in Ditwah; a rise of 1 ft followed about 40 to 50 mm in a day, but with only 2 to 3 storms the pattern is too thin to publish. Baddegama (lower, 5 more cells above it) has the weakest pattern: in Ditwah it did not rise at all by the 1 ft test from its starting level, because it was already high (peak 11.9 ft on 26 Nov).

| Gauge | Area km2 | Cells (all / near / up) | Up-channel gauges (travel h) | Lag near / up (h) | Rain for a 1 ft rise (window) | Alert | Rise per 10 mm (wet / dry) | Peak lag h (storms) | Satellite bias, Open-Meteo/sat | Storms, confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| Baddegama | 1040 | 15 / 10 / 5 | Thawalama (8) | 8 / 9 | - | - | 0.2 (0.4 / 0.1) | 46 (5) | 0.7, 0.3 | 0, none |
| Thawalama | 350 | 5 / 5 / 0 | - | 24 / - | (50 mm / 24 h, not published) | - | 0.3 (0.3 / 0.2) | 26 (3) | 0.93, 0.31 | 2, none |

Worked examples (peak level, rise, heaviest 24 h of catchment rain): Baddegama: Ditwah 11.9 ft (+0, 72.7 mm), 25-26 Oct 9.4 ft (+2.4, 48.7 mm); Thawalama: Ditwah 13.6 ft (+7, 185.7 mm), 25-26 Oct 10.7 ft (+1.7, 64.5 mm).

## Heda Oya

Siyambalanduwa is dry zone, small (350 km2) and rarely rises (7.7% of hours): too few storms (AUC 0.73, no threshold reached the test) to say how much rain it takes.

| Gauge | Area km2 | Cells (all / near / up) | Up-channel gauges (travel h) | Lag near / up (h) | Rain for a 1 ft rise (window) | Alert | Rise per 10 mm (wet / dry) | Peak lag h (storms) | Satellite bias, Open-Meteo/sat | Storms, confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| Siyambalanduwa | 350 | 5 / 5 / 0 | - | 31 / - | - | - | 0 (0 / 0) | 30 (6) | 0.89, 0.27 | 0, none |

Worked examples (peak level, rise, heaviest 24 h of catchment rain): Siyambalanduwa: Ditwah 19.2 ft (+13.1, 90.4 mm), 25-26 Oct 1.8 ft (+0, 50.2 mm).

## Kalu Ganga

The Kalu drains the wettest part of the island and rises big and slowly: Ratnapura rose 15 ft in Ditwah and 13 ft on 26 Oct, with rain beside it showing in about 3 hours; Ellagawa about 8 to 9 hours behind Ratnapura; Magura about 25 hours behind Ellagawa on the up-channel signal; Putupaula and Kalawellawa (near the sea, tide-affected) around 30 hours with the weakest rain link (AUC 0.49 to 0.54). Only Magura has a published threshold (about 40 mm in 24 h, alert level about 40 mm; three storms), the rest do not separate rises from non-rises well because they are almost always moving (a 1 ft rise followed 26 to 42% of all hours).

| Gauge | Area km2 | Cells (all / near / up) | Up-channel gauges (travel h) | Lag near / up (h) | Rain for a 1 ft rise (window) | Alert | Rise per 10 mm (wet / dry) | Peak lag h (storms) | Satellite bias, Open-Meteo/sat | Storms, confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| Ellagawa | 2490 | 9 / 3 / 6 | Rathnapura (8) | 9 / 8 | (20 mm / 12 h, not published) | - | 0.8 (0.6 / 0.9) | 34 (8) | 1.07, 0.36 | 12, none |
| Kalawellawa (Millakanda) | 3040 | 11 / 1 / 10 | Magura (11) | 10 / 11 | - | - | 0.6 (0.5 / 0.6) | 36 (8) | 0.76, 0.48 | 0, none |
| Magura | 2760 | 10 / 1 / 9 | Ellagawa (25) | 1 / 25 | 40 mm / 24 h | 40 mm / 24 h | 0.2 (0.6 / 0) | 29 (15) | 0.75, 0.51 | 3, medium |
| Putupaula | 3040 | 11 / 1 / 10 | Magura (29) | 30 / 29 | (35 mm / 12 h, not published) | - | 0.6 (0.5 / 0.9) | 32 (5) | 0.74, 0.49 | 5, none |
| Rathnapura | 1660 | 6 / 6 / 0 | - | 3 / - | - | - | 0.3 (0.7 / 0) | 35 (2) | 1.2, 0.33 | 0, none |

Worked examples (peak level, rise, heaviest 24 h of catchment rain): Ellagawa: Ditwah 39.3 ft (+14.7, 220.2 mm), 25-26 Oct 28.9 ft (+5.8, 71.4 mm); Kalawellawa (Millakanda): Ditwah 26.7 ft (+8.6, 172.7 mm), 25-26 Oct 19.4 ft (+4.8, 55.7 mm); Magura: Ditwah 17.9 ft (+7.9, 174.8 mm), 25-26 Oct 14.1 ft (+5.2, 53.1 mm); Putupaula: Ditwah 13.4 ft (+7.1, 169.9 mm), 25-26 Oct 7.6 ft (+2.6, 54.7 mm); Rathnapura: Ditwah 33.5 ft (+15.5, 230.9 mm), 25-26 Oct 25 ft (+12.9, 66.9 mm).

## Kelani Ganga

The Kelani is a steep river with a flashy upper end and a slow, damped lower end. Holombuwa (on the Gurugoda Oya) and Deraniyagala / Glencourse answer rain within about 0 to 4 hours and rose 20 to 36 ft in Ditwah, but only two or three separate storms in the 11 months gave a clean rain-to-rise pattern there, so no per-gauge number is published (confidence low): 'about 50 mm a day' is the best guess for Holombuwa. The satellite also under-reads a local cloudburst (14 mm in 3 h over the Holombuwa catchment on 26 Oct while the gauge read 67 mm), so the gauge's own rain is the signal there. Hanwella is slow and damped: rain beside it and rain from the Glencourse and Holombuwa side both take about 7 hours to show, it has usually risen 1 ft or more after about 35 mm over the catchment in a day (alert level after about 40 mm), and its peak comes about 13 hours after the heaviest rain (28 storms). Nagalagam Street is the tidal end: the tide and the Mutwal lake matter more than rain, its own rain sensor is dead (always 0) and no rain amount separates rises from non-rises (AUC 0.46).

| Gauge | Area km2 | Cells (all / near / up) | Up-channel gauges (travel h) | Lag near / up (h) | Rain for a 1 ft rise (window) | Alert | Rise per 10 mm (wet / dry) | Peak lag h (storms) | Satellite bias, Open-Meteo/sat | Storms, confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| Deraniyagala | 1100 | 4 / 1 / 3 | Kithulgala (0) | 0 / 0 | - | - | 0.3 (0.3 / 0.4) | 25 (7) | 1.17, 0.27 | 0, none |
| Glencourse | 1660 | 6 / 2 / 4 | Deraniyagala (4) | 4 / 4 | - | - | 0.5 (0.5 / 0.5) | 6 (3) | 0.8, 0.43 | 0, none |
| Hanwella | 2210 | 8 / 2 / 6 | Glencourse (7), Holombuwa (7) | 7 / 7 | 35 mm / 24 h | 40 mm / 24 h | 0.5 (0.6 / 0.4) | 13 (28) | 0.58, 0.56 | 6, medium |
| Holombuwa | 1660 | 6 / 2 / 4 | Deraniyagala (1) | 1 / 1 | (50 mm / 24 h, not published) | - | 0 (0.1 / 0) | 8 (3) | 0.8, 0.44 | 2, low |
| Kithulgala | 830 | 3 / 2 / 1 | Norwood (15) | 0 / 0 | - | - | 0.3 (0.2 / 0.4) | 33 (10) | 1.5, 0.24 | 0, none |
| Nagalagam Street (sensor dead) | 2490 | 9 / 1 / 8 | Hanwella (6) | 6 / 6 | - | - | 0.3 (0.2 / 0.5) | 20 (11) | 0.92, 0.37 | 0, none |
| Norwood | 280 | 1 / 1 / 0 | - | 1 / - | - | - | 0.1 (0.1 / 0.1) | 22 (3) | 1.02, 0.27 | 0, none |

Worked examples (peak level, rise, heaviest 24 h of catchment rain): Deraniyagala: Ditwah 28.2 ft (+24.7, 216.1 mm), 25-26 Oct 11 ft (+7.4, 85.3 mm); Glencourse: Ditwah 71.9 ft (+35.9, 173.4 mm), 25-26 Oct 41.7 ft (+5.7, 66.7 mm); Hanwella: Ditwah 35.9 ft (+25.6, 137.7 mm), 25-26 Oct 14.2 ft (+5, 54.6 mm); Holombuwa: Ditwah 23.9 ft (+19.8, 172.5 mm), 25-26 Oct 15.3 ft (+10.7, 66.3 mm); Kithulgala: Ditwah 22.9 ft (+16.9, 247.9 mm), 25-26 Oct 10.3 ft (+3.1, 88 mm); Nagalagam Street: Ditwah 7 ft (+4.2, 196.4 mm), 25-26 Oct 2.6 ft (+0.6, 89.4 mm); Norwood: Ditwah 12.5 ft (+7.9, 221.3 mm), 25-26 Oct 7.4 ft (+2.8, 50.8 mm).

## Kirindi Oya

Wellawaya (upper), Kuda Oya and Thanamalwila are chained; the response is weak in this data (AUC 0.65 to 0.70) and few storms are behind it, so nothing is published. Kuda Oya and Thanamalwila answer within a couple of hours, Wellawaya about 12 hours.

| Gauge | Area km2 | Cells (all / near / up) | Up-channel gauges (travel h) | Lag near / up (h) | Rain for a 1 ft rise (window) | Alert | Rise per 10 mm (wet / dry) | Peak lag h (storms) | Satellite bias, Open-Meteo/sat | Storms, confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| Kuda Oya | 690 | 10 / 4 / 6 | Wellawaya (14) | 1 / 0 | - | - | 0 (0 / 0) | 24 (7) | 1.16, 0.21 | 0, none |
| Thanamalwila | 760 | 11 / 1 / 10 | Kuda Oya (2) | 2 / 2 | - | - | 0.1 (0.1 / 0.1) | 6 (5) | 0.8, 0.27 | 0, none |
| Wellawaya | 410 | 6 / 6 / 0 | - | 12 / - | - | - | 0.1 (0.1 / 0.1) | 11 (1) | 0.69, 0.33 | 0, none |

Worked examples (peak level, rise, heaviest 24 h of catchment rain): Kuda Oya: Ditwah 18.1 ft (+11.2, 138.6 mm), 25-26 Oct 4.2 ft (+0.1, 45.4 mm); Thanamalwila: Ditwah 18.2 ft (+11.4, 111.4 mm), 25-26 Oct 3.2 ft (+0.3, 32.1 mm); Wellawaya: Ditwah 11.9 ft (+7.1, 87.2 mm), 25-26 Oct 4.1 ft (+0.7, 25.3 mm).

## Kumbukkan Oya

Nakkala is dry zone: the rain link is weak and slow (about 32 hours, correlation 0.17), no threshold published.

| Gauge | Area km2 | Cells (all / near / up) | Up-channel gauges (travel h) | Lag near / up (h) | Rain for a 1 ft rise (window) | Alert | Rise per 10 mm (wet / dry) | Peak lag h (storms) | Satellite bias, Open-Meteo/sat | Storms, confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| Nakkala | 410 | 6 / 6 / 0 | - | 32 / - | - | - | 0.1 (0 / 0.1) | 46 (3) | 0.85, 0.32 | 0, none |

Worked examples (peak level, rise, heaviest 24 h of catchment rain): Nakkala: Ditwah 28.1 ft (+21.4, 83.1 mm), 25-26 Oct 5.5 ft (+3.2, 40.3 mm).

## Ma Oya

Yaka Wewa: rain beside the gauge shows up almost at once, but only 2 to 3 storms back the thresholds (about 50 mm in 6 h), so nothing is published.

| Gauge | Area km2 | Cells (all / near / up) | Up-channel gauges (travel h) | Lag near / up (h) | Rain for a 1 ft rise (window) | Alert | Rise per 10 mm (wet / dry) | Peak lag h (storms) | Satellite bias, Open-Meteo/sat | Storms, confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| Yaka Wewa | 550 | 8 / 8 / 0 | - | 0 / - | - | - | 0 (0 / 0) | 18 (1) | 0.95, 0.21 | 0, none |

Worked examples (peak level, rise, heaviest 24 h of catchment rain): Yaka Wewa: Ditwah 18.8 ft (+14.3, 156.4 mm), 25-26 Oct 3.6 ft (+1.9, 65 mm).

## Maduru Oya

Padiyathalawa is small (about 210 km2) and in the dry zone; the satellite reads about 1.5 times the gauge. About 70 mm in a day has come before a 1 ft rise (3 storms; medium). It did not rise on 26 Oct.

| Gauge | Area km2 | Cells (all / near / up) | Up-channel gauges (travel h) | Lag near / up (h) | Rain for a 1 ft rise (window) | Alert | Rise per 10 mm (wet / dry) | Peak lag h (storms) | Satellite bias, Open-Meteo/sat | Storms, confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| Padiyathalawa | 210 | 3 / 3 / 0 | - | 1 / - | 70 mm / 24 h | - | 0 (0 / 0) | 10 (3) | 1.5, 0.25 | 3, medium |

Worked examples (peak level, rise, heaviest 24 h of catchment rain): Padiyathalawa: Ditwah 21.8 ft (+16.9, 192 mm), 25-26 Oct 1 ft (+0.2, 47.8 mm).

## Maha Oya

A river with a clear, slow response. Giriulla rises about 20 hours after the rain nearby; Badalgama (below it) adds about 10 hours from its own cells, and its signal from the Giriulla side is around 30 hours. About 30 mm over the catchment in a day has usually come before a 1 ft rise at both (16 and 7 storms; confidence high), the rise peaking 12 to 15 hours after the heaviest rain. Ditwah lifted Badalgama 31 ft.

| Gauge | Area km2 | Cells (all / near / up) | Up-channel gauges (travel h) | Lag near / up (h) | Rain for a 1 ft rise (window) | Alert | Rise per 10 mm (wet / dry) | Peak lag h (storms) | Satellite bias, Open-Meteo/sat | Storms, confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| Badalgama | 1520 | 22 / 2 / 20 | Giriulla (32) | 10 / 32 | 30 mm / 24 h | - | 0.1 (0.3 / 0) | 15 (28) | 1.17, 0.22 | 16, high |
| Giriulla | 1380 | 20 / 20 / 0 | - | 20 / - | 30 mm / 24 h | - | 0.2 (0.3 / 0.1) | 12 (24) | 0.72, 0.32 | 7, high |

Worked examples (peak level, rise, heaviest 24 h of catchment rain): Badalgama: Ditwah 44.1 ft (+31.5, 187.9 mm), 25-26 Oct 13.6 ft (+4.3, 136.8 mm); Giriulla: Ditwah 41.1 ft (+31.1, 144.1 mm), 25-26 Oct 10.5 ft (+5.2, 93 mm).

## Mahaweli Ganga

The Mahaweli is a long river with big reservoirs (Kotmale, Victoria, Randenigala, Rantembe; releases are handled in lib/releases.ts, not here) that buffer and delay everything. Nawalapitiya (upper) answers at once; Peradeniya and Thaldena sit about 24 to 28 hours behind it on the up-channel signal; Manampitiya (8,000 km2, the biggest catchment) responds to near rain in about 4 hours and to rain on the Weraganthota side in about 16 hours. About 30 mm over the catchment in a day has usually come before a 1 ft rise at Manampitiya (10 storms; medium); the other three have no clear rain-to-rise pattern.

| Gauge | Area km2 | Cells (all / near / up) | Up-channel gauges (travel h) | Lag near / up (h) | Rain for a 1 ft rise (window) | Alert | Rise per 10 mm (wet / dry) | Peak lag h (storms) | Satellite bias, Open-Meteo/sat | Storms, confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| Manampitiya | 8000 | 29 / 12 / 17 | Weraganthota (16) | 4 / 16 | 30 mm / 24 h | - | 0.3 (0.2 / 0.4) | 25 (29) | 1.26, 0.35 | 10, medium |
| Nawalapitiya | 1380 | 5 / 5 / 0 | - | 0 / - | (80 mm / 24 h, not published) | - | 0.1 (0.1 / 0.1) | 14 (1) | 1.35, 0.24 | 2, none |
| Peradeniya | 2760 | 10 / 5 / 5 | Nawalapitiya (0) | 25 / 24 | - | - | 1.1 (0.8 / 1.3) | 12 (3) | 0.85, 0.46 | 0, none |
| Thaldena | 2760 | 10 / 5 / 5 | Nawalapitiya (27) | 28 / 27 | - | - | 0.2 (0.1 / 0.3) | 9 (1) | 0.75, 0.49 | 0, none |

Worked examples (peak level, rise, heaviest 24 h of catchment rain): Manampitiya: Ditwah 19.3 ft (+10.7, 173.6 mm), 25-26 Oct 1.6 ft (+1.1, 76.7 mm); Nawalapitiya: Ditwah 21.2 ft (+16.4, 219.9 mm), 25-26 Oct 12.9 ft (+7.6, 51.9 mm); Peradeniya: Ditwah 33.6 ft (+23.1, 141.5 mm), 25-26 Oct 14.3 ft (+4.7, 32.9 mm); Thaldena: Ditwah 15.1 ft (+11.2, 124.7 mm), 25-26 Oct 2.2 ft (+1.1, 29 mm).

## Menik Ganga

Katharagama is the driest catchment: the satellite reads about 0.4 times the gauge there (the satellite over-reads), a 1 ft rise followed only 4.6% of hours, and Ditwah lifted it 18 ft with only 43 mm of satellite rain in the heaviest day. No rain amount is published.

| Gauge | Area km2 | Cells (all / near / up) | Up-channel gauges (travel h) | Lag near / up (h) | Rain for a 1 ft rise (window) | Alert | Rise per 10 mm (wet / dry) | Peak lag h (storms) | Satellite bias, Open-Meteo/sat | Storms, confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| Katharagama | 1170 | 17 / 17 / 0 | - | 2 / - | - | - | 0 (0 / 0.2) | 15 (2) | 0.4, 0.35 | 0, none |

Worked examples (peak level, rise, heaviest 24 h of catchment rain): Katharagama: Ditwah 22.1 ft (+17.9, 43.2 mm), 25-26 Oct -0.6 ft (+0.1, 24.6 mm).

## Nilwala Ganga

A river of small steep sub-catchments that answer within about an hour (Urawa, Pitabeddara) but where the rain link is weak (AUC 0.56 to 0.59). Urawa: about 30 mm in a day has been followed by a 1 ft rise two times in three (alert level about 50 mm; confidence low). Panadugama / Thalgahagoda sit lower and showed little rise in Ditwah (0.5 to 0.8 ft by this test).

| Gauge | Area km2 | Cells (all / near / up) | Up-channel gauges (travel h) | Lag near / up (h) | Rain for a 1 ft rise (window) | Alert | Rise per 10 mm (wet / dry) | Peak lag h (storms) | Satellite bias, Open-Meteo/sat | Storms, confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| Panadugama | 760 | 11 / 4 / 7 | Pitabeddara (n/a), Urawa (24) | 0 / 24 | - | - | 0.1 (0.4 / 0) | 35 (4) | 0.84, 0.45 | 0, none |
| Pitabeddara | 480 | 7 / 7 / 0 | - | 1 / - | - | - | 0.2 (0.5 / 0.1) | 33 (5) | 0.8, 0.35 | 0, none |
| Thalgahagoda | 970 | 14 / 3 / 11 | Panadugama (n/a) | 1 / - | - | - | 0.2 (0.2 / 0.4) | 59 (2) | 0.73, 0.53 | 0, none |
| Urawa | 480 | 7 / 7 / 0 | - | 1 / - | (30 mm / 24 h, not published) | - | 0 (0.1 / 0) | 26 (4) | 0.96, 0.3 | 7, none |

Worked examples (peak level, rise, heaviest 24 h of catchment rain): Panadugama: Ditwah 18.4 ft (+0.8, 120.9 mm), 25-26 Oct 16.1 ft (+1.2, 58 mm); Pitabeddara: Ditwah 11.1 ft (+2.9, 154.9 mm), 25-26 Oct 7.2 ft (+1.6, 56.1 mm); Thalgahagoda: Ditwah 5.6 ft (+0.5, 90.4 mm), 25-26 Oct 4 ft (+1, 49.2 mm); Urawa: Ditwah 9.8 ft (+5, 176 mm), 25-26 Oct 6.4 ft (+2.8, 67.5 mm).

## Walawe Ganga

Moraketiya answers in about 17 hours and peaks around two days after the heaviest rain; about 35 mm in a day has usually come before a 1 ft rise (5 storms; confidence medium; alert level about 40 mm).

| Gauge | Area km2 | Cells (all / near / up) | Up-channel gauges (travel h) | Lag near / up (h) | Rain for a 1 ft rise (window) | Alert | Rise per 10 mm (wet / dry) | Peak lag h (storms) | Satellite bias, Open-Meteo/sat | Storms, confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| Moraketiya | 2760 | 10 / 10 / 0 | - | 17 / - | 35 mm / 24 h | 40 mm / 24 h | 0 (0.1 / 0) | 51 (2) | 0.88, 0.29 | 5, medium |

Worked examples (peak level, rise, heaviest 24 h of catchment rain): Moraketiya: Ditwah 15.7 ft (+10.6, 162.3 mm), 25-26 Oct 6.2 ft (+2.4, 34.2 mm).

## Yan Oya

Horowpothana is a dry-zone river where the satellite reads about 0.6 times the rain gauge. About 20 mm of catchment rain in a day has usually come before a 1 ft rise (9 storms; confidence high), peaking about 38 hours later. No clean travel time could be measured.

| Gauge | Area km2 | Cells (all / near / up) | Up-channel gauges (travel h) | Lag near / up (h) | Rain for a 1 ft rise (window) | Alert | Rise per 10 mm (wet / dry) | Peak lag h (storms) | Satellite bias, Open-Meteo/sat | Storms, confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| Horowpothana | 1030 | 15 / 15 / 0 | - | - / - | 20 mm / 24 h | - | 0.1 (0.2 / 0) | 38 (7) | 0.6, 0.31 | 9, high |

Worked examples (peak level, rise, heaviest 24 h of catchment rain): Horowpothana: Ditwah 27.5 ft (+12, 102.4 mm), 25-26 Oct 8.2 ft (+1.5, 59.5 mm).

## Limits and what would improve it

- The pattern between catchment rain and a 1 ft rise is weak or noisy at most gauges (AUC 0.4 to 0.8): rivers here are also driven by dam releases, tides, and rain upstream that the 0.1 degree satellite averages over. Only 10 gauges clear the bar for publication (Badalgama, Dunamale, Giriulla, Hanwella, Horowpothana, Magura, Manampitiya, Moragaswewa, Moraketiya, Padiyathalawa); the rest use the national numbers (lib/rainWords.ts).
- Travel times come from a lag correlation and are rough (nothing under correlation 0.15 is shown). Several lags of 25 to 32 hours (Badalgama up-channel, Peradeniya, Thaldena, Nakkala) sit near the 36 h search limit and should be read as "a day or more".
- The gauge rain archive is 14 days long, so the bias factors lean on the zone value; the satellite over-reads in the dry zone (Katharagama 0.4, Thanthirimale 0.5, Horowpothana 0.6 of the gauge) and under-reads a small cloudburst (Holombuwa 26 Oct). Refit when a monsoon season of `rain_fall` is archived.
- ERA5-Land from Open-Meteo returned no values for these cells, so no second reanalysis rain was compared; Open-Meteo's own past hours were used only as a comparison (0.2 to 0.56 of the satellite in storms).
- Raw hourly catchment series (3 products x 39 catchments x 8,640 hours): `research/gsmap-catchment-hourly.json.gz`.
