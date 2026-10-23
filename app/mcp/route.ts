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
import { reservoirById } from "@/lib/reservoirs";

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
      "Get water-level (and rainfall where reported) readings for a single station. Returns up to the last `days` of readings (the source only retains ~7 days) plus alert / minor-flood / major-flood thresholds. Units vary by station — Kelani Ganga gauges are in feet; other basins may differ.",
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
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  station: data.station,
                  basin: data.basin,
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
      "Get every station in a basin ordered upstream → downstream (canonical order for known basins, longitude desc otherwise). For each station: current level, 3-hour trend rate, full 24h time series. Useful for spotting a flood wave moving down a river.",
      {
        basin: z.string().describe("Basin name, e.g. 'Kelani Ganga'"),
      },
      async ({ basin }) => {
        const raw = await fetchBasinSnapshot(basin);
        const ordered = orderStations(basin, raw);
        const summary = ordered.map((s, i) => {
          const status = statusFor(s.latest?.water_level ?? null, s.thresholds, s.latest?.ts);
          return {
            position:
              i === 0 ? "upstream" : i === ordered.length - 1 ? "downstream" : "midstream",
            station: s.station,
            latest_level: s.latest?.water_level ?? null,
            latest_ts: s.latest?.ts ?? null,
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
  },
  {},
  { basePath: "" },
);

export { handler as GET, handler as POST, handler as DELETE };
