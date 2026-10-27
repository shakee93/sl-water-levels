"use client";
// Unlisted test map (not in nav or sitemap, noindex): low ground shaded blue where the river would reach at a given Nagalagam Street level.
// MapLibre is loaded on demand. Data: /flood3d/*.json|png (static, built by scripts/flood3d), live gauges from our own /api/flood3d (polled
// every ~5 min while the tab is visible). The browser never calls ArcGIS or HMIS; map tiles come from OpenFreeMap and AWS Terrarium.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MlMap, GeoJSONSource, CanvasSource, MapMouseEvent, Popup, GeolocateControl, Marker } from "maplibre-gl";
import { ReportPanel, type CellInfo, type RepPos } from "./ReportPanel";
import { chanceClass, gaugeSpread, hanwellaMToNagFt, pWet, type Calibration, type Chance } from "./chance";

type Horizon = { h: number; level: number; low: number | null; high: number | null };
type Gauge = { station: string; levelFt: number | null; hourlyAt: string | null; marks: { alert: number | null; minor: number | null; major: number | null }; status: string; trend: string | null; changePerHourFt: number | null; fastFt: number | null; fastAt: string | null; horizons: Horizon[]; method: string | null };
type MapGauge = { name: string; lat: number; lon: number; levelFt: number | null; status: string; statusLabel: string; trend: string | null; observedAt: string | null; url: string; fastFt: number | null };
type RainNow = { generatedAt: string; grid: { west: number; north: number; south: number; east: number; step: number; nx: number; ny: number }; v: string; satelliteHourStart: number | null; groundGauges: number; gauges: { n: string; i: string; lat: number; lon: number; mm1h: number | null; mm24h: number; ageMin: number }[]; credit: string };
const STEP_COLOR: Record<string, string> = { normal: "#16a34a", watch: "#ca8a04", alert: "#ea580c", minor: "#dc2626", major: "#7f1d1d", stale: "#64748b", none: "#64748b" };
type Live = { gauges?: MapGauge[]; generatedAt: string; nagalagam: Gauge | null; hanwella: Gauge | null; hanwellaToNag: [number, number][] };
type Meta = { png: { w: number; h: number; west: number; east: number; south: number; north: number; deg: number }; chance_calibration: Calibration; cover_bounds: [number, number, number, number]; reports_used?: Record<string, number> };

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

export type SearchItem = { n: string; lat: number; lon: number; al?: string[] };
type GazItem = [name: string, lat: number, lon: number, kind: number, si?: string, ta?: string];
const KIND_LABEL = ["place", "landmark", "road"];

