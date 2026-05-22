import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  fetchStations,
  fetchStationData,
  fetchBasinSnapshot,
  statusFor,
} from "@/lib/arcgis";
import { orderStations } from "@/lib/basinOrder";

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
      "Get water-level (and rainfall where reported) readings for a single station. Returns up to the last `days` of readings plus alert / minor-flood / major-flood thresholds. Units vary by station — Kelani Ganga gauges are in feet; other basins may differ.",
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
        const status = statusFor(data.latest?.water_level ?? null, data.thresholds);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  station: data.station,
                  basin: data.basin,
                  status: status.label,
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
          const status = statusFor(s.latest?.water_level ?? null, s.thresholds);
          let ratePerHour: number | null = null;
          if (
            s.latest &&
            s.prior &&
            s.latest.water_level != null &&
            s.prior.water_level != null
          ) {
            const dt = (s.latest.ts - s.prior.ts) / 3_600_000;
            if (dt > 0) ratePerHour = (s.latest.water_level - s.prior.water_level) / dt;
          }
          return {
            position:
              i === 0 ? "upstream" : i === ordered.length - 1 ? "downstream" : "midstream",
            station: s.station,
            latest_level: s.latest?.water_level ?? null,
            latest_ts: s.latest?.ts ?? null,
            status: status.label,
            thresholds: s.thresholds,
            rate_per_hour_3h: ratePerHour,
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
  },
  {},
  { basePath: "" },
);

export { handler as GET, handler as POST, handler as DELETE };
