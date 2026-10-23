"use client";

import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  Popup,
  ZoomControl,
  Polyline,
  Marker,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { Tier } from "@/lib/arcgis";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatLevel } from "@/lib/units";
import { stationDisplayName } from "@/lib/displayName";
import { matchLocation } from "@/lib/nearby";
import { TIER_HEX, tierLabel, type HomeStation } from "./tierUi";
import { useI18n } from "./LocaleProvider";
import { riverName } from "@/lib/i18n/format";
import { useLocation } from "./useLocation";
import { HOME_RIVERS, MAJOR_BASINS } from "@/lib/geo/homeRivers";
import { MapLabels } from "./MapLabels";
import { rtFor } from "@/lib/i18n/reservoirs";
import type { HomeLake } from "./MapClient";

type Props = {
  stations: HomeStation[];
  lakes: HomeLake[];
};

// Tight bounds around Sri Lanka so the user can't pan or zoom out to India.
// Bounds aspect (≈2.5°W × 4.4°H, portrait) is narrower than typical viewports,
// so we set explicit center+zoom for the initial view instead of fitting the
// bbox (which would pad horizontally and show Tamil Nadu).
const SL_CENTER: [number, number] = [7.6, 80.77];
const SL_ZOOM = 8;
// The whole island, framed on load; also the farthest the visitor can zoom out.
const SL_FIT: [[number, number], [number, number]] = [
  [5.6, 79.6],
  [9.85, 82.0],
];
const SL_BOUNDS: [[number, number], [number, number]] = [
  [5.4, 79.2],
  [10.4, 82.4],
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

const isHot = (s: HomeStation) =>
  s.tier === "watch" || s.tier === "alert" || s.tier === "minor" || s.tier === "major";

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

const inSriLanka = (lat: number, lon: number) =>
  lat >= SL_BOUNDS[0][0] && lat <= SL_BOUNDS[1][0] && lon >= SL_BOUNDS[0][1] && lon <= SL_BOUNDS[1][1];

/** Once per page load: frame the visitor and their nearest gauges. No continuous tracking. */
function FitToUser({ points }: { points: Array<[number, number]> | null }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (!points || done.current) return;
    done.current = true;
    map.fitBounds(points, { padding: [48, 48], maxZoom: 11, animate: false });
  }, [map, points]);
  return null;
}

/** Frame the whole island on load and on resize; that framing is also the minimum zoom. */
function FitIsland() {
  const map = useMap();
  useEffect(() => {
    const fit = () => {
      map.invalidateSize();
      map.setMinZoom(0);
      map.fitBounds(SL_FIT, { animate: false, padding: [2, 2] });
      map.setMinZoom(map.getZoom());
    };
    const refit = () => {
      if (map.getZoom() <= map.getMinZoom() + 0.01) fit();
    };
    fit();
    const later = window.setTimeout(refit, 400);
    map.on("resize", refit);
    return () => {
      window.clearTimeout(later);
      map.off("resize", refit);
    };
  }, [map]);
  return null;
}

