"use client";
// Unlisted test map (not in nav or sitemap, noindex): low ground shaded blue where the river would reach at a given Nagalagam Street level.
// MapLibre is loaded on demand. Data: /flood3d/*.json|png (static, built by scripts/flood3d), live gauges from our own /api/flood3d (polled
// every ~5 min while the tab is visible). The browser never calls ArcGIS or HMIS; map tiles come from OpenFreeMap and AWS Terrarium.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MlMap, GeoJSONSource, CanvasSource, MapMouseEvent, Popup, Marker } from "maplibre-gl";
import { preconnect, preload } from "react-dom";
import { Activity, Box, CloudRain, Copy, Droplets, ExternalLink, Flag, Gauge, History, Info, Layers, LocateFixed, Maximize2, MapPin, Minimize2, PanelRightClose, Play, Route, Search, SlidersHorizontal, Waves, X } from "lucide-react";
import { loadBaseStyle } from "./mapStyle";
import { ML_VERSION, loadMl, type Ml } from "./ml";
import { GLASS, ICON_BTN, Seg, SectionTitle, SwitchRow } from "./ui";
import { makeT, type Lang } from "./strings";
import { ReplayCard, replayTime, type ReplayData } from "./Replay";
import { depthM, poolTaper } from "./depth";
import { ReportPanel, type CellInfo, type RepPos } from "./ReportPanel";
import { SurveyPanel } from "./SurveyPanel";
import { trackEvent } from "@/lib/umami";
import { chanceClass, gaugeSpread, hanwellaMToNagFt, pWet, type Calibration, type Chance } from "./chance";

type Horizon = { h: number; level: number; low: number | null; high: number | null };
type Gauge = { station: string; levelFt: number | null; hourlyAt: string | null; marks: { alert: number | null; minor: number | null; major: number | null }; status: string; trend: string | null; changePerHourFt: number | null; fastFt: number | null; fastAt: string | null; horizons: Horizon[]; method: string | null };
type MapGauge = { name: string; lat: number; lon: number; levelFt: number | null; status: string; statusLabel: string; trend: string | null; observedAt: string | null; url: string; fastFt: number | null };
type RainNow = { generatedAt: string; grid: { west: number; north: number; south: number; east: number; step: number; nx: number; ny: number }; v: string; satelliteHourStart: number | null; satelliteAgeMin?: number | null; groundGauges: number; gauges: { n: string; i: string; lat: number; lon: number; mm1h: number | null; mm24h: number; ageMin: number }[]; credit: string };
const STEP_COLOR: Record<string, string> = { normal: "#16a34a", watch: "#ca8a04", alert: "#ea580c", minor: "#dc2626", major: "#7f1d1d", stale: "#64748b", none: "#64748b" };
type Live = { gauges?: MapGauge[]; hanwellaLagH?: number; stale?: boolean; partial?: boolean; generatedAt: string; nagalagam: Gauge | null; hanwella: Gauge | null; hanwellaToNag: [number, number][] };
type Meta = { png: { w: number; h: number; west: number; east: number; south: number; north: number; deg: number }; chance_calibration: Calibration; cover_bounds: [number, number, number, number]; reports_used?: Record<string, number> };

const DITWAH_PEAK_FT = 8.43; // Nagalagam Street, 1 Dec 2025 (the replay hour 155 of public/flood3d/ditwah.json)
const POLL_MS = 5 * 60 * 1000;
const CENTER: [number, number] = [79.922, 6.955]; // Kelaniya
const PX = { lo: 2, step: 10 }; // level.png: R = round((ft - 2) * 10) + 1

const clock = (iso: string | number | null) => (iso == null ? "" : new Date(iso).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Colombo" }).replace(" ", " "));
const ageText = (ms: number) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 90 ? `${m} min` : `${Math.round(m / 6) / 10} h`; };
const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

export type SearchItem = { n: string; lat: number; lon: number; al?: string[] };
type GazItem = [name: string, lat: number, lon: number, kind: number, si?: string, ta?: string];
const KIND_LABEL = ["place", "landmark", "road"];
const ORDER_RAMP: [number, number, number][] = [[76, 29, 120], [150, 40, 140], [214, 70, 110], [244, 127, 80], [250, 185, 100], [252, 230, 150]]; // "fills first" shading, dark to pale

