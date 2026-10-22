"use client";

import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  Popup,
  ZoomControl,
  Polyline,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Station } from "@/lib/arcgis";
import { stationPath } from "@/lib/slug";

type Props = {
  stations: Station[];
  colorForBasin: Record<string, string>;
  basinChains: Record<string, Array<[number, number]>>;
};

// Tight bounds around Sri Lanka so the user can't pan or zoom out to India.
// Bounds aspect (≈2.5°W × 4.4°H, portrait) is narrower than typical viewports,
// so we set explicit center+zoom for the initial view instead of fitting the
// bbox (which would pad horizontally and show Tamil Nadu).
const SL_CENTER: [number, number] = [7.6, 80.77];
const SL_ZOOM = 8;
const SL_BOUNDS: [[number, number], [number, number]] = [
  [5.7, 79.5],
  [10.1, 82.0],
];

// Esri Light/Dark Gray Canvas. Free with attribution and no API key.
// (CARTO's basemaps.cartocdn.com started returning "API KEY REQUIRED"
// watermark tiles for keyless requests in Oct 2026, so we moved off it.)
// The muted grays sit well under our slate UI; the *_Reference overlay adds
// city/place labels on top of the base so stations have geographic context.
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const ESRI_ATTRIBUTION = "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors";
const LIGHT_TILE = {
  url: `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
  labels: `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
  attribution: ESRI_ATTRIBUTION,
};
const DARK_TILE = {
  url: `${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
  labels: `${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
  attribution: ESRI_ATTRIBUTION,
};

function useColorScheme(): "light" | "dark" {
  // Lazy initializer reads matchMedia synchronously on first render. MapLeaflet
  // only renders in the browser (dynamic-imported with ssr:false), so this is
  // safe — and it avoids the first-paint flash of light tiles in dark mode.
  const [scheme, setScheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined" || !window.matchMedia) return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setScheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return scheme;
}

export function MapLeaflet({ stations, colorForBasin, basinChains }: Props) {
  const scheme = useColorScheme();
  const tile = scheme === "dark" ? DARK_TILE : LIGHT_TILE;

  return (
    <MapContainer
      center={SL_CENTER}
      zoom={SL_ZOOM}
      maxBounds={SL_BOUNDS}
      maxBoundsViscosity={1.0}
      minZoom={SL_ZOOM}
      maxZoom={12}
      scrollWheelZoom={false}
      zoomControl={false}
      attributionControl={true}
      style={{ height: "100%", width: "100%", background: "transparent" }}
    >
      <ZoomControl position="bottomright" />
      <TileLayer
        key={scheme}
        attribution={tile.attribution}
        url={tile.url}
        maxZoom={16}
      />
      <TileLayer key={`${scheme}-labels`} url={tile.labels} maxZoom={16} />
      {Object.entries(basinChains).map(([basin, chain]) => {
        const color = colorForBasin[basin] || "#64748b";
        return (
          <Polyline
            key={`chain-${basin}`}
            positions={chain}
            pathOptions={{
              color,
              weight: 3,
              opacity: 0.65,
              lineCap: "round",
              lineJoin: "round",
            }}
            interactive={false}
          />
        );
      })}
      {stations.map((s) => {
        const color = colorForBasin[s.basin] || "#64748b";
        const stroke = scheme === "dark" ? "#0f172a" : "#ffffff";
        return (
          <CircleMarker
            key={`${s.basin}|${s.station}`}
            center={[s.latitude, s.longitude]}
            radius={6.5}
            pathOptions={{
              fillColor: color,
              fillOpacity: 0.95,
              color: stroke,
              weight: 2,
              opacity: 1,
            }}
          >
            <Tooltip direction="top" offset={[0, -6]} opacity={1}>
              <span className="font-medium">{s.station}</span>
              <span className="text-slate-500"> — {s.basin}</span>
            </Tooltip>
            <Popup>
              <div className="space-y-0.5">
                <Link
                  href={stationPath(s.basin, s.station)}
                  className="font-semibold text-sky-700 hover:underline block"
                >
                  {s.station}
                </Link>
                <div className="text-xs text-slate-500">{s.basin}</div>
                <Link
                  href={stationPath(s.basin, s.station)}
                  className="text-xs text-sky-600 hover:underline inline-block mt-1"
                >
                  Open station →
                </Link>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