/** The key, in a corner of the map: collapsed to a button on phones. */
function Key({ hasLakes, hasUser }: { hasLakes: boolean; hasUser: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(() => typeof window !== "undefined" && window.innerWidth >= 640);
  const tiers: Tier[] = ["normal", "watch", "alert", "minor", "major", "stale"];
  return (
    <div data-map-key className="absolute left-2 top-2 sm:bottom-2 sm:top-auto z-[1000] max-w-[calc(100%-4rem)] rounded-lg border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 text-[11px] leading-4 text-slate-700 dark:text-slate-200 shadow-sm backdrop-blur-sm">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-1.5 px-2.5 py-1.5 font-medium">
        {t("map.key")}
        <ChevronDown className={`size-3 transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden />
      </button>
      {open && (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1 px-2.5 pb-2 sm:grid-cols-3">
          {tiers.map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span className="size-2.5 shrink-0 rounded-full border border-white/70 dark:border-slate-900" style={{ background: TIER_HEX[k] }} aria-hidden />
              {k === "stale" ? t("tier.noData") : tierLabel(t, k)}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 shrink-0 rounded" style={{ background: "#38bdf8" }} aria-hidden />
            {t("map.river")}
          </li>
          {hasLakes && (
            <li className="col-span-2 flex items-center gap-1.5 sm:col-span-1">
              <span className="size-2.5 shrink-0 rounded-[40%] bg-amber-500" aria-hidden />
              {t("map.releasing")}
            </li>
          )}
          {hasUser && (
            <li className="flex items-center gap-1.5">
              <span className="size-2.5 shrink-0 rounded-full bg-blue-600" aria-hidden />
              {t("map.you")}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * One-finger drags scroll the page while the whole island is in view (nothing to pan to);
 * once the visitor zooms in, dragging pans the map. Stops the map trapping a phone's scroll.
 */
function TouchScrollGuard() {
  const map = useMap();
  useEffect(() => {
    const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    if (!coarse) return;
    const sync = () => (map.getZoom() > map.getMinZoom() ? map.dragging.enable() : map.dragging.disable());
    sync();
    map.on("zoomend", sync);
    return () => {
      map.off("zoomend", sync);
    };
  }, [map]);
  return null;
}

const LAKE_FILL = { spilling: "#f59e0b", releasing: "#0ea5e9" } as const;
const lakeIcon = (status: HomeLake["status"], stroke: string) =>
  L.divIcon({
    className: "",
    iconSize: [18, 14],
    iconAnchor: [9, 7],
    html: `<svg width="18" height="14" viewBox="-9 -7 18 14" aria-hidden="true"><path d="M-7 0.5C-7.5-4-2-6.5 2.5-5.5 7-5 8.5-1 6.5 3 4.5 6.5-3 6.8-5.8 4-6.8 2.6-7 1.4-7 0.5Z" fill="${LAKE_FILL[status]}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
  });

export function MapLeaflet({ stations, lakes }: Props) {
  const scheme = useColorScheme();
  const { lang, t, p } = useI18n();
  const rt = rtFor(lang);
  // On phones the whole island only fits one zoom level further out.
  const [zoom] = useState(() =>
    typeof window !== "undefined" && window.innerWidth < 640 ? SL_ZOOM - 1 : SL_ZOOM,
  );
  const tile = scheme === "dark" ? DARK_TILE : LIGHT_TILE;
  const { loc } = useLocation();
  const user = loc && inSriLanka(loc.lat, loc.lon) ? loc : null;
  const fit = useMemo(() => {
    if (!user) return null;
    const near = matchLocation(user, stations);
    const pts: Array<[number, number]> = [[user.lat, user.lon]];
    if (near) for (const g of [near.primary, ...near.others]) pts.push([g.latitude, g.longitude]);
    return pts;
  }, [user, stations]);

  return (
    <div className="relative h-full w-full">
    <MapContainer
      center={SL_CENTER}
      zoom={zoom}
      zoomSnap={0.25}
      zoomDelta={0.5}
      maxBounds={SL_BOUNDS}
      maxBoundsViscosity={1.0}
      minZoom={6}
      maxZoom={12}
      scrollWheelZoom={false}
      zoomControl={false}
      attributionControl={true}
      style={{ height: "100%", width: "100%", background: "transparent" }}
    >
      <ZoomControl position="bottomright" />
      <FitIsland />
      <FitToUser points={fit} />
      <TouchScrollGuard />
      <TileLayer
        key={scheme}
        attribution={tile.attribution}
        url={tile.url}
        maxZoom={16}
      />
      {/* the real rivers (OpenStreetMap), under the gauge dots */}
      {HOME_RIVERS.map((r, i) => {
        const major = MAJOR_BASINS.includes(r.basin);
        return (
          <Polyline
            key={i}
            positions={r.pts}
            pathOptions={{
              color: scheme === "dark" ? "#38bdf8" : "#7dd3fc",
              weight: major && r.main ? 2.4 : major ? 1.4 : 1.1,
              opacity: scheme === "dark" ? 0.7 : 0.95,
              lineCap: "round",
              lineJoin: "round",
            }}
            interactive={false}
          />
        );
      })}
      <MapLabels stations={stations} lakes={lakes} scheme={scheme} user={user} />
      {/* reservoirs releasing water right now */}
      {lakes.map((l) => (
        <Marker key={l.slug} position={[l.lat, l.lon]} icon={lakeIcon(l.status, scheme === "dark" ? "#0f172a" : "#ffffff")} keyboard={false}>
          <Tooltip direction="top" offset={[0, -6]} opacity={1}>
            <span className="font-medium">{l.name}</span>
            <span className="text-slate-500"> · {rt(`s.${l.status}` as "s.spilling")}</span>
          </Tooltip>
          <Popup>
            <Link href={p(l.href)} className="font-semibold text-sky-700 hover:underline block">{l.name}</Link>
            <div className="text-xs text-slate-500">{rt(`s.${l.status}` as "s.spilling")}</div>
          </Popup>
        </Marker>
      ))}
      {[...stations]
        // Draw the stations that matter last so they sit on top of grey dots.
        .sort((a, b) => Number(isHot(a)) - Number(isHot(b)))
        .map((s) => {
        const color = TIER_HEX[s.tier];
        const stroke = scheme === "dark" ? "#0f172a" : "#ffffff";
        return (
          <CircleMarker
            key={`${s.basin}|${s.station}`}
            center={[s.latitude, s.longitude]}
            radius={isHot(s) ? 8 : 6}
            pathOptions={{
              fillColor: color,
              fillOpacity: 0.95,
              color: stroke,
              weight: 2,
              opacity: 1,
            }}
          >
            <Tooltip direction="top" offset={[0, -6]} opacity={1}>
              <span className="font-medium">{stationDisplayName(s.station)}</span>
              <span className="text-slate-500">
                {s.level != null ? ` · ${formatLevel(s.level, s.unit)}` : ""} · {tierLabel(t, s.tier)}
              </span>
            </Tooltip>
            <Popup>
              <div className="space-y-0.5">
                <Link href={p(s.href)} className="font-semibold text-sky-700 hover:underline block">
                  {stationDisplayName(s.station)}
                </Link>
                <div className="text-xs text-slate-500">
                  {riverName(s.basin, lang)}
                  {s.level != null ? ` · ${formatLevel(s.level, s.unit)}` : ""} · {tierLabel(t, s.tier)}
                </div>
                <Link href={p(s.href)} className="text-xs text-sky-600 hover:underline inline-block mt-1">
                  {t("map.openStation")}
                </Link>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
      {user && (
        <>
          <CircleMarker
            center={[user.lat, user.lon]}
            radius={14}
            pathOptions={{ stroke: false, fillColor: "#3b82f6", fillOpacity: 0.18 }}
            interactive={false}
          />
          <CircleMarker
            center={[user.lat, user.lon]}
            radius={6}
            pathOptions={{ fillColor: "#2563eb", fillOpacity: 1, color: scheme === "dark" ? "#0f172a" : "#ffffff", weight: 2.5, opacity: 1 }}
          >
            <Tooltip direction="top" offset={[0, -6]} opacity={1}>
              <span className="font-medium">{t("map.you")}</span>
              <span className="text-slate-500"> · {t("map.about1km")}</span>
            </Tooltip>
          </CircleMarker>
        </>
      )}
    </MapContainer>
    <Key hasLakes={lakes.length > 0} hasUser={!!user} />
    </div>
  );
}
