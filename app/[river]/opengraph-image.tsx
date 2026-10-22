import { ImageResponse } from "next/og";
import { fetchBasinSnapshot, fetchStations, type Tier } from "@/lib/arcgis";
import { resolveBasin } from "@/lib/slug";

export const alt = "River water level today – live gauges";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 300;

const RANK: Record<Tier, number> = { major: 6, minor: 5, alert: 4, watch: 3, normal: 2, none: 1, stale: 0 };
const LABEL: Record<Tier, string> = {
  major: "Major flood",
  minor: "Minor flood",
  alert: "Alert",
  watch: "Approaching alert",
  normal: "Normal",
  none: "No flood levels set",
  stale: "Not reporting",
};
const COLOR: Record<Tier, string> = {
  major: "#dc2626",
  minor: "#ea580c",
  alert: "#ca8a04",
  watch: "#ca8a04",
  normal: "#16a34a",
  none: "#64748b",
  stale: "#64748b",
};

export default async function Image({ params }: { params: Promise<{ river: string }> }) {
  const { river } = await params;
  let basin = river.replace(/-/g, " ");
  let count = 0;
  let worst: Tier | null = null;
  try {
    const stations = await fetchStations();
    basin = resolveBasin(stations, river) ?? basin;
    const snap = await fetchBasinSnapshot(basin);
    count = snap.length;
    if (snap.length) worst = snap.reduce((a, b) => (RANK[b.tier] > RANK[a.tier] ? b : a)).tier;
  } catch {
    // Render a generic card during an outage rather than failing the image.
  }

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          padding: 80,
          color: "#fff",
          background: "linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)",
        }}
      >
        <div style={{ display: "flex", fontSize: 30, letterSpacing: 6, textTransform: "uppercase", opacity: 0.85 }}>
          Sri Lanka Water Levels
        </div>
        <div style={{ display: "flex", fontSize: 92, fontWeight: 700, marginTop: 20, lineHeight: 1.05 }}>
          {basin} water level today
        </div>
        <div style={{ display: "flex", alignItems: "center", marginTop: 40, fontSize: 40 }}>
          {count > 0 && <div style={{ display: "flex", opacity: 0.92 }}>{count} live river gauges</div>}
          {worst && (
            <div
              style={{
                display: "flex",
                marginLeft: count > 0 ? 36 : 0,
                padding: "8px 28px",
                borderRadius: 999,
                background: "#fff",
                color: COLOR[worst],
                fontWeight: 700,
              }}
            >
              {LABEL[worst]}
            </div>
          )}
        </div>
      </div>
    ),
    size,
  );
}
