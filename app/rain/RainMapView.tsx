"use client";

// The rain map drawing (loaded lazily by RainMap). Plain SVG + small canvases, no map SDK:
//  - land and rivers from the OpenStreetMap geometry already used by the home map (lib/geo/homeRivers.ts)
//  - rain from a 25 x 42 grid (satellite, 0.1 degree) or 10 x 17 (forecast, 0.25 degree), interpolated and coloured by rain word;
//    the forecast is drawn striped so it never reads as rain that fell
//  - gauges coloured by level, with the mm their own sensor measured when it is moderate rain or more
//  - tap a river area (or a gauge) for what the rain means for that river
// Data only from our own /api/rain-map.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Pause, Play, X } from "lucide-react";
import { HOME_COAST, HOME_RIVERS } from "@/lib/geo/homeRivers";
import { basinForecast, basinSatellite, decodeFrame, forecastTotal, satelliteTotal, type RainMapData, type RainMapGauge } from "@/lib/rainMapCalc";
import { RAIN_BANDS, rainBand, rainWordOf, satelliteCaveat, type RainBand, type RainWindow } from "@/lib/rainWords";
import { rmFor } from "@/lib/i18n/rainMap";
import { clock } from "@/lib/i18n/format";
import { basinPath } from "@/lib/slug";
import { TIER_HEX, tierLabel, tierRank } from "../tierUi";
import { useI18n } from "../LocaleProvider";
import type { TFn } from "@/lib/i18n/translate";

const HOUR = 3_600_000;
// Map frame = the satellite grid's extent: 79.5..82.0 E, 5.8..10.0 N; x scaled by cos(7.9 deg) so the island keeps its shape.
const LON0 = 79.5, LON1 = 82.0, LAT0 = 10.0, LAT1 = 5.8;
const W = 500;
const H = Math.round((W * (LAT0 - LAT1)) / ((LON1 - LON0) * Math.cos((7.9 * Math.PI) / 180)));
const px = (lon: number) => ((lon - LON0) / (LON1 - LON0)) * W;
const py = (lat: number) => ((LAT0 - lat) / (LAT0 - LAT1)) * H;
const r1 = (n: number) => Math.round(n * 10) / 10;
const line = (pts: [number, number][]) => pts.map(([lat, lon], i) => `${i ? "L" : "M"}${r1(px(lon))} ${r1(py(lat))}`).join("");

// Static geometry, projected once per page load.
const COAST_D = HOME_COAST.map((r) => `${line(r)}Z`).join("");
const RIVER_MAIN_D = HOME_RIVERS.filter((r) => r.main).map((r) => line(r.pts)).join("");
const RIVER_TRIB_D = HOME_RIVERS.filter((r) => !r.main).map((r) => line(r.pts)).join("");

type Tab = "1h" | "3h" | "24h" | "f24";
type View = { kind: "total"; tab: Tab } | { kind: "hour"; i: number };

/** Band colours (RGBA). The same four words as everywhere on the site (lib/rainWords.ts). */
const BAND_RGBA: Record<Exclude<RainBand, "none">, [number, number, number, number]> = {
  light: [125, 211, 252, 150],
  moderate: [59, 130, 246, 185],
  heavy: [29, 78, 216, 210],
  veryHeavy: [192, 38, 211, 225],
};
const BAND_CSS = Object.fromEntries(Object.entries(BAND_RGBA).map(([k, [r, g, b, a]]) => [k, `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`])) as Record<keyof typeof BAND_RGBA, string>;

/**
 * Draw one layer: the grid values are interpolated bilinearly onto a canvas UP times finer and each pixel is coloured by its rain
 * band, so the bands read as smooth areas instead of 10 km squares. Missing values (null / negative) are left clear.
 */
