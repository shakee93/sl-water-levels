"use client";

import { MapContainer, TileLayer, CircleMarker, Tooltip, Popup, ZoomControl } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import Link from "next/link";
import type { Station } from "@/lib/arcgis";
import { stationPath } from "@/lib/slug";

type Props = {
  stations: Station[];
  colorForBasin: Record<string, string>;
};

// Sri Lanka roughly fits a box [5.7, 79.5] - [10.0, 82.0].
const SL_CENTER: [number, number] = [7.85, 80.77];
const SL_ZOOM = 7;

export function MapLeaflet({ stations, colorForBasin }: Props) {
  return (
    <MapContainer
      center={SL_CENTER}
      zoom={SL_ZOOM}
      scrollWheelZoom={false}
      zoomControl={false}
      attributionControl={true}
      style={{ height: "100%", width: "100%", background: "transparent" }}
    >
      <ZoomControl position="bottomright" />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={18}
      />
      {stations.map((s) => {
        const color = colorForBasin[s.basin] || "#64748b";
        return (
          <CircleMarker
            key={`${s.basin}|${s.station}`}
            center={[s.latitude, s.longitude]}
            radius={6.5}
            pathOptions={{
              fillColor: color,
              fillOpacity: 0.95,
              color: "#ffffff",
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
