"use client";

import Link from "next/link";
import { useState } from "react";
import { MapPin, Loader2, AlertCircle, X } from "lucide-react";
import type { Station } from "@/lib/arcgis";

type StationWithCoords = Station & { latitude: number; longitude: number };

type State =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "results"; nearest: { station: StationWithCoords; km: number }[] }
  | { kind: "error"; message: string };

// Haversine distance in km between two lat/lon points.
function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function StationFinder({ stations }: { stations: StationWithCoords[] }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  function locate() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({ kind: "error", message: "Geolocation isn't available in this browser." });
      return;
    }
    setState({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const user = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        const ranked = stations
          .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
          .map((s) => ({
            station: s,
            km: distanceKm(user, { lat: s.latitude, lon: s.longitude }),
          }))
          .sort((a, b) => a.km - b.km)
          .slice(0, 3);
        setState({ kind: "results", nearest: ranked });
      },
      (err) => {
        const reason =
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied."
            : err.code === err.POSITION_UNAVAILABLE
              ? "Couldn't determine your location."
              : "Location request timed out.";
        setState({ kind: "error", message: reason });
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60_000 },
    );
  }

  function reset() {
    setState({ kind: "idle" });
  }

  return (
    <div className="text-xs">
      {state.kind === "idle" && (
        <button
          onClick={locate}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 px-2.5 py-1.5 font-medium text-slate-700 dark:text-slate-300 shadow-sm transition"
        >
          <MapPin className="size-3.5" />
          Find my nearest station
        </button>
      )}

      {state.kind === "locating" && (
        <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400 px-2.5 py-1.5">
          <Loader2 className="size-3.5 animate-spin" />
          Locating…
        </span>
      )}

      {state.kind === "error" && (
        <div className="inline-flex items-start gap-1.5 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1.5 text-amber-800 dark:text-amber-200">
          <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
          <span>{state.message}</span>
          <button onClick={reset} className="ml-2 underline">
            close
          </button>
        </div>
      )}

      {state.kind === "results" && (
        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden max-w-xs">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-medium">
              Nearest to you
            </span>
            <button
              onClick={reset}
              aria-label="Close"
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <ul>
            {state.nearest.map(({ station, km }, i) => (
              <li key={`${station.basin}|${station.station}`}>
                <Link
                  href={`/?station=${encodeURIComponent(station.station)}`}
                  className="flex items-baseline justify-between gap-3 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {i === 0 && "★ "}
                      {station.station}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      {station.basin || "—"}
                    </div>
                  </div>
                  <div className="tabular-nums text-xs text-slate-600 dark:text-slate-400 shrink-0">
                    {km.toFixed(1)} km
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="px-3 py-1.5 text-[10px] text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-800">
            Straight-line distance — your local river gauge may be further by road or downstream.
          </div>
        </div>
      )}
    </div>
  );
}
