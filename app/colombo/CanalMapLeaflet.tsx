"use client";

// The interactive Colombo canal map (lazy chunk, loaded by CanalMap.tsx when near the screen).
// Base map: OpenStreetMap tiles. Canal lines, lakes: OpenStreetMap (lib/geo/colombo-canals.json, fetched once
// at build time). Basin outlines and gauge positions are APPROXIMATE (see lib/geo/colomboMap.ts and DOCS.md).
// Levels come from our own server (props), in feet. The browser never calls pub.curwsl.org.
import { Circle, CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronUp, Crosshair, Layers, Waves } from "lucide-react";
import { useI18n } from "../LocaleProvider";
import { useScheme } from "../useTheme";
import { clock } from "@/lib/i18n/format";
import { ccFor, type CC, type CKey } from "@/lib/i18n/colombo";
import { CURW_URL, type CanalState } from "@/lib/curwStatus";
import type { BasinId } from "@/lib/colombo";
import {
  BASIN_SHAPES, FLOOD_CIRCLES, GAUGE_POS, LINES, MAP_BOUNDS, NAGALAGAM, WATERS, WORKS, basinAt,
  type Line, type LL, type Work,
} from "@/lib/geo/colomboMap";
import type { CanalMapData, MapBasinData, MapGaugeData } from "./canalMapTypes";

type Sel =
  | { t: "basin"; id: BasinId }
  | { t: "line"; i: number }
  | { t: "gauge"; n: string }
  | { t: "work"; id: Work["id"] }
  | { t: "sea" }
  | { t: "nag" }
  | null;
type Layer = "canals" | "basins" | "gauges" | "works" | "floods";
const LAYERS: Layer[] = ["canals", "basins", "gauges", "works", "floods"];