export default function Flood3dMap({ towns = [], gauges = [] }: { towns?: SearchItem[]; gauges?: SearchItem[] }) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const popRef = useRef<Popup | null>(null);
  const grid = useRef<{ L: Float32Array; hw: Float32Array; cls: Uint8Array; band: Uint8Array; river: Uint8Array; unc: Uint8Array; w: number; h: number } | null>(null);
  const meta = useRef<Meta | null>(null);
  const cv = useRef<{ out: HTMLCanvasElement; a: HTMLCanvasElement; b: HTMLCanvasElement; tmp: HTMLCanvasElement; hatch: CanvasPattern | null; scale: number } | null>(null);
  const shown = useRef(3); // level currently drawn (animated)
  const raf = useRef(0);

  const [ready, setReady] = useState(false);
  // Full screen: the browser's Fullscreen API where it exists (desktop, Android); a fixed full-viewport layer otherwise (iPhone Safari
  // has no element fullscreen). Escape or the button leaves it; the map is resized after every change.
  const [panelOpen, setPanelOpen] = useState(true);
  const wrap = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const toggleFull = useCallback(() => {
    const el = wrap.current;
    if (!full) {
      setFull(true);
      setPanelOpen(window.innerWidth >= 768);
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
  const [waterOn, setWaterOn] = useState(true);
  const [gaugesOn, setGaugesOn] = useState(true);
  const [rainGaugesOn, setRainGaugesOn] = useState(false);
  const [rainOn, setRainOn] = useState(false);
  const [rain, setRain] = useState<RainNow | null>(null);
  const [rainErr, setRainErr] = useState(false);
  const rainCv = useRef<HTMLCanvasElement | null>(null);
  const rainFx = useRef<HTMLCanvasElement | null>(null);

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
    const { w, h, L, hw, cls, band, river, unc } = g;
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
      if (unc[i]) { r = 100; gg = 116; b = 139; a = 75; } // not covered yet: grey, never water
      else if (gs) {
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
    vis("f3d-water", waterOn); vis("roads-main", roadsOn); vis("roads-local", roadsOn); vis("past-fill", past); vis("past-line", past);
  }, [ready, roadsOn, past, waterOn]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (threeD) { map.setTerrain({ source: "dem", exaggeration: 2.5 }); map.easeTo({ pitch: 58, bearing: -25, duration: 900 }); }
    else { map.setTerrain(null); map.easeTo({ pitch: 0, bearing: 0, duration: 700 }); }
  }, [ready, threeD]);

  // ---- GPS ("Locate me", only on tap, after the consent line) and "Report here" (GPS spot or a dragged pin)
  const [rep, setRep] = useState<RepPos | null>(null);
  const [consentAsk, setConsentAsk] = useState(false);
  const [consented, setConsented] = useState(false);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [areas, setAreas] = useState<{ name: string; n: number | null }[]>([]);
  const [used, setUsed] = useState(0);
  const gps = useRef<{ lat: number; lon: number; acc: number } | null>(null);
  const geoRef = useRef<GeolocateControl | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const openReportRef = useRef<((p: RepPos) => void) | null>(null);
  useEffect(() => { openReportRef.current = (p) => { setRep(p); setPanelOpen(false); }; });
  useEffect(() => {
    fetch("/api/flood3d/report").then((r) => r.json()).then((d) => setAreas(d.areas ?? [])).catch(() => {});
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!rep) { markerRef.current?.remove(); markerRef.current = null; return; }
    if (markerRef.current) { markerRef.current.setLngLat([rep.lon, rep.lat]); return; }
    void loadMl().then((ml) => {
      if (markerRef.current || !mapRef.current) return;
      const mk = new ml.Marker({ draggable: true, color: "#0284c7" }).setLngLat([rep.lon, rep.lat]).addTo(mapRef.current);
      mk.on("dragend", () => { const q = mk.getLngLat(); setRep((r) => (r ? { lat: q.lat, lon: q.lng, src: "pin", acc: null } : r)); });
      markerRef.current = mk;
    });
  }, [rep, ready]);
  /* eslint-disable react-hooks/refs -- the grid is loaded once and never changes; reading it while rendering only decides labels */
  const cellAtLL = (lon: number, lat: number): CellInfo => {
    const g = grid.current, m = meta.current;
    if (!g || !m) return { covered: false, shaded: false, cellFt: null };
    const ix = Math.floor((lon - m.png.west) / m.png.deg), iy = Math.floor((m.png.north - lat) / m.png.deg);
    if (ix < 0 || iy < 0 || ix >= g.w || iy >= g.h) return { covered: false, shaded: false, cellFt: null };
    const i = iy * g.w + ix;
    if (g.unc[i]) return { covered: false, shaded: false, cellFt: null };
    const L = g.L[i];
    return { covered: true, shaded: Number.isFinite(L) && L <= level, cellFt: Number.isFinite(L) ? L : null };
  };
  const cell: CellInfo = rep ? cellAtLL(rep.lon, rep.lat) : { covered: false, shaded: false, cellFt: null };
  /* eslint-enable react-hooks/refs */
  const locate = () => { if (!consented) setConsentAsk(true); else { setGeoMsg(null); geoRef.current?.trigger(); } };
  const startReport = () => {
    const map = mapRef.current;
    if (!map) return;
    setPanelOpen(false);
    if (gps.current) setRep({ lat: gps.current.lat, lon: gps.current.lon, src: "gps", acc: gps.current.acc });
    else { const c = map.getCenter(); setRep({ lat: c.lat, lon: c.lng, src: "pin", acc: null }); }
  };

  // ---- river gauge markers (official step colour, level and trend), rain-gauge dots, rain now
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const arrow = (t: string | null) => (t == null ? "" : t.startsWith("rising") ? " ↑" : t === "falling" ? " ↓" : " →");
    const feats = (live?.gauges ?? []).map((g) => {
      const lv = g.fastFt ?? g.levelFt;
      return { type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [g.lon, g.lat] }, properties: { name: g.name, color: STEP_COLOR[g.status] ?? "#64748b", label: lv == null ? g.name : `${g.name.replace(" Street", "")} ${f1(lv)} ft${arrow(g.trend)}`, level: lv == null ? "no reading" : `${f1(lv)} ft`, fast: g.fastFt != null ? 1 : 0, statusLabel: g.statusLabel, trend: g.trend ?? "", url: g.url, at: g.observedAt ?? "" } };
    });
    (map.getSource("f3d-gauges") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: feats });
    for (const id of ["f3d-gauges", "f3d-gauges-label"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", gaugesOn ? "visible" : "none");
  }, [ready, live, gaugesOn]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const feats = (rain?.gauges ?? []).map((g) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [g.lon, g.lat] }, properties: { name: g.n, inst: g.i, mm: g.mm1h ?? -1, mm24: g.mm24h, age: g.ageMin, stale: g.ageMin > 60 ? 1 : 0 } }));
    (map.getSource("f3d-rain-gauges") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: feats });
    if (map.getLayer("f3d-rain-gauges")) map.setLayoutProperty("f3d-rain-gauges", "visibility", rainGaugesOn ? "visible" : "none");
    if (map.getLayer("f3d-rain")) map.setLayoutProperty("f3d-rain", "visibility", rainOn ? "visible" : "none");
  }, [ready, rain, rainGaugesOn, rainOn]);
  // rain data: only while one of the rain layers is on, on the same ~5 min rhythm, paused while the tab is hidden; our own endpoint only
  useEffect(() => {
    if (!rainOn && !rainGaugesOn) return;
    let stop = false, timer: ReturnType<typeof setTimeout> | undefined;
    const fake = new URLSearchParams(location.search).has("fakerain") && new URLSearchParams(location.search).has("debug");
    const pull = async () => {
      let ok = false;
      try {
        if (fake) { // test only (?debug=1&fakerain=1): a made-up shower over Kelaniya
          const nx = 36, ny = 20, v: string[] = [];
          for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) { const d = Math.hypot(c - 13, r - 9); v.push(d < 7 ? String(Math.round(120 * Math.exp(-d * d / 18))) : ""); }
          if (!stop) { setRain({ generatedAt: new Date().toISOString(), grid: { west: 79.79, north: 7.05, south: 6.85, east: 80.15, step: 0.01, nx, ny }, v: v.join(","), satelliteHourStart: null, groundGauges: 0, gauges: [], credit: "test data" }); setRainErr(false); }
          return;
        }
        const r = await fetch("/api/flood3d/rain", { cache: "no-store" });
        if (r.ok) { const d = (await r.json()) as RainNow; ok = true; if (!stop) { setRain(d); setRainErr(false); } } else if (!stop) setRainErr(true);
      } catch { if (!stop) setRainErr(true); }
      if (!stop && !document.hidden) timer = setTimeout(pull, ok ? POLL_MS : 30_000);
    };
    const vis = () => { if (timer) clearTimeout(timer); timer = undefined; if (!document.hidden) void pull(); };
    void pull();
    document.addEventListener("visibilitychange", vis);
    return () => { stop = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", vis); };
  }, [rainOn, rainGaugesOn]);
  // soft translucent intensity picture (static, georeferenced canvas source) + falling streaks (one DOM canvas, capped, paused when idle conditions fail)
  useEffect(() => {
    const map = mapRef.current, rc = rainCv.current;
    if (!ready || !map || !rc || !rain) return;
    const { nx, ny } = rain.grid;
    const vals = rain.v.split(",").map((x) => (x === "" ? 0 : Number(x) / 10)); // mm/h
    const small = document.createElement("canvas"); small.width = nx; small.height = ny;
    const sctx = small.getContext("2d")!, img = sctx.createImageData(nx, ny);
    for (let i = 0; i < nx * ny; i++) {
      const v = vals[i] ?? 0; if (v < 0.3) continue;
      const [r, g, b, a] = v >= 7.6 ? [30, 64, 175, 150] : v >= 2.5 ? [59, 130, 246, 120] : [147, 197, 253, 95]; // heavy / moderate / light
      img.data.set([r, g, b, a], i * 4);
    }
    sctx.putImageData(img, 0, 0);
    const ctx = rc.getContext("2d")!; ctx.clearRect(0, 0, rc.width, rc.height); ctx.imageSmoothingEnabled = true; ctx.drawImage(small, 0, 0, rc.width, rc.height);
    const src = map.getSource("f3d-rain") as CanvasSource | undefined;
    if (src) { src.play(); requestAnimationFrame(() => requestAnimationFrame(() => src.pause())); }
  }, [ready, rain]);
  useEffect(() => {
    const map = mapRef.current, cvs = rainFx.current;
    if (!ready || !map || !cvs || !rain || !rainOn) { if (cvs) cvs.getContext("2d")?.clearRect(0, 0, cvs.width, cvs.height); return; }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return; // static overlay only
    const cap = window.innerWidth < 768 ? 120 : 300;
    const { nx, ny, west, north, step } = rain.grid;
    const vals = rain.v.split(",").map((x) => (x === "" ? 0 : Number(x) / 10));
    const ctx = cvs.getContext("2d")!;
    type P = { x: number; y: number; l: number; s: number; life: number };
    let cands: { x: number; y: number }[] = [];
    let parts: P[] = [];
    let raf = 0, last = 0, timer: ReturnType<typeof setTimeout> | undefined, running = false;
    const size = () => { const r = cvs.parentElement!.getBoundingClientRect(); cvs.width = Math.round(r.width); cvs.height = Math.round(r.height); };
    const build = () => { // screen points that sit in rain, weighted by intensity: light 1, moderate 2, heavy 4 copies
      size(); cands = [];
      const w = cvs.width, h = cvs.height;
      for (let y = 6; y < h; y += 18) for (let x = 6; x < w; x += 18) {
        const ll = map.unproject([x, y]);
        const c = Math.floor((ll.lng - west) / step), r = Math.floor((north - ll.lat) / step);
        if (c < 0 || r < 0 || c >= nx || r >= ny) continue;
        const v = vals[r * nx + c] ?? 0;
        if (v < 0.3) continue;
        const k = v >= 7.6 ? 4 : v >= 2.5 ? 2 : 1;
        for (let i = 0; i < k; i++) cands.push({ x, y });
      }
      const n = Math.min(cap, Math.round(cands.length * 0.3));
      parts = Array.from({ length: n }, () => spawn(Math.random()));
    };
    const spawn = (age: number): P => { const c = cands[Math.floor(Math.random() * cands.length)] ?? { x: 0, y: 0 }; return { x: c.x + (Math.random() - 0.5) * 16, y: c.y + (Math.random() - 0.5) * 16, l: 7 + Math.random() * 8, s: 260 + Math.random() * 160, life: age * 0.7 }; };
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < 42) return; // about 24 fps at most (the owner does not want the laptop working hard)
      const dt = Math.min(0.1, (t - last) / 1000); last = t;
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      ctx.strokeStyle = "rgba(70,110,190,0.55)"; ctx.lineWidth = 1; ctx.beginPath();
      for (const p of parts) {
        p.life += dt; p.y += p.s * dt; p.x -= p.s * dt * 0.18;
        if (p.life > 0.7) Object.assign(p, spawn(0));
        ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.l * 0.18, p.y - p.l);
      }
      ctx.stroke();
    };
    const start = () => { if (running || document.hidden || !cands.length) return; running = true; last = 0; raf = requestAnimationFrame(frame); };
    const stop = () => { running = false; cancelAnimationFrame(raf); ctx.clearRect(0, 0, cvs.width, cvs.height); };
    const onMoveStart = () => { stop(); if (timer) clearTimeout(timer); };
    const onIdle = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { build(); start(); }, 400); };
    const onVis = () => { if (document.hidden) stop(); else onIdle(); };
    map.on("movestart", onMoveStart); map.on("moveend", onIdle); document.addEventListener("visibilitychange", onVis); window.addEventListener("resize", onIdle);
    build(); start();
    return () => { stop(); if (timer) clearTimeout(timer); map.off("movestart", onMoveStart); map.off("moveend", onIdle); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("resize", onIdle); };
  }, [ready, rain, rainOn, full]);

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
        map = new ml.Map({ container: box.current, style: STYLE, center: CENTER, zoom: phone ? 12.4 : 13, pitch: 0, maxPitch: 70, maxBounds: [[m.png.west - 0.03, m.png.south - 0.03], [m.png.east + 0.17, m.png.north + 0.03]], attributionControl: { compact: true } });
        mapRef.current = map;
        if (new URLSearchParams(location.search).has("debug")) (window as unknown as { __f3d?: unknown }).__f3d = { map, cv: cv.current, grid: grid.current };
        map.addControl(new ml.NavigationControl({ visualizePitch: true }), "top-right");
        // Locate me: the control's own button is hidden (CSS below); our button asks for consent first, then triggers it. Never on load.
        const geo = new ml.GeolocateControl({ positionOptions: { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }, trackUserLocation: false, showAccuracyCircle: true, showUserLocation: true, fitBoundsOptions: { maxZoom: 16 } });
        map.addControl(geo, "top-right");
        geo.on("geolocate", (e: unknown) => { const c = (e as { coords: GeolocationCoordinates }).coords; gps.current = { lat: c.latitude, lon: c.longitude, acc: c.accuracy }; setGeoMsg(null); });
        geo.on("error", () => setGeoMsg("Your location could not be read. Check that location is on for this browser."));
        geoRef.current = geo;
        setUsed(m.reports_used?.Kelaniya ?? 0);
        map.on("style.load", () => {
          if (dead || !map) return;
          const { west, east, south, north } = m.png;
          map.addSource("dem", { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: 256, maxzoom: 14, attribution: "Terrain: Mapzen/AWS Terrain Tiles (incl. Copernicus DEM)" });
          map.addSource("f3d-water", { type: "canvas", canvas: out, coordinates: [[west, north], [east, north], [east, south], [west, south]], animate: false });
          const before = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
          map.addLayer({ id: "f3d-water", type: "raster", source: "f3d-water", paint: { "raster-opacity": 0.85, "raster-fade-duration": 0, "raster-resampling": "linear" } }, before);
          // everything outside the calibrated picture is greyed: no estimate there
          const { west: bw, east: be, south: bs, north: bn } = m.png;
          map.addSource("f3d-outside", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], [[bw, bs], [bw, bn], [be, bn], [be, bs], [bw, bs]]] } } });
          map.addLayer({ id: "f3d-outside", type: "fill", source: "f3d-outside", paint: { "fill-color": "#64748b", "fill-opacity": 0.2 } }, before);
          // rain now: a static, smooth canvas picture of the intensity field (drawn when data arrives); the falling streaks are a separate DOM canvas
          const rc = document.createElement("canvas"); rc.width = 360; rc.height = 200; rainCv.current = rc;
          map.addSource("f3d-rain", { type: "canvas", canvas: rc, coordinates: [[79.79, 7.05], [80.15, 7.05], [80.15, 6.85], [79.79, 6.85]], animate: false });
          map.addLayer({ id: "f3d-rain", type: "raster", source: "f3d-rain", paint: { "raster-opacity": 0.9, "raster-fade-duration": 0 }, layout: { visibility: "none" } }, before);
          map.addSource("past", { type: "geojson", data: "/flood3d/ems-2025.json" });
          map.addLayer({ id: "past-fill", type: "fill", source: "past", paint: { "fill-color": "#7c3aed", "fill-opacity": 0.18 }, layout: { visibility: "none" } }, before);
          map.addLayer({ id: "past-line", type: "line", source: "past", paint: { "line-color": "#6d28d9", "line-width": 1.2, "line-dasharray": [3, 2] }, layout: { visibility: "none" } }, before);
          const lw: unknown = ["interpolate", ["linear"], ["zoom"], 11, 1.2, 15, 4];
          map.addSource("roads-main", { type: "geojson", data: "/flood3d/roads-main.json" });
          map.addLayer({ id: "roads-main", type: "line", source: "roads-main", paint: { "line-color": "rgba(0,0,0,0)", "line-width": lw as never, "line-dasharray": [1, 0] }, layout: { "line-cap": "round" } });
          map.addSource("roads-local", { type: "geojson", data: "/flood3d/roads-local.json" });
          map.addLayer({ id: "roads-local", type: "line", source: "roads-local", minzoom: 13, paint: { "line-color": "rgba(0,0,0,0)", "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1, 16, 3] as never }, layout: { "line-cap": "round" } });
          const empty = { type: "FeatureCollection" as const, features: [] };
          map.addSource("f3d-rain-gauges", { type: "geojson", data: empty });
          map.addLayer({ id: "f3d-rain-gauges", type: "circle", source: "f3d-rain-gauges", paint: { "circle-radius": 4.5, "circle-color": ["case", ["==", ["get", "mm"], -1], "#94a3b8", [">=", ["get", "mm"], 7.6], "#1e3a8a", [">=", ["get", "mm"], 2.5], "#2563eb", [">", ["get", "mm"], 0], "#60a5fa", "#e2e8f0"], "circle-stroke-color": "#1e293b", "circle-stroke-width": 1, "circle-opacity": ["case", ["==", ["get", "stale"], 1], 0.35, 1] }, layout: { visibility: "none" } });
          map.addSource("f3d-gauges", { type: "geojson", data: empty });
          map.addLayer({ id: "f3d-gauges", type: "circle", source: "f3d-gauges", paint: { "circle-radius": 8, "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 } });
          map.addLayer({ id: "f3d-gauges-label", type: "symbol", source: "f3d-gauges", layout: { "text-field": ["get", "label"], "text-size": 11, "text-offset": [0, 1.6], "text-anchor": "top", "text-font": ["Noto Sans Bold"], "text-allow-overlap": true }, paint: { "text-color": "#0f172a", "text-halo-color": "#ffffff", "text-halo-width": 2 } });
          map.on("click", (ev) => tapRef.current?.(ev));
          for (const id of ["roads-main", "roads-local", "f3d-gauges", "f3d-rain-gauges"]) { map.on("mouseenter", id, () => (map!.getCanvas().style.cursor = "pointer")); map.on("mouseleave", id, () => (map!.getCanvas().style.cursor = "")); }
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
    const gh = map.queryRenderedFeatures(ev.point, { layers: ["f3d-gauges", "f3d-rain-gauges"].filter((i) => map.getLayer(i)) })[0];
    if (gh?.properties) {
      const pr = gh.properties as Record<string, string | number>;
      if (gh.layer.id === "f3d-gauges") {
        add(String(pr.name), true);
        add(`${pr.level} ${pr.fast ? "(10-minute sensor) " : ""}· ${pr.statusLabel}${pr.trend ? `, ${pr.trend}` : ""}`);
        if (pr.at) add(`Hourly reading from ${clock(String(pr.at))}.`);
        const a = document.createElement("a"); a.href = String(pr.url); a.textContent = "Open the gauge page"; a.style.cssText = "color:#0369a1;font-size:12px;text-decoration:underline"; lines.appendChild(a);
      } else {
        add(String(pr.name), true);
        add(`${pr.inst}. Last hour: ${Number(pr.mm) < 0 ? "not known" : `${pr.mm} mm (at least)`}, 24 h: ${pr.mm24} mm. Reported ${pr.age} min ago${Number(pr.stale) ? " (old)" : ""}.`);
      }
      popRef.current?.remove();
      void loadMl().then((ml) => { popRef.current = new ml.Popup({ closeButton: true, maxWidth: "270px" }).setLngLat(ev.lngLat).setDOMContent(lines).addTo(map); });
      return;
    }
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
      else if (g.unc[i]) add("Not covered yet: there is no calibration here, so the map shows no flood estimate for this spot.");
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
    const rb = document.createElement("button");
    rb.textContent = "Report here"; rb.style.cssText = "margin-top:6px;padding:4px 10px;border-radius:6px;background:#0284c7;color:#fff;font:600 12px system-ui,sans-serif;border:0;cursor:pointer";
    rb.onclick = () => { popRef.current?.remove(); openReportRef.current?.({ lat: ev.lngLat.lat, lon: ev.lngLat.lng, src: "pin", acc: null }); };
    lines.appendChild(rb);
    popRef.current?.remove();
    void loadMl().then((ml) => { popRef.current = new ml.Popup({ closeButton: true, maxWidth: "270px" }).setLngLat(ev.lngLat).setDOMContent(lines).addTo(map); });
  }; });

  const secs = fetchedAt ? Math.max(0, Math.round((POLL_MS - (now - fetchedAt)) / 60000)) : null;
  const nag = live?.nagalagam, han = live?.hanwella;
  const marks = nag?.marks;

  // ---- search: our towns, then gauges, then the shipped gazetteer (places, landmarks, road names). No geocoder calls, nothing leaves the browser.
  const [q, setQ] = useState("");
  const [qOpen, setQOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [gaz, setGaz] = useState<GazItem[] | null>(null);
  const searchPin = useRef<Marker | null>(null);
  const loadGaz = () => { if (!gaz) fetch("/flood3d/gazetteer.json").then((r) => r.json()).then((d) => setGaz(d.p as GazItem[])).catch(() => setGaz([])); };
  type Hit = { n: string; lat: number; lon: number; tag: string; zoom: number };
  const hits: Hit[] = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    const out: Hit[] = [];
    const score = (names: (string | undefined)[]) => { let best = 9; for (const n of names) { if (!n) continue; const l = n.toLowerCase(); const k = l.startsWith(t) ? 0 : l.split(/[\s,-]+/).some((w) => w.startsWith(t)) ? 1 : l.includes(t) ? 2 : 9; if (k < best) best = k; } return best; };
    const take = <T,>(list: T[], names: (x: T) => (string | undefined)[], mk: (x: T) => Hit, max: number) => {
      const sc = list.map((x) => [score(names(x)), x] as const).filter(([k]) => k < 9).sort((a, b) => a[0] - b[0]).slice(0, max);
      for (const [, x] of sc) { const h = mk(x); if (!out.some((o) => o.n === h.n && Math.abs(o.lat - h.lat) < 0.003 && Math.abs(o.lon - h.lon) < 0.003)) out.push(h); }
    };
    take(towns, (x) => [x.n, ...(x.al ?? [])], (x) => ({ n: x.n, lat: x.lat, lon: x.lon, tag: "town", zoom: 14 }), 4);
    take(gauges, (x) => [x.n], (x) => ({ n: `${x.n} gauge`, lat: x.lat, lon: x.lon, tag: "river gauge", zoom: 15 }), 2);
    if (gaz) take(gaz, (x) => [x[0], x[4], x[5]], (x) => ({ n: x[0], lat: x[1], lon: x[2], tag: KIND_LABEL[x[3]] ?? "place", zoom: x[3] === 2 ? 16 : x[3] === 1 ? 16 : 14.5 }), 8);
    return out.slice(0, 8);
  }, [q, towns, gauges, gaz]);
  /* eslint-disable-next-line react-hooks/refs -- grid is read-only after load */
  const hitCovered = hits.map((h) => cellAtLL(h.lon, h.lat).covered);
  const goTo = (h: Hit) => {
    const map = mapRef.current;
    if (!map) return;
    setQ(h.n); setQOpen(false);
    const covered = cellAtLL(h.lon, h.lat).covered;
    map.flyTo({ center: [h.lon, h.lat], zoom: h.zoom, duration: 1400 });
    searchPin.current?.remove();
    void loadMl().then((ml) => { searchPin.current = new ml.Marker({ color: covered ? "#dc2626" : "#64748b" }).setLngLat([h.lon, h.lat]).addTo(map); });
    if (!covered) setGeoMsg(`${h.n}: not covered yet. The map is flown there but shows no flood estimate.`);
    else setGeoMsg(null);
  };
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setQOpen(true); setActive((a) => Math.min(hits.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter" && hits[active]) { e.preventDefault(); goTo(hits[active]); }
    else if (e.key === "Escape" && qOpen) { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setQOpen(false); }
  };

  const pill = (on: boolean, color = "sky") => `rounded-full border px-3 py-1 text-xs ${on ? (color === "sky" ? "border-sky-600 bg-sky-600 text-white" : "border-orange-600 bg-orange-600 text-white") : "border-slate-300 dark:border-slate-600"}`;
  const areaK = areas.find((x) => x.name === "Kelaniya");
  const legend = (
    <div className="rounded bg-white/90 px-2 py-1 text-[11px] leading-tight text-slate-700 shadow dark:bg-slate-900/90 dark:text-slate-200">
      <span className="mr-1 inline-block h-2.5 w-3 rounded-sm" style={{ background: "rgba(30,110,210,.75)" }} /> water at this river level{" "}
      <span className="mx-1 inline-block h-2.5 w-3 rounded-sm" style={{ background: "repeating-linear-gradient(135deg,rgba(30,110,210,.8) 0 2px,transparent 2px 5px)" }} /> less certain{" "}
      <span className="mx-1 inline-block h-1 w-3 bg-red-600" /> low road{" "}
      <span className="mx-1 inline-block h-2.5 w-3 rounded-sm" style={{ background: "rgba(100,116,139,.45)" }} /> not covered yet
    </div>
  );
  const statusBox = (
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
      {areaK?.n != null && <p className="text-xs text-slate-500">{areaK.n} reports around Kelaniya so far.{used > 0 && ` Your reports improved this area: ${used} used in the latest update.`}</p>}
    </div>
  );
  const controls = (
    <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">River level on the map</legend>
      <div className="flex flex-wrap gap-2">
        {([["live", "Live now"], ["nag", "What if Nagalagam reaches…"], ["han", "What if Hanwella reaches…"]] as const).map(([k, t]) => (
          <button key={k} type="button" onClick={() => { setDriver(k); if (k !== "live") setChanceOn(false); }} aria-pressed={driver === k} className={pill(driver === k)}>{t}</button>
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
        <label className="flex items-center gap-1"><input type="checkbox" checked={waterOn} onChange={(e) => setWaterOn(e.target.checked)} /> Water</label>
        <label className={`flex items-center gap-1 ${isLive ? "" : "opacity-50"}`}><input type="checkbox" disabled={!isLive} checked={chanceOn && isLive} onChange={(e) => { setChanceOn(e.target.checked); if (e.target.checked) setPlain(false); }} /> Chance of water</label>
        {chanceOn && isLive && (["0", "3", "6"] as const).map((h) => <button key={h} type="button" onClick={() => setHorizon(+h as 0 | 3 | 6)} aria-pressed={horizon === +h} className={pill(horizon === +h, "orange").replace("px-3", "px-2").replace("py-1", "py-0.5")}>{h === "0" ? "Now" : `+${h} h`}</button>)}
        <label className="flex items-center gap-1"><input type="checkbox" checked={gaugesOn} onChange={(e) => setGaugesOn(e.target.checked)} /> River gauges</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={rainOn} onChange={(e) => setRainOn(e.target.checked)} /> Rain now</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={rainGaugesOn} onChange={(e) => setRainGaugesOn(e.target.checked)} /> Rain gauges</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={roadsOn} onChange={(e) => setRoadsOn(e.target.checked)} /> Low roads</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={past} onChange={(e) => setPast(e.target.checked)} /> Real flood, 30 Nov 2025 (satellite)</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={plain} onChange={(e) => { setPlain(e.target.checked); if (e.target.checked) setChanceOn(false); }} /> Plain elevation bands (compare)</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={threeD} onChange={(e) => setThreeD(e.target.checked)} /> 3D (off = 2D)</label>
      </div>
      {rainOn && <p className="text-xs text-slate-600 dark:text-slate-400">{rain ? `Rain now (estimate, updated ${clock(rain.generatedAt)}). Light, moderate and heavy blue shading; ${rain.groundGauges} ground gauge${rain.groundGauges === 1 ? "" : "s"} reported in the last hour, the rest is satellite${rain.satelliteHourStart ? ` for the hour from ${clock(rain.satelliteHourStart)}` : ""}.` : rainErr ? "Rain data is not available right now." : "Loading rain…"}</p>}
      {chanceOn && isLive && <p className="text-xs text-slate-600 dark:text-slate-400">Shading: yellow low, orange medium, red high chance of water by then. River-driven only; heavy local rain can flood streets without the river.</p>}
    </fieldset>
  );

  return (
    <div className="space-y-3">
      <div ref={wrap} className={full ? "fixed inset-0 z-[70] bg-slate-100 dark:bg-slate-950" : "relative"}>
        <div ref={box} className={full ? "h-full w-full" : "h-[62vh] min-h-[380px] w-full overflow-hidden rounded-lg border border-slate-300 bg-slate-100 dark:border-slate-700"} data-testid="flood3d-map" />
        <canvas ref={rainFx} className="pointer-events-none absolute inset-0 z-[5]" aria-hidden />
        <button
          type="button"
          onClick={toggleFull}
          aria-pressed={full}
          className="absolute left-2 top-2 z-10 rounded-md bg-white/95 px-3 py-2 text-xs font-medium text-slate-800 shadow hover:bg-white dark:bg-slate-900/95 dark:text-slate-100"
          style={full ? { top: "calc(env(safe-area-inset-top, 0px) + 8px)", left: "calc(env(safe-area-inset-left, 0px) + 8px)" } : undefined}
        >
          {full ? "Exit full screen" : "Full screen"}
        </button>
        <div className="absolute z-20" style={{ top: full ? "calc(env(safe-area-inset-top, 0px) + 8px)" : 8, left: full ? "calc(env(safe-area-inset-left, 0px) + 120px)" : 118, right: full ? "calc(env(safe-area-inset-right, 0px) + 52px)" : 52, maxWidth: 360 }}>
          <input
            type="search" role="combobox" aria-expanded={qOpen && hits.length > 0} aria-controls="f3d-search-list" aria-label="Search a place, road or gauge" placeholder="Search a place or road"
            value={q} onChange={(e) => { setQ(e.target.value); setQOpen(true); setActive(0); }} onFocus={() => { loadGaz(); setQOpen(true); }} onKeyDown={onSearchKey}
            className="w-full rounded-md border border-slate-300 bg-white/95 px-3 py-2 text-xs text-slate-900 shadow dark:border-slate-600 dark:bg-slate-900/95 dark:text-slate-100"
          />
          {qOpen && hits.length > 0 && (
            <ul id="f3d-search-list" role="listbox" className="mt-1 max-h-64 overflow-y-auto rounded-md bg-white text-xs text-slate-900 shadow-lg dark:bg-slate-900 dark:text-slate-100">
              {hits.map((h, i) => {
                const cov = hitCovered[i];
                return (
                  <li key={`${h.n}-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); goTo(h); }} onMouseEnter={() => setActive(i)} className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 ${i === active ? "bg-sky-50 dark:bg-slate-800" : ""}`}>
                    <span className="truncate">{h.n}</span>
                    <span className="shrink-0 text-[10px] text-slate-500">{h.tag}{cov ? "" : " · not covered yet"}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="absolute left-2 z-10 flex flex-col gap-2" style={full ? { top: "calc(env(safe-area-inset-top, 0px) + 52px)", left: "calc(env(safe-area-inset-left, 0px) + 8px)" } : { top: "52px" }}>
          <button type="button" onClick={locate} className="rounded-md bg-white/95 px-3 py-2 text-xs font-medium text-slate-800 shadow hover:bg-white dark:bg-slate-900/95 dark:text-slate-100">Locate me</button>
          <button type="button" onClick={startReport} className="rounded-md bg-sky-600 px-3 py-2 text-xs font-semibold text-white shadow hover:bg-sky-700">Report here</button>
        </div>
        {geoMsg && <p role="status" className="absolute left-2 right-14 z-10 rounded bg-slate-800/90 p-2 text-xs text-white shadow" style={{ top: 140 }}>{geoMsg}</p>}
        {consentAsk && (
          <div role="dialog" aria-label="Use your location" className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
            <div className="max-w-xs space-y-3 rounded-lg bg-white p-4 text-sm text-slate-900 shadow-xl dark:bg-slate-900 dark:text-slate-100">
              <p className="font-semibold">Use your location?</p>
              <p>Your exact spot is kept private and used only to improve the flood map. We only read it when you tap, and never show it to anyone.</p>
              <div className="flex gap-2">
                <button type="button" className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white" onClick={() => { setConsented(true); setConsentAsk(false); setGeoMsg(null); geoRef.current?.trigger(); }}>Use my location</button>
                <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600" onClick={() => setConsentAsk(false)}>Not now</button>
              </div>
            </div>
          </div>
        )}
        {rep && <ReportPanel pos={rep} cell={cell} onClose={() => setRep(null)} />}
        {full && !rep && !panelOpen && (
          <button type="button" onClick={() => setPanelOpen(true)} className="absolute z-10 rounded-md bg-sky-600 px-4 py-2 text-xs font-semibold text-white shadow-lg md:right-2 md:top-28" style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)", right: "calc(env(safe-area-inset-right, 0px) + 12px)" }}>Options</button>
        )}
        {full && !rep && panelOpen && (
          <div role="region" aria-label="Map options" className="absolute inset-x-0 bottom-0 z-10 max-h-[62%] space-y-2 overflow-y-auto rounded-t-xl bg-white/97 p-2 text-slate-900 shadow-2xl dark:bg-slate-900/97 dark:text-slate-100 md:inset-x-auto md:bottom-2 md:right-2 md:top-28 md:max-h-none md:w-80 md:rounded-xl" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)", paddingRight: "calc(env(safe-area-inset-right, 0px) + 8px)" }}>
            <div className="flex items-center justify-between gap-2">
              <p className="rounded bg-amber-50 p-1.5 text-[11px] leading-tight text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"><strong>Test map.</strong> Illustration of low ground likely to flood at this river level, from 30 m satellite elevation. Not an official flood map.</p>
              <button type="button" onClick={() => setPanelOpen(false)} className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600">Hide</button>
            </div>
            {statusBox}
            {controls}
            <div className="flex gap-2">
              <button type="button" onClick={locate} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium dark:border-slate-600">Locate me</button>
              <button type="button" onClick={startReport} className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white">Report here</button>
            </div>
            {legend}
          </div>
        )}
        <style>{".maplibregl-ctrl-group:has(.maplibregl-ctrl-geolocate){display:none!important}"}</style>
        {!ready && !err && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-500">Loading map…</div>}
        {err && <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-red-700">{err}</div>}
        {!full && <div className="pointer-events-none absolute bottom-6 left-2">{legend}</div>}
      </div>

      {statusBox}
      {controls}
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
  const L = new Float32Array(n), hw = new Float32Array(n), cls = new Uint8Array(n), band = new Uint8Array(n), river = new Uint8Array(n), unc = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    river[i] = r === 255 ? 1 : 0;
    L[i] = r === 0 || r === 255 ? Infinity : (r - 1) / PX.step + PX.lo;
    hw[i] = g / 10; cls[i] = b & 3; band[i] = (b >> 2) & 7; unc[i] = (b >> 5) & 1;
  }
  return { L, hw, cls, band, river, unc, w: c.width, h: c.height };
}
