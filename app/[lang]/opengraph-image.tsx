import { ImageResponse } from "next/og";

export const alt = "Sri Lanka Water Levels – live river levels across Sri Lanka";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
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
          Department of Irrigation gauges
        </div>
        <div style={{ display: "flex", fontSize: 88, fontWeight: 700, marginTop: 20, lineHeight: 1.05 }}>
          Sri Lanka Water Levels
        </div>
        <div style={{ display: "flex", fontSize: 44, marginTop: 28, opacity: 0.92 }}>
          Live river levels across Sri Lanka
        </div>
      </div>
    ),
    size,
  );
}
