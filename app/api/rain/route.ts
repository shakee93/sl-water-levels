// Rain per river gauge right now, kept apart by source: what the gauge measured, and what the weather model forecasts for the
// catchment above it (deterministic and the heavier ensemble scenario, next 6 and 24 hours), plus the model's own estimate of the
// past hours. Read every 30 minutes by .github/workflows/gsmap-snapshot.yml, which appends it to rain-forecast/ on the `data`
// branch: the forecast AT ISSUE TIME cannot be recovered later (the Previous Runs API is a different thing), so this is the only
// way a future backtest can know what we thought would fall. Public data only.
import { connection } from "next/server";
import { getNational } from "@/lib/arcgis";
import { getForecastRainAll, measuredAtGauge } from "@/lib/stationRain";

export const maxDuration = 60;

const r1 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10) / 10);

export async function GET() {
  await connection();
  const now = Date.now();
  const [all, fc] = await Promise.all([getNational(), getForecastRainAll()]);
  const stations: Record<string, unknown> = {};
  for (const s of all) {
    const key = `${s.basin.trim()}/${s.station}`;
    const f = fc[key];
    const m = measuredAtGauge(s.station, s.trend24h, now);
    if (!f && !m) continue;
    stations[key] = {
      forecast: f
        ? { issuedAt: new Date(f.issuedAt).toISOString(), next6h: r1(f.next6h), next6hP90: r1(f.next6hP90), next24h: r1(f.next24h), next24hP90: r1(f.next24hP90), modelPast6h: r1(f.modelPast6h), modelPast24h: r1(f.modelPast24h) }
        : null,
      measured: m ? { endAt: new Date(m.endTs).toISOString(), mm1h: r1(m.mm1h), mm3h: r1(m.mm3h), mm24h: r1(m.mm24h) } : null,
    };
  }
  return Response.json(
    {
      generatedAt: new Date(now).toISOString(),
      note: "forecast = Open-Meteo catchment-mean rain for the next 6 / 24 h (p90 = heavier ensemble scenario); modelPast* is the model's estimate of the past hours, NOT a measurement; measured = the gauge's own sensor (null without a sensor).",
      stations,
    },
    { headers: { "Cache-Control": "public, s-maxage=300" } },
  );
}
