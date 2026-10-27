"use client";
// Unlisted test map (not in nav or sitemap, noindex): low ground shaded blue where the river would reach at a given Nagalagam Street level.
// MapLibre is loaded on demand. Data: /flood3d/*.json|png (static, built by scripts/flood3d), live gauges from our own /api/flood3d (polled
// every ~5 min while the tab is visible). The browser never calls ArcGIS or HMIS; map tiles come from OpenFreeMap and AWS Terrarium.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MlMap, CanvasSource, MapMouseEvent, Popup } from "maplibre-gl";
import { chanceClass, gaugeSpread, hanwellaMToNagFt, pWet, type Calibration, type Chance } from "./chance";

type Horizon = { h: number; level: number; low: number | null; high: number | null };
type Gauge = { station: string; levelFt: number | null; hourlyAt: string | null; marks: { alert: number | null; minor: number | null; major: number | null }; status: string; trend: string | null; changePerHourFt: number | null; fastFt: number | null; fastAt: string | null; horizons: Horizon[]; method: string | null };
type Live = { generatedAt: string; nagalagam: Gauge | null; hanwella: Gauge | null; hanwellaToNag: [number, number][] };
type Meta = { png: { w: number; h: number; west: number; east: number; south: number; north: number; deg: number }; chance_calibration: Calibration };

type Ml = typeof import("maplibre-gl");
const ML_VERSION = "5.24.0"; // files in /public/flood3d/ml are copied from the maplibre-gl@5.24.0 npm package (CSP build: no inline worker, works with Next)
let mlPromise: Promise<Ml> | null = null;
/** Loads MapLibre on demand from our own static files: nothing of it is in the page bundle. */
function loadMl(): Promise<Ml> {
  mlPromise ??= new Promise<Ml>((resolve, reject) => {
    const w = window as unknown as { maplibregl?: Ml };
    if (w.maplibregl) return resolve(w.maplibregl);
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = `/flood3d/ml/maplibre-gl.css?v=${ML_VERSION}`; document.head.appendChild(css);
    const sc = document.createElement("script"); sc.src = `/flood3d/ml/maplibre-gl-csp.js?v=${ML_VERSION}`; sc.async = true;
    sc.onload = () => { const ml = w.maplibregl!; ml.setWorkerUrl(`/flood3d/ml/maplibre-gl-csp-worker.js?v=${ML_VERSION}`); resolve(ml); };
    sc.onerror = () => { mlPromise = null; reject(new Error("The map library could not load.")); };
    document.head.appendChild(sc);
  });
  return mlPromise;
}

const POLL_MS = 5 * 60 * 1000;
const CENTER: [number, number] = [79.922, 6.955]; // Kelaniya
const STYLE = "https://tiles.openfreemap.org/styles/liberty";
const PX = { lo: 2, step: 10 }; // level.png: R = round((ft - 2) * 10) + 1