const STATE_HEX: Record<CanalState, string> = { normal: "#059669", rising: "#d97706", higher: "#ea580c", lower: "#475569", learning: "#94a3b8", offline: "#94a3b8" };
const BASIN_HEX: Record<string, string> = { higher: "#f59e0b", normal: "#10b981", lower: "#64748b", learning: "#94a3b8", offline: "#94a3b8" };
const BASIN_ORDER: BasinId[] = ["kolonnawa", "north", "parliament", "wellawatta"];
const WEIGHT: Record<Line["k"], number> = { r: 5.5, c: 3, d: 1.7, s: 1.1, t: 1 };
// OpenStreetMap's own tiles (CARTO's now need an API key). Dark mode darkens them with a CSS filter.
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const ICON_PATH: Record<Work["kind"], string> = {
  pump: '<path d="M13 2 3 14h7l-1 8 10-12h-7z"/>',
  tunnel: '<path d="M3 21v-8a9 9 0 0 1 18 0v8"/><path d="M8 21v-7a4 4 0 0 1 8 0v7"/>',
  gate: '<path d="M4 3v18M20 3v18M4 8h16M4 14h16"/>',
};
const workIcon = (k: Work["kind"]) =>
  L.divIcon({
    className: "",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<span class="cc-work"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATH[k]}</svg></span>`,
  });

const css = `
.cc-work{display:grid;place-items:center;width:26px;height:26px;border-radius:9999px;background:#fff;color:#0f172a;border:2px solid #0369a1;box-shadow:0 1px 3px rgba(0,0,0,.35)}
.dark .cc-work{background:#0f172a;color:#e2e8f0;border-color:#38bdf8}
.cc-wlabel{font-size:11px;font-weight:600;padding:1px 5px}
.cc-blabel{background:transparent!important;border:0!important;box-shadow:none!important;color:#1e293b;font-weight:700;font-size:11px;letter-spacing:.03em;text-transform:uppercase;text-align:center;white-space:normal!important;width:96px;padding:0;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 5px #fff}
.cc-blabel:before{display:none!important}
.dark .cc-blabel{color:#f1f5f9;text-shadow:0 0 3px #0f172a,0 0 3px #0f172a,0 0 5px #0f172a}
.cc-flow{stroke-dasharray:0.1 13;animation:cc-flow 1.8s linear infinite}
@keyframes cc-flow{to{stroke-dashoffset:-13.1}}
@media (prefers-reduced-motion:reduce){.cc-flow{animation:none;stroke-dasharray:6 9}}
.cc-map .leaflet-container{font:inherit}
html .cc-map .leaflet-container{background:#e9edf1}
html.dark .cc-map .leaflet-container{background:#111827}
.cc-tiles{filter:grayscale(1) contrast(.5) brightness(1.22)}
.dark .cc-tiles{filter:grayscale(1) invert(1) contrast(.55) brightness(.7)}
`;

const fmtFt = (v: number | null | undefined) => (v == null ? "-" : v.toFixed(1));

/** Metres between two points (flat approximation, fine at city scale). */
const metres = (a: LL, b: LL) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * 0.993) * 111_200;

/** Creates the map panes and renderers once, then lets the layers draw. */
function Panes({ onReady }: { onReady: (r: { canvas: L.Canvas; svg: L.SVG }) => void }) {
  const map = useMap();
  useEffect(() => {
    const mk = (n: string, _z: number) => (map.getPane(n) ? map.getPane(n)! : map.createPane(n));
    mk("cc-basins", 410).style.zIndex = "410";
    mk("cc-water", 415).style.zIndex = "415";
    mk("cc-canals", 420).style.zIndex = "420";
    mk("cc-flow", 430).style.zIndex = "430";
    mk("cc-flood", 412).style.zIndex = "412";
    mk("cc-points", 450).style.zIndex = "450";
    map.attributionControl.setPrefix(false);
    onReady({ canvas: L.canvas({ pane: "cc-canals", tolerance: 9 }), svg: L.svg({ pane: "cc-flow", padding: 0.3 }) });
  }, [map, onReady]);
  return null;
}

/** Zoom to the selected basin, or back to the whole area; on phones one-finger drags scroll the page until zoomed in. */
function Camera({ target, resetKey }: { target: L.LatLngBoundsExpression | null; resetKey: number }) {
  const map = useMap();
  const base = useRef<number | null>(null);
  const lastFit = useRef(0);
  useEffect(() => {
    // on wide screens the "How Colombo drains" card floats over the right side: frame the system left of it
    const fit = (animate: boolean) => {
      map.invalidateSize();
      const wide = map.getSize().x >= 900;
      map.fitBounds(target ?? MAP_BOUNDS, { paddingTopLeft: [16, 16], paddingBottomRight: [wide ? 372 : 16, 16], animate });
      lastFit.current = map.getZoom();
    };
    fit(base.current != null);
    // the lazy chunk can mount before the box has its final size: frame again once it settles
    const first = base.current == null;
    const later = window.setTimeout(() => { if (first) { fit(false); base.current = map.getZoom(); } }, 350);
    if (first) base.current = map.getZoom();
    // a window resize re-frames the view unless the visitor has already zoomed or panned
    const onResize = () => { if (!target && Math.abs(map.getZoom() - lastFit.current) < 0.01) { fit(false); base.current = map.getZoom(); } };
    map.on("resize", onResize);
    return () => { window.clearTimeout(later); map.off("resize", onResize); };
  }, [map, target, resetKey]);
  useEffect(() => {
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    if (!coarse) return;
    const sync = () => (map.getZoom() > (base.current ?? 0) + 0.2 ? map.dragging.enable() : map.dragging.disable());
    sync();
    map.on("zoomend", sync);
    return () => void map.off("zoomend", sync);
  }, [map]);
  return null;
}

function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMap();
  useEffect(() => { onZoom(map.getZoom()); }, [map, onZoom]);
  useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  return null;
}

function Background({ onClear }: { onClear: () => void }) {
  useMapEvents({ click: onClear });
  return null;
}

function Spark({ g, label }: { g: MapGaugeData; label: string }) {
  const s = g.series;
  if (s.length < 3) return null;
  const lo = Math.min(...s.map((p) => p.ft)), hi = Math.max(...s.map((p) => p.ft));
  const span = Math.max(hi - lo, 0.4);
  const t0 = s[0].ms, t1 = s[s.length - 1].ms;
  const pts = s.map((p) => `${(((p.ms - t0) / Math.max(1, t1 - t0)) * 100).toFixed(1)},${(26 - ((p.ft - lo) / span) * 24).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 100 28" className="h-10 w-full" role="img" aria-label={label} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke" className="text-sky-700 dark:text-sky-300" />
    </svg>
  );
}

export function CanalMapLeaflet({ data }: { data: CanalMapData }) {
  const { lang, t, p } = useI18n();
  const cc = ccFor(lang);
  const scheme = useScheme();
  const dark = scheme === "dark";
  const [rend, setRend] = useState<{ canvas: L.Canvas; svg: L.SVG } | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [on, setOn] = useState<Record<Layer, boolean>>({ canals: true, basins: true, gauges: true, works: true, floods: false });
  const [resetKey, setResetKey] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<LL | null>(null);
  const [reduced, setReduced] = useState(false);
  const [zoom, setZoom] = useState(12);
  useEffect(() => {
    const m = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    setReduced(!!m?.matches);
  }, []);

  const gauge = useMemo(() => new Map(data.gauges.map((g) => [g.name, g])), [data.gauges]);
  const basin = useMemo(() => new Map(data.basins.map((b) => [b.id, b])), [data.basins]);
  const shape = useMemo(() => new Map(BASIN_SHAPES.map((b) => [b.id, b])), []);
  const selBasin: BasinId | null = sel?.t === "basin" ? sel.id : sel?.t === "line" ? LINES[sel.i].b : sel?.t === "gauge" ? GAUGE_POS.find((g) => g.n === sel.n)?.basin ?? null : null;
  const target = sel?.t === "basin" ? L.latLngBounds(shape.get(sel.id)!.ring) : null;
  const clear = useCallback(() => { setSel(null); setMsg(null); }, []);
  const reset = () => { setSel(null); setMsg(null); setMe(null); setResetKey((k) => k + 1); };
  const pick = useCallback((s: Sel) => { setMsg(null); setSel(s); }, []);
  const selId = sel?.t === "basin" ? sel.id : null;

  const towns = useMemo(() => data.basins.flatMap((b) => b.towns.map((x) => ({ ...x, basin: b.id }))).sort((a, b) => a.name.localeCompare(b.name)), [data.basins]);

  const locate = () => {
    if (!navigator.geolocation) return setMsg(cc("map.find.denied"));
    setBusy(true);
    setMsg(null);
    // Once, on this tap only. The position is used here and never stored or sent anywhere.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        const pt: LL = [pos.coords.latitude, pos.coords.longitude];
        const id = basinAt(pt);
        if (!id) { setMe(null); setSel(null); return setMsg(cc("map.find.outside")); }
        setMe(pt);
        setSel({ t: "basin", id });
        setMsg(cc("map.find.in", { name: basin.get(id)?.name ?? id }));
      },
      () => { setBusy(false); setMsg(cc("map.find.denied")); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  };

  const lineColor = dark ? "#38bdf8" : "#0284c7";
  const dim = (b: BasinId | null) => selBasin != null && b !== selBasin;
  const flowColor = "#bae6fd";

  return (
    <div className="cc-map" lang={lang}>
      <style>{css}</style>
      <p className="sr-only">{cc("map.sr")}</p>
      <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={cc("map.layers")}>
        <Layers className="size-4 text-slate-500 dark:text-slate-400" aria-hidden />
        {LAYERS.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={on[l]}
            onClick={() => setOn((o) => ({ ...o, [l]: !o[l] }))}
            className={`min-h-9 rounded-full border px-3 text-xs font-medium transition ${on[l] ? "border-sky-600 bg-sky-600 text-white dark:border-sky-400 dark:bg-sky-400 dark:text-slate-900" : "border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}
          >
            {cc(`map.l.${l}` as CKey)}
          </button>
        ))}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={locate} disabled={busy} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
          <Crosshair className="size-3.5" aria-hidden /> {busy ? cc("map.finding") : cc("map.find")}
        </button>
        <label className="sr-only" htmlFor="cc-town">{cc("map.pick")}</label>
        <select
          id="cc-town"
          value=""
          onChange={(e) => {
            const x = towns.find((q) => q.href === e.target.value);
            if (x) { setMe(null); pick({ t: "basin", id: x.basin }); }
          }}
          className="min-h-9 max-w-[11rem] rounded-full border border-slate-300 bg-white px-3 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="">{cc("map.pick")}</option>
          {towns.map((x) => <option key={x.href} value={x.href}>{x.name}</option>)}
        </select>
        {(sel || me) && (
          <button type="button" onClick={reset} className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-sky-700 underline underline-offset-2 dark:text-sky-300">
            <ArrowLeft className="size-3.5" aria-hidden /> {cc("map.reset")}
          </button>
        )}
      </div>
      {msg && <p role="status" className="mb-2 text-sm text-slate-800 dark:text-slate-200">{msg}</p>}

      <div className="relative">
        <div>
          <div className="relative h-[clamp(440px,65vh,560px)] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 lg:h-[clamp(520px,70vh,780px)]">
            <MapContainer
              center={[6.92, 79.89]}
              zoom={12}
              zoomSnap={0.25}
              zoomDelta={0.5}
              minZoom={10}
              maxZoom={17}
              maxBounds={[[6.78, 79.78], [7.05, 80.02]]}
              maxBoundsViscosity={0.8}
              scrollWheelZoom={false}
              attributionControl
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer url={TILE_URL} attribution="© OpenStreetMap contributors" maxZoom={19} className="cc-tiles" />
              <Panes onReady={setRend} />
              <Camera target={target} resetKey={resetKey} />
              <Background onClear={clear} />
              <ZoomWatcher onZoom={setZoom} />
              {rend && (
                <>
                  {/* areas, coloured by the basin's state now */}
                  {on.basins && BASIN_SHAPES.map((b) => {
                    const d = basin.get(b.id);
                    const isSel = sel?.t === "basin" && sel.id === b.id;
                    const hex = BASIN_HEX[d?.state ?? "offline"];
                    return (
                      <Polygon
                        key={b.id}
                        positions={b.ring}
                        pane="cc-canals"
                        renderer={rend.canvas}
                        bubblingMouseEvents={false}
                        pathOptions={{ color: hex, weight: isSel ? 3 : 1.5, dashArray: isSel ? undefined : "6 5", fillColor: hex, fillOpacity: selBasin && selBasin !== b.id ? 0.03 : isSel ? 0.34 : 0.2, opacity: selBasin && selBasin !== b.id ? 0.4 : 0.9 }}
                        eventHandlers={{ click: () => pick({ t: "basin", id: b.id }), add: (e) => (e.target as L.Polygon).bringToBack() }}
                      >
                        {!(selBasin && selBasin !== b.id) && (
                          <Tooltip permanent direction="center" opacity={1} className="cc-blabel">{(d?.name ?? b.id).split(" (")[0]}</Tooltip>
                        )}
                      </Polygon>
                    );
                  })}
                  {/* past flood: village divisions inside the mapped May 2016 Kelani flood */}
                  {on.floods && FLOOD_CIRCLES.map((c, i) => (
                    <Circle key={i} center={[c[0], c[1]]} radius={Math.max(c[2], 150)} pane="cc-flood" interactive={false} pathOptions={{ color: "#7c3aed", weight: 1, fillColor: "#8b5cf6", fillOpacity: 0.16, opacity: 0.55 }} />
                  ))}
                  {/* lakes and marshes */}
                  {on.canals && WATERS.map((w, i) => (
                    <Polygon key={i} positions={w.ring} pane="cc-water" interactive={false} pathOptions={{ stroke: false, fillColor: w.w ? (dark ? "#5eead4" : "#99f6e4") : dark ? "#38bdf8" : "#7dd3fc", fillOpacity: w.w ? 0.28 : 0.85 }}>
                    </Polygon>
                  ))}
                  {/* canal lines (OpenStreetMap) */}
                  {on.canals && LINES.map((l, i) => {
                    const isSel = sel?.t === "line" && sel.i === i;
                    const w = WEIGHT[l.k] + (l.k === "c" && l.n ? 0.8 : 0);
                    return (
                      <Polyline
                        key={i}
                        positions={l.pts}
                        pane="cc-canals"
                        renderer={rend.canvas}
                        bubblingMouseEvents={false}
                        pathOptions={{ color: isSel ? "#f97316" : lineColor, weight: isSel ? w + 3 : w, opacity: dim(l.b) ? 0.22 : isSel ? 1 : 0.9, lineCap: "round", lineJoin: "round" }}
                        eventHandlers={{
                          click: () => pick({ t: "line", i }),
                          mouseover: (e) => { if (!isSel) (e.target as L.Polyline).setStyle({ weight: w + 2.5, color: "#f97316" }); },
                          mouseout: (e) => { if (!isSel) (e.target as L.Polyline).setStyle({ weight: w, color: lineColor }); },
                        }}
                      >
                        {l.n && <Tooltip sticky direction="top" opacity={0.95}>{l.n}</Tooltip>}
                      </Polyline>
                    );
                  })}
                  {/* flow: moving dots along the main canals, towards their outfall (still dots when motion is reduced) */}
                  {on.canals && LINES.map((l, i) => l.flow && !dim(l.b) && (
                    <Polyline key={`f${i}`} positions={l.pts} pane="cc-flow" renderer={rend.svg} interactive={false} pathOptions={{ color: flowColor, weight: 2.2, opacity: reduced ? 0.7 : 0.95, lineCap: "round", className: "cc-flow" }} />
                  ))}
                  {/* CUrW gauges */}
                  {on.gauges && GAUGE_POS.filter((g) => g.n !== "Mutwal Inlet").map((g) => {
                    const d = gauge.get(g.n);
                    const state: CanalState = d?.state ?? "offline";
                    const isSel = sel?.t === "gauge" && sel.n === g.n;
                    return (
                      <CircleMarker
                        key={g.n}
                        center={[g.lat, g.lon]}
                        radius={isSel ? 9 : 6.5}
                        pane="cc-points"
                        bubblingMouseEvents={false}
                        pathOptions={{ fillColor: STATE_HEX[state], fillOpacity: state === "offline" || state === "learning" ? 0.55 : 0.95, color: isSel ? "#f97316" : dark ? "#0f172a" : "#ffffff", weight: isSel ? 3 : 2, opacity: dim(g.basin) ? 0.5 : 1 }}
                        eventHandlers={{ click: () => pick({ t: "gauge", n: g.n }) }}
                      >
                        <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                          <span className="font-medium">{g.n}</span>
                          <span className="text-slate-500">{d?.ft != null && state !== "offline" ? ` · ${fmtFt(d.ft)} ft` : ""} · {cc(`state.${state}` as CKey)}</span>
                        </Tooltip>
                      </CircleMarker>
                    );
                  })}
                  {/* the sea at Mutwal and the Nagalagam Street river gauge */}
                  {on.gauges && GAUGE_POS.filter((g) => g.n === "Mutwal Inlet").map((g) => (
                    <CircleMarker key="sea" center={[g.lat, g.lon]} radius={sel?.t === "sea" ? 10 : 8} pane="cc-points" bubblingMouseEvents={false} pathOptions={{ fillColor: "#0ea5e9", fillOpacity: 0.95, color: sel?.t === "sea" ? "#f97316" : dark ? "#0f172a" : "#fff", weight: 3 }} eventHandlers={{ click: () => pick({ t: "sea" }) }}>
                      <Tooltip direction="top" offset={[0, -6]} opacity={1}>{cc("map.sea.title")}{data.sea ? ` · ${fmtFt(data.sea.ft)} ft` : ""}</Tooltip>
                    </CircleMarker>
                  ))}
                  {on.gauges && (
                    <CircleMarker center={NAGALAGAM} radius={sel?.t === "nag" ? 10 : 8} pane="cc-points" bubblingMouseEvents={false} pathOptions={{ fillColor: "#1e3a8a", fillOpacity: 1, color: sel?.t === "nag" ? "#f97316" : dark ? "#bae6fd" : "#fff", weight: 3 }} eventHandlers={{ click: () => pick({ t: "nag" }) }}>
                      <Tooltip direction="top" offset={[0, -6]} opacity={1}>{cc("map.nag.title")}{data.nag ? ` · ${data.nag.level}` : ""}</Tooltip>
                    </CircleMarker>
                  )}
                  {/* flood-control works: static design context */}
                  {on.works && WORKS.filter((w) => w.id !== "nagalagam").map((w) => (
                    <Marker key={w.id} position={[w.lat, w.lon]} icon={workIcon(w.kind)} pane="cc-points" keyboard={false} bubblingMouseEvents={false} eventHandlers={{ click: () => pick({ t: "work", id: w.id }) }}>
                      <Tooltip key={zoom >= 14 ? "p" : "h"} permanent={zoom >= 14} direction="right" offset={[10, 0]} opacity={0.95} className="cc-wlabel">{cc(`work.${w.id}` as CKey)}</Tooltip>
                    </Marker>
                  ))}
                  {on.works && (() => { const w = WORKS.find((x) => x.id === "nagalagam")!; return (
                    <Marker position={[w.lat, w.lon]} icon={workIcon("gate")} pane="cc-points" keyboard={false} bubblingMouseEvents={false} eventHandlers={{ click: () => pick({ t: "work", id: w.id }) }}>
                      <Tooltip key={zoom >= 14 ? "p" : "h"} permanent={zoom >= 14} direction="left" offset={[-10, 0]} opacity={0.95} className="cc-wlabel">{cc("work.nagalagam")}</Tooltip>
                    </Marker>
                  ); })()}
                  {me && (
                    <>
                      <CircleMarker center={me} radius={14} interactive={false} pane="cc-points" pathOptions={{ stroke: false, fillColor: "#3b82f6", fillOpacity: 0.2 }} />
                      <CircleMarker center={me} radius={6} interactive={false} pane="cc-points" pathOptions={{ fillColor: "#2563eb", fillOpacity: 1, color: dark ? "#0f172a" : "#fff", weight: 2.5 }} />
                    </>
                  )}
                </>
              )}
            </MapContainer>
          </div>
        </div>
        <div className="mt-3 lg:absolute lg:right-3 lg:top-3 lg:z-[1000] lg:mt-0 lg:w-[340px]">
        <Panel data={data} cc={cc} sel={sel} setSel={pick} gauge={gauge} basin={basin} reset={reset} floods={on.floods} t={t} p={p} lang={lang} selId={selId} />
        </div>
      </div>
      <Legend cc={cc} floods={on.floods} />
      <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{cc("map.credit")} {cc("map.note")}</p>
    </div>
  );
}

function Dot({ hex, hollow }: { hex: string; hollow?: boolean }) {
  return <span className="inline-block size-2.5 shrink-0 rounded-full border border-white/70 dark:border-slate-900" style={{ background: hollow ? `${hex}88` : hex }} aria-hidden />;
}

function Legend({ cc, floods }: { cc: CC; floods: boolean }) {
  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">{cc("map.key")}</h3>
      <ul className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-slate-700 dark:text-slate-300 min-[420px]:grid-cols-2 lg:grid-cols-4">
        <li className="flex items-center gap-1.5"><Dot hex={STATE_HEX.normal} /> {cc("map.k.normal")}</li>
        <li className="flex items-center gap-1.5"><Dot hex={STATE_HEX.higher} /> {cc("map.k.higher")}</li>
        <li className="flex items-center gap-1.5"><Dot hex={STATE_HEX.lower} /> {cc("map.k.lower")}</li>
        <li className="flex items-center gap-1.5"><Dot hex={STATE_HEX.offline} hollow /> {cc("map.k.off")}</li>
        <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 shrink-0 rounded bg-sky-700 dark:bg-sky-300" aria-hidden /> {cc("map.k.canal")}</li>
        <li className="flex items-center gap-1.5"><span className="w-4 shrink-0 border-t-[3px] border-dotted border-sky-800 dark:border-sky-100" aria-hidden /> {cc("map.k.flow")}</li>
        <li className="flex items-center gap-1.5"><span className="h-3 w-4 shrink-0 rounded border border-dashed border-emerald-600 bg-emerald-500/20" aria-hidden /> {cc("map.k.basin")}</li>
        <li className="flex items-center gap-1.5"><span className="grid size-4 shrink-0 place-items-center rounded-full border-2 border-sky-700 bg-white text-[8px] dark:border-sky-300 dark:bg-slate-900" aria-hidden>⚡</span> {cc("map.k.work")}</li>
        <li className="flex items-center gap-1.5"><Dot hex="#0ea5e9" /> {cc("map.sea.title")}</li>
        <li className="flex items-center gap-1.5"><Dot hex="#1e3a8a" /> {cc("map.nag.title")}</li>
        {floods && <li className="flex items-center gap-1.5"><span className="size-3 shrink-0 rounded-full border border-violet-600 bg-violet-500/20" aria-hidden /> {cc("map.flood.title")}</li>}
      </ul>
    </div>
  );
}

const STATE_TONE: Record<string, string> = {
  higher: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 border-amber-300 dark:border-amber-800",
  rising: "bg-amber-50 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 border-amber-200 dark:border-amber-900",
  normal: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200 border-emerald-200 dark:border-emerald-900",
  lower: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700",
  learning: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700",
  offline: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-300 dark:border-slate-700",
};
const Chip = ({ state, cc }: { state: string; cc: CC }) => (
  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${STATE_TONE[state]}`}>{cc(`state.${state}` as CKey)}</span>
);

type PanelProps = {
  data: CanalMapData; cc: CC; sel: Sel; setSel: (s: Sel) => void; gauge: Map<string, MapGaugeData>; basin: Map<BasinId, MapBasinData>;
  reset: () => void; floods: boolean; t: ReturnType<typeof useI18n>["t"]; p: (path: string) => string; lang: string; selId: BasinId | null;
};

/** "How Colombo drains": follows whatever is selected on the map. */
function Panel({ data, cc, sel, setSel, gauge, basin, reset, floods, t, p }: PanelProps) {
  const [open, setOpen] = useState(true);
  const card = "rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900";
  const h = "flex items-center gap-1.5 text-sm font-semibold";
  const read = (ms: number | null) => (ms ? clock(ms, t) : "");
  const nearest = (pt: LL, b: BasinId | null): MapGaugeData | null => {
    let best: MapGaugeData | null = null, bd = 1500;
    for (const g of GAUGE_POS) {
      const d = gauge.get(g.n);
      if (!d || d.state === "offline" || d.state === "learning" || d.ft == null || g.n === "Mutwal Inlet") continue;
      if (b && g.basin && g.basin !== b) continue;
      const m = metres(pt, [g.lat, g.lon]);
      if (m < bd) { bd = m; best = d; }
    }
    return best;
  };
  const BasinButtons = () => (
    <ul className="mt-2 space-y-1.5">
      {BASIN_ORDER.map((id) => basin.get(id)).filter((b): b is MapBasinData => !!b).map((b) => (
        <li key={b.id}>
          <button type="button" onClick={() => setSel({ t: "basin", id: b.id })} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60">
            <span className="font-medium">{b.name}</span>
            <Chip state={b.state === "higher" ? "higher" : b.state} cc={cc} />
          </button>
        </li>
      ))}
    </ul>
  );
  const Back = () => (
    <button type="button" onClick={reset} className="mb-2 inline-flex min-h-9 items-center gap-1 text-xs font-medium text-sky-700 underline underline-offset-2 dark:text-sky-300">
      <ArrowLeft className="size-3.5" aria-hidden /> {cc("map.back")}
    </button>
  );
  let body: React.ReactNode;
  if (sel?.t === "basin") {
    const b = basin.get(sel.id);
    body = b && (
      <>
        <Back />
        <h3 className="text-base font-semibold">{b.name}</h3>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{cc("map.k.basin")}</p>
        <p className="mt-2 text-sm text-slate-800 dark:text-slate-200">{cc(`map.bstate.${b.state}` as CKey)}</p>
        <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{b.drain}</p>
        <p className="mt-2 text-sm font-medium">{cc("map.outfall", { to: cc(`map.out.${b.id}` as CKey) })}</p>
        <h4 className="mt-3 text-sm font-semibold">{cc("map.gaugesNow")}</h4>
        <ul className="mt-1 space-y-1">
          {b.gauges.map((n) => gauge.get(n)).filter((g): g is MapGaugeData => !!g).map((g) => (
            <li key={g.name}>
              <button type="button" onClick={() => setSel({ t: "gauge", n: g.name })} className="flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <span>{g.name}</span>
                <span className="flex items-center gap-2"><span className="tabular-nums text-slate-600 dark:text-slate-400">{g.state !== "offline" && g.ft != null ? `${fmtFt(g.ft)} ft` : ""}</span><Chip state={g.state} cc={cc} /></span>
              </button>
            </li>
          ))}
        </ul>
        <h4 className="mt-3 text-sm font-semibold">{cc("map.towns")}</h4>
        <p className="mt-1 flex flex-wrap gap-x-3 text-sm">
          {b.towns.map((x) => <Link key={x.href} href={p(x.href)} className="inline-block py-2 text-sky-700 underline underline-offset-2 hover:no-underline dark:text-sky-300">{x.name}</Link>)}
        </p>
      </>
    );
  } else if (sel?.t === "line") {
    const l = LINES[sel.i];
    const b = l.b ? basin.get(l.b) : null;
    const g = nearest(l.mid, l.b);
    body = (
      <>
        <Back />
        <h3 className="text-base font-semibold">{l.n ?? cc("map.unnamed", { kind: cc(`map.kind.${l.k}` as CKey) })}</h3>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{cc(`map.kind.${l.k}` as CKey)}</p>
        <p className="mt-2 text-sm">{b ? cc("map.areaOf", { name: b.name }) : cc("map.outside")}</p>
        {l.b && <p className="mt-1 text-sm">{cc("map.outfall", { to: cc(`map.out.${l.b}` as CKey) })}</p>}
        {l.flow && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{cc("map.flows")}</p>}
        <p className="mt-2 text-sm">{g ? cc("map.nearGauge", { name: g.name, ft: fmtFt(g.ft), time: read(g.observedMs) }) : cc("map.noGauge")}</p>
        {b && <button type="button" onClick={() => setSel({ t: "basin", id: b.id })} className="mt-2 min-h-9 text-sm font-medium text-sky-700 underline underline-offset-2 dark:text-sky-300">{b.name}</button>}
      </>
    );
  } else if (sel?.t === "gauge") {
    const g = gauge.get(sel.n);
    const pos = GAUGE_POS.find((x) => x.n === sel.n);
    const b = pos?.basin ? basin.get(pos.basin) : null;
    body = (
      <>
        <Back />
        <p className="text-xs text-slate-600 dark:text-slate-400">{cc("map.gauge.title")}</p>
        <div className="flex items-start justify-between gap-2"><h3 className="text-base font-semibold">{sel.n}</h3>{g && <Chip state={g.state} cc={cc} />}</div>
        {g && g.state !== "offline" && g.ft != null ? (
          <>
            <p className="mt-1 text-sm">{cc("map.ft", { ft: fmtFt(g.ft) })}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400">{cc("canal.read", { time: read(g.observedMs) })}</p>
            <div className="mt-2"><Spark g={g} label={`${sel.n}: ${cc("canal.spark")}`} /></div>
            <p className="text-xs text-slate-600 dark:text-slate-400">{cc("canal.spark")}</p>
          </>
        ) : g?.observedMs ? <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{cc("canal.read", { time: read(g.observedMs) })}</p> : null}
        {b && <p className="mt-2 text-sm">{cc("map.areaOf", { name: b.name })}</p>}
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{cc("map.gauge.approx")}</p>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{cc("canal.usual")}</p>
      </>
    );
  } else if (sel?.t === "work") {
    const w = WORKS.find((x) => x.id === sel.id)!;
    body = (
      <>
        <Back />
        <h3 className="text-base font-semibold">{cc(`work.${w.id}` as CKey)}</h3>
        <p className="mt-2 text-sm">{w.kind === "gate" ? cc("map.work.gate") : cc(`map.work.${w.kind}` as CKey, { cap: w.cap })}</p>
        {w.id === "northlock" && <p className="mt-1 text-sm">{cc("map.out.kolonnawa").replace(/^./, (c) => c.toUpperCase())}.</p>}
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{cc("map.work.note")}</p>
      </>
    );
  } else if (sel?.t === "sea") {
    body = (
      <>
        <Back />
        <h3 className="flex items-center gap-1.5 text-base font-semibold"><Waves className="size-4" aria-hidden /> {cc("map.sea.title")}</h3>
        {data.sea ? <p className="mt-2 text-sm">{cc("map.sea.line", { ft: fmtFt(data.sea.ft), trend: data.sea.trend ? cc(`tide.${data.sea.trend}` as CKey) : "", time: read(data.sea.observedMs) })}</p> : <p className="mt-2 text-sm">{cc("canal.none")}</p>}
        {data.nextHigh && <p className="mt-1 text-sm">{cc("map.sea.next", { times: data.nextHigh })}</p>}
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{cc("tide.basis")}</p>
      </>
    );
  } else if (sel?.t === "nag") {
    body = (
      <>
        <Back />
        <h3 className="text-base font-semibold">{cc("map.nag.title")}</h3>
        {data.nag ? <p className="mt-2 text-sm">{cc("map.nag.line", { level: data.nag.level, tier: data.nag.tier, time: read(data.nag.observedMs) })}</p> : null}
        <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{cc("map.nag.note")}</p>
      </>
    );
  } else {
    body = (
      <>
        <p className="text-sm text-slate-700 dark:text-slate-300">{cc("map.overview")}</p>
        <BasinButtons />
        {data.sea && (
          <button type="button" onClick={() => setSel({ t: "sea" })} className="mt-3 flex w-full items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-left text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
            <Waves className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span><span className="font-medium">{cc("map.sea.title")}</span><br />{cc("map.sea.line", { ft: fmtFt(data.sea.ft), trend: data.sea.trend ? cc(`tide.${data.sea.trend}` as CKey) : "", time: read(data.sea.observedMs) })}{data.nextHigh ? ` ${cc("map.sea.next", { times: data.nextHigh })}` : ""}</span>
          </button>
        )}
        {data.nag && (
          <button type="button" onClick={() => setSel({ t: "nag" })} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm dark:border-slate-800">
            <span className="font-medium">{cc("map.nag.title")}</span><br />{cc("map.nag.line", { level: data.nag.level, tier: data.nag.tier, time: read(data.nag.observedMs) })}
          </button>
        )}
        <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
          {cc("canal.credit")} · <a href={CURW_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:no-underline">{cc("canal.chart")}</a>
        </p>
      </>
    );
  }
  return (
    <aside className={`${card} lg:bg-white/95 lg:shadow-lg lg:backdrop-blur dark:lg:bg-slate-900/95`} aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <h2 className={h}><Waves className="size-4 text-sky-700 dark:text-sky-300" aria-hidden /> {cc("map.panel")}</h2>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={cc("map.panel")} className="hidden size-8 place-items-center rounded-full text-slate-600 hover:bg-slate-100 lg:grid dark:text-slate-300 dark:hover:bg-slate-800">
          <ChevronUp className={`size-4 transition-transform ${open ? "" : "rotate-180"}`} aria-hidden />
        </button>
      </div>
      <div className={`${open ? "" : "lg:hidden"} lg:max-h-[calc(clamp(520px,70vh,780px)-7rem)] lg:overflow-y-auto`}>
      <div className="mt-2">{body}</div>
      {floods && (
        <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-2.5 text-xs text-violet-950 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100">
          <p className="font-semibold">{cc("map.flood.title")}</p>
          <p className="mt-0.5">{cc("map.flood.note")}</p>
        </div>
      )}
      </div>
    </aside>
  );
}