const UP = 12;
function paint(canvas: HTMLCanvasElement | null, values: (number | null)[] | null, nx: number, ny: number, win: RainWindow) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = nx * UP;
  canvas.height = ny * UP;
  if (!values) return;
  const img = ctx.createImageData(nx * UP, ny * UP);
  const at = (r: number, c: number) => {
    const v = values[Math.min(ny - 1, Math.max(0, r)) * nx + Math.min(nx - 1, Math.max(0, c))];
    return v == null || v < 0 ? null : v;
  };
  for (let y = 0; y < ny * UP; y++) {
    const gy = (y + 0.5) / UP - 0.5, r = Math.floor(gy), fy = gy - r;
    for (let x = 0; x < nx * UP; x++) {
      const gx = (x + 0.5) / UP - 0.5, c = Math.floor(gx), fx = gx - c;
      const q = [at(r, c), at(r, c + 1), at(r + 1, c), at(r + 1, c + 1)];
      const w = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
      let s = 0, ws = 0;
      for (let k = 0; k < 4; k++) if (q[k] != null) { s += q[k]! * w[k]; ws += w[k]; }
      if (ws < 0.5) continue;
      const b = rainBand(win, s / ws);
      if (!b || b === "none") continue;
      img.data.set(BAND_RGBA[b], (y * nx * UP + x) * 4);
    }
  }
  ctx.putImageData(img, 0, 0);
}

export type RainMapStrings = { rivers: Record<string, string> };

