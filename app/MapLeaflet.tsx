"use client";

import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  Popup,
  ZoomControl,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Station } from "@/lib/arcgis";
import { stationPath } from "@/lib/slug";

type Props = {
  stations: Station[];
  colorForBasin: Record<string, string>;
};

// Tight bounds around Sri Lanka so the user can't pan/zoom out to India.
// SW = south of Dondra Head; NE = north of Point Pedro & east of Trincomalee.
const SL_BOUNDS: [[number, number], [number, number]] = [
  [5.7, 79.5],
  [10.1, 82.0],
];

// CartoDB Voyager (warm/light) for light mode; CartoDB Dark Matter for dark.
// Both are free with attribution and far easier on the eye than OSM Standard,
// which is too saturated against our slate UI.
const LIGHT_TILE = {
  url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
};
const DARK_TILE = {
  url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
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

export function MapLeaflet({ stations, colorForBasin }: Props) {
  const scheme = useColorScheme();
  const tile = scheme === "dark" ? DARK_TILE : LIGHT_TILE;

  return (
    <MapContainer
      bounds={SL_BOUNDS}
      maxBounds={SL_BOUNDS}
      maxBoundsViscosity={1.0}
      minZoom={7}
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
        maxZoom={18}
      />
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
