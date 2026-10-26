# What drives the Colombo canal levels: tide, rain and the Kelani (first look, 26 Oct 2026)

**Status: internal and private.** This note uses the CUrW (pub.curwsl.org) canal levels that we archive every 15 minutes in the private D1 table `curw_levels`. We have **no permission to publish CUrW data** (email sent, no reply). Nothing here may be shown on the site or used to drive a public output until permission arrives. The numbers below may be quoted only as "internal research". Only the tide timing (lib/tide.ts) is public, and it does not use CUrW data at all.

**Sample is small.** 22 Oct 22:15 to 26 Oct 12:15 Sri Lanka time, 345 readings per gauge (3.6 days), 28 gauges, digitised from chart images (about 0.005 m typical error). Everything below is a first look, not a calibration. Rain is the Open-Meteo model hourly rainfall for central Colombo (6.93 N, 79.89 E), not a gauge: 22 Oct 39 mm, 23 Oct 33, 24 Oct 15, 25 Oct 42, 26 Oct about 60 up to noon. The Kelani was **low throughout**: Nagalagam Street's 25-hour mean level stayed between 2.0 and 2.5 ft (minor flood is 5 ft). So the high-river regime, the one that matters most for Kolonnawa, is **not in this sample** and nothing here says how the canals behave when the Kelani is high.

## 1. The sea tide, and how it reaches Nagalagam

