import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  fetchStations,
  fetchStationData,
  fetchBasinSnapshot,
  statusFor,
} from "@/lib/arcgis";
import { orderStations } from "@/lib/basinOrder";
import { ageMinutes } from "@/lib/readings";
import { getOfficialWarnings, warningsForBasin } from "@/lib/warnings";
import { getReleases } from "@/lib/releases";
import { WEEKLY_PDF, getWeeklyOutcome, windowState } from "@/lib/wmsWeekly";
import { reservoirById } from "@/lib/reservoirs";
import { getNextHourForBasin, getNextHourForBasins, timeBox } from "@/lib/nextHour";
import { bestWindow, figure, getAccuracy, newModelFigure, spanText } from "@/lib/accuracy";

const NEXT_HOUR_DOC =
  "next_hour = the next-hour river forecast (the headline feature of this service): level_ft is the expected level in about an hour from issuedAt, low_ft..high_ft the range it should stay in, direction rising/falling/steady, crossing a flood mark the range reaches, method model|trend. A forecast, not an official warning; null when not available.";

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "list_basins",
      "List every river basin that has hydrometric gauge stations in the Sri Lanka Department of Irrigation dataset.",
      {},
      async () => {
        const stations = await fetchStations();
        const basins = [...new Set(stations.map((s) => s.basin.trim()))]
          .filter(Boolean)
          .sort();
        return {
          content: [
            { type: "text", text: JSON.stringify({ basins, count: basins.length }, null, 2) },
          ],
        };
      },
    );

    server.tool(
      "list_stations",
      "List hydrometric gauge stations, optionally filtered by basin (substring match, case-insensitive). Returns each station with its basin.",
      {
        basin: z.string().optional().describe("Optional basin filter, e.g. 'Kelani'"),
      },
      async ({ basin }) => {
        const stations = await fetchStations();
        const filtered = basin
          ? stations.filter((s) => s.basin.toLowerCase().includes(basin.toLowerCase()))
          : stations;
        return {
          content: [
            { type: "text", text: JSON.stringify({ stations: filtered, count: filtered.length }, null, 2) },
          ],
        };
      },
    );

    server.tool(
      "get_station_readings",
      "Get water-level (and rainfall where reported) readings for a single station, plus its next-hour forecast (`next_hour`: expected level in about an hour with a range, updated hourly). Returns up to the last `days` of readings (the source only retains ~7 days) plus alert / minor-flood / major-flood thresholds. Readings and thresholds are in the gauge's published unit (feet or metres, depending on the gauge); next_hour is always in feet. " + NEXT_HOUR_DOC,
      {
        station: z.string().describe("Exact station name, e.g. 'Nagalagam Street' or 'Hanwella'"),
        days: z
          .number()
          .int()
          .min(1)
          .max(30)
          .optional()
          .describe("Window of history in days. Default 4."),
      },
      async ({ station, days }) => {
        const data = await fetchStationData(station, days ?? 4);
        const status = statusFor(data.latest?.water_level ?? null, data.thresholds, data.latest?.ts);
        const nh = await timeBox(getNextHourForBasin(data.basin), 4000);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  station: data.station,
                  basin: data.basin,
                  next_hour: nh?.[data.station] ?? null,
                  status: status.label,
                  tier: status.tier,
                  age_minutes: ageMinutes(data.latest),
                  thresholds: data.thresholds,
                  latest: data.latest,
                  reading_count: data.readings.length,
                  readings: data.readings,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    server.tool(
      "get_basin_snapshot",
      "Get every station in a basin ordered upstream → downstream (canonical order for known basins, longitude desc otherwise). For each station: current level, 3-hour trend rate and its next-hour forecast (`next_hour`). Useful for spotting a flood wave moving down a river and seeing where each gauge will be in an hour. " + NEXT_HOUR_DOC,
      {
        basin: z.string().describe("Basin name, e.g. 'Kelani Ganga'"),
      },
      async ({ basin }) => {
        const raw = await fetchBasinSnapshot(basin);
        const ordered = orderStations(basin, raw);
        const nh = await timeBox(getNextHourForBasin(basin), 4000);
        const summary = ordered.map((s, i) => {
          const status = statusFor(s.latest?.water_level ?? null, s.thresholds, s.latest?.ts);
          return {
            position:
              i === 0 ? "upstream" : i === ordered.length - 1 ? "downstream" : "midstream",
            station: s.station,
            latest_level: s.latest?.water_level ?? null,
            latest_ts: s.latest?.ts ?? null,
            next_hour: nh?.[s.station] ?? null,
            status: status.label,
            tier: status.tier,
            age_minutes: s.ageMin,
            unit: s.unit,
            thresholds: s.thresholds,
            rate_per_hour_3h: s.rate3h,
            rate_m_per_hour_3h: s.rate3hM,
          };
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { basin, station_count: summary.length, stations: summary },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    server.tool(
      "get_next_hour_forecast",
      "Get the next-hour river forecast: for every gauge (or one river, or one gauge) where the river is expected to be in about an hour, with a range, updated hourly. This is the main thing this service adds: as far as we know it is the only public next-hour river forecast for Sri Lanka. Built from the recent trend, the gauges upstream and rain. Returns per gauge: level_ft, low_ft, high_ft, change_ft, direction (rising/falling/steady), crossing (e.g. 'may reach alert level', else null), issuedAt (the reading it starts from), method (model or trend) and experimental. Also returns an accuracy summary measured against what the gauges then read. Always quote it as a forecast, not an official warning, with the issuedAt time (Sri Lanka time, UTC+5:30).",
      {
        basin: z.string().optional().describe("Optional river filter, e.g. 'Kelani Ganga'"),
        station: z.string().optional().describe("Optional exact gauge name, e.g. 'Hanwella'"),
      },
      async ({ basin, station }) => {
        const all = await fetchStations();
        const b = basin?.trim().toLowerCase();
        const st = station?.trim().toLowerCase();
        const picked = all.filter((s) => (b ? s.basin.trim().toLowerCase().includes(b) : true) && (st ? s.station.toLowerCase() === st : true));
        const [nh, acc] = await Promise.all([timeBox(getNextHourForBasins(picked.map((s) => s.basin)), 8000), getAccuracy()]);
        const win = acc ? bestWindow(acc) : "all";
        const forecasts = picked.map((s) => ({ station: s.station, river: s.basin.trim(), next_hour: nh?.[s.station] ?? null }));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  count: forecasts.length,
                  ready: nh != null,
                  note: NEXT_HOUR_DOC,
                  accuracy: acc
                    ? {
                        as_of: acc.asOf,
                        window: spanText(acc, win),
                        note: "Measured live from the prediction log: each forecast checked against the gauge reading closest to its target time. Average miss in feet; direction = rising / falling / steady called right. Longer horizons are much less certain.",
                        by_horizon_h: Object.fromEntries(
                          [1, 3, 6, 12, 24].flatMap((h) => {
                            const f = figure(acc.overall, h, win);
                            return f ? [[h, { checks: f.n, gauges: f.gauges, average_miss_ft: f.maeFt, average_miss_if_no_change_ft: f.baseMaeFt, share_inside_stated_range_pct: f.inBandPct, range_width_ft: f.bandFt, direction_right_pct: f.dirPct, direction_right_if_always_steady_pct: f.dirSteadyPct }]] : [];
                          }),
                        ),
                        gauge_only_model_next_hour: (() => {
                          const f = newModelFigure(acc.overall, 1, win);
                          return f ? { since: acc.gaugeModelSince, checks: f.n, average_miss_ft: f.maeFt, average_miss_if_no_change_ft: f.baseMaeFt } : null;
                        })(),
                        details: "https://sl-water-levels.vercel.app/about#next-hour",
                      }
                    : { unavailable: true, details: "https://sl-water-levels.vercel.app/about#next-hour" },
                  forecasts,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    server.tool(
      "get_official_warnings",
      "Get the latest official flood and weather warnings (issued in the last 24 hours) from the Disaster Management Centre, Irrigation Department and Met Department that name our river basins or carry a warning level. Each has source, bulletin URL, issue time, basins named, severity (none/advisory/alert/minor flood/major flood/evacuation), a one-sentence summary and a confidence. Read by an AI model from the published bulletin PDFs, so check the linked bulletin. Returns an empty list with a reason when nothing is current or the feed is unavailable.",
      {
        basin: z.string().optional().describe("Optional basin filter, e.g. 'Kala Oya'"),
      },
      async ({ basin }) => {
        const result = await getOfficialWarnings();
        const warnings = basin ? warningsForBasin(result, basin) : result.warnings;
        return {
          content: [
            { type: "text", text: JSON.stringify({ warnings, count: warnings.length, reason: result.reason ?? null }, null, 2) },
          ],
        };
      },
    );

    server.tool(
      "get_reservoir_releases",
      "Get reservoirs that are releasing water right now and which of our river gauges are downstream. Each release has the reservoir, kind ('confirmed' = official numbers, 'reported' = only a news report of spill gates opened, never official), source (Irrigation Department, Mahaweli Authority or the news outlet), url, cusecs (about; null for a news-only report), gatesOpen, observedAt (the reading's date or the report time, Sri Lanka time), downstream gauge names and, per gauge, the measured travel time in hours where we have one (otherwise null). Official figures are daily readings, so observedAt may be hours old; news reports expire after 12 hours. Also returns per-source status. A release is not a flood by itself: compare with the gauge's alert level.",
      {
        basin: z.string().optional().describe("Optional basin filter, e.g. 'Deduru Oya'"),
        station: z.string().optional().describe("Optional gauge name, e.g. 'Moragaswewa': only releases upstream of it"),
      },
      async ({ basin, station }) => {
        const result = await getReleases();
        const b = basin?.trim().toLowerCase();
        const releases = result.releases
          .filter((r) => (b ? r.basin.toLowerCase() === b : true))
          .map((r) => {
            const gauges = (reservoirById(r.reservoirId)?.gauges ?? []).map((g) => ({
              station: g.station,
              basin: g.basin,
              travelHours: g.eta,
              confidence: g.confidence,
            }));
            return { ...r, gauges };
          })
          .filter((r) => (station ? r.gauges.some((g) => g.station.toLowerCase() === station.trim().toLowerCase()) : true));
        return {
          content: [{ type: "text", text: JSON.stringify({ releases, count: releases.length, sources: result.sources }, null, 2) }],
        };
      },
    );

    server.tool(
      "get_spill_watch",
      "Get the Mahaweli Authority's weekly 'possible to spill' windows (from the Water Management Secretariat weekly operational meeting PDF). Per reservoir: spillWindow {from,to} (Sri Lanka dates; the meeting expects spilling may happen in that window), state (upcoming / now / ended), plannedMcmPerDay, lastWeekMcm (water released last week, million cubic metres) and the raw remark. It is a weekly plan, not an observation and not a flood warning: gates may open earlier, later or not at all. The file is often published days after the meeting. Includes the meeting date and when the file was last modified.",
      {
        reservoir: z.string().optional().describe("Optional reservoir name filter, e.g. 'Upper Kotmale'"),
        includePast: z.boolean().optional().describe("Also list windows that ended more than a day ago (default false)"),
      },
      async ({ reservoir, includePast }) => {
        const w = await getWeeklyOutcome();
        if (!w.ok) return { content: [{ type: "text", text: JSON.stringify({ error: w.error }) }] };
        const q = reservoir?.trim().toLowerCase();
        const now = Date.now();
        const items = w.data.items
          .filter((i) => i.spillWindow && (includePast || windowState(i.spillWindow, now) !== "passed"))
          .filter((i) => (q ? i.name.toLowerCase().includes(q) : true))
          .map((i) => ({ ...i, state: windowState(i.spillWindow!, now) }));
        return {
          content: [{ type: "text", text: JSON.stringify({ meetingDate: w.data.meetingDate, nextWeek: w.data.nextWeek, lastModified: w.data.lastModified, source: WEEKLY_PDF, items, count: items.length }, null, 2) }],
        };
      },
    );
  },
  {},
  { basePath: "" },
);

export { handler as GET, handler as POST, handler as DELETE };