export function RainMapView({ rivers }: RainMapStrings) {
  const { t, lang } = useI18n();
  const rm = rmFor(lang);
  const [data, setData] = useState<RainMapData | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>({ kind: "total", tab: "24h" });
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const satRef = useRef<HTMLCanvasElement>(null);
  const fcRef = useRef<HTMLCanvasElement>(null);

  // load, then refresh every 10 minutes while the tab is visible
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/rain-map")
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((d: RainMapData) => { if (alive) { setData(d); setFailed(false); } })
        .catch(() => { if (alive) setFailed(true); });
    load();
    const id = setInterval(() => { if (document.visibilityState === "visible") load(); }, 600_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const nowHour = data ? Math.floor(data.generatedAt / HOUR) * HOUR : 0;

  // what to draw for the current view
  const frame = useMemo(() => {
    if (!data) return null;
    const sat = (vals: (number | null)[] | null, win: RainWindow) => ({ layer: "sat" as const, vals, win });
    // forecast values come per kept point: spread them onto the full forecast grid (sea points stay clear)
    const fc = (vals: (number | null)[] | null, win: RainWindow) => {
      const g = data.forecast?.grid;
      let full: (number | null)[] | null = null;
      if (vals && g && data.forecast) {
        full = new Array(g.nx * g.ny).fill(null);
        data.forecast.points.forEach(([r, c], i) => { full![r * g.nx + c] = vals[i]; });
      }
      return { layer: "fc" as const, vals: full, win };
    };
    if (view.kind === "total") {
      if (view.tab === "f24") return fc(forecastTotal(data, 24), "24h");
      const h = view.tab === "1h" ? 1 : view.tab === "3h" ? 3 : 24;
      return sat(satelliteTotal(data, h), view.tab);
    }
    if (view.i < 0) {
      const start = nowHour + view.i * HOUR;
      const hr = data.satellite?.hours.find((x) => x.start === start);
      return sat(hr ? decodeFrame(hr.v) : null, "1h");
    }
    const end = nowHour + (view.i + 1) * HOUR;
    const hr = data.forecast?.hours.find((x) => x.end === end);
    return fc(hr ? decodeFrame(hr.v) : null, "1h");
  }, [data, view, nowHour]);

  useEffect(() => {
    if (!data || !frame) return;
    paint(satRef.current, frame.layer === "sat" ? frame.vals : null, data.grid.nx, data.grid.ny, frame.win);
    paint(fcRef.current, frame.layer === "fc" ? frame.vals : null, data.forecast?.grid.nx ?? 1, data.forecast?.grid.ny ?? 1, frame.win);
  }, [data, frame]);

  // play hour by hour, -24 h to +24 h
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setView((v) => {
        const i = v.kind === "hour" ? v.i + 1 : -24;
        if (i > 23) { setPlaying(false); return { kind: "hour", i: 23 }; }
        return { kind: "hour", i };
      });
    }, 700);
    return () => clearInterval(id);
  }, [playing]);

  const fell24 = useMemo(() => (data ? basinSatellite(data, 24) : []), [data]);
  const next24 = useMemo(() => (data ? basinForecast(data, 24) : []), [data]);
  const next6 = useMemo(() => (data ? basinForecast(data, 6) : []), [data]);
  const gaugeBy = useMemo(() => new Map((data?.gauges ?? []).map((g) => [g.station, g])), [data]);
  const basinIdx = useMemo(() => new Map((data?.basins ?? []).map((b, i) => [b.basin, i])), [data]);

  const outline = useMemo(() => {
    if (!data || sel == null) return "";
    const { nx, ny } = data.grid;
    const inB = (r: number, c: number) => r >= 0 && r < ny && c >= 0 && c < nx && data.basinOf[r * nx + c] === sel;
    const cw = W / nx, ch = H / ny;
    let d = "";
    for (let r = 0; r < ny; r++)
      for (let c = 0; c < nx; c++) {
        if (!inB(r, c)) continue;
        const x = r1(c * cw), y = r1(r * ch), x2 = r1((c + 1) * cw), y2 = r1((r + 1) * ch);
        if (!inB(r - 1, c)) d += `M${x} ${y}H${x2}`;
        if (!inB(r + 1, c)) d += `M${x} ${y2}H${x2}`;
        if (!inB(r, c - 1)) d += `M${x} ${y}V${y2}`;
        if (!inB(r, c + 1)) d += `M${x2} ${y}V${y2}`;
      }
    return d;
  }, [data, sel]);

  function tapMap(e: React.MouseEvent<SVGSVGElement>) {
    if (!data) return;
    const box = e.currentTarget.getBoundingClientRect();
    const c = Math.floor(((e.clientX - box.left) / box.width) * data.grid.nx);
    const r = Math.floor(((e.clientY - box.top) / box.height) * data.grid.ny);
    if (r < 0 || r >= data.grid.ny || c < 0 || c >= data.grid.nx) return;
    const b = data.basinOf[r * data.grid.nx + c];
    setSel(b >= 0 ? b : null);
  }

  // gauge mm label for the past windows (measured at the gauge, moderate rain or more)
  const labelWin: { win: RainWindow; key: "mm1h" | "mm3h" | "mm24h" } | null =
    view.kind === "total" && view.tab !== "f24" ? { win: view.tab, key: view.tab === "1h" ? "mm1h" : view.tab === "3h" ? "mm3h" : "mm24h" } : null;
  const legendWin: RainWindow = frame?.win ?? "24h";
  const isFc = frame?.layer === "fc";

  // caption over the map: which layer, which hours
  let caption = "";
  let note: string | null = null;
  if (data && frame) {
    const satHours = data.satellite?.hours ?? [];
    const lastSat = satHours.at(-1);
    if (view.kind === "total" && view.tab === "f24") {
      caption = rm("frame.fcTotal", { from: clock(nowHour, t) });
      if (!data.forecast) note = rm("frame.noFc");
    } else if (view.kind === "total") {
      const h = view.tab === "1h" ? 1 : view.tab === "3h" ? 3 : 24;
      caption = lastSat ? rm("frame.satTotal", { h, to: clock(lastSat.start + HOUR, t) }) : "";
      if (!data.satellite) note = rm("frame.noSat");
      else if (h === 24 && satHours.length < 24) note = rm("frame.partial", { n: satHours.length });
    } else if (view.i < 0) {
      const s = nowHour + view.i * HOUR;
      caption = rm("frame.sat", { from: clock(s, t), to: clock(s + HOUR, t) });
      if (!frame.vals) note = data.satellite ? rm("frame.notIn") : rm("frame.noSat");
    } else {
      const s = nowHour + view.i * HOUR;
      caption = rm("frame.fc", { from: clock(s, t), to: clock(s + HOUR, t) });
      if (!frame.vals) note = rm("frame.noFc");
    }
  }

  const sliderI = view.kind === "hour" ? view.i : view.tab === "f24" ? 0 : -1;
  const tabs: Tab[] = ["1h", "3h", "24h", "f24"];
  const selBasin = sel != null ? data?.basins[sel] : null;

  // rivers ranked by rain in the last 24 h, for the card when nothing is selected
  const ranked = data
    ? data.basins.map((b, i) => ({ i, b, mm: fell24[i] })).filter((x) => x.mm != null && x.mm >= 2.5).sort((a, b) => (b.mm ?? 0) - (a.mm ?? 0)).slice(0, 6)
    : [];

  return (
    <div className="lg:grid lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-6">
      {/* map */}
      <div className="relative mx-auto" style={{ width: `min(100%, max(320px, calc(78vh * ${W} / ${H})))`, aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full rounded-xl" aria-hidden>
          <rect width={W} height={H} className="fill-[#d6e8f5] dark:fill-[#10263d]" />
          <path d={COAST_D} className="fill-[#f6f5f1] stroke-[#7d9db8] dark:fill-[#1a2433] dark:stroke-[#5b7da0]" strokeWidth={1} strokeLinejoin="round" />
        </svg>
        <canvas ref={satRef} className="absolute inset-0 h-full w-full" aria-hidden />
        {data?.forecast && (
          <canvas
            ref={fcRef}
            className="absolute"
            style={{
              left: `${(px(data.forecast.grid.lon0 - data.forecast.grid.step / 2) / W) * 100}%`,
              top: `${(py(data.forecast.grid.lat0 + data.forecast.grid.step / 2) / H) * 100}%`,
              width: `${((data.forecast.grid.nx * data.forecast.grid.step) / (LON1 - LON0)) * 100}%`,
              height: `${((data.forecast.grid.ny * data.forecast.grid.step) / (LAT0 - LAT1)) * 100}%`,
            }}
            aria-hidden
          />
        )}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="absolute inset-0 h-full w-full cursor-pointer select-none"
          role="img"
          aria-label={rm("map.aria")}
          onClick={tapMap}
        >
          <defs>
            <pattern id="rm-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="9" strokeWidth="3" className="stroke-white/70 dark:stroke-slate-950/70" />
            </pattern>
          </defs>
          {isFc && <rect width={W} height={H} fill="url(#rm-hatch)" />}
          <path d={COAST_D} fill="none" strokeWidth={1.1} strokeLinejoin="round" className="stroke-[#7d9db8] dark:stroke-[#5b7da0]" />
          <path d={RIVER_TRIB_D} fill="none" strokeWidth={0.7} strokeLinecap="round" strokeLinejoin="round" className="stroke-sky-400/70 dark:stroke-sky-500/60" />
          <path d={RIVER_MAIN_D} fill="none" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="stroke-sky-500 dark:stroke-sky-400" />
          {outline && (
            <>
              <path d={outline} fill="none" strokeWidth={5} strokeLinecap="round" className="stroke-white/90 dark:stroke-slate-950/90" />
              <path d={outline} fill="none" strokeWidth={2.2} strokeLinecap="round" className="stroke-slate-900 dark:stroke-amber-300" />
            </>
          )}
          {(data?.gauges ?? []).map((g) => (
            <GaugeDot
              t={t}
              key={`${g.basin}/${g.station}`}
              g={g}
              label={labelWin && g.measured ? g.measured[labelWin.key] : null}
              win={labelWin?.win ?? "1h"}
              selected={sel != null && basinIdx.get(g.basin) === sel}
              onTap={() => {
                const b = basinIdx.get(g.basin);
                setSel(b ?? null);
              }}
            />
          ))}
          <text x={W - 6} y={H - 6} textAnchor="end" fontSize={9} className="fill-slate-500 dark:fill-slate-400">© OpenStreetMap contributors</text>
        </svg>
        {/* caption */}
        <div className="pointer-events-none absolute left-2 right-2 top-2 flex flex-col items-start gap-1">
          {caption && (
            <span className={`rounded-md px-2 py-1 text-xs font-medium shadow-sm ${isFc ? "bg-amber-50/95 text-amber-900 ring-1 ring-amber-300 dark:bg-amber-950/90 dark:text-amber-100 dark:ring-amber-800" : "bg-white/95 text-slate-800 ring-1 ring-slate-200 dark:bg-slate-900/90 dark:text-slate-100 dark:ring-slate-700"}`}>
              {caption}
            </span>
          )}
          {note && <span className="max-w-[90%] rounded-md bg-white/95 px-2 py-1 text-xs text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900/90 dark:text-slate-300 dark:ring-slate-700">{note}</span>}
        </div>
        {!data && (
          <div className="absolute inset-0 grid place-items-center rounded-xl bg-slate-50/70 text-sm text-slate-600 dark:bg-slate-900/70 dark:text-slate-300">
            {failed ? rm("failed") : rm("loading")}
          </div>
        )}
      </div>

      {/* controls and the river card */}
      <div className="mt-4 lg:mt-0 lg:max-w-md">
        <div role="tablist" aria-label={rm("legend.title")} className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1 text-sm dark:bg-slate-800">
          {tabs.map((k) => {
            const on = view.kind === "total" && view.tab === k;
            return (
              <button
                key={k}
                role="tab"
                aria-selected={on}
                onClick={() => { setPlaying(false); setView({ kind: "total", tab: k }); }}
                className={`rounded-md px-1 py-2 font-medium leading-tight transition ${on ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100" : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"} ${k === "f24" ? "underline decoration-dashed decoration-amber-500 underline-offset-4" : ""}`}
              >
                {rm(`tab.${k}`)}
              </button>
            );
          })}
        </div>

        {/* slider */}
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { if (!playing && (view.kind !== "hour" || view.i >= 23)) setView({ kind: "hour", i: -24 }); setPlaying(!playing); }}
              className="grid size-11 shrink-0 place-items-center rounded-full border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              aria-label={playing ? rm("pause") : rm("play")}
            >
              {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
            </button>
            <div className="relative min-w-0 flex-1">
              {/* forecast half of the track is striped */}
              <div className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-sky-200 dark:bg-sky-900" aria-hidden>
                <div className="absolute inset-y-0 right-0 w-1/2 bg-[repeating-linear-gradient(45deg,#fcd34d_0_4px,#fef3c7_4px_8px)] dark:bg-[repeating-linear-gradient(45deg,#92400e_0_4px,#451a03_4px_8px)]" />
              </div>
              <input
                type="range"
                min={-24}
                max={23}
                step={1}
                value={sliderI}
                onChange={(e) => { setPlaying(false); setView({ kind: "hour", i: Number(e.target.value) }); }}
                className={`relative h-11 w-full cursor-pointer appearance-none bg-transparent accent-slate-800 dark:accent-slate-200 ${view.kind === "total" ? "opacity-60" : ""}`}
                aria-label={rm("slider.label")}
                aria-valuetext={view.kind === "hour" ? (view.i < 0 ? rm("slider.ago", { h: -view.i }) : view.i === 0 ? rm("slider.now") : rm("slider.ahead", { h: view.i })) : rm("slider.now")}
              />
            </div>
          </div>
          <div className="relative ml-[3.25rem] mt-0.5 h-4 text-[11px] text-slate-500 dark:text-slate-400" aria-hidden>
            <span className="absolute left-0">−24 h</span>
            <span className="absolute -translate-x-1/2 font-semibold text-slate-800 dark:text-slate-100" style={{ left: `${(24 / 47) * 100}%` }}>▲ {rm("slider.now")}</span>
            <span className="absolute right-0">+24 h</span>
          </div>
        </div>

        {/* legend */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
          {(["light", "moderate", "heavy", "veryHeavy"] as const).map((b, k) => {
            const e = RAIN_BANDS[legendWin];
            const range = k === 0 ? `< ${e.moderate}` : k === 1 ? `${e.moderate}–${e.heavy}` : k === 2 ? `${e.heavy}–${e.veryHeavy}` : `${e.veryHeavy}+`;
            return (
              <span key={b} className="inline-flex items-center gap-1">
                <span className="inline-block size-3 rounded-sm" style={{ background: BAND_CSS[b] }} aria-hidden />
                {rainWordOf(b, lang)} <span className="tabular-nums text-slate-500 dark:text-slate-400">{range} mm</span>
              </span>
            );
          })}
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-3 rounded-full border-2 border-white bg-slate-500 shadow dark:border-slate-900" aria-hidden />
            {rm("legend.gauge")}
          </span>
        </div>

        {/* river picker (keyboard and screen readers) */}
        {data && (
          <select
            value={sel ?? ""}
            onChange={(e) => setSel(e.target.value === "" ? null : Number(e.target.value))}
            className="mt-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900"
            aria-label={rm("card.hint")}
          >
            <option value="">{rm("card.hint")}</option>
            {data.basins.map((b, i) => (
              <option key={b.basin} value={i}>{rivers[b.basin] ?? b.basin}</option>
            ))}
          </select>
        )}

        {/* river card */}
        {data && selBasin && sel != null ? (
          <RiverCard
            name={rivers[selBasin.basin] ?? selBasin.basin}
            basin={selBasin.basin}
            dryZone={selBasin.dryZone}
            gauges={selBasin.gauges.map((s) => gaugeBy.get(s)).filter((g): g is RainMapGauge => !!g)}
            fell={fell24[sel]}
            next={next24[sel]}
            next6={next6[sel]}
            onClose={() => setSel(null)}
          />
        ) : (
          ranked.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              {ranked.map((x) => (
                <li key={x.b.basin}>
                  <button type="button" onClick={() => setSel(x.i)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <span className="inline-block size-3 shrink-0 rounded-sm" style={{ background: BAND_CSS[(rainBand("24h", x.mm) ?? "light") === "none" ? "light" : (rainBand("24h", x.mm) as keyof typeof BAND_CSS)] }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-medium">{rivers[x.b.basin] ?? x.b.basin}</span>
                    <span className="shrink-0 tabular-nums text-slate-600 dark:text-slate-300">{Math.round(x.mm!)} mm</span>
                    <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{rainWordOf(rainBand("24h", x.mm) ?? "none", lang)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        )}

        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
          {rm("note.sat")} {rm("note.fc")} {rm("note.areas")}
          {data && <> {rm("updated", { time: clock(data.generatedAt, t) })}.</>}
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{rm("note.credit")}</p>
      </div>
    </div>
  );
}

function GaugeDot({ t, g, label, win, selected, onTap }: { t: TFn; g: RainMapGauge; label: number | null; win: RainWindow; selected: boolean; onTap: () => void }) {
  const x = px(g.lon), y = py(g.lat);
  const band = label != null ? rainBand(win, label) : null;
  const show = band === "moderate" || band === "heavy" || band === "veryHeavy";
  const txt = show ? `${Math.round(label!)}` : "";
  return (
    <g
      onClick={(e) => { e.stopPropagation(); onTap(); }}
      className="cursor-pointer"
    >
      <title>{`${g.name}: ${tierLabel(t, g.tier)}${g.level ? `, ${g.level}` : ""}`}</title>
      <circle cx={x} cy={y} r={14} fill="transparent" />
      <circle cx={x} cy={y} r={selected ? 6.5 : 5.5} fill={TIER_HEX[g.tier]} strokeWidth={selected ? 2.5 : 1.8} className="stroke-white dark:stroke-slate-900" />
      {show && (
        <g transform={`translate(${r1(x + 8)} ${r1(y - 7)})`}>
          <rect width={txt.length * 6.2 + 8} height={14} rx={4} style={{ fill: BAND_CSS[band as keyof typeof BAND_CSS] }} className="stroke-white dark:stroke-slate-900" strokeWidth={1} />
          <text x={4} y={10.5} fontSize={10} fontWeight={600} className="fill-white">{txt}</text>
        </g>
      )}
    </g>
  );
}

function RiverCard({ name, basin, dryZone, gauges, fell, next, next6, onClose }: { name: string; basin: string; dryZone: boolean; gauges: RainMapGauge[]; fell: number | null; next: number | null; next6: number | null; onClose: () => void }) {
  const { t, p, lang } = useI18n();
  const rm = rmFor(lang);
  const worst = [...gauges].sort((a, b) => tierRank(a.tier) - tierRank(b.tier))[0];
  const fellBand = rainBand("24h", fell);
  const nextBand = rainBand("24h", next);
  const heavy = (mm: number | null | undefined) => { const b = rainBand("24h", mm); return b === "heavy" || b === "veryHeavy"; };
  // wet = heavy over the whole area, over the catchment above any gauge, or at any gauge's own sensor
  const wet = heavy(fell) || gauges.some((g) => heavy(g.above24h) || heavy(g.measured?.mm24h));
  const coming = heavy(next);
  // the gauges' own state first (it is what was measured), then what the rain means
  const level =
    worst && (worst.tier === "major" || worst.tier === "minor")
      ? rm("mean.flood", { gauge: worst.name, tier: tierLabel(t, worst.tier).toLowerCase() })
      : worst?.tier === "alert"
        ? rm("mean.alert", { gauge: worst.name })
        : worst?.tier === "watch"
          ? rm("mean.watch", { gauge: worst.name })
          : null;
  const rain = wet && coming ? rm("mean.wetComing") : wet ? rm("mean.wet") : coming ? rm("mean.coming") : level ? null : rm("mean.calm");
  const meaning = [level, rain].filter(Boolean).join(" ");
  const upper = gauges.find((g) => g.above24h != null);
  const outlet = [...gauges].reverse().find((g) => g.above24h != null);
  const measured = gauges.filter((g) => g.measured?.mm24h != null).sort((a, b) => (b.measured!.mm24h ?? 0) - (a.measured!.mm24h ?? 0))[0];
  return (
    <section className="mt-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900" aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">{name}</h2>
        <button type="button" onClick={onClose} className="-m-2 grid size-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800" aria-label={rm("card.close")}>
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{meaning}</p>
      <ul className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
        <li>{fell != null ? rm("card.fell", { mm: Math.round(fell), word: rainWordOf(fellBand ?? "none", lang) }) : rm("card.fellNone")}</li>
        {upper && outlet && upper.station !== outlet.station && <li>{rm("card.upper", { gauge: upper.name, mm: Math.round(upper.above24h!) })}</li>}
        {measured && (measured.measured!.mm24h ?? 0) >= 0.2 && <li>{rm("card.measured", { gauge: measured.name, mm: Math.round(measured.measured!.mm24h!) })}</li>}
        {next != null && (
          <li className="text-amber-900 dark:text-amber-200">
            {rm("card.next", { mm: Math.round(next), word: rainWordOf(nextBand ?? "none", lang) })}
            {next6 != null && <> {rm("card.next6", { mm: Math.round(next6) })}</>}
          </li>
        )}
      </ul>
      {fell != null && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{satelliteCaveat(dryZone ? basin : null, lang)}</p>}
      {gauges.length > 0 && (
        <>
          <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{rm("card.gauges")}</h3>
          <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
            {gauges.map((g) => (
              <li key={g.station}>
                <Link href={p(g.href)} className="flex items-center gap-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: TIER_HEX[g.tier] }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{g.name}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {[
                        tierLabel(t, g.tier),
                        g.above24h != null ? rm("card.above", { mm: Math.round(g.above24h) }) : null,
                        g.measured?.mm24h != null ? rm("card.atGauge", { mm: Math.round(g.measured.mm24h) }) : null,
                      ].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-700 dark:text-slate-200">{g.level ?? rm("card.noReading")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <Link href={p(basinPath(basin))} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-300">
        {rm("card.open")} <ArrowRight className="size-4" aria-hidden />
      </Link>
    </section>
  );
}