- Mutwal Inlet (sea level at the Kelani mouth) swung between -0.12 and +0.72 m MSL (2.7 ft) in the window. Two highs and two lows a day; the biggest high was 26 Oct 01:45 (+0.70 m), around the full moon, so probably a spring tide.
- Nagalagam Street's gauge follows it: the detrended hourly Nagalagam series correlates r = 0.91 with Mutwal Inlet when Nagalagam is shifted **75 minutes later** (hourly readings, so plus or minus 30 minutes), with about **70% of the swing** (standard deviation 0.145 m against 0.205 m). This is the "tide at Nagalagam" the owner saw: highs 0 to 2 hours after the sea.
- The public tide model (lib/tide.ts, harmonics fitted to 11 months of Nagalagam's own dry-period readings) tracks Mutwal Inlet with r = 0.98 and sits **45 minutes behind** it, consistent with the above. Out of sample (fit without the last 60 days) it explains 78% of the dry-period swing and puts the high within 60 minutes of the observed high for 80% of tides.

## 2. How far the tide travels into the canals

Standard deviation of the tidal band (the series minus its own 25-hour mean) relative to Mutwal Inlet, and the delay of the tide at each gauge behind Mutwal:

| Gauge | Tide size vs Mutwal | Delay | Correlation | Reading |
|---|---|---|---|---|
| Mattakkuliya N | 1.0 | 0 | 0.99 | the same tide |
| Kalupalama DS / US | 0.8 | 15 / 30 min | 0.96 / 0.95 | Kolonnawa canal outfall is fully tidal |
| Sedawatta Bridge DS | 0.7 | 15 min | 0.98 | tidal |
| Ingurukade N | 0.55 | 30 min | 0.93 | tidal |
| Wellawatta N | 0.45 | 0 | 0.97 | the southern canal outfall is tidal too |
| Aluthkade | 0.35 | 60 min | 0.75 | damped |
| Orugodawatta | 0.25 | 60 min | 0.72 | damped |
| Near Lanka Hospital, Nawala Road | 0.1 | 45 to 105 min | 0.5 to 0.8 | barely |
| Salalihini Mw | 0.6 | about 150 min | 0.27 at zero lag (0.58 at the lag) | small ripple on a rain-driven level |
| **Parliament Lake group** (Diyasaru Uyana Gate US, Diyatha Bridge, Kimbulawela, Rampalawatta, Torinton) | 0.1 or less | no clear delay | below 0.2 | **no tide at all** (gated) |
| Ambathale, Thalangama Lake, Awerihena Tank | not tidal | none | below 0.3 | rain / pumping driven |

So: **Kalupalama (the Kolonnawa canal outfall) rides the sea tide with 20 to 30 minutes of delay and 80% of its size.** The Parliament Lake side is decoupled from the tide by its gates and holds a nearly flat level.

## 3. Kolonnawa canal: tide plus a "head" from the runoff

Kalupalama US minus Mutwal Inlet at each tide shows how much extra water the canal carries on top of the sea (m):

| Mutwal high | sea | Kalupalama US 30 min later | head |
|---|---|---|---|
| 23 Oct 00:30 | 0.49 | 1.13 | +0.64 |
| 23 Oct 12:15 | 0.41 | 0.90 | +0.49 |
| 24 Oct 01:00 | 0.55 | 0.88 | +0.33 |
| 24 Oct 13:00 | 0.42 | 0.76 | +0.34 |
| 25 Oct 13:45 | 0.47 | 0.71 | +0.24 |
| 26 Oct 01:45 | 0.70 | 0.98 | +0.28 |

At low tide the canal cannot empty below about 0.25 to 0.35 m MSL even when the sea is at -0.07: the **low-tide floor** fell from 0.69 (23 Oct morning) to 0.25 (25 Oct evening) as the 21 to 23 Oct rain drained, then jumped to 0.56 (26 Oct 07:30) after the next rain. That floor, the head over the sea, is the cleanest "is the canal draining normally" signal in the data: it follows the rain, not the tide.

What this says about drainage: the canal outfall can only drain in the part of the tide below its own level. With the head at +0.3 to +0.6 m the canal sits above the sea for the whole tide, so it drains all the time but **slowest around the sea's high**, when the difference is smallest. The tide-hold-back matters most when the head is already small (late in a dry spell) and the sea is high; it matters less right after rain. The case that cannot be read here is a high Kelani, where the head would disappear and the canal would depend on the North Lock pumps.

## 4. Rain: lag and sensitivity

- **Salalihini Mawatha** (Kolonnawa basin, rain driven): fell from 2.29 to 1.07 m over 23 to 25 Oct (about 0.4 to 0.5 m a day, after 70 mm on 21 to 23 Oct), then rose to 1.88 m by noon on 26 Oct (+0.8 m) while about 45 mm fell between 25 Oct 18:00 and 26 Oct 12:00 (model rain). Roughly **0.02 m per mm** of rain in a night. The rise began within about 1 to 3 hours of the rain picking up (1 to 2 mm/h in the evening, then 3 to 5 mm/h from midnight); hourly data cannot resolve the lag more finely.
- **Ambathale** (Madiwela East diversion pumping station area): same behaviour, +0.87 m (1.50 to 2.37) over the same hours, still rising at noon; about 0.02 m per mm. Its level also reflects the pumps, so do not read it as a natural canal.
- **A single morning's 25 mm (25 Oct 03:00 to 10:00)** only paused Salalihini's fall (a blip of +0.1 m) and did not reverse it: the canal was draining faster than it filled. Rain on a canal that is draining down from an earlier event does not show as a rise.
- **Parliament Lake group**: slow and small. The best lag from rain to level change is 6 to 8 hours, and the rise to noon on 26 Oct was only +0.08 to +0.12 m at Diyasaru, Diyatha, Rampalawatta and Kimbulawela (about 0.003 m per mm). The lake fell steadily from 22 to 25 Oct (Diyasaru from 1.33 to 0.87, Rampalawatta from 1.57 to 1.10) which looks like deliberate drawdown through its gates after the 21 to 23 Oct rain, not natural drainage. It is far below the levels the project report gives for the 2021 events (kept under 1.15 m in Nov 2021, 1.71 m with three pumping stations running in Jun 2021; datum of those figures unconfirmed), so in this sample the lake has headroom.

## 5. When do the canals rise "above normal"?

We cannot say yet. The window is short, wet, and starts mid-recession, so there is no dry baseline. What the data can support is a relative statement per gauge, against its own recent range:

| Gauge | min | max (window) | 26 Oct noon | note |
|---|---|---|---|---|
| Kalupalama US | 0.25 | 1.15 | tide, 0.4 to 1.0 | read its low-tide floor, not the instant level |
| Salalihini Mw | 1.02 | 2.32 | 1.88 | up 0.8 m in 15 hours |
| Ambathale | 1.48 | 2.69 | 2.37 | up 0.87 m, still rising |
| Diyasaru Uyana Gate US | 0.86 | 1.33 | 0.98 | flat |
| Rampalawatta | 1.08 | 1.57 | 1.21 | flat |

A usable rule will need at least a wet season of data. The thresholds should come from CUrW's own alert levels (ask for them) or from the percentile of each gauge's own history.

## 6. What we cannot say, and what to do next

- **Kelani effect.** Not testable: the river was low. We need a day with Nagalagam above 4 ft. The first such event after 23 Oct should be kept in full (the raw PNGs are kept by the archive job when a level passes its threshold).
- **Pumps and gates.** No status feed. The jump or fall of a level that does not follow the tide or rain (Parliament Lake drawdown, Ambathale) is probably operation, and can only be confirmed by CUrW.
- **Rain.** Model rainfall, hourly, one point. Use the CUrW rain maps or the satellite rain in the site's own archive for a real fit.
- **Caveats:** 3.6 days, digitised, 15-minute sampling, no shared datum with Nagalagam's gauge feet (the project report's feet-to-MSL conversion is inconsistent), only one big (probably spring) tide.

## 7. What could become public if CUrW agrees (in order of value)

1. **Mutwal Inlet live sea level** and the "tide at the Kelani mouth" line next to the predicted tide: removes the 45 to 75 minute guess and shows surge days.
2. **Canal draining state for the Kolonnawa outfall**: Kalupalama's head over the sea, shown as "draining normally / slowly / not draining" (needs thresholds from CUrW or a few events).
3. **Salalihini Mawatha and Ambathale** as rain-driven canal levels against their own recent range ("high for this canal").
4. **Parliament Lake level** against its managed range, and the gate or pump status if CUrW will share it.
5. Even without permission, the site can carry the **research conclusions** above in words (the canal follows the tide with a 20 to 30 minute delay; the lake does not) as long as no CUrW number is shown.

Until then the public pages use only the predicted tide, the rain (sensor, satellite, model) and the official warnings.

Data and scripts: private D1 `curw_levels` (scripts/curw-snapshot.mjs), tide fit scripts/fit-tide.mjs. Analysis notebooks were scratch, not committed (they read the private table).
