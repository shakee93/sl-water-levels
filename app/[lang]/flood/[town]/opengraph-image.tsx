import { ImageResponse } from "next/og";
import { placeBySlug } from "@/lib/places";
import { loadTownStates } from "@/lib/townData";

export const alt = "Town flood estimate: live river level and rain";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 600;

const PILL: Record<string, { bg: string; fg: string; text: string }> = {
  normal: { bg: "#d1fae5", fg: "#065f46", text: "Normal" },
  watch: { bg: "#e2e8f0", fg: "#1e293b", text: "Keep an eye on it" },
  alert: { bg: "#fcd34d", fg: "#451a03", text: "Get ready" },
  minor: { bg: "#fb923c", fg: "#431407", text: "Flooding likely" },
  major: { bg: "#ef4444", fg: "#ffffff", text: "Move to safety" },
  stale: { bg: "#e2e8f0", fg: "#475569", text: "Open for the estimate" },
};

export default async function Image({ params }: { params: Promise<{ town: string }> }) {
  const { town } = await params;
  const place = placeBySlug(town);
  const name = place?.name ?? town.replace(/-/g, " ");
  let tone = "stale";
  try {
    if (place) tone = (await loadTownStates([place], { street: false })).get(place.slug)?.tone ?? "stale";
  } catch {
    // generic card during an outage
  }
  const pill = PILL[tone] ?? PILL.stale;
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: "100%", height: "100%", padding: 80, color: "#fff", background: "linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)" }}>
        <div style={{ display: "flex", fontSize: 30, letterSpacing: 6, textTransform: "uppercase", opacity: 0.85 }}>Sri Lanka Water Levels</div>
        <div style={{ display: "flex", fontSize: 88, fontWeight: 700, marginTop: 20, lineHeight: 1.05 }}>Is {name} flooding?</div>
        <div style={{ display: "flex", alignItems: "center", marginTop: 44, fontSize: 40 }}>
          <div style={{ display: "flex", padding: "8px 28px", borderRadius: 999, background: pill.bg, color: pill.fg, fontWeight: 700 }}>{pill.text}</div>
          <div style={{ display: "flex", marginLeft: 28, opacity: 0.92 }}>Live river level, rain and warnings</div>
        </div>
      </div>
    ),
    size,
  );
}
