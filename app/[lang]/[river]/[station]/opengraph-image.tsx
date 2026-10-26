import { ImageResponse } from "next/og";
import { fetchBasinSnapshot, fetchStations, statusFor } from "@/lib/arcgis";
import { resolveStation } from "@/lib/slug";
import { stationDisplayName } from "@/lib/displayName";
import { formatLevel } from "@/lib/units";

export const revalidate = 60;
export const alt = "Live river water level";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const COLORS: Record<string, { bg: string; fg: string }> = {
  normal: { bg: "#d1fae5", fg: "#064e3b" },
  watch: { bg: "#d1fae5", fg: "#064e3b" }, // near alert reads Normal
  alert: { bg: "#fcd34d", fg: "#451a03" },
  minor: { bg: "#c2410c", fg: "#ffffff" },
  major: { bg: "#b91c1c", fg: "#ffffff" },
  none: { bg: "#e2e8f0", fg: "#1e293b" },
  stale: { bg: "#e2e8f0", fg: "#334155" },
};

const tf = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Colombo", hour: "numeric", minute: "2-digit", hour12: true });
const df = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", day: "numeric", month: "short" });

export default async function Image({ params }: { params: Promise<{ river: string; station: string }> }) {
  const { river, station: stationParam } = await params;
  let name = "Sri Lanka Water Levels";
  let basin = "";
  let levelText = "";
  let label = "";
  let tier = "stale";
  let when = "";
  try {
    const hit = resolveStation(await fetchStations(), river, stationParam);
    if (hit) {
      name = stationDisplayName(hit.station);
      basin = hit.basin.trim();
      const me = (await fetchBasinSnapshot(hit.basin)).find((s) => s.station === hit.station);
      if (me?.latest?.water_level != null) {
        const st = statusFor(me.latest.water_level, me.thresholds, me.latest.ts);
        tier = st.tier;
        label = st.tier === "stale" ? "Stale reading" : st.label;
        levelText = formatLevel(me.latest.water_level, me.unit);
        const t = tf.format(me.latest.ts).replace(/\s?(AM|PM)/, (_, m: string) => ` ${m.toLowerCase()}`);
        when = `Updated ${t}, ${df.format(me.latest.ts)}`;
      } else {
        label = "Not reporting";
      }
    }
  } catch {
    /* fall through to the generic card */
  }
  const c = COLORS[tier];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background: "linear-gradient(180deg, #f8fafc, #ffffff)",
          color: "#0f172a",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: 30, color: "#0369a1", fontWeight: 600 }}>
          Sri Lanka Water Levels
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 700, letterSpacing: -2 }}>{name}</div>
          <div style={{ display: "flex", fontSize: 38, color: "#475569", marginTop: 6 }}>{basin}</div>
          {levelText && (
            <div style={{ display: "flex", fontSize: 150, fontWeight: 700, marginTop: 24, letterSpacing: -3 }}>{levelText}</div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {label && (
            <div
              style={{
                display: "flex",
                fontSize: 38,
                fontWeight: 700,
                padding: "12px 32px",
                borderRadius: 999,
                background: c.bg,
                color: c.fg,
              }}
            >
              {label}
            </div>
          )}
          <div style={{ display: "flex", fontSize: 32, color: "#475569" }}>{when}</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
