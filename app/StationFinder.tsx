"use client";

import Link from "next/link";
import { useState } from "react";
import { MapPin, Loader2, AlertCircle, X } from "lucide-react";
import type { Station } from "@/lib/arcgis";
import { stationPath } from "@/lib/slug";
import { locate as findMe } from "@/lib/locate";
import { trackEvent } from "@/lib/umami";
import { useI18n } from "./LocaleProvider";
import { riverName } from "@/lib/i18n/format";

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
  const { lang, t, p } = useI18n();

  function locate() {
    trackEvent("find_nearest_clicked");
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({ kind: "error", message: t("finder.errNoGeo") });
      return;
    }
    setState({ kind: "locating" });
    void findMe().then((r) => {
      if (!r.ok) {
        const reason = r.denied ? t("finder.errDenied") : r.code === 2 ? t("finder.errUnavailable") : t("finder.errTimeout");
        trackEvent("find_nearest_error", { code: r.code, retried: r.retried });
        setState({ kind: "error", message: reason });
        return;
      }
      const user = { lat: r.lat, lon: r.lon };
      const ranked = stations
        .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
        .map((s) => ({
          station: s,
          km: distanceKm(user, { lat: s.latitude, lon: s.longitude }),
        }))
        .sort((a, b) => a.km - b.km)
        .slice(0, 3);
      trackEvent("find_nearest_success", {
        nearest: ranked[0]?.station.station,
        nearest_km: ranked[0] ? Number(ranked[0].km.toFixed(1)) : undefined,
        retried: r.retried,
      });
      setState({ kind: "results", nearest: ranked });
    });
  }

  function reset() {
    setState({ kind: "idle" });
  }

  return (
    <div className="text-sm">
      {state.kind === "idle" && (
        <button
          onClick={locate}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 px-3 h-11 sm:h-9 text-sm font-medium text-slate-700 dark:text-slate-300 shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          <MapPin className="size-3.5" />
          {t("finder.button")}
        </button>
      )}

      {state.kind === "locating" && (
        <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400 px-2.5 py-1.5">
          <Loader2 className="size-3.5 animate-spin" />
          {t("finder.locating")}
        </span>
      )}

      {state.kind === "error" && (
        <div className="inline-flex items-start gap-1.5 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1.5 text-amber-800 dark:text-amber-200">
          <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
          <span>{state.message}</span>
          <button onClick={reset} className="ml-2 underline min-h-11 sm:min-h-0 px-1">
            {t("common.closeLower")}
          </button>
        </div>
      )}

      {state.kind === "results" && (
        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden max-w-xs">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {t("finder.nearest")}
            </span>
            <button
              onClick={reset}
              aria-label={t("common.close")}
              className="grid place-items-center size-11 -mr-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <ul>
            {state.nearest.map(({ station, km }, i) => (
              <li key={`${station.basin}|${station.station}`}>
                <Link
                  href={p(stationPath(station.basin, station.station))}
                  onClick={() =>
                    trackEvent("nearest_station_clicked", {
                      basin: station.basin?.trim() || "(unknown)",
                      station: station.station,
                      rank: i + 1,
                    })
                  }
                  className="flex items-center justify-between gap-3 px-3 min-h-12 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {i === 0 && "★ "}
                      {station.station}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {station.basin ? riverName(station.basin, lang) : "—"}
                    </div>
                  </div>
                  <div className="tabular-nums text-xs text-slate-600 dark:text-slate-400 shrink-0">
                    {km.toFixed(1)} {t("unit.km")}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800">
            {t("finder.straight")}
          </div>
        </div>
      )}
    </div>
  );
}
