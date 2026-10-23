import { ImageResponse } from "next/og";
import { getReservoir } from "@/lib/reservoirData";

export const alt = "Reservoir water level and spill today";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 600;

const PILL: Record<string, { bg: string; fg: string; text: string }> = {
  spilling: { bg: "#fcd34d", fg: "#451a03", text: "Spilling" },
  releasing: { bg: "#e0f2fe", fg: "#0c4a6e", text: "Releasing" },
  holding: { bg: "#e2e8f0", fg: "#1e293b", text: "Holding" },
  nodata: { bg: "#e2e8f0", fg: "#475569", text: "No recent data" },
};

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let name = slug.replace(/-/g, " ");
  let status = "nodata";
  let pct: number | null = null;
  let cusecs: number | null = null;
  try {
    const hit = await getReservoir(slug);
    if (hit) {
      name = hit.rv.name;
      status = hit.rv.status;
      pct = hit.rv.storage?.fresh ? Math.round(hit.rv.storage.pct) : null;
      cusecs = hit.rv.flow?.cusecs ?? null;
    }
  } catch {
    // generic card during an outage
  }
  const pill = PILL[status];
  const fill = pct == null ? 0 : Math.min(100, pct);
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", padding: 80, color: "#fff", background: "linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
          <div style={{ display: "flex", fontSize: 30, letterSpacing: 6, textTransform: "uppercase", opacity: 0.85 }}>Sri Lanka Water Levels</div>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 700, marginTop: 20, lineHeight: 1.05 }}>{name} reservoir</div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 40, fontSize: 40 }}>
            <div style={{ display: "flex", padding: "8px 28px", borderRadius: 999, background: pill.bg, color: pill.fg, fontWeight: 700 }}>{pill.text}</div>
            {cusecs != null && <div style={{ display: "flex", marginLeft: 28, opacity: 0.95 }}>{cusecs.toLocaleString("en-US")} cusecs</div>}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", width: 260 }}>
          <div style={{ display: "flex", position: "relative", width: 200, height: 300, border: "6px solid rgba(255,255,255,0.9)", borderRadius: 24, background: "rgba(255,255,255,0.12)", overflow: "hidden", alignItems: "flex-end" }}>
            <div style={{ display: "flex", width: "100%", height: `${fill}%`, background: "rgba(255,255,255,0.75)" }} />
          </div>
          <div style={{ display: "flex", fontSize: 56, fontWeight: 700, marginTop: 20 }}>{pct == null ? "—" : `${pct}% full`}</div>
        </div>
      </div>
    ),
    size,
  );
}