const clock = (iso: string | number | null) => (iso == null ? "" : new Date(iso).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Colombo" }).replace(" ", " "));
const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

export default function Flood3dMap() {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const popRef = useRef<Popup | null>(null);
  const grid = useRef<{ L: Float32Array; hw: Float32Array; cls: Uint8Array; band: Uint8Array; river: Uint8Array; w: number; h: number } | null>(null);
  const meta = useRef<Meta | null>(null);
  const cv = useRef<{ out: HTMLCanvasElement; a: HTMLCanvasElement; b: HTMLCanvasElement; tmp: HTMLCanvasElement; hatch: CanvasPattern | null; scale: number } | null>(null);
  const shown = useRef(3); // level currently drawn (animated)
  const raf = useRef(0);

  const [ready, setReady] = useState(false);
  // Full screen: the browser's Fullscreen API where it exists (desktop, Android); a fixed full-viewport layer otherwise (iPhone Safari
  // has no element fullscreen). Escape or the button leaves it; the map is resized after every change.
  const wrap = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const toggleFull = useCallback(() => {
    const el = wrap.current;
    if (!full) {
      setFull(true);
      el?.requestFullscreen?.().catch(() => {});
    } else {
      setFull(false);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  }, [full]);
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setFull(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("fullscreenchange", onFs); window.removeEventListener("keydown", onKey); };
  }, []);
  useEffect(() => {
    document.body.style.overflow = full ? "hidden" : "";
    const t = setTimeout(() => mapRef.current?.resize(), 60);
    return () => clearTimeout(t);
  }, [full]);
  const [err, setErr] = useState<string | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [driver, setDriver] = useState<"live" | "nag" | "han">("live");
  const [whatNag, setWhatNag] = useState(6);
  const [whatHan, setWhatHan] = useState(26);
  const [chanceOn, setChanceOn] = useState(false);
  const [horizon, setHorizon] = useState<0 | 3 | 6>(0);
  const [plain, setPlain] = useState(false);
  const [past, setPast] = useState(false);
  const [roadsOn, setRoadsOn] = useState(true);
  const [threeD, setThreeD] = useState(false);

  const table = useMemo<[number, number][]>(() => live?.hanwellaToNag ?? [[3, 2.6], [10, 7.4]], [live]);

  // ---- the level the map shows
  const liveNag = useMemo(() => {
    const n = live?.nagalagam, h = live?.hanwella;
    if (!n || n.levelFt == null) return null;
    let v = n.levelFt, est = false;
    if (h && h.fastFt != null && h.levelFt != null) {
      // Hanwella's 10-minute sensor moved since its hourly reading: carry that change down to Nagalagam at the table's slope (about 1 ft per m), capped
      const dM = (h.fastFt - h.levelFt) * 0.3048;
      const hm = h.fastFt * 0.3048;
      const slope = hanwellaMToNagFt(hm + 0.5, table) - hanwellaMToNagFt(hm - 0.5, table);
      v += Math.max(-1, Math.min(1, dM * slope)); est = Math.abs(dM) > 0.02;
    }
    return { ft: v, est };
  }, [live, table]);
  const level = driver === "live" ? liveNag?.ft ?? 3.7 : driver === "nag" ? whatNag : hanwellaMToNagFt(whatHan * 0.3048, table);
  const isLive = driver === "live";

  // Deep link for testing and sharing a view: ?lv=7.2 (what-if Nagalagam ft) &chance=6 (horizon h) &past=1 &plain=1 &d3=0|1
  const startView = useRef<[number, number, number] | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- reads the URL once on mount (client only, so no hydration mismatch) */
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const lv = q.get("lv"); if (lv && +lv >= 2 && +lv <= 12) { setDriver("nag"); setWhatNag(+lv); }
    const ch = q.get("chance"); if (ch !== null && !lv) { setChanceOn(true); setHorizon(([0, 3, 6].includes(+ch) ? +ch : 0) as 0 | 3 | 6); }
    if (q.get("past")) setPast(true);
    if (q.get("plain")) setPlain(true);
    const ll = q.get("ll")?.split(",").map(Number); if (ll && ll.length === 3 && ll.every(Number.isFinite)) startView.current = [ll[0], ll[1], ll[2]];
    if (q.has("d3")) forced3d.current = q.get("d3") === "1";
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  const forced3d = useRef<boolean | null>(null);

  // ---- poll our cached endpoint every ~5 min while visible
  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout> | undefined;
    const pull = async () => {
      let ok = false;
      try {
        const r = await fetch("/api/flood3d", { cache: "no-store" });
        if (r.ok) { const d = (await r.json()) as Live; ok = true; if (!stop) { setLive(d); setFetchedAt(Date.now()); } }
      } catch { /* keep the last good numbers */ }
      if (!stop && !document.hidden) timer = setTimeout(pull, ok ? POLL_MS : 20_000); // a cold server can miss its first answer: try again soon
    };
    const vis = () => {
      if (document.hidden) { if (timer) clearTimeout(timer); timer = undefined; }
      else { if (timer) clearTimeout(timer); void pull(); }
    };
    void pull();
    document.addEventListener("visibilitychange", vis);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => { stop = true; if (timer) clearTimeout(timer); clearInterval(tick); document.removeEventListener("visibilitychange", vis); };
  }, []);

  // ---- render the water canvas for a level
  const draw = useCallback((lv: number) => {
    const g = grid.current, c = cv.current, m = meta.current;
    if (!g || !c || !m) return;
    const { w, h, L, hw, cls, band, river } = g;
    const ia = c.a.getContext("2d")!.createImageData(w, h);
    const ib = c.b.getContext("2d")!.createImageData(w, h);
    const da = ia.data, db = ib.data;
    const horizonData = live?.nagalagam?.horizons.find((x) => x.h === horizon);
    const gs = chanceOn && isLive ? (horizon === 0 || !horizonData ? gaugeSpread(lv, null, null, 0) : gaugeSpread(horizonData.level + (lv - (live?.nagalagam?.levelFt ?? lv)), horizonData.low, horizonData.high, horizon)) : null;
    const cal = meta.current!.chance_calibration;
    const kBand = lv >= 7 ? 2 : lv >= 5 ? 1 : lv >= 4 ? 0 : -1; // plain elevation bands: alert 0-1 m, minor 0-2 m, major 0-3 m
    for (let i = 0; i < L.length; i++) {
      if (river[i]) continue;
      let r = 0, gg = 0, b = 0, a = 0;
      if (gs) {
        const ch = chanceClass(pWet(L[i], hw[i], gs), cal).cls;
        if (ch === "low") { r = 250; gg = 204; b = 21; a = 105; }
        else if (ch === "medium") { r = 249; gg = 115; b = 22; a = 150; }
        else if (ch === "high") { r = 220; gg = 38; b = 38; a = 175; }
      } else if (plain) {
        if (band[i] <= kBand) { r = 168; gg = 85; b = 247; a = 150; }
      } else if (L[i] <= lv) {
        const d = Math.min(3, lv - L[i]);
        r = 30 - d * 6; gg = 110 - d * 14; b = 210 - d * 10; a = 120 + d * 28;
      }
      if (!a) continue;
      const t = cls[i] === 0 ? db : da;
      const o = i * 4; t[o] = r; t[o + 1] = gg; t[o + 2] = b; t[o + 3] = a;
    }
    c.a.getContext("2d")!.putImageData(ia, 0, 0);
    c.b.getContext("2d")!.putImageData(ib, 0, 0);
    const o = c.out.getContext("2d")!;
    o.clearRect(0, 0, c.out.width, c.out.height);
    o.imageSmoothingEnabled = true; o.imageSmoothingQuality = "high";
    o.drawImage(c.a, 0, 0, c.out.width, c.out.height);
    // less certain (extrapolated) cells: hatched, so they cannot be read as solid water
    const t2 = c.tmp.getContext("2d")!;
    t2.globalCompositeOperation = "source-over"; t2.clearRect(0, 0, c.tmp.width, c.tmp.height);
    t2.imageSmoothingEnabled = true; t2.drawImage(c.b, 0, 0, c.tmp.width, c.tmp.height);
    if (c.hatch) { t2.globalCompositeOperation = "destination-out"; t2.fillStyle = c.hatch; t2.fillRect(0, 0, c.tmp.width, c.tmp.height); }
    o.drawImage(c.tmp, 0, 0);
    const src = mapRef.current?.getSource("f3d-water") as CanvasSource | undefined;
    if (src) { src.play(); requestAnimationFrame(() => requestAnimationFrame(() => src.pause())); }
  }, [chanceOn, isLive, horizon, plain, live]);

  const paintRoads = useCallback((lv: number) => {
    const map = mapRef.current;
    if (!map) return;
    const col: unknown = ["case", ["<=", ["get", "l"], lv], "#dc2626", ["<=", ["get", "l"], lv + 1], "#f97316", ["<=", ["get", "l"], lv + 2], "#fbbf24", "rgba(0,0,0,0)"];
    for (const id of ["roads-main", "roads-local"]) if (map.getLayer(id)) map.setPaintProperty(id, "line-color", col as never);
  }, []);

  // ---- animate to the new level (smooth rise / fall), redraw when other layers change
  useEffect(() => {
    if (!ready) return;
    cancelAnimationFrame(raf.current);
    const from = shown.current, to = level, t0 = performance.now(), dur = Math.abs(to - from) < 0.03 ? 0 : 1400;
    const step = (t: number) => {
      const k = dur ? Math.min(1, (t - t0) / dur) : 1, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      shown.current = from + (to - from) * e;
      draw(shown.current); paintRoads(shown.current);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [ready, level, draw, paintRoads]);

  // ---- layer toggles
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const vis = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    vis("roads-main", roadsOn); vis("roads-local", roadsOn); vis("past-fill", past); vis("past-line", past);
  }, [ready, roadsOn, past]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (threeD) { map.setTerrain({ source: "dem", exaggeration: 2.5 }); map.easeTo({ pitch: 58, bearing: -25, duration: 900 }); }
    else { map.setTerrain(null); map.easeTo({ pitch: 0, bearing: 0, duration: 700 }); }
  }, [ready, threeD]);

  // ---- build the map once, lazily
  useEffect(() => {
    let dead = false;
    let map: MlMap | null = null;
    (async () => {
      try {
        const [ml, m, png] = await Promise.all([loadMl(), fetch("/flood3d/accuracy.json").then((r) => r.json() as Promise<Meta>), loadGrid()]);
        if (dead || !box.current) return;
        meta.current = m; grid.current = png;
        const phone = window.innerWidth < 768;
        const scale = phone ? 2 : 3;
        const mk = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
        const out = mk(png.w * scale, png.h * scale), tmp = mk(png.w * scale, png.h * scale);
        const tile = mk(7, 7); const tc = tile.getContext("2d")!; tc.strokeStyle = "#000"; tc.lineWidth = 2.4; tc.beginPath(); tc.moveTo(-1, 8); tc.lineTo(8, -1); tc.stroke();
        cv.current = { out, tmp, a: mk(png.w, png.h), b: mk(png.w, png.h), hatch: tmp.getContext("2d")!.createPattern(tile, "repeat"), scale };
        map = new ml.Map({ container: box.current, style: STYLE, center: CENTER, zoom: phone ? 12.4 : 13, pitch: 0, maxPitch: 70, attributionControl: { compact: true }, maxBounds: [[79.78, 6.8], [80.16, 7.06]] });
        mapRef.current = map;
        if (new URLSearchParams(location.search).has("debug")) (window as unknown as { __f3d?: unknown }).__f3d = { map, cv: cv.current, grid: grid.current };
        map.addControl(new ml.NavigationControl({ visualizePitch: true }), "top-right");
        map.on("style.load", () => {
          if (dead || !map) return;
          const { west, east, south, north } = m.png;
          map.addSource("dem", { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: 256, maxzoom: 14, attribution: "Terrain: Mapzen/AWS Terrain Tiles (incl. Copernicus DEM)" });
          map.addSource("f3d-water", { type: "canvas", canvas: out, coordinates: [[west, north], [east, north], [east, south], [west, south]], animate: false });
          const before = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
          map.addLayer({ id: "f3d-water", type: "raster", source: "f3d-water", paint: { "raster-opacity": 0.85, "raster-fade-duration": 0, "raster-resampling": "linear" } }, before);
          map.addSource("past", { type: "geojson", data: "/flood3d/ems-2025.json" });
          map.addLayer({ id: "past-fill", type: "fill", source: "past", paint: { "fill-color": "#7c3aed", "fill-opacity": 0.18 }, layout: { visibility: "none" } }, before);
          map.addLayer({ id: "past-line", type: "line", source: "past", paint: { "line-color": "#6d28d9", "line-width": 1.2, "line-dasharray": [3, 2] }, layout: { visibility: "none" } }, before);
          const lw: unknown = ["interpolate", ["linear"], ["zoom"], 11, 1.2, 15, 4];
          map.addSource("roads-main", { type: "geojson", data: "/flood3d/roads-main.json" });
          map.addLayer({ id: "roads-main", type: "line", source: "roads-main", paint: { "line-color": "rgba(0,0,0,0)", "line-width": lw as never, "line-dasharray": [1, 0] }, layout: { "line-cap": "round" } });
          map.addSource("roads-local", { type: "geojson", data: "/flood3d/roads-local.json" });
          map.addLayer({ id: "roads-local", type: "line", source: "roads-local", minzoom: 13, paint: { "line-color": "rgba(0,0,0,0)", "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1, 16, 3] as never }, layout: { "line-cap": "round" } });
          map.on("click", (ev) => tapRef.current?.(ev));
          for (const id of ["roads-main", "roads-local"]) { map.on("mouseenter", id, () => (map!.getCanvas().style.cursor = "pointer")); map.on("mouseleave", id, () => (map!.getCanvas().style.cursor = "")); }
          if (startView.current) map.jumpTo({ center: [startView.current[0], startView.current[1]], zoom: startView.current[2] });
          setThreeD(forced3d.current ?? !phone);
          setReady(true);
        });
        map.on("error", (e) => { if (!dead && /style|tiles\.openfreemap/i.test(String(e?.error?.message ?? ""))) setErr("The base map could not load."); });
      } catch (e) {
        if (!dead) setErr(e instanceof Error ? e.message : "The map could not start.");
      }
    })();
    return () => { dead = true; cancelAnimationFrame(raf.current); popRef.current?.remove(); map?.remove(); mapRef.current = null; };
  }, []);

  // ---- tap: road name + level, or what the water here does
  const stateRef = useRef({ level, isLive, live, horizon });
  useEffect(() => { stateRef.current = { level, isLive, live, horizon }; });
  const tapRef = useRef<((ev: MapMouseEvent) => void) | null>(null);
  // eslint-disable-next-line react-hooks/immutability -- latest-callback ref for the map click handler
  useEffect(() => { tapRef.current = (ev: MapMouseEvent) => {
    const map = mapRef.current, g = grid.current, m = meta.current;
    if (!map || !g || !m) return;
    const st = stateRef.current;
    const lines = document.createElement("div"); lines.style.cssText = "font:13px/1.4 system-ui,sans-serif;max-width:250px;color:#0f172a";
    const add = (t: string, bold = false) => { const p = document.createElement("p"); p.textContent = t; p.style.margin = "2px 0"; if (bold) p.style.fontWeight = "600"; lines.appendChild(p); };
    const road = map.queryRenderedFeatures(ev.point, { layers: ["roads-main", "roads-local"].filter((i) => map.getLayer(i)) })[0];
    if (road && road.properties && road.properties.l != null) {
      const l = Number(road.properties.l);
      add(String(road.properties.n || "Unnamed road"), true);
      add(`${road.properties.br ? "Bridge or tunnel. " : ""}Low section: the ground here is covered when Nagalagam Street reaches about ${f1(l)} ft (estimate from 30 m elevation).`);
    } else {
      const ix = Math.floor((ev.lngLat.lng - m.png.west) / m.png.deg), iy = Math.floor((m.png.north - ev.lngLat.lat) / m.png.deg);
      if (ix < 0 || iy < 0 || ix >= g.w || iy >= g.h) return;
      const i = iy * g.w + ix;
      if (g.river[i]) add("River or canal.");
      else if (!Number.isFinite(g.L[i])) add("Not expected to flood from the river at any level seen so far (estimate).");
      else {
        const L = g.L[i], hw = g.hw[i], cls = g.cls[i];
        const lo = Math.max(2, L - hw), hi = L + hw;
        const kind = cls === 2 ? "backed by a satellite flood map" : cls === 1 ? "interpolated between past floods" : "a guess beyond the floods we have maps for";
        add(`Floods when Nagalagam Street reaches about ${f1(L)} ft`, true);
        add(`Estimate, range ${f1(lo)} to ${f1(hi)} ft (${kind}).`);
        const nag = st.live?.nagalagam;
        if (st.isLive && nag?.levelFt != null) {
          const hz = st.horizon === 0 ? 6 : st.horizon;
          const hd = nag.horizons.find((x) => x.h === hz);
          const gs = hd ? gaugeSpread(hd.level, hd.low, hd.high, hz) : gaugeSpread(nag.levelFt, null, null, hz);
          const best = Math.max(pWet(L, hw, gs), pWet(L, hw, gaugeSpread(nag.levelFt, null, null, 0)));
          const c = chanceClass(best, m.chance_calibration);
          console.info("[flood3d] chance of water", { rawP: Math.round(best * 1000) / 1000, calibrated: Math.round(c.p * 1000) / 1000, class: c.cls, cellLevelFt: f1(L), halfWidthFt: hw });
          const word: Record<Chance, string> = { none: "very low", low: "low", medium: "medium", high: "high" };
          add(`Chance of water here in the next 6 hours: ${word[c.cls]}.`);
          add(`River now ${f1(st.level)} ft${nag.trend ? ` and ${nag.trend}` : ""}.`);
        } else add(`At ${f1(st.level)} ft this spot would be ${L <= st.level ? "under water" : "dry"}.`);
      }
    }
    popRef.current?.remove();
    void loadMl().then((ml) => { popRef.current = new ml.Popup({ closeButton: true, maxWidth: "270px" }).setLngLat(ev.lngLat).setDOMContent(lines).addTo(map); });
  }; });

  const secs = fetchedAt ? Math.max(0, Math.round((POLL_MS - (now - fetchedAt)) / 60000)) : null;
  const nag = live?.nagalagam, han = live?.hanwella;
  const marks = nag?.marks;

  return (
    <div className="space-y-3">
      <div ref={wrap} className={full ? "fixed inset-0 z-[70] bg-slate-100 dark:bg-slate-950" : "relative"}>
        <div ref={box} className={full ? "h-full w-full" : "h-[62vh] min-h-[380px] w-full overflow-hidden rounded-lg border border-slate-300 bg-slate-100 dark:border-slate-700"} data-testid="flood3d-map" />
        <button
          type="button"
          onClick={toggleFull}
          aria-pressed={full}
          className="absolute left-2 top-2 z-10 rounded-md bg-white/95 px-3 py-2 text-xs font-medium text-slate-800 shadow hover:bg-white dark:bg-slate-900/95 dark:text-slate-100"
          style={full ? { top: "calc(env(safe-area-inset-top, 0px) + 8px)", left: "calc(env(safe-area-inset-left, 0px) + 8px)" } : undefined}
        >
          {full ? "Exit full screen" : "Full screen"}
        </button>
        {!ready && !err && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-500">Loading map…</div>}
        {err && <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-red-700">{err}</div>}
        <div className="pointer-events-none absolute bottom-6 left-2 rounded bg-white/90 px-2 py-1 text-[11px] leading-tight text-slate-700 shadow dark:bg-slate-900/90 dark:text-slate-200">
          <span className="mr-1 inline-block h-2.5 w-3 rounded-sm" style={{ background: "rgba(30,110,210,.75)" }} /> water at this river level{" "}
          <span className="mx-1 inline-block h-2.5 w-3 rounded-sm" style={{ background: "repeating-linear-gradient(135deg,rgba(30,110,210,.8) 0 2px,transparent 2px 5px)" }} /> less certain{" "}
          <span className="mx-1 inline-block h-1 w-3 bg-red-600" /> low road
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700" aria-live="polite">
        <p className="font-medium" data-testid="flood3d-now">
          {nag?.levelFt != null ? `Nagalagam Street ${f1(nag.levelFt)} ft` : "Nagalagam Street: no reading"}
          {han?.levelFt != null && <span className="font-normal text-slate-600 dark:text-slate-300"> · Hanwella {f1(han.fastFt ?? han.levelFt)} ft{han.fastFt != null ? " (10-min sensor)" : ""}</span>}
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          {fetchedAt ? `Updated ${clock(fetchedAt)} · next update in ~${secs && secs > 0 ? secs : 1} min` : "Loading the latest readings…"}
          {nag?.hourlyAt && ` · Nagalagam reading from ${clock(nag.hourlyAt)}`}
          {liveNag?.est && " · level between hourly readings estimated from Hanwella"}
        </p>
        {marks && <p className="text-xs text-slate-500">Official steps at Nagalagam: Alert {marks.alert} ft · Minor flood {marks.minor} ft · Major flood {marks.major} ft. This map never changes them.</p>}
      </div>

      <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">River level on the map</legend>
        <div className="flex flex-wrap gap-2">
          {([["live", "Live now"], ["nag", "What if Nagalagam reaches…"], ["han", "What if Hanwella reaches…"]] as const).map(([k, t]) => (
            <button key={k} type="button" onClick={() => { setDriver(k); if (k !== "live") setChanceOn(false); }} aria-pressed={driver === k} className={`rounded-full border px-3 py-1 text-xs ${driver === k ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300 dark:border-slate-600"}`}>{t}</button>
          ))}
        </div>
        {driver === "nag" && (
          <div>
            <input aria-label="Nagalagam Street level in feet" type="range" min={2} max={10} step={0.1} value={whatNag} onChange={(e) => setWhatNag(+e.target.value)} className="w-full" />
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold">{f1(whatNag)} ft</span>
              {marks && ([["Alert", marks.alert], ["Minor", marks.minor], ["Major", marks.major]] as const).map(([t, v]) => v != null && <button key={t} type="button" className="rounded border border-slate-300 px-2 py-0.5 dark:border-slate-600" onClick={() => setWhatNag(v)}>{t} {v} ft</button>)}
              <button type="button" className="rounded border border-slate-300 px-2 py-0.5 dark:border-slate-600" onClick={() => setWhatNag(8.4)}>Dec 2025 peak 8.4 ft</button>
            </div>
          </div>
        )}
        {driver === "han" && (
          <div>
            <input aria-label="Hanwella level in feet" type="range" min={10} max={36} step={0.5} value={whatHan} onChange={(e) => setWhatHan(+e.target.value)} className="w-full" />
            <p className="text-xs"><span className="font-semibold">Hanwella {f1(whatHan)} ft</span> is roughly <span className="font-semibold">{f1(level)} ft</span> at Nagalagam Street (rough pairing from the past year; Hanwella peaks about a day before Nagalagam).</p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs">
          <label className={`flex items-center gap-1 ${isLive ? "" : "opacity-50"}`}><input type="checkbox" disabled={!isLive} checked={chanceOn && isLive} onChange={(e) => { setChanceOn(e.target.checked); if (e.target.checked) setPlain(false); }} /> Chance of water</label>
          {chanceOn && isLive && (["0", "3", "6"] as const).map((h) => <button key={h} type="button" onClick={() => setHorizon(+h as 0 | 3 | 6)} aria-pressed={horizon === +h} className={`rounded-full border px-2 py-0.5 ${horizon === +h ? "border-orange-600 bg-orange-600 text-white" : "border-slate-300 dark:border-slate-600"}`}>{h === "0" ? "Now" : `+${h} h`}</button>)}
          <label className="flex items-center gap-1"><input type="checkbox" checked={roadsOn} onChange={(e) => setRoadsOn(e.target.checked)} /> Low roads</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={past} onChange={(e) => setPast(e.target.checked)} /> Real flood, 30 Nov 2025 (satellite)</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={plain} onChange={(e) => { setPlain(e.target.checked); if (e.target.checked) setChanceOn(false); }} /> Plain elevation bands (compare)</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={threeD} onChange={(e) => setThreeD(e.target.checked)} /> 3D</label>
        </div>
        {chanceOn && isLive && <p className="text-xs text-slate-600 dark:text-slate-400">Shading: yellow low, orange medium, red high chance of water by then. River-driven only; heavy local rain can flood streets without the river.</p>}
      </fieldset>
      {/* TODO(si, ta): translate once the test is promoted; English only for the MVP. */}
    </div>
  );
}

async function loadGrid() {
  const img = await createImageBitmap(await (await fetch("/flood3d/level.png")).blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const x = c.getContext("2d", { willReadFrequently: true })!; x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const n = c.width * c.height;
  const L = new Float32Array(n), hw = new Float32Array(n), cls = new Uint8Array(n), band = new Uint8Array(n), river = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    river[i] = r === 255 ? 1 : 0;
    L[i] = r === 0 || r === 255 ? Infinity : (r - 1) / PX.step + PX.lo;
    hw[i] = g / 10; cls[i] = b & 3; band[i] = b >> 2;
  }
  return { L, hw, cls, band, river, w: c.width, h: c.height };
}
