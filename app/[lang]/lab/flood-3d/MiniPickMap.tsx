"use client";
// The small "mark your spot" map in the "Is this right?" card (app/feedback/MarkSpot.tsx): base map and a pin only. No flood layer,
// level.webp, accuracy.json, gauges or search, so it is a fraction of the full map's weight. Reuses the full map's own MapLibre loader and
// base style. Two-finger pan (cooperative gestures) keeps the page scrollable. Tap to drop the pin, drag it to adjust.
import { useEffect, useRef } from "react";
import type { Map as MlMap, Marker } from "maplibre-gl";
import { loadBaseStyle } from "./mapStyle";
import { loadMl } from "./ml";
import { BOUNDS } from "@/lib/flood3dReports";

export type PickHelp = { win: string; mac: string; mobile: string };

export default function MiniPickMap({ center, pos, onPick, help, onFail }: { center: [number, number]; pos: { lat: number; lon: number } | null; onPick: (lat: number, lon: number) => void; help: PickHelp; onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const mk = useRef<Marker | null>(null);
  const pickRef = useRef(onPick);
  const posRef = useRef(pos);
  useEffect(() => { pickRef.current = onPick; posRef.current = pos; });

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const dark = document.documentElement.classList.contains("dark");
        const [ml, style] = await Promise.all([loadMl(), loadBaseStyle(dark)]);
        if (dead || !box.current) return;
        const map = new ml.Map({
          container: box.current, style: style as never, center, zoom: 15.5, maxBounds: [[BOUNDS.west, BOUNDS.south], [BOUNDS.east, BOUNDS.north]],
          attributionControl: { compact: true }, cooperativeGestures: true, dragRotate: false, pitchWithRotate: false,
          locale: { "CooperativeGesturesHandler.WindowsHelpText": help.win, "CooperativeGesturesHandler.MacHelpText": help.mac, "CooperativeGesturesHandler.MobileHelpText": help.mobile },
        });
        mapRef.current = map;
        // the credit stays the (i) button until tapped (MapLibre re-opens it on load; the same trick as the full map's embed)
        const a = box.current;
        let tapped = false;
        const shut = () => { const el = a.querySelector(".maplibregl-ctrl-attrib"); if (el && !tapped && el.classList.contains("maplibregl-compact-show")) { el.classList.remove("maplibregl-compact-show"); el.removeAttribute("open"); } };
        a.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest(".maplibregl-ctrl-attrib-button")) tapped = true; }, true);
        new MutationObserver(shut).observe(a, { subtree: true, attributes: true, attributeFilter: ["class", "open"], childList: true });
        shut();
        map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
        const place = (lat: number, lon: number) => {
          if (!mk.current) {
            const m = new ml.Marker({ draggable: true, color: "#0284c7" }).setLngLat([lon, lat]).addTo(map);
            m.on("dragend", () => { const q = m.getLngLat(); pickRef.current(q.lat, q.lng); });
            mk.current = m;
          } else mk.current.setLngLat([lon, lat]);
        };
        map.on("click", (e) => { place(e.lngLat.lat, e.lngLat.lng); pickRef.current(e.lngLat.lat, e.lngLat.lng); });
        map.on("load", () => { const p = posRef.current; if (p) place(p.lat, p.lon); });
        map.on("error", (e) => { if (!dead && /style|tiles\.openfreemap/i.test(String(e?.error?.message ?? ""))) onFail(); });
      } catch {
        if (!dead) onFail();
      }
    })();
    return () => { dead = true; mk.current = null; mapRef.current?.remove(); mapRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- builds the map once; centre and strings are read at creation
  }, []);

  // a position that arrives from outside the map (Use my location): drop the pin there and bring it into view
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pos) return;
    const at = mk.current?.getLngLat();
    if (at && Math.abs(at.lat - pos.lat) < 1e-9 && Math.abs(at.lng - pos.lon) < 1e-9) return;
    void loadMl().then((ml) => {
      if (!mapRef.current) return;
      if (!mk.current) {
        const m = new ml.Marker({ draggable: true, color: "#0284c7" }).setLngLat([pos.lon, pos.lat]).addTo(mapRef.current);
        m.on("dragend", () => { const q = m.getLngLat(); pickRef.current(q.lat, q.lng); });
        mk.current = m;
      } else mk.current.setLngLat([pos.lon, pos.lat]);
      mapRef.current.easeTo({ center: [pos.lon, pos.lat], zoom: Math.max(mapRef.current.getZoom(), 16), duration: 500 });
    });
  }, [pos]);

  return <div ref={box} className="h-full w-full" />;
}