// embed: the compact version rendered inline in a town page (app/flood/Flood3dInline.tsx; view = [lon, lat, zoom]): 2D, live level only, no search / options / reports / replay.
/** What the inline town card tells its parent so the sentence above the map follows the map: the river now (null until read / when too old) and the level shown. */
export type EmbedState = { nowFt: number | null; shownFt: number; scen: Scenario; failed: boolean; marks: { alert: number; minor: number; major: number } };
export type Scenario = "now" | "alert" | "minor" | "major" | "ditwah";
const MARKS0 = { alert: 4, minor: 5, major: 7 }; // Nagalagam Street's official steps until the live reading brings them
export default function Flood3dMap({ towns = [], gauges = [], lang = "en", embed = false, view, survey: surveyPage = false, onState }: { towns?: SearchItem[]; gauges?: SearchItem[]; lang?: Lang; embed?: boolean; view?: [number, number, number]; survey?: boolean; onState?: (s: EmbedState) => void }) {
  const tr = useMemo(() => makeT(lang), [lang]);
  preconnect("https://tiles.openfreemap.org"); preconnect("https://s3.amazonaws.com");
  // start the map library download in the HTML, before hydration (fetch preloads of the data files made fetch() fail intermittently on throttled phones, so those are not preloaded)
  preload(`/flood3d/ml/maplibre-gl-csp.js?v=${ML_VERSION}`, { as: "script" }); // start the tile connections while the map library loads
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const popRef = useRef<Popup | null>(null);
  const grid = useRef<{ L: Float32Array; hw: Float32Array; cls: Uint8Array; band: Uint8Array; river: Uint8Array; unc: Uint8Array; wet: Uint8Array; built: Uint8Array; w: number; h: number } | null>(null);
  const meta = useRef<Meta | null>(null);
  const cv = useRef<{ out: HTMLCanvasElement; img: ImageData; lut: Uint8ClampedArray } | null>(null);
  const up = useRef<{ W2: number; H2: number; L2: Float32Array; hw2: Uint8Array; fl: Uint8Array; cls2: Uint8Array; band2: Uint8Array } | null>(null);
  const shown = useRef(3); // level currently drawn (animated)
  const shownBoost = useRef(0); // Hanwella boost upstream currently drawn (animated with the level)
  const raf = useRef(0);
  const roadsRef = useRef(true);
  const addLocalRef = useRef<(() => void) | null>(null);
  const paintRoadsRef = useRef<((lv: number) => void) | null>(null);

  const [ready, setReady] = useState(false);
  // Full screen: the browser's Fullscreen API where it exists (desktop, Android); a fixed full-viewport layer otherwise (iPhone Safari
  // has no element fullscreen). Escape or the button leaves it; the map is resized after every change.
  const [panelOpen, setPanelOpen] = useState(true);
  const ctxOpen = useRef(false);
  const [ctx, setCtx] = useState<{ x: number; y: number; lat: number; lon: number; line: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const setCtxRef = useRef<((v: null) => void) | null>(null);
  const openCtxRef = useRef<((x: number, y: number, lng: number, lat: number) => void) | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const toggleFull = useCallback(() => {
    const el = embed ? embedRoot.current : wrap.current;
    if (!full) {
      trackEvent("f3d_fullscreen", { where: embed ? "card" : "map" });
      setFull(true);
      el?.requestFullscreen?.().catch(() => {});
    } else {
      setFull(false);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  }, [full, embed]);
  useEffect(() => { toggleFullRef.current = toggleFull; });
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setFull(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (popRef.current) { popRef.current.remove(); return; }
      if (ctxOpen.current) { setCtx(null); return; }
      setLegendNote(false); setFull(false);
    };
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
  const [liveErr, setLiveErr] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [driver, setDriver] = useState<"live" | "nag" | "han">("live");
  const [whatNag, setWhatNag] = useState(6);
  const [whatHan, setWhatHan] = useState(26);
  const [chanceOn, setChanceOn] = useState(false);
  const [horizon, setHorizon] = useState<0 | 3 | 6>(0);
  const [plain, setPlain] = useState(false);
  // Replay of Cyclone Ditwah (off by default; its 3 KB file is fetched only when it is opened) and the "fills first" shading
  const [replayOn, setReplayOn] = useState(false);
  const [rp, setRp] = useState<ReplayData | null>(null);
  const [rpIdx, setRpIdx] = useState(42);
  const [playing, setPlaying] = useState(false);
  const [order, setOrder] = useState(false);
  const [past, setPast] = useState(false);
  const [roadsOn, setRoadsOn] = useState(true);
  const [threeD, setThreeD] = useState(false);
  const [scen, setScen] = useState<Scenario>("now"); // embed only: "what if the river rises to ...": now (live), the official Alert / Minor / Major step at Nagalagam, or the Cyclone Ditwah peak (1 Dec 2025, 8.43 ft)
  const ditwah = scen === "ditwah";
  const embedRoot = useRef<HTMLDivElement>(null);
  const fullBtn = useRef<HTMLButtonElement | null>(null);
  const toggleFullRef = useRef<() => void>(() => {});
  const [waterOn, setWaterOn] = useState(true);
  const [legendNote, setLegendNote] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [snap, setSnap] = useState(0);
  const [sheetPx, setSheetPx] = useState<number | null>(null);
  const [mapTheme, setMapTheme] = useState<"light" | "dark">("light"); // the basemap is light by default whatever the site theme (owner, 27 Oct 2026); only the panels follow the site
  const schemeRef = useRef<"light" | "dark">("light");
  const [gaugesOn, setGaugesOn] = useState(true);
  const [rainGaugesOn, setRainGaugesOn] = useState(false);
  const [rainOn, setRainOn] = useState(false);
  const [rain, setRain] = useState<RainNow | null>(null);
  const [rainErr, setRainErr] = useState(false);
  const rainCv = useRef<HTMLCanvasElement | null>(null);
  const rainFx = useRef<HTMLCanvasElement | null>(null);

  const table = useMemo<[number, number][]>(() => live?.hanwellaToNag ?? [[3, 2.6], [10, 7.4]], [live]);

  // ---- the level the map shows
  // Nagalagam's own hourly level, always. Hanwella (10-minute sensor) is shown as its own number and is only used to answer "what if Hanwella reaches X",
  // because it leads Nagalagam by many hours at high flows (scripts/flood3d/fit-hanwella.py), so it says nothing about Nagalagam right now.
  // A reading older than about 6 h is not shown as live (the chip says unavailable); older than 90 min it says it may be a few minutes old.
  const liveNag = useMemo(() => (live?.nagalagam?.levelFt != null && !(live.nagalagam.hourlyAt && Date.now() - Date.parse(live.nagalagam.hourlyAt) > 6 * 3_600_000) ? { ft: live.nagalagam.levelFt } : null), [live]);
  const rpI = rp ? Math.max(0, Math.min(rp.hours - 1, Math.round(rpIdx))) : 0;
  const scenMarks = { alert: live?.nagalagam?.marks?.alert ?? MARKS0.alert, minor: live?.nagalagam?.marks?.minor ?? MARKS0.minor, major: live?.nagalagam?.marks?.major ?? MARKS0.major };
  const scenFt = scen === "ditwah" ? DITWAH_PEAK_FT : scen === "alert" ? scenMarks.alert : scen === "minor" ? scenMarks.minor : scen === "major" ? scenMarks.major : null;
  const level = embed && scenFt != null ? scenFt : replayOn && rp ? rp.nag[rpI] / 100 : driver === "live" ? liveNag?.ft ?? (embed ? 0 : 3.7) : driver === "nag" ? whatNag : hanwellaMToNagFt(whatHan * 0.3048, table);
  const lagH = live?.hanwellaLagH ?? 18;
  // Upstream follows Hanwella. Nagalagam rises 12-18 h after Hanwella, so on a rising river the towns from Kaduwela to Ruwanwella were shown late.
  // Hanwella's reading, converted to Nagalagam-equivalent ft (the same table as the Hanwella option), raises the water there when it is higher than
  // Nagalagam; it never lowers it (the upstream picture was fitted on Nagalagam at the satellite times: 30 Nov Hanwella 10.8 m -> 7.4 ft = Nagalagam 7.4,
  // 3 Dec 5.2 m -> 4.1 ft < Nagalagam 4.6, so the falling limb keeps Nagalagam as fitted). West of Kaduwela nothing changes.
  const liveHanFt = live?.hanwella ? (live.hanwella.fastFt ?? live.hanwella.levelFt) : null;
  const upLevel = embed && scen !== "now" ? null : replayOn && rp ? (rp.han?.[rpI] != null ? hanwellaMToNagFt(rp.han[rpI] / 10, table) : null) : driver === "live" && liveHanFt != null ? hanwellaMToNagFt(liveHanFt * 0.3048, table) : null;
  const upBoost = upLevel != null ? Math.max(0, upLevel - level) : 0;
  const isLive = driver === "live" && !replayOn && !(embed && scen !== "now");
  const nearShot = replayOn && rp ? rp.shots.find((x) => Math.abs(x.h - rpI) <= 6) ?? null : null;

  // Deep link for testing and sharing a view: ?lv=7.2 (what-if Nagalagam ft) &chance=6 (horizon h) &past=1 &plain=1 &d3=0|1
  const startView = useRef<[number, number, number, number?] | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- reads the URL once on mount (client only, so no hydration mismatch) */
  useEffect(() => {
    const q = new URLSearchParams(embed ? "" : location.search); // inline on a town page: the page URL is not the map's
    const lv = q.get("lv"); if (lv && +lv >= 2 && +lv <= 12) { setDriver("nag"); setWhatNag(+lv); }
    const ch = q.get("chance"); if (ch !== null && !lv) { setChanceOn(true); setHorizon(([0, 3, 6].includes(+ch) ? +ch : 0) as 0 | 3 | 6); }
    if (q.get("past")) setPast(true);
    if (q.get("plain")) setPlain(true);
    if (q.get("order")) setOrder(true);
    if (q.get("replay")) { setReplayOn(true); const t = +(q.get("t") ?? ""); if (Number.isFinite(t) && q.get("t")) setRpIdx(t); else setPlaying(true); }
    // ll=lon,lat,zoom[,pitch]: links from town pages open close in, tilted, with the 3D buildings (pitch 0-70)
    const ll = q.get("ll")?.split(",").map(Number); if (ll && (ll.length === 3 || ll.length === 4) && ll.every(Number.isFinite)) { startView.current = [ll[0], ll[1], ll[2], Math.max(0, Math.min(70, ll[3] ?? 0))]; if ((ll[3] ?? 0) > 0) setThreeD(true); }
    if (embed && view) startView.current = view; // inline on a town page: the town, whatever the page URL says
    if (q.has("d3")) forced3d.current = q.get("d3") === "1";
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount only: embed and view never change for a mounted map
  /* eslint-enable react-hooks/set-state-in-effect */
  const forced3d = useRef<boolean | null>(null);

  // ---- poll our cached endpoint every ~5 min while visible
  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout> | undefined;
    const pull = async () => {
      let ok = false;
      try {
        // a cold or stuck server must not leave the strip on "Loading" for ever: give up after 12 s (the map keeps the last good reading and tries again soon)
        const ac = new AbortController(), to = setTimeout(() => ac.abort(), 12_000);
        let r: Response;
        try { r = await fetch("/api/flood3d", { cache: "no-store", signal: ac.signal }); } finally { clearTimeout(to); }
        if (r.ok) { const d = (await r.json()) as Live; ok = !d.partial; if (!stop && !d.partial) { setLive(d); setFetchedAt(Date.now()); setLiveErr(!!d.stale); } else if (!stop) setLiveErr(true); } else if (!stop) setLiveErr(true);
      } catch { if (!stop) setLiveErr(true); /* keep the last good numbers */ }
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
  const draw = useCallback((lv: number, boost = 0) => {
    const u = up.current, c = cv.current, m = meta.current;
    if (!u || !c || !m) return;
    const { W2, H2, L2, hw2, fl, cls2, band2 } = u;
    const px = c.img.data; px.fill(0);
    const horizonData = live?.nagalagam?.horizons.find((x) => x.h === horizon);
    const gs = chanceOn && isLive ? (horizon === 0 || !horizonData ? gaugeSpread(lv, null, null, 0) : gaugeSpread(horizonData.level + (lv - (live?.nagalagam?.levelFt ?? lv)), horizonData.low, horizonData.high, horizon)) : null;
    // chance classes per (level, half-width) from a small table: the cell level is quantised to 0.1 ft, so no per-pixel maths
    const tables = new Map<number, Uint8Array>();
    const tableFor = (hwx10: number) => { let t = tables.get(hwx10); if (!t) { t = new Uint8Array(420); for (let k = 0; k < 420; k++) { const ch = chanceClass(pWet(k / 10 + 2, hwx10 / 10, gs!), m.chance_calibration).cls; t[k] = ch === "low" ? 1 : ch === "medium" ? 2 : ch === "high" ? 3 : 0; } tables.set(hwx10, t); } return t; };
    const kBand = lv >= 7 ? 2 : lv >= 5 ? 1 : lv >= 4 ? 0 : -1; // plain elevation bands: alert 0-1 m, minor 0-2 m, major 0-3 m
    const lut = c.lut;
    // per-column share of the Hanwella boost: 0 west of 79.98 E (Kaduwela), 1 from 80.08 E (Hanwella) eastwards
    const colW = new Float32Array(W2);
    for (let x = 0; x < W2; x++) { const lon = m.png.west + ((x + 0.5) / W2) * (m.png.east - m.png.west); colW[x] = Math.min(1, Math.max(0, (lon - 79.98) / 0.1)); }
    for (let y = 0, i = 0; y < H2; y++) {
      for (let x = 0; x < W2; x++, i++) {
        const f = fl[i];
        if (f & 1) continue; // river or sea
        let r = 0, g = 0, b = 0, a = 0;
        if (f & 2) { r = 100; g = 116; b = 139; a = 34; } // not covered yet: a faint grey, never water
        else if (f & 4) { if (!gs) { r = 70; g = 140; b = 135; a = 64; } } // usually-wet ground: a quiet teal, never flood blue
        else if (gs) {
          const t = tableFor(hw2[i])[Math.min(419, Math.max(0, Math.round((L2[i] - 2) * 10)))];
          if (t === 1) { r = 254; g = 222; b = 185; a = 150; } else if (t === 2) { r = 240; g = 150; b = 70; a = 165; } else if (t === 3) { r = 180; g = 60; b = 15; a = 185; }
        } else if (order) { // fills first: dark = the low spots that flood first, pale = the ground that floods last; in a replay only what is under water now
          const l = L2[i];
          if (l <= 9.5 && (!replayOn || l <= lv)) {
            const k = l <= 3.5 ? 0 : l <= 4.5 ? 1 : l <= 5.5 ? 2 : l <= 6.5 ? 3 : l <= 7.5 ? 4 : 5;
            r = ORDER_RAMP[k][0]; g = ORDER_RAMP[k][1]; b = ORDER_RAMP[k][2]; a = cls2[i] === 0 && (x + y) % 7 !== 0 ? 95 : 170;
          }
        } else if (plain) {
          if (band2[i] <= kBand) { r = 99; g = 102; b = 241; a = 120; }
        } else {
          const d = lv + colW[x] * boost - L2[i];
          if (d >= 0) {
            const k = Math.min(256, (d * 32) | 0) * 4;
            r = lut[k]; g = lut[k + 1]; b = lut[k + 2]; a = lut[k + 3];
            if (d < 0.15) a = a * (0.45 + (0.55 * d) / 0.15); // soft shoreline that never vanishes: a street coloured as wet always has water on it
            if (cls2[i] === 0) a = (x + y) % 7 === 0 ? a * 0.9 : a * 0.45; // estimate only: a fine hatch, not stripes
          }
        }
        if (!a) continue;
        const o = i * 4; px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a;
      }
    }
    c.out.getContext("2d")!.putImageData(c.img, 0, 0);
    const src = mapRef.current?.getSource("f3d-water") as CanvasSource | undefined;
    if (src) { src.play(); requestAnimationFrame(() => requestAnimationFrame(() => src.pause())); }
  }, [chanceOn, isLive, horizon, plain, live, order, replayOn]);

  const paintRoads = useCallback((lv: number) => {
    const map = mapRef.current;
    if (!map) return;
    const col: unknown = ["case", ["<=", ["get", "l"], lv], "#b91c1c", ["<=", ["get", "l"], lv + 1], "#d97706", "rgba(0,0,0,0)"]; // deep red: under water at this level; amber: within a foot
    for (const id of ["roads-main", "roads-local"]) if (map.getLayer(id)) map.setPaintProperty(id, "line-color", col as never);
  }, []);

  useEffect(() => { paintRoadsRef.current = paintRoads; });
  // ---- animate to the new level (smooth rise / fall), redraw when other layers change
  useEffect(() => {
    if (!ready) return;
    cancelAnimationFrame(raf.current);
    const fromB = shownBoost.current, toB = upBoost;
    const from = shown.current, to = level, t0 = performance.now(), dur = Math.abs(to - from) < 0.03 ? 0 : replayRef.current ? 220 : 1400;
    const step = (t: number) => {
      const k = dur ? Math.min(1, (t - t0) / dur) : 1, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      shown.current = from + (to - from) * e; shownBoost.current = fromB + (toB - fromB) * e;
      draw(shown.current, shownBoost.current); paintRoads(shown.current);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [ready, level, upBoost, draw, paintRoads]);

  // ---- layer toggles
  useEffect(() => { roadsRef.current = roadsOn; });
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const vis = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    vis("f3d-water", waterOn); vis("roads-main", roadsOn); vis("roads-local", roadsOn);
  }, [ready, roadsOn, waterOn]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    // in the town card the 3D view also comes in to street level (zoom 15.8+), where the 3D buildings start
    if (threeD) { map.setTerrain({ source: "dem", exaggeration: 2.5 }); map.easeTo({ pitch: 58, bearing: -25, duration: 900, ...(embed ? { zoom: Math.max(map.getZoom(), 15.8) } : {}) }); }
    else { map.setTerrain(null); map.easeTo({ pitch: 0, bearing: 0, duration: 700 }); }
  }, [ready, threeD, embed]);

  // ---- GPS ("Locate me", only on tap, after the consent line) and "Report here" (GPS spot or a dragged pin)
  const [rep, setRep] = useState<RepPos | null>(null);
  const [survey, setSurvey] = useState(false); // the flood survey sheet instead of the report sheet (same pin)
  const surveyRef = useRef(false);
  useEffect(() => { surveyRef.current = survey; });
  const [consentAsk, setConsentAsk] = useState(false);
  const [consented, setConsented] = useState(false);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [areas, setAreas] = useState<{ name: string; n: number | null }[]>([]);
  const [used, setUsed] = useState(0);
  const [photosEnabled, setPhotosEnabled] = useState(false);
  const gps = useRef<{ lat: number; lon: number; acc: number } | null>(null);
  const meMarker = useRef<Marker | null>(null);
  const meData = useRef<GeoJSON.FeatureCollection | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const openReportRef = useRef<((p: RepPos) => void) | null>(null);
  useEffect(() => { openReportRef.current = (p) => { setSurvey(false); setRep(p); setPanelOpen(false); }; });
  useEffect(() => {
    if (embed) return; // reports are not part of the embed
    fetch("/api/flood3d/report").then((r) => r.json()).then((d) => { setAreas(d.areas ?? []); setPhotosEnabled(!!d.photosEnabled); }).catch(() => {});
  }, [embed]);
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
   
  const locate = () => { if (!consented) setConsentAsk(true); else findMe(); };
  useEffect(() => {
    if (!embed || !full || !ready) return;
    let off = false;
    navigator.permissions?.query({ name: "geolocation" as PermissionName }).then((p) => { if (!off && p.state === "granted") findMe(); }).catch(() => {});
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embed, full, ready]);
  // Locate me: navigator.geolocation directly (never on load, only after the consent line). First a precise try, then a coarser, patient one.
  const findMe = () => {
    if (!navigator.geolocation) { setGeoMsg(tr("Your browser cannot share its location.")); return; }
    setGeoMsg(tr("Finding your location\u2026"));
    const msgFor = (code: number) => code === 1 ? tr("Location is blocked for this site. Allow it in the browser's site settings (padlock icon).") : code === 2 ? tr("Your device couldn't find its location. Turn Wi-Fi on (Macs locate using nearby Wi-Fi), even on Ethernet. On a Mac, turn on Location Services for your browser in System Settings \u203a Privacy & Security \u203a Location Services; on a phone, turn on Location.") : tr("Finding your location took too long. Try again near a window or with Wi-Fi on.");
    const ok = (pos: GeolocationPosition) => { trackEvent("f3d_locate", { where: embed ? "card" : "map", result: "ok" }); showMe(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy); };
    const fail = (err: GeolocationPositionError, stage: number) => {
      console.warn("[flood3d] geolocation error", err.code, err.message, "stage", stage);
      if (stage === 0 && (err.code === 2 || err.code === 3)) { navigator.geolocation.getCurrentPosition(ok, (e) => fail(e, 1), { enableHighAccuracy: false, timeout: 20000, maximumAge: 300000 }); return; }
      setGeoMsg(msgFor(err.code));
      trackEvent("f3d_locate", { where: embed ? "card" : "map", result: err.code === 1 ? "denied" : "failed" });
      void approxCity();
    };
    navigator.geolocation.getCurrentPosition(ok, (e) => fail(e, 0), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  };
  // Fallback when the device gives no position: the visitor's approximate city from the request headers (our own route, never stored, never a report position).
  const approxCity = async () => {
    try {
      const r = await fetch("/api/flood3d/where", { cache: "no-store" });
      const d = (await r.json()) as { city: string | null; lat?: number; lon?: number };
      const map = mapRef.current, m = meta.current;
      if (!d.city || d.lat == null || d.lon == null || !map || !m) return;
      const inside = d.lon >= m.png.west - 0.03 && d.lon <= m.png.east + 0.03 && d.lat >= m.png.south - 0.03 && d.lat <= m.png.north + 0.03;
      if (!inside) { setGeoMsg(tr("We couldn't get your exact location. Your connection looks like {city}, which is outside the covered area (Kelani corridor).", { city: d.city })); return; }
      setGeoMsg(tr("We couldn't get your exact location, so we moved to {city} (approximate). Tap your street to check it.", { city: d.city }));
      map.flyTo({ center: [d.lon, d.lat], zoom: 13, duration: 1400 });
    } catch { /* keep the plain error message */ }
  };
  const showMe = (lat: number, lon: number, acc: number) => {
    const map = mapRef.current, m = meta.current;
    if (!map || !m) return;
    gps.current = { lat, lon, acc };
    if (surveyRef.current) setRep({ lat, lon, src: "gps", acc }); // survey step 1: "I'm here now"
    // our own dot and accuracy circle (a 64-point polygon of acc metres)
    const ring: [number, number][] = [];
    for (let k = 0; k <= 64; k++) { const a = (k / 64) * 2 * Math.PI; ring.push([lon + (acc * Math.sin(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (acc * Math.cos(a)) / 110574]); }
    meData.current = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }] };
    (map.getSource("f3d-me") as GeoJSONSource | undefined)?.setData(meData.current);
    void loadMl().then((ml) => {
      if (!meMarker.current) { const el = document.createElement("div"); el.style.cssText = "width:14px;height:14px;border-radius:50%;background:#0284c7;border:3px solid #fff;box-shadow:0 0 0 1px rgba(2,132,199,.5),0 1px 4px rgba(0,0,0,.35)"; meMarker.current = new ml.Marker({ element: el }).setLngLat([lon, lat]).addTo(map); }
      else meMarker.current.setLngLat([lon, lat]);
    });
    const inside = lon >= m.png.west - 0.03 && lon <= m.png.east + 0.03 && lat >= m.png.south - 0.03 && lat <= m.png.north + 0.03;
    if (!inside) {
      const km = Math.round(Math.hypot((lon - CENTER[0]) * 111.32 * Math.cos((lat * Math.PI) / 180), (lat - CENTER[1]) * 110.57));
      map.setMaxBounds(null as never); // show where they are anyway
      setGeoMsg(tr("You're outside the covered area (Kelani corridor), about {km} km from Kelaniya.", { km }));
      map.flyTo({ center: [lon, lat], zoom: 11, duration: 1400 });
    } else {
      setGeoMsg(null);
      map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), acc > 500 ? 13.5 : 15), duration: 1400 });
    }
  };
  const startSurvey = () => {
    const map = mapRef.current;
    if (!map) return;
    setPanelOpen(false); setSurvey(true);
    const c = map.getCenter();
    setRep({ lat: c.lat, lon: c.lng, src: "pin", acc: null });
  };
  const repRef = useRef<RepPos | null>(null);
  useEffect(() => { repRef.current = rep; });
  // the survey sheet covers the lower part of the map: keep the pin in the visible part above it
  const onSurveySheet = useCallback((h: number) => {
    const map = mapRef.current, p = repRef.current;
    if (!map) return;
    map.easeTo({ padding: { top: 0, left: 0, right: 0, bottom: h }, ...(h > 0 && p ? { center: [p.lon, p.lat] as [number, number] } : {}), duration: 250 });
  }, []);
  const surveyOpened = useRef(false);
  useEffect(() => {
    if (!surveyPage || !ready || surveyOpened.current) return;
    surveyOpened.current = true;
    startSurvey();
    // bring the map (under the site header) to the top of the screen so the sheet and the pin are both in view
    const top = wrap.current?.parentElement?.getBoundingClientRect().top;
    if (top != null && top > 0) window.scrollTo({ top: window.scrollY + top - 56, behavior: "smooth" });
  });
  const startReport = () => {
    const map = mapRef.current;
    if (!map) return;
    setPanelOpen(false); setSurvey(false);
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
    const feats = (rain?.gauges ?? []).map((g) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [g.lon, g.lat] }, properties: { name: g.n, inst: g.i, mm: g.mm1h ?? -1, mm24: g.mm24h, age: g.ageMin, stale: g.ageMin > 60 ? 1 : 0, rain: g.ageMin <= 60 && (g.mm1h ?? 0) > 0 ? 1 : 0 } }));
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
    const cap = window.innerWidth < 768 ? 70 : 180;
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
      const n = Math.min(cap, Math.round(cands.length * 0.2));
      parts = Array.from({ length: n }, () => spawn(Math.random()));
    };
    const spawn = (age: number): P => { const c = cands[Math.floor(Math.random() * cands.length)] ?? { x: 0, y: 0 }; return { x: c.x + (Math.random() - 0.5) * 16, y: c.y + (Math.random() - 0.5) * 16, l: 5 + Math.random() * 5, s: 120 + Math.random() * 90, life: age * 0.7 }; };
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < 50) return; // about 20 fps at most: slow, faint streaks (the owner does not want the laptop working hard)
      const dt = Math.min(0.1, (t - last) / 1000); last = t;
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      ctx.strokeStyle = schemeRef.current === "dark" ? "rgba(186,210,255,0.3)" : "rgba(60,100,180,0.28)"; ctx.lineWidth = 0.8; ctx.beginPath();
      for (const p of parts) {
        p.life += dt; p.y += p.s * dt; p.x -= p.s * dt * 0.18;
        if (p.life > 1.1) Object.assign(p, spawn(0));
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

  // embed: in full screen one finger pans the map (the page cannot scroll behind it); inline the page keeps scrolling (two fingers / Ctrl + scroll for the map)
  useEffect(() => {
    if (!embed || !ready) return;
    const m = mapRef.current;
    if (m?.cooperativeGestures) { if (full) m.cooperativeGestures.disable(); else m.cooperativeGestures.enable(); }
    const b = fullBtn.current;
    if (b) { const lab = full ? tr("Exit full screen") : tr("Full screen"); b.className = full ? "maplibregl-ctrl-shrink" : "maplibregl-ctrl-fullscreen"; b.setAttribute("aria-label", lab); b.title = lab; }
    const t = setTimeout(() => m?.resize(), 120);
    return () => clearTimeout(t);
  }, [embed, ready, full, tr]);

  // ---- build the map once, lazily
  useEffect(() => {
    let dead = false;
    let map: MlMap | null = null;
    (async () => {
      try {
        let dark0 = false;
        // the town card map is light whatever the site theme
        try { dark0 = embed ? false : localStorage.getItem("f3d-map-theme") === "dark"; } catch { /* default light */ }
        const [ml, m, png, base] = await Promise.all([loadMl(), fetch("/flood3d/accuracy.json").then((r) => r.json() as Promise<Meta>), loadGrid(), loadBaseStyle(dark0)]);
        if (dead || !box.current) return;
        meta.current = m; grid.current = png;
        const phone = window.innerWidth < 768;
        // upsampling for smooth shorelines (3 desktop / 2 phone). The draw loop visits W2 x H2 cells on each level change (14M desktop / 6.2M phone on the
        // extended 1680 x 930 grid); a lower factor made the water edges visibly blocky, which the owner had already rejected once.
        const S = phone ? 2 : 3;
        const W2 = png.w * S, H2 = png.h * S;
        const out = document.createElement("canvas"); out.width = W2; out.height = H2;
        // water colour by depth below the level (0..8 ft, 1/32 ft steps): the natural blue (30,110,210) deepening with depth
        const lut = new Uint8ClampedArray(257 * 4);
        for (let k = 0; k <= 256; k++) { const d = Math.min(3, k / 32); lut[k * 4] = 30 - d * 6; lut[k * 4 + 1] = 110 - d * 14; lut[k * 4 + 2] = 210 - d * 10; lut[k * 4 + 3] = 120 + d * 28; }
        cv.current = { out, img: out.getContext("2d")!.createImageData(W2, H2), lut };
        const buildUpLater = () => { up.current ??= buildUp(png, S); };
        schemeRef.current = dark0 ? "dark" : "light";
        setMapTheme(schemeRef.current);
        map = new ml.Map({ container: box.current, style: base as never, center: CENTER, zoom: phone ? 12.4 : 13, pitch: 0, maxPitch: 70, maxBounds: [[m.png.west - 0.03, m.png.south - 0.03], [m.png.east + 0.03, m.png.north + 0.03]], attributionControl: { compact: true }, ...(embed ? { cooperativeGestures: true, locale: { "CooperativeGesturesHandler.WindowsHelpText": tr("Use Ctrl + scroll to zoom the map"), "CooperativeGesturesHandler.MacHelpText": tr("Use ⌘ + scroll to zoom the map"), "CooperativeGesturesHandler.MobileHelpText": tr("Use two fingers to move the map") } } : {}) });
        mapRef.current = map;
        if (embed) {
          // the credit starts as the (i) button (the small map stays clear); tapping (i) opens it. MapLibre re-opens it on load and on style data, so keep it shut until the visitor taps.
          const a = box.current!;
          let tapped = false;
          const shut = () => { const el = a.querySelector(".maplibregl-ctrl-attrib"); if (el && !tapped && el.classList.contains("maplibregl-compact-show")) { el.classList.remove("maplibregl-compact-show"); el.removeAttribute("open"); } };
          a.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest(".maplibregl-ctrl-attrib-button")) tapped = true; }, true);
          new MutationObserver(shut).observe(a, { subtree: true, attributes: true, attributeFilter: ["class", "open"], childList: true });
          shut();
        }
        if (new URLSearchParams(location.search).has("debug")) (window as unknown as { __f3d?: unknown }).__f3d = { map, cv: cv.current, grid: grid.current };
        map.addControl(new ml.NavigationControl({ visualizePitch: !embed, showCompass: !embed }), embed || phone ? "top-right" : "bottom-left");
        if (embed) {
          // full screen: a third button in MapLibre's own zoom group, with MapLibre's own full screen / shrink icons, so it matches + and -
          const grp = box.current?.querySelector(".maplibregl-ctrl-top-right .maplibregl-ctrl-group");
          const b = document.createElement("button"); b.type = "button"; b.className = "maplibregl-ctrl-fullscreen"; b.setAttribute("aria-label", tr("Full screen")); b.title = tr("Full screen");
          b.innerHTML = '<span class="maplibregl-ctrl-icon" aria-hidden="true"></span>'; b.addEventListener("click", () => toggleFullRef.current()); grp?.appendChild(b); fullBtn.current = b;
        }
        if (!phone && !embed) map.addControl(new ml.ScaleControl({ maxWidth: 100, unit: "metric" }), "bottom-left");
        setUsed(m.reports_used?.Kelaniya ?? 0);
        let bound = false;
        map.on("style.load", () => {
          if (dead || !map) return;
          const dark = schemeRef.current === "dark";
          const { west, east, south, north } = m.png;
          map.addSource("dem", { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: 256, maxzoom: 14, attribution: "Terrain: Mapzen/AWS Terrain Tiles (incl. Copernicus DEM)" });
          map.addSource("f3d-water", { type: "canvas", canvas: out, coordinates: [[west, north], [east, north], [east, south], [west, south]], animate: false });
          const before = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
          map.addLayer({ id: "f3d-water", type: "raster", source: "f3d-water", paint: { "raster-opacity": 0.88, "raster-fade-duration": 0, "raster-resampling": "linear" } }, before);
          // everything outside the calibrated picture is greyed: no estimate there
          const { west: bw, east: be, south: bs, north: bn } = m.png;
          map.addSource("f3d-outside", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], [[bw, bs], [bw, bn], [be, bn], [be, bs], [bw, bs]]] } } });
          map.addLayer({ id: "f3d-outside", type: "fill", source: "f3d-outside", paint: { "fill-color": "#64748b", "fill-opacity": 0.12 } }, before);
          // rain now: a static, smooth canvas picture of the intensity field (drawn when data arrives); the falling streaks are a separate DOM canvas
          const rc = document.createElement("canvas"); rc.width = 360; rc.height = 200; rainCv.current = rc;
          map.addSource("f3d-rain", { type: "canvas", canvas: rc, coordinates: [[79.79, 7.05], [80.15, 7.05], [80.15, 6.85], [79.79, 6.85]], animate: false });
          map.addLayer({ id: "f3d-rain", type: "raster", source: "f3d-rain", paint: { "raster-opacity": 0.9, "raster-fade-duration": 0 }, layout: { visibility: "none" } }, before);
          map.addSource("f3d-me", { type: "geojson", data: meData.current ?? { type: "FeatureCollection", features: [] } });
          map.addLayer({ id: "f3d-me-acc", type: "fill", source: "f3d-me", paint: { "fill-color": "#0284c7", "fill-opacity": 0.12 } });
          map.addLayer({ id: "f3d-me-line", type: "line", source: "f3d-me", paint: { "line-color": "#0284c7", "line-width": 1, "line-opacity": 0.5 } });
          map.addSource("past", { type: "geojson", data: "/flood3d/ems-2025.json" });
          map.addLayer({ id: "past-fill", type: "fill", source: "past", paint: { "fill-color": "#6366f1", "fill-opacity": 0.12 }, layout: { visibility: "none" } }, before);
          map.addLayer({ id: "past-line", type: "line", source: "past", paint: { "line-color": "#4f46e5", "line-width": 1, "line-dasharray": [3, 2] }, layout: { visibility: "none" } }, before);
          const lw: unknown = ["interpolate", ["linear"], ["zoom"], 11, 0.8, 15, 2.4];
          map.addSource("roads-main", { type: "geojson", data: "/flood3d/roads-main.json" });
          map.addLayer({ id: "roads-main", type: "line", source: "roads-main", paint: { "line-color": "rgba(0,0,0,0)", "line-width": lw as never }, layout: { "line-cap": "round" } });
          // local streets (660 KB) are fetched only once the map is zoomed in to street level
          const addLocal = () => {
            if (!mapRef.current || map!.getSource("roads-local") || map!.getZoom() < 15.5) return;
            map!.addSource("roads-local", { type: "geojson", data: "/flood3d/roads-local.json" });
            map!.addLayer({ id: "roads-local", type: "line", source: "roads-local", paint: { "line-color": "rgba(0,0,0,0)", "line-width": ["interpolate", ["linear"], ["zoom"], 16, 0.9, 18, 1.8] as never }, minzoom: 16, layout: { "line-cap": "round", visibility: roadsRef.current ? "visible" : "none" } });
            paintRoadsRef.current?.(shown.current);
          };
          addLocalRef.current = addLocal; addLocal();
          // 3D buildings only from street level: keeps the first paint light on phones
          if (map.getLayer("building-3d")) map.setLayerZoomRange("building-3d", 15, 24);
          const empty = { type: "FeatureCollection" as const, features: [] };
          map.addSource("f3d-rain-gauges", { type: "geojson", data: empty });
          map.addLayer({ id: "f3d-rain-gauges", type: "circle", source: "f3d-rain-gauges", paint: { "circle-radius": ["case", ["==", ["get", "rain"], 1], 6, 3.5], "circle-color": ["case", ["==", ["get", "mm"], -1], "#94a3b8", [">=", ["get", "mm"], 7.6], "#1e3a8a", [">=", ["get", "mm"], 2.5], "#2563eb", [">", ["get", "mm"], 0], "#60a5fa", "#e2e8f0"], "circle-stroke-color": ["case", ["==", ["get", "rain"], 1], "#0ea5e9", dark ? "#0f172a" : "#ffffff"], "circle-stroke-width": ["case", ["==", ["get", "rain"], 1], 2.5, 1], "circle-opacity": ["case", ["==", ["get", "stale"], 1], 0.35, 1] }, layout: { visibility: "none" } });
          map.addSource("f3d-gauges", { type: "geojson", data: empty });
          // river gauges: a small white disc with a ring in the official step colour, and a compact label that yields to others when crowded
          map.addLayer({ id: "f3d-gauges", type: "circle", source: "f3d-gauges", paint: { "circle-radius": 5, "circle-color": dark ? "#0f172a" : "#ffffff", "circle-stroke-color": ["get", "color"], "circle-stroke-width": 3 } });
          map.addLayer({ id: "f3d-gauges-label", type: "symbol", source: "f3d-gauges", layout: { "text-field": ["get", "label"], "text-size": 11, "text-offset": [0, 1.3], "text-anchor": "top", "text-font": ["Noto Sans Bold"], "text-padding": 4, "text-optional": true }, paint: { "text-color": dark ? "#e2e8f0" : "#0f172a", "text-halo-color": dark ? "#0f172a" : "#ffffff", "text-halo-width": 2.2 } });
          if (!bound) {
          bound = true;
          map.on("zoomend", () => addLocalRef.current?.());
          map.on("click", (ev) => tapRef.current?.(ev));
          if (!embed) map.on("contextmenu", (ev) => { ev.preventDefault(); openCtxRef.current?.(ev.point.x, ev.point.y, ev.lngLat.lng, ev.lngLat.lat); });
          // long press (about half a second, finger still): opens the same menu on phones without fighting pan or pinch
          let lp: ReturnType<typeof setTimeout> | undefined, p0: { x: number; y: number } | null = null;
          const cancel = () => { if (lp) clearTimeout(lp); lp = undefined; p0 = null; };
          map.on("touchstart", (ev) => { cancel(); if (embed) return; if ((ev.originalEvent as TouchEvent).touches?.length !== 1) return; p0 = { x: ev.point.x, y: ev.point.y }; const { lng, lat } = ev.lngLat, { x, y } = ev.point; lp = setTimeout(() => { lp = undefined; openCtxRef.current?.(x, y, lng, lat); }, 500); });
          map.on("touchmove", (ev) => { if (p0 && Math.hypot(ev.point.x - p0.x, ev.point.y - p0.y) > 10) cancel(); });
          for (const t of ["touchend", "touchcancel", "dragstart", "zoomstart"] as const) map.on(t, cancel);
          map.on("movestart", () => { if (!adjusting.current) setCtxRef.current?.(null); });
          for (const id of ["roads-main", "roads-local", "f3d-gauges", "f3d-rain-gauges"]) { map.on("mouseenter", id, () => (map!.getCanvas().style.cursor = "pointer")); map.on("mouseleave", id, () => (map!.getCanvas().style.cursor = "")); }
          if (startView.current) map.jumpTo({ center: [startView.current[0], startView.current[1]], zoom: startView.current[2], pitch: startView.current[3] ?? 0 });
          setThreeD(embed ? false : forced3d.current ?? !phone);
          }
          buildUpLater(); // the heavy upsampling runs after the base map has started loading its tiles
          setReady(true);
          trackEvent("f3d_map_loaded", { where: embed ? "card" : "map" });
        });
        map.on("error", (e) => { if (!dead && /style|tiles\.openfreemap/i.test(String(e?.error?.message ?? ""))) setErr(tr("The base map could not load.")); });
      } catch (e) {
        console.error("[flood3d] map start failed", e);
        if (!dead) setErr(e instanceof Error && e.message === "maplibre" ? tr("The map library could not load.") : tr("The map could not start."));
      }
    })();
    return () => { dead = true; cancelAnimationFrame(raf.current); popRef.current?.remove(); map?.remove(); mapRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- builds the map once; strings are read at creation
  }, []);

  // ---- basemap Light / Dark (remembered): swap the base style, our layers are re-added on style.load (which sets ready again)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || schemeRef.current === mapTheme) return;
    schemeRef.current = mapTheme;
    try { localStorage.setItem("f3d-map-theme", mapTheme); } catch { /* private mode: not remembered */ }
    setReady(false);
    void loadBaseStyle(mapTheme === "dark").then((st) => { if (mapRef.current === map) map.setStyle(st as never); });
  }, [mapTheme]);

  // ---- tap: road name + level, or what the water here does
  const stateRef = useRef({ level, isLive, live, horizon });
  useEffect(() => { stateRef.current = { level, isLive, live, horizon }; });
  const tapRef = useRef<((ev: MapMouseEvent) => void) | null>(null);
  const adjusting = useRef(false);
  /** One line about the cell at a point (same words as the tap popup). Called from event handlers only. */
  const infoAt = (lng: number, lat: number): string => {
    const g = grid.current, m = meta.current;
    if (!g || !m) return "";
    const ix = Math.floor((lng - m.png.west) / m.png.deg), iy = Math.floor((m.png.north - lat) / m.png.deg);
    if (ix < 0 || iy < 0 || ix >= g.w || iy >= g.h) return tr("Not covered yet: there is no calibration here, so the map shows no flood estimate for this spot.");
    const i = iy * g.w + ix;
    if (g.river[i]) return tr("River or canal.");
    if (g.unc[i]) return tr("Not covered yet: there is no calibration here, so the map shows no flood estimate for this spot.");
    if (g.wet[i]) return tr("Usually wet ground (marsh or paddy): the map does not count it as flood.");
    const L = g.L[i];
    if (!Number.isFinite(L) || L > 12) return tr("Not expected to flood from the river at any level seen so far (estimate).");
    return `${tr("Floods when Nagalagam Street reaches about {ft} ft", { ft: f1(L) })}${g.cls[i] === 0 ? ` (${tr("Estimate only")})` : ""}`;
  };
  useEffect(() => {
    openCtxRef.current = (x, y, lng, lat) => { popRef.current?.remove(); ctxOpen.current = true; setCopied(false); setCtx({ x, y, lat, lon: lng, line: infoAt(lng, lat) }); };
  });
  useEffect(() => { setCtxRef.current = setCtx; }, []);
  useEffect(() => { ctxOpen.current = !!ctx; if (ctx) menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus(); }, [ctx]);
  useEffect(() => {
    if (!ctx) return;
    const down = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setCtx(null); };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [ctx]);
  const copyCoords = async () => {
    if (!ctx) return;
    const text = `${ctx.lat.toFixed(5)}, ${ctx.lon.toFixed(5)}`;
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement("textarea"); ta.value = text; ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch { /* nothing more to try */ } ta.remove();
    }
    setCopied(true); setTimeout(() => setCtx(null), 900);
  };
  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setCtx(null); }
  };
  /** The one popup: replaces the previous, closes on x / Esc / empty-map tap / map move, and is panned clear of the panel and the top bar. */
  const showPopup = (lngLat: { lng: number; lat: number }, dom: HTMLElement) => {
    const map = mapRef.current;
    if (!map) return;
    popRef.current?.remove();
    void loadMl().then((ml) => {
      popRef.current?.remove();
      const p = new ml.Popup({ closeButton: true, closeOnClick: true, closeOnMove: false, maxWidth: "270px", className: "f3d-popup", focusAfterOpen: false }).setLngLat(lngLat).setDOMContent(dom).addTo(map);
      popRef.current = p;
      const mv = () => { if (!adjusting.current) p.remove(); };
      map.on("movestart", mv);
      p.on("close", () => { map.off("movestart", mv); if (popRef.current === p) popRef.current = null; });
      requestAnimationFrame(() => {
        const el = p.getElement(), box = wrap.current;
        if (!el || !box) return;
        const r = el.getBoundingClientRect(), w = box.getBoundingClientRect();
        let dx = 0, dy = 0;
        const side = box.querySelector("aside")?.getBoundingClientRect();
        if (side && r.right > side.left && r.left < side.right && r.bottom > side.top && r.top < side.bottom) { if (side.left > w.left + w.width / 2 && side.width < w.width * 0.6) dx = r.right - side.left + 16; else dy = r.bottom - side.top + 16; }
        if (r.top < w.top + 64) dy = Math.min(dy, 0) - (w.top + 64 - r.top);
        if (dx || dy) { adjusting.current = true; map.panBy([dx, dy], { duration: 250 }); setTimeout(() => { adjusting.current = false; }, 400); }
      });
    });
  };
   
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
        add(`${pr.level} ${pr.fast ? tr("(10-min sensor)") + " " : ""}· ${pr.statusLabel}${pr.trend ? `, ${tr(String(pr.trend))}` : ""}`);
        if (pr.at) add(tr("Hourly reading from {time}.", { time: clock(String(pr.at)) }));
        const a = document.createElement("a"); a.href = String(pr.url); a.textContent = tr("Open the gauge page"); a.style.cssText = "color:#0369a1;font-size:12px;text-decoration:underline"; if (embed) a.target = "_top"; lines.appendChild(a);
      } else {
        add(String(pr.name), true);
        add(`${pr.inst}. ${tr("Last hour: {x} mm (at least), 24 h: {y} mm. Reported {m} min ago.", { x: Number(pr.mm) < 0 ? tr("not known") : String(pr.mm), y: String(pr.mm24), m: String(pr.age) })}${Number(pr.stale) ? " " + tr("(old)") : ""}`);
      }
      showPopup(ev.lngLat, lines);
      return;
    }
    const road = map.queryRenderedFeatures(ev.point, { layers: ["roads-main", "roads-local"].filter((i) => map.getLayer(i)) })[0];
    if (road && road.properties && road.properties.l != null) {
      const l = Number(road.properties.l);
      add(String(road.properties.n || tr("Unnamed road")), true);
      add(`${road.properties.br ? tr("Bridge or tunnel. ") : ""}${tr("Low section: the ground here is covered when Nagalagam Street reaches about {ft} ft (estimate from 30 m elevation).", { ft: f1(l) })}`);
    } else {
      const ix = Math.floor((ev.lngLat.lng - m.png.west) / m.png.deg), iy = Math.floor((m.png.north - ev.lngLat.lat) / m.png.deg);
      if (ix < 0 || iy < 0 || ix >= g.w || iy >= g.h) return;
      const i = iy * g.w + ix;
      if (g.river[i]) add(tr("River or canal."));
      else if (g.unc[i]) add(tr("Not covered yet: there is no calibration here, so the map shows no flood estimate for this spot."));
      else if (g.wet[i]) add(tr("Usually wet ground (marsh or paddy): the map does not count it as flood."));
      else if (!Number.isFinite(g.L[i]) || g.L[i] > 12) add(tr("Not expected to flood from the river at any level seen so far (estimate)."));
      else {
        const L = g.L[i], hw = g.hw[i], cls = g.cls[i];
        const lo = Math.max(2, L - hw), hi = L + hw;
        const kind = cls === 2 ? tr("backed by a satellite flood map") : cls === 1 ? tr("interpolated between past floods") : tr("the river would have to go higher (or lower) here than in any flood we have records for, so this is a guess from ground height");
        add(tr("Floods when Nagalagam Street reaches about {ft} ft", { ft: f1(L) }), true);
        add(`${cls === 0 ? tr("Estimate only") : tr("Estimate")}, ${tr("range {lo} to {hi} ft", { lo: f1(lo), hi: f1(hi) })} (${kind}).`);
        const nag = st.live?.nagalagam;
        if (st.isLive && nag?.levelFt != null) {
          const hz = st.horizon === 0 ? 6 : st.horizon;
          const hd = nag.horizons.find((x) => x.h === hz);
          const gs = hd ? gaugeSpread(hd.level, hd.low, hd.high, hz) : gaugeSpread(nag.levelFt, null, null, hz);
          const best = Math.max(pWet(L, hw, gs), pWet(L, hw, gaugeSpread(nag.levelFt, null, null, 0)));
          const c = chanceClass(best, m.chance_calibration);
          console.info("[flood3d] chance of water", { rawP: Math.round(best * 1000) / 1000, calibrated: Math.round(c.p * 1000) / 1000, class: c.cls, cellLevelFt: f1(L), halfWidthFt: hw });
          const word: Record<Chance, string> = { none: tr("very low"), low: tr("low"), medium: tr("medium"), high: tr("high") };
          add(tr("Chance of water here in the next 6 hours: {w}.", { w: word[c.cls] }));
          add(nag.trend ? tr("River now {ft} ft and {trend}.", { ft: f1(st.level), trend: tr(nag.trend) }) : tr("River now {ft} ft", { ft: f1(st.level) }));
        } else add(L <= st.level ? tr("At {ft} ft this spot would be under water.", { ft: f1(st.level) }) : tr("At {ft} ft this spot would be dry.", { ft: f1(st.level) }));
        // how deep (an estimate, see depth.ts), tied to the replay time, the live reading or the chosen level
        const tp = poolTaper(ev.lngLat.lng, ev.lngLat.lat), dm = depthM(st.level, L, tp >= 0.5 ? 2 : g.built[i] ? 1 : 0, tp);
        if (dm > 0.05) {
          const ftw = Math.max(1, Math.round((dm / 0.3048) * 2) / 2);
          const when = replayRef.current && rp ? replayTime(rp, rpI, lang) : st.isLive && nag?.hourlyAt ? clock(nag.hourlyAt) : "";
          add(when ? tr("About {ft} ft of water here at {when} (estimate).", { ft: String(ftw), when }) : tr("About {ft} ft of water here with the river at {lv} ft (estimate).", { ft: String(ftw), lv: f1(st.level) }), true);
          add(tr("Rough guide only: the depth in streets between houses is hard to see from space."));
        }
      }
    }
    if (embed) { showPopup(ev.lngLat, lines); return; }
    const rb = document.createElement("button");
    rb.textContent = tr("Report here"); rb.style.cssText = "margin-top:6px;padding:4px 10px;border-radius:6px;background:#0284c7;color:#fff;font:600 12px system-ui,sans-serif;border:0;cursor:pointer";
    rb.onclick = () => { popRef.current?.remove(); openReportRef.current?.({ lat: ev.lngLat.lat, lon: ev.lngLat.lng, src: "pin", acc: null }); };
    lines.appendChild(rb);
    showPopup(ev.lngLat, lines);
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
   
  const hitCovered = hits.map((h) => cellAtLL(h.lon, h.lat).covered);
  const goTo = (h: Hit) => {
    trackEvent("f3d_search", { where: embed ? "card" : "map", kind: h.tag });
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

  const arrow = (t: string | null | undefined) => (t == null ? "" : t.startsWith("rising") ? "↑" : t === "falling" ? "↓" : "→");
  const areaK = areas.find((x) => x.name === "Kelaniya");
  const nagAgeMin = nag?.hourlyAt ? (now - Date.parse(nag.hourlyAt)) / 60000 : null;
  const nagUsable = nag?.levelFt != null && !(nagAgeMin != null && nagAgeMin > 360);
  const stepColor = STEP_COLOR[nag ? (live?.gauges?.find((g) => g.name === "Nagalagam Street")?.status ?? nag.status) : "none"] ?? "#64748b";
  const dot = "·";
  // the inline town card's sentence follows the map: what the river is now and the level shown (plus the Hanwella lift at the town's own longitude)
  const townLon = view?.[0] ?? CENTER[0];
  const shownEff = level + Math.min(1, Math.max(0, (townLon - 79.98) / 0.1)) * upBoost;
  useEffect(() => { if (embed) onState?.({ nowFt: nagUsable && nag ? nag.levelFt : null, shownFt: shownEff, scen, failed: liveErr || (live != null && !nagUsable), marks: scenMarks }); }, [embed, shownEff, scen, nagUsable, nag?.levelFt, liveErr, live]); // eslint-disable-line react-hooks/exhaustive-deps -- onState is the parent's setter

  // ---- header strip: title, one live chip, one info chip that expands the test notice
  const Title = surveyPage ? "h2" : "h1";
  const header = (
    <div className="space-y-2">
      <div className="flex flex-nowrap items-center gap-x-2 overflow-x-auto whitespace-nowrap sm:gap-x-3 [&>*]:shrink-0">
        <Title className="shrink-0 text-sm font-semibold md:text-base tracking-tight text-slate-900 dark:text-slate-100">{tr("Kelani flood map")}</Title>
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" data-testid="flood3d-now" aria-live="polite">
          <span aria-hidden className="size-2 rounded-full" style={{ background: stepColor }} />
          {replayOn && rp ? (
            <span className="font-semibold">{tr("Replay")} {dot} {replayTime(rp, rpI, lang)} {dot} {tr("Nagalagam Street {ft} ft", { ft: f1(rp.nag[rpI] / 100) })}</span>
          ) : nagUsable && nag ? (
            <>
              <span className="font-semibold">{tr("Nagalagam Street {ft} ft", { ft: f1(nag.levelFt ?? 0) })}</span>
              {nag.trend && <span>{dot} {tr(nag.trend)} {arrow(nag.trend)}</span>}
              {nag.hourlyAt && <span className="text-slate-500 dark:text-slate-400">{dot} {clock(nag.hourlyAt)}{nagAgeMin != null && nagAgeMin > 90 ? ` ${dot} ${tr("may be a few minutes old")}` : ""}</span>}
            </>
          ) : (
            <span>{liveErr ? tr("Live readings unavailable") : tr("Loading the latest readings…")}</span>
          )}
        </span>
        {han?.levelFt != null && (
          <span className="hidden text-xs text-slate-600 dark:text-slate-300 sm:inline">{tr("Hanwella {ft} ft", { ft: f1(han.fastFt ?? han.levelFt) })}{han.fastFt != null ? ` ${tr("(10-min sensor)")}` : ""}</span>
        )}
        <button type="button" aria-expanded={infoOpen} onClick={() => setInfoOpen((v) => !v)} className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          <Info className="size-3.5" aria-hidden /> {tr("Not official")}
        </button>
      </div>
      {infoOpen && (
        <p role="note" className="max-w-3xl rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          {tr("Illustration of low ground likely to flood at this river level, from 30 m satellite elevation. Not an official flood map.")} {tr("In an emergency call 117.")}
        </p>
      )}
    </div>
  );

  // ---- legend card with a depth gradient
  const replayRef = useRef(false);
  useEffect(() => { replayRef.current = replayOn; });
  // replay data: fetched once, only when the replay is opened (our own static file)
  useEffect(() => {
    if (!replayOn || rp) return;
    let dead = false;
    fetch("/flood3d/ditwah.json").then((r) => r.json()).then((d: ReplayData) => { if (!dead) setRp(d); }).catch(() => { if (!dead) { setReplayOn(false); setGeoMsg(tr("The replay could not load. Try again in a minute.")); } });
    return () => { dead = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tr is stable per language
  }, [replayOn, rp]);
  // playback: one hour of the storm every 0.2 s, paused while the tab is hidden, stops at the end
  useEffect(() => {
    if (!playing || !rp) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      setRpIdx((v) => { const n = Math.round(v) + 1; if (n >= rp.hours - 1) { setPlaying(false); return rp.hours - 1; } return n; });
    }, 200);
    return () => clearInterval(id);
  }, [playing, rp]);
  // the real satellite outline appears while the replay is within a few hours of a satellite photo
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const on = past || !!nearShot;
    const f = !past && nearShot ? ["==", ["get", "event"], nearShot.ev] : null;
    for (const id of ["past-fill", "past-line"]) if (map.getLayer(id)) { map.setFilter(id, f as never); map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); }
    if (map.getLayer("past-line")) { map.setPaintProperty("past-line", "line-width", nearShot && !past ? 2.4 : 1); map.setPaintProperty("past-line", "line-color", nearShot && !past ? "#312e81" : "#4f46e5"); }
  }, [ready, past, nearShot]);

  const legend = (
    <div className="space-y-2 px-1.5 pb-1 text-[11px] text-slate-700 dark:text-slate-300">
      <div>
        <div className="h-2 rounded-full" style={{ background: "linear-gradient(90deg, rgba(30,110,210,.5), rgba(24,96,190,.75) 50%, rgba(12,68,180,.95))" }} />
        <div className="mt-0.5 flex justify-between text-[10px] text-slate-500 dark:text-slate-400"><span>{tr("shallow")}</span><span>{tr("water at this river level")}</span><span>{tr("deep")}</span></div>
      </div>
      {order && (
        <div>
          <div className="h-2 rounded-full" style={{ background: `linear-gradient(90deg, ${ORDER_RAMP.map((c) => `rgb(${c.join(",")})`).join(", ")})` }} />
          <div className="mt-0.5 flex justify-between text-[10px] text-slate-500 dark:text-slate-400"><span>{tr("floods first")}</span><span>{tr("floods last")}</span></div>
        </div>
      )}
      {chanceOn && isLive && (
        <div>
          <div className="h-2 rounded-full" style={{ background: "linear-gradient(90deg, rgb(254,222,185), rgb(240,150,70) 55%, rgb(180,60,15))" }} />
          <div className="mt-0.5 flex justify-between text-[10px] text-slate-500 dark:text-slate-400"><span>{tr("low")}</span><span>{tr("Chance of water")}</span><span>{tr("high")}</span></div>
        </div>
      )}
      <ul className="grid grid-cols-1 gap-1">
        <li className="flex items-center gap-2"><span className="inline-block h-2.5 w-5 rounded-sm" style={{ background: "repeating-linear-gradient(135deg, rgba(30,110,210,.8) 0 1px, rgba(30,110,210,.3) 1px 6px)" }} />
          <button type="button" aria-expanded={legendNote} onClick={() => setLegendNote((v) => !v)} className="text-left underline decoration-dotted underline-offset-2">{tr("Estimate only (beyond floods we've seen)")}</button></li>
        {legendNote && <li className="pl-7 text-[10px] leading-snug text-slate-500 dark:text-slate-400">{tr("Here the river would have to go higher (or lower) than in any flood we have records for, so this is a guess from ground height.")}</li>}
        <li className="flex items-center gap-2"><span className="inline-block h-0.5 w-5 rounded" style={{ background: "#d97706" }} /><span className="inline-block h-0.5 w-5 -ml-1 rounded" style={{ background: "#b91c1c" }} /> {tr("low road")}</li>
        <li className="flex items-center gap-2"><span className="inline-block h-2.5 w-5 rounded-sm" style={{ background: "rgba(70,140,135,.45)" }} /> {tr("usually wet ground")}</li>
        <li className="flex items-center gap-2"><span className="inline-block h-2.5 w-5 rounded-sm" style={{ background: "rgba(100,116,139,.3)" }} /> {tr("not covered yet")}</li>
      </ul>
    </div>
  );

  // ---- the panel body (one place for every control, in and out of full screen)
  const panelBody = (
    <div className="px-2 pb-3">
      {isLive && nagUsable && nag && (
        <p className="mx-1.5 mb-2 rounded-lg bg-slate-100 px-2.5 py-2 text-[11px] leading-snug text-slate-700 dark:bg-slate-800 dark:text-slate-200" data-testid="flood3d-live-note">
          {level < (marks?.alert ?? 4) ? tr("River now: normal, {ft} ft. This map shows river flooding only; rain and canal water on streets is not shown.", { ft: f1(level) }) : tr("River now: {ft} ft, above normal. This map shows river flooding only; rain and canal water on streets is not shown.", { ft: f1(level) })}
        </p>
      )}
      <SectionTitle>{tr("River level on the map")}</SectionTitle>
      <div className="px-1.5">
        <Seg value={driver} onChange={(k) => { setDriver(k); setReplayOn(false); setPlaying(false); if (k !== "live") setChanceOn(false); }} label={tr("River level on the map")} items={[{ v: "live", t: tr("Live") }, { v: "nag", t: "Nagalagam" }, { v: "han", t: "Hanwella" }]} />
        <div className="pt-1"><SwitchRow icon={<Play className="size-4" />} label={tr("Replay Cyclone Ditwah (Nov 2025)")} on={replayOn} onChange={(v) => { setReplayOn(v); setPlaying(v); if (v) { setChanceOn(false); setPlain(false); setRpIdx(42); } }} /></div>
        {driver === "nag" && !replayOn && (
          <div className="pt-2">
            <div className="flex items-baseline justify-between text-xs"><span className="text-slate-500 dark:text-slate-400">{tr("What if Nagalagam reaches…")}</span><span className="text-base font-semibold tabular-nums">{f1(whatNag)} ft</span></div>
            <input aria-label={tr("Nagalagam Street level in feet")} type="range" min={2} max={10} step={0.1} value={whatNag} onChange={(e) => setWhatNag(+e.target.value)} className="mt-1 w-full accent-sky-600" />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {marks && ([["Alert", marks.alert], ["Minor", marks.minor], ["Major", marks.major]] as const).map(([name, v]) => v != null && <button key={name} type="button" className="rounded-full border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => setWhatNag(v)}>{tr(name)} {v}</button>)}
              <button type="button" className="rounded-full border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => setWhatNag(8.4)}>{tr("Dec 2025 peak 8.4 ft")}</button>
            </div>
          </div>
        )}
        {driver === "han" && !replayOn && (
          <div className="pt-2">
            <div className="flex items-baseline justify-between text-xs"><span className="text-slate-500 dark:text-slate-400">{tr("What if Hanwella reaches…")}</span><span className="text-base font-semibold tabular-nums">{f1(whatHan)} ft</span></div>
            <input aria-label={tr("Hanwella level in feet")} type="range" min={10} max={36} step={0.5} value={whatHan} onChange={(e) => setWhatHan(+e.target.value)} className="mt-1 w-full accent-sky-600" />
            <p className="pt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{tr("Hanwella {han} ft is roughly {nag} ft at Nagalagam Street, about {h} hours later (rough, from the past year; Nagalagam's own level is always better).", { han: f1(whatHan), nag: f1(level), h: lagH })}</p>
          </div>
        )}
      </div>

      <SectionTitle>{tr("Layers")}</SectionTitle>
      <div className="space-y-0.5">
        <SwitchRow icon={<Waves className="size-4" />} label={tr("Water")} on={waterOn} onChange={setWaterOn} />
        <SwitchRow icon={<Activity className="size-4" />} label={tr("Chance of water")} on={chanceOn && isLive} disabled={!isLive} onChange={(v) => { setChanceOn(v); if (v) setPlain(false); }} />
        {chanceOn && isLive && <div className="px-1.5 pb-1 pt-0.5"><Seg tone="amber" value={horizon} onChange={setHorizon} label={tr("Chance of water")} items={[{ v: 0, t: tr("Now") }, { v: 3, t: tr("+{h} h", { h: 3 }) }, { v: 6, t: tr("+{h} h", { h: 6 }) }]} /><p className="pt-1 text-[10px] leading-snug text-slate-500 dark:text-slate-400">{tr("Shading: yellow low, orange medium, red high chance of water by then. River-driven only; heavy local rain can flood streets without the river.")}</p></div>}
        <SwitchRow icon={<Route className="size-4" />} label={tr("Low roads")} on={roadsOn} onChange={setRoadsOn} />
        <SwitchRow icon={<Gauge className="size-4" />} label={tr("River gauges")} on={gaugesOn} onChange={setGaugesOn} />
        <SwitchRow icon={<CloudRain className="size-4" />} label={tr("Rain now")} on={rainOn} onChange={setRainOn} />
        {rainOn && <p className="px-1.5 pb-1 text-[10px] leading-snug text-slate-500 dark:text-slate-400">{rain ? tr("Rain now (estimate, updated {time}). {g} ground gauge(s) reported in the last hour; the rest is satellite for the hour from {sat} ({age} old).", { time: clock(rain.generatedAt), g: rain.groundGauges, sat: rain.satelliteHourStart ? clock(rain.satelliteHourStart) : "-", age: rain.satelliteHourStart ? ageText(Date.parse(rain.generatedAt) - rain.satelliteHourStart - 3_600_000) : "-" }) : rainErr ? tr("Rain data is not available right now.") : tr("Loading rain…")}</p>}
        <SwitchRow icon={<MapPin className="size-4" />} label={tr("Rain gauges")} on={rainGaugesOn} onChange={setRainGaugesOn} />
        <SwitchRow icon={<History className="size-4" />} label={tr("Real flood, 30 Nov 2025 (satellite)")} on={past} onChange={setPast} />
        <SwitchRow icon={<Droplets className="size-4" />} label={tr("Fills first (dark floods first)")} on={order} onChange={(v) => { setOrder(v); if (v) { setChanceOn(false); setPlain(false); } }} />
        <SwitchRow icon={<Layers className="size-4" />} label={tr("Plain elevation bands (compare)")} on={plain} onChange={(v) => { setPlain(v); if (v) { setChanceOn(false); setOrder(false); } }} />
        <SwitchRow icon={<Box className="size-4" />} label={tr("3D (off = 2D)")} on={threeD} onChange={setThreeD} />
      </div>

      <SectionTitle>{tr("Map")}</SectionTitle>
      <div className="px-1.5"><Seg value={mapTheme} onChange={setMapTheme} label={tr("Map")} items={[{ v: "light", t: tr("Light") }, { v: "dark", t: tr("Dark") }]} /></div>

      <SectionTitle>{tr("Legend")}</SectionTitle>
      {legend}

      <div className="mt-3 space-y-1 border-t border-slate-200 px-1.5 pt-2 text-[11px] leading-snug text-slate-500 dark:border-slate-700 dark:text-slate-400">
        <p>{fetchedAt ? tr("Updated {time} · next update in ~{min} min", { time: clock(fetchedAt), min: secs && secs > 0 ? secs : 1 }) : tr("Loading the latest readings…")}</p>
        {marks && <p>{tr("Official steps at Nagalagam: Alert {a} ft · Minor flood {b} ft · Major flood {c} ft. This map never changes them.", { a: marks.alert ?? "", b: marks.minor ?? "", c: marks.major ?? "" })}</p>}
        {areaK?.n != null && <p>{tr("{n} reports around Kelaniya so far.", { n: areaK.n })}{used > 0 && ` ${tr("Your reports improved this area: {n} used in the latest update.", { n: used })}`}</p>}
        <p>{tr("Map data")}: &copy; OpenStreetMap contributors, OpenFreeMap, Copernicus DEM, GSMaP (JAXA), HMIS.</p>
      </div>
    </div>
  );

  // ---- bottom sheet (phones) drag with snap points; side panel (desktop) via CSS
  const dragRef = useRef<{ y0: number; h0: number } | null>(null);
  const sheetHeights = () => { const H = wrap.current?.clientHeight ?? 700; return [92, Math.round(H * 0.5), Math.round(H * 0.88)]; };
  const onSheetDown = (e: React.PointerEvent) => { dragRef.current = { y0: e.clientY, h0: sheetPx ?? sheetHeights()[snap] }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const onSheetMove = (e: React.PointerEvent) => { if (!dragRef.current) return; const hs = sheetHeights(); setSheetPx(Math.max(hs[0], Math.min(hs[2], dragRef.current.h0 + (dragRef.current.y0 - e.clientY)))); };
  const onSheetUp = () => {
    if (!dragRef.current) return;
    const hs = sheetHeights(), cur = sheetPx ?? hs[snap];
    const moved = Math.abs(cur - dragRef.current.h0) > 6;
    const nearest = hs.reduce((b, h, i) => (Math.abs(h - cur) < Math.abs(hs[b] - cur) ? i : b), 0);
    dragRef.current = null; setSheetPx(null); setSnap(moved ? nearest : (snap + 1) % 3);
  };

  // full width and the full screen height: viewport minus the site header (3.5 rem), this strip (~2.75 rem) and, on phones, the bottom nav; vh first, dvh over it (see the style tag)
  const mapH = full ? "h-full w-full" : "f3d-map w-full overflow-hidden";
  const PANEL = embed ? "border border-slate-200 bg-white/95 text-slate-900 shadow-lg backdrop-blur-md" : GLASS;
  const results = (
    <>
      {qOpen && q.trim().length >= 2 && hits.length === 0 && gaz && <p className={`mt-1 rounded-lg px-3 py-2 text-xs text-slate-600 ${embed ? "" : "dark:text-slate-300"} ${PANEL}`}>{tr("No match. Try a town, road or landmark.")}</p>}
      {qOpen && hits.length > 0 && (
        <ul id="f3d-search-list" role="listbox" className={`mt-1 max-h-64 overflow-y-auto rounded-lg text-xs ${PANEL}`}>
          {hits.map((h, i) => (
            <li key={`${h.n}-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); goTo(h); }} onMouseEnter={() => setActive(i)} className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 ${i === active ? (embed ? "bg-sky-50" : "bg-sky-50 dark:bg-slate-800") : ""}`}>
              <span className="truncate">{h.n}</span>
              <span className="shrink-0 text-[10px] text-slate-500">{tr(h.tag)}{hitCovered[i] ? "" : ` ${dot} ${tr("not covered yet")}`}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  // ---- embed: a strip saying which level is shown, the "what if" chips, the map, then a legend + note + link. Always a LIGHT panel (the card around it follows the site theme).
  if (embed) {
    const fullHref = () => {
      const m = mapRef.current, c = m?.getCenter(), z = m?.getZoom();
      const base = lang === "en" ? "/lab/flood-3d" : `/${lang}/lab/flood-3d`;
      const rp0 = ditwah ? "replay=1&t=155&" : "";
      // the full map opens at street level (zoom 16.5 or closer, tilted 55 degrees) so houses and streets are readable
      return c && z != null ? `${base}?${rp0}ll=${c.lng.toFixed(5)},${c.lat.toFixed(5)},${Math.max(16.5, z).toFixed(1)},55` : `${base}${ditwah ? "?replay=1&t=155" : ""}`;
    };
    const nowFt = nagUsable && nag ? nag.levelFt : null;
    const scenName = scen === "alert" ? tr("Alert level") : scen === "minor" ? tr("Minor flood level") : scen === "major" ? tr("Major flood level") : tr("Cyclone Ditwah peak, 1 Dec 2025");
    const chips: { v: Scenario; t: string }[] = [
      { v: "now", t: nowFt != null ? tr("Now {ft} ft", { ft: f1(nowFt) }) : tr("Now") },
      { v: "alert", t: tr("Alert {ft} ft", { ft: f1(scenMarks.alert) }) },
      { v: "minor", t: tr("Minor {ft} ft", { ft: f1(scenMarks.minor) }) },
      { v: "major", t: tr("Major {ft} ft", { ft: f1(scenMarks.major) }) },
      { v: "ditwah", t: tr("Ditwah {ft} ft", { ft: f1(DITWAH_PEAK_FT) }) },
    ];
    const unavailable = liveErr || (live != null && !nagUsable);
    return (
      <div ref={embedRoot} className={`flex min-h-0 flex-col bg-white text-slate-900 ${full ? "fixed inset-0 z-[70] h-[100dvh]" : "h-full"}`} style={full ? { paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" } : undefined} data-testid="flood3d-embed" data-full={full ? "1" : "0"}>
        <style>{".f3d-popup .maplibregl-popup-close-button{width:44px;height:44px;font-size:24px;line-height:1;color:#475569;border-radius:0 12px 0 12px} .f3d-popup .maplibregl-popup-content{padding:12px 44px 12px 14px;border-radius:12px;box-shadow:0 8px 24px rgba(15,23,42,.22)} .maplibregl-ctrl-group{border-radius:10px;box-shadow:0 1px 6px rgba(15,23,42,.18)} .f3d-fs-btn{display:flex;align-items:center;justify-content:center}"}</style>
        <div className="flex shrink-0 items-center gap-2 px-3 py-2 text-xs text-slate-800" data-testid="flood3d-now" aria-live="polite">
          <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: scen === "now" ? stepColor : "#0369a1" }} />
          <span className="min-w-0 leading-snug">
            {scen !== "now" ? <><span className="font-semibold">{tr("Showing {name}", { name: scenName })} {dot} {tr("Nagalagam {ft} ft", { ft: f1(level) })}</span>{nowFt != null && <span className="text-slate-600"> {dot} {tr("river now {ft} ft", { ft: f1(nowFt) })}</span>}</>
              : nowFt != null && nag ? <><span className="font-semibold">{tr("Nagalagam Street {ft} ft", { ft: f1(nowFt) })}</span>{nag.trend && <> {dot} {tr(nag.trend)} {arrow(nag.trend)}</>}{nag.hourlyAt && <span className="text-slate-600"> {dot} {clock(nag.hourlyAt)}</span>}</>
              : unavailable ? <span className="font-semibold">{tr("Live reading unavailable")}</span> : tr("Loading the latest readings…")}
          </span>
        </div>
        <div className="shrink-0 px-3 pb-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p id="f3d-whatif" className="text-[11px] font-medium text-slate-600">{tr("What if the river rises to…")}</p>
            <button type="button" aria-pressed={threeD} onClick={() => { if (!threeD) trackEvent("f3d_3d", { where: "card" }); setThreeD((v) => !v); }} data-testid="f3d-3d" className={`inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${threeD ? "border-sky-700 bg-sky-700 text-white" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"}`}>
              <Box className="size-3.5" aria-hidden /> {tr("3D view")}
            </button>
          </div>
          <div role="radiogroup" aria-labelledby="f3d-whatif" className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <button key={c.v} type="button" role="radio" aria-checked={scen === c.v} onClick={() => { setScen(c.v); trackEvent("f3d_whatif", { level: c.v }); }} data-testid={`f3d-chip-${c.v}`} className={`min-h-10 rounded-full border px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${scen === c.v ? "border-sky-700 bg-sky-700 text-white" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-100"}`}>{c.t}</button>
            ))}
          </div>
        </div>
        <div ref={wrap} className="relative min-h-0 flex-1">
          <div ref={box} className="h-full w-full overflow-hidden" data-testid="flood3d-map" />
          {!ready && !err && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-500">{tr("Loading map…")}</div>}
          {err && <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-red-700">{err}</div>}
          {full && (
            <div className="absolute left-16 right-14 top-3 z-20 flex items-start gap-2 sm:left-[7.25rem]">
              <div className="min-w-0 max-w-[22rem] flex-1">
                <div className="flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 shadow-lg">
                  <Search className="size-4 shrink-0 text-slate-500" aria-hidden />
                  <input
                    type="search" role="combobox" aria-expanded={qOpen && hits.length > 0} aria-controls="f3d-search-list" aria-label={tr("Search a place, road or gauge")} placeholder={tr("Search a place or road")}
                    value={q} onChange={(e) => { setQ(e.target.value); setQOpen(true); setActive(0); }} onFocus={() => { loadGaz(); setQOpen(true); }} onBlur={() => setTimeout(() => setQOpen(false), 150)} onKeyDown={onSearchKey}
                    className="h-11 w-full min-w-0 bg-transparent text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none"
                  />
                </div>
                {results}
              </div>
              <button type="button" onClick={findMe} data-testid="flood3d-locate" className="flex size-11 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-800 shadow-lg hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500" aria-label={tr("Locate me")} title={tr("Locate me")}><LocateFixed className="size-5" aria-hidden /></button>
            </div>
          )}
          {full && geoMsg && (
            <div role="status" className="absolute left-3 right-14 top-[4.25rem] z-10 flex items-start gap-2 rounded-lg border border-slate-200 bg-white/95 py-2 pl-3 pr-1 text-xs text-slate-800 shadow-lg sm:right-auto sm:max-w-sm">
              <p className="flex-1 pt-1">{geoMsg}</p>
              <button type="button" onClick={() => setGeoMsg(null)} aria-label={tr("Close")} className="-my-2 flex size-11 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"><X className="size-4" /></button>
            </div>
          )}
          {full && <button type="button" onClick={toggleFull} data-testid="flood3d-close" aria-label={tr("Close")} className="absolute left-3 top-3 z-10 inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full bg-white px-0 sm:px-4 text-sm font-semibold text-slate-900 shadow-lg ring-1 ring-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"><X className="size-5 sm:size-4" aria-hidden /><span className="hidden sm:inline">{tr("Close")}</span></button>}
        </div>
        <div className="shrink-0 space-y-1 px-3 py-2 text-[11px] text-slate-700">
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-700" aria-label={tr("Legend")}>
            <li className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-6 rounded-sm" style={{ background: "linear-gradient(90deg, rgba(30,110,210,.45), rgba(12,68,180,.95))" }} />{tr("Water (darker = deeper)")}</li>
            <li className="inline-flex items-center gap-1.5"><span aria-hidden className="h-1 w-5 rounded-full" style={{ background: "#b91c1c" }} />{tr("Road under water")}</li>
            <li className="inline-flex items-center gap-1.5"><span aria-hidden className="h-1 w-5 rounded-full" style={{ background: "#d97706" }} />{tr("Road within 1 ft")}</li>
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
            <p>{tr("River flooding only · not official")}</p>
            <a href={fullHref()} target="_top" onClick={(e) => { e.currentTarget.href = fullHref(); trackEvent("f3d_open_full", { mode: ditwah ? "ditwah" : "now" }); }} className="inline-flex min-h-8 items-center gap-1 font-medium text-sky-800 underline underline-offset-2"><ExternalLink className="size-3.5" aria-hidden />{tr("Open the full flood map")}</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <style>{`.f3d-map{--f3d-off:calc(3.5rem + 2.9rem + 3.5rem + env(safe-area-inset-bottom,0px));height:calc(100vh - var(--f3d-off));height:calc(100dvh - var(--f3d-off));min-height:420px}@media (min-width:640px){.f3d-map{--f3d-off:calc(3.5rem + 2.9rem)}}`}</style>
      <div className="px-3 py-1.5 sm:px-4">{header}</div>
      <div ref={wrap} className={full ? "fixed inset-0 z-[70] bg-slate-100 dark:bg-slate-950" : "relative"}>
        <div ref={box} className={mapH} data-testid="flood3d-map" />
        <canvas ref={rainFx} className="pointer-events-none absolute inset-0 z-[5]" aria-hidden />

        {!rep && !replayOn && !embed && (
          <button type="button" onClick={startSurvey} disabled={!ready} data-testid="survey-open" className="absolute z-10 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300" style={{ top: full ? "calc(env(safe-area-inset-top, 0px) + 64px)" : 60, left: full ? "calc(env(safe-area-inset-left, 0px) + 12px)" : 12 }}>
            <Flag className="size-3.5" aria-hidden /> {tr("Is your area flooded now?")}
          </button>
        )}

        {/* top bar: search + map tools */}
        <div className="absolute z-20 flex items-start gap-2" style={{ top: full ? "calc(env(safe-area-inset-top, 0px) + 12px)" : 12, left: full ? "calc(env(safe-area-inset-left, 0px) + 12px)" : 12, right: 12 }}>
          <div className="w-full max-w-[22rem] min-w-0 flex-1">
            <div className={`flex items-center gap-2 rounded-lg px-3 ${GLASS}`}>
              <Search className="size-4 shrink-0 text-slate-500" aria-hidden />
              <input
                type="search" role="combobox" aria-expanded={qOpen && hits.length > 0} aria-controls="f3d-search-list" aria-label={tr("Search a place, road or gauge")} placeholder={tr("Search a place or road")}
                value={q} onChange={(e) => { setQ(e.target.value); setQOpen(true); setActive(0); }} onFocus={() => { loadGaz(); setQOpen(true); }} onBlur={() => setTimeout(() => setQOpen(false), 150)} onKeyDown={onSearchKey}
                className="h-9 w-full min-w-0 bg-transparent text-xs text-slate-900 placeholder:text-slate-500 focus:outline-none dark:text-slate-100"
              />
            </div>
            {results}
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={locate} className={ICON_BTN} aria-label={tr("Locate me")} title={tr("Locate me")}><LocateFixed className="size-4" /></button>
            <button type="button" onClick={startReport} className={ICON_BTN} aria-label={tr("Report here")} title={tr("Report here")}><Flag className="size-4" /></button>
            <button type="button" onClick={toggleFull} aria-pressed={full} className={ICON_BTN} aria-label={full ? tr("Exit full screen") : tr("Full screen")} title={full ? tr("Exit full screen") : tr("Full screen")}>{full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</button>
          </div>
        </div>
        {replayOn && <ReplayCard data={rp} idx={rpIdx} setIdx={setRpIdx} playing={playing} setPlaying={setPlaying} onClose={() => { setReplayOn(false); setPlaying(false); }} tr={tr} lang={lang} near={nearShot} top={full ? 64 : 60} />}
        {geoMsg && (
          <div role="status" className={`absolute left-3 right-3 z-20 flex items-start gap-2 rounded-lg py-2 pl-3 pr-1 text-xs md:right-auto md:max-w-sm ${GLASS}`} style={{ top: full ? "calc(env(safe-area-inset-top, 0px) + 64px)" : 64 }}>
            <p className="flex-1 pt-1">{geoMsg}</p>
            <button type="button" onClick={() => setGeoMsg(null)} aria-label={tr("Close")} className="flex size-11 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 -my-2"><X className="size-4" /></button>
          </div>
        )}

        {consentAsk && (
          <div role="dialog" aria-label={tr("Use your location?")} className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
            <div className={`max-w-xs space-y-3 rounded-xl p-4 text-sm ${GLASS} bg-white dark:bg-slate-900`}>
              <p className="font-semibold">{tr("Use your location?")}</p>
              <p className="text-xs leading-relaxed">{tr("Your exact spot is kept private and used only to improve the flood map. We only read it when you tap, and never show it to anyone.")}</p>
              <div className="flex gap-2">
                <button type="button" className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white" onClick={() => { setConsented(true); setConsentAsk(false); findMe(); }}>{tr("Use my location")}</button>
                <button type="button" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600" onClick={() => setConsentAsk(false)}>{tr("Not now")}</button>
              </div>
            </div>
          </div>
        )}
        {ctx && (
          <div
            ref={menuRef} role="menu" aria-label={tr("Map")} onKeyDown={onMenuKey}
            className={`absolute z-30 w-60 rounded-xl p-1 text-xs ${GLASS}`}
            style={{ left: Math.max(8, Math.min(ctx.x, (wrap.current?.clientWidth ?? 600) - 248)), top: Math.max(8, Math.min(ctx.y, (wrap.current?.clientHeight ?? 600) - 190)) }}
          >
            <div className="flex items-start justify-between gap-1 px-2 py-1.5">
              <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-300">{ctx.line}</p>
              <button type="button" onClick={() => setCtx(null)} aria-label={tr("Close")} className="-mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="size-4" /></button>
            </div>
            <a role="menuitem" href={`https://www.google.com/maps/search/?api=1&query=${ctx.lat.toFixed(6)},${ctx.lon.toFixed(6)}`} target="_blank" rel="noopener noreferrer" onClick={() => setCtx(null)} className="flex min-h-9 items-center gap-2 rounded-md px-2 hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800"><ExternalLink className="size-4 text-slate-500" aria-hidden />{tr("Open in Google Maps")}</a>
            <button type="button" role="menuitem" onClick={() => void copyCoords()} className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800"><Copy className="size-4 text-slate-500" aria-hidden />{copied ? tr("Copied") : `${tr("Copy coordinates")} (${ctx.lat.toFixed(5)}, ${ctx.lon.toFixed(5)})`}</button>
            <button type="button" role="menuitem" onClick={() => { const c = ctx; setCtx(null); openReportRef.current?.({ lat: c.lat, lon: c.lon, src: "pin", acc: null }); }} className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800"><Flag className="size-4 text-slate-500" aria-hidden />{tr("Report here")}</button>
          </div>
        )}
        {rep && (survey ? <SurveyPanel onSheet={onSurveySheet} pos={rep} cell={cell} onClose={() => { setRep(null); setSurvey(false); }} onLocate={locate} geoMsg={geoMsg} tr={tr} lang={lang} /> : <ReportPanel pos={rep} cell={cell} onClose={() => setRep(null)} tr={tr} lang={lang} photosEnabled={photosEnabled} />)}

        {/* panel: bottom sheet on phones, side card on desktop */}
        {!rep && (panelOpen ? (
          <aside
            aria-label={tr("Options")}
            className={`absolute inset-x-0 bottom-0 z-10 flex flex-col rounded-t-2xl md:inset-x-auto md:bottom-11 md:right-3 md:top-16 md:w-80 md:rounded-xl h-[var(--sh)] md:h-auto ${GLASS}`}
            style={{ ["--sh" as string]: `${sheetPx ?? sheetHeights()[snap]}px`, paddingBottom: "env(safe-area-inset-bottom, 0px)", transition: dragRef.current ? "none" : "height .2s ease" }}
          >
            <div className="flex shrink-0 items-center justify-between md:px-3 md:pt-1.5">
              {/* phones: the whole top strip (full width, 44 px tall) is the grab area; drag to resize, tap to step through the sizes */}
              <button type="button" aria-label={tr("Options")} onPointerDown={onSheetDown} onPointerMove={onSheetMove} onPointerUp={onSheetUp} onPointerCancel={onSheetUp} className="flex h-11 w-full cursor-grab touch-none select-none flex-col items-center justify-center gap-1 rounded-t-2xl md:hidden"><span className="h-1.5 w-12 rounded-full bg-slate-400 dark:bg-slate-500" /><span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{tr("Options")}</span></button>
              <p className="hidden text-xs font-semibold md:block">{tr("Options")}</p>
              <button type="button" onClick={() => setPanelOpen(false)} aria-label={tr("Hide")} title={tr("Hide")} className="hidden size-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 md:flex"><PanelRightClose className="size-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{panelBody}</div>
          </aside>
        ) : (
          <button type="button" onClick={() => setPanelOpen(true)} className={`absolute z-10 flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${GLASS}`} style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 44px)", right: 12 }}><SlidersHorizontal className="size-4" aria-hidden /> {tr("Options")}</button>
        ))}
        <style>{".f3d-popup .maplibregl-popup-close-button{width:44px;height:44px;font-size:24px;line-height:1;color:#475569;border-radius:0 12px 0 12px} .f3d-popup .maplibregl-popup-content{padding:12px 44px 12px 14px;border-radius:12px;box-shadow:0 8px 24px rgba(15,23,42,.22)} .maplibregl-ctrl-bottom-left{margin-bottom:44px} @media (max-width:767px){.maplibregl-ctrl-top-right{margin-top:60px}} .maplibregl-ctrl-group{border-radius:10px;box-shadow:0 1px 6px rgba(15,23,42,.18)}"}</style>
        {!ready && !err && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-500">{tr("Loading map…")}</div>}
        {err && <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-red-700">{err}</div>}
      </div>
      {/* TODO(si, ta): strings are drafts (strings.ts); review with a native speaker before this leaves /lab. */}
    </div>
  );
}

/** Upsample the level grid S times: levels bilinear (smooth shorelines, no blocky 30 m cells), flags nearest. */
function buildUp(g: { L: Float32Array; hw: Float32Array; cls: Uint8Array; band: Uint8Array; river: Uint8Array; unc: Uint8Array; wet: Uint8Array; w: number; h: number }, S: number) {
  const W2 = g.w * S, H2 = g.h * S;
  const L2 = new Float32Array(W2 * H2), hw2 = new Uint8Array(W2 * H2), fl = new Uint8Array(W2 * H2), cls2 = new Uint8Array(W2 * H2), band2 = new Uint8Array(W2 * H2);
  const cap = (v: number) => (Number.isFinite(v) ? v : 60);
  for (let y = 0; y < H2; y++) {
    const fy = Math.min(g.h - 1, Math.max(0, (y + 0.5) / S - 0.5)), y0 = Math.floor(fy), y1 = Math.min(g.h - 1, y0 + 1), ty = fy - y0;
    const ny = Math.min(g.h - 1, Math.floor(y / S));
    for (let x = 0; x < W2; x++) {
      const fx = Math.min(g.w - 1, Math.max(0, (x + 0.5) / S - 0.5)), x0 = Math.floor(fx), x1 = Math.min(g.w - 1, x0 + 1), tx = fx - x0;
      const i = y * W2 + x, n = ny * g.w + Math.min(g.w - 1, Math.floor(x / S));
      L2[i] = (cap(g.L[y0 * g.w + x0]) * (1 - tx) + cap(g.L[y0 * g.w + x1]) * tx) * (1 - ty) + (cap(g.L[y1 * g.w + x0]) * (1 - tx) + cap(g.L[y1 * g.w + x1]) * tx) * ty;
      hw2[i] = Math.round(g.hw[n] * 10); fl[i] = g.river[n] | (g.unc[n] << 1) | (g.wet[n] << 2); cls2[i] = g.cls[n]; band2[i] = g.band[n];
    }
  }
  return { W2, H2, L2, hw2, fl, cls2, band2 };
}

async function loadGrid() {
  const img = await createImageBitmap(await (await fetch("/flood3d/level.webp")).blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const x = c.getContext("2d", { willReadFrequently: true })!; x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const n = c.width * c.height;
  const L = new Float32Array(n), hw = new Float32Array(n), cls = new Uint8Array(n), band = new Uint8Array(n), river = new Uint8Array(n), unc = new Uint8Array(n), wet = new Uint8Array(n), built = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    river[i] = r === 255 ? 1 : 0;
    L[i] = r === 0 || r === 255 ? Infinity : (r - 1) / PX.step + PX.lo;
    hw[i] = g / 10; cls[i] = b & 3; band[i] = (b >> 2) & 7; unc[i] = (b >> 5) & 1; wet[i] = (b >> 6) & 1; built[i] = (b >> 7) & 1;
  }
  return { L, hw, cls, band, river, unc, wet, built, w: c.width, h: c.height };
}
