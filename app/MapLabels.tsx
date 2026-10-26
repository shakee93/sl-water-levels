"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMap, useMapEvents } from "react-leaflet";
import { formatLevel } from "@/lib/units";
import { stationDisplayName } from "@/lib/displayName";
import { riverName } from "@/lib/i18n/format";
import { RIVER_NAME_LINES } from "@/lib/geo/homeRivers";
import { TIER_HEX, type HomeStation } from "./tierUi";
import { useI18n } from "./LocaleProvider";
import type { HomeLake } from "./MapClient";

// The labels of the home map: river names along their lines, towns, gauge names and levels, and the
// names of reservoirs that are releasing. They are drawn in an overlay above the map and placed in
// screen pixels with one collision pass (priority order, first free spot wins, the rest are dropped),
// so nothing overlaps whatever the zoom or screen size. Only the dots stay interactive.

const TOWNS: [string, number, number][] = [
  ["Colombo", 6.9271, 79.8612], ["Kandy", 7.2906, 80.6337], ["Galle", 6.0535, 80.221], ["Matara", 5.9549, 80.555],
  ["Jaffna", 9.6615, 80.0255], ["Trincomalee", 8.5874, 81.2152], ["Batticaloa", 7.7102, 81.6924], ["Anuradhapura", 8.3114, 80.4037],
  ["Kurunegala", 7.4863, 80.3623], ["Ratnapura", 6.6828, 80.3992], ["Badulla", 6.9934, 81.055], ["Hambantota", 6.1241, 81.1185],
  ["Chilaw", 7.5758, 79.7953], ["Kalutara", 6.5854, 79.9607], ["Vavuniya", 8.7514, 80.4971], ["Mannar", 8.981, 79.9044],
  ["Polonnaruwa", 7.9403, 81.0188], ["Nuwara Eliya", 6.9497, 80.7891],
];

type Box = { x0: number; y0: number; x1: number; y1: number };
type Item = { kind: "text"; key: string; x: number; y: number; w: number; h: number; text: string; cls: string; level?: { text: string; color: string; dark: boolean }; rot?: number; dot?: { x: number; y: number } };

const FAMILY = 'Arial, Helvetica, "Noto Sans Sinhala", "Noto Sans Tamil", sans-serif';
let ctx: CanvasRenderingContext2D | null = null;
function textW(s: string, bold = false, px = 11): number {
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return s.length * 6.2;
  ctx.font = `${bold ? 600 : 400} ${px}px ${FAMILY}`;
  return ctx.measureText(s).width;
}

const hit = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

export function MapLabels({ stations, lakes, scheme, user }: { stations: HomeStation[]; lakes: HomeLake[]; scheme: "light" | "dark"; user: { lat: number; lon: number } | null }) {
  const map = useMap();
  const { lang } = useI18n();
  const [items, setItems] = useState<Item[]>([]);
  const raf = useRef(0);

  const compute = useCallback(() => {
    const size = map.getSize();
    const z = map.getZoom();
    const W = size.x, H = size.y;
    const P = (lat: number, lon: number) => map.latLngToContainerPoint([lat, lon]);
    const inView = (x: number, y: number, m = 6) => x > m && x < W - m && y > m && y < H - m;
    const phone = typeof window !== "undefined" && window.innerWidth < 640;
    const gfs = phone ? 10 : 11.5; // normal gauge names
    const rfs = phone ? 10 : 11; // river names
    const placed: Box[] = [];
    const solid: Box[] = []; // markers a river name must never cover
    // the dots and icons are obstacles
    for (const s of stations) {
      const p = P(s.latitude, s.longitude);
      const r = (s.tier === "alert" || s.tier === "minor" || s.tier === "major" ? 8 : 6) + 2;
      const bx = { x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r };
      placed.push(bx);
      if (r > 9) solid.push(bx);
    }
    for (const l of lakes) {
      const p = P(l.lat, l.lon);
      const bx = { x0: p.x - 10, y0: p.y - 8, x1: p.x + 10, y1: p.y + 8 };
      placed.push(bx);
      solid.push(bx);
    }
    if (user) {
      const p = P(user.lat, user.lon);
      placed.push({ x0: p.x - 14, y0: p.y - 14, x1: p.x + 14, y1: p.y + 14 });
    }
    // the key and the zoom buttons
    const cr = map.getContainer().getBoundingClientRect();
    const kr = map.getContainer().parentElement?.querySelector("[data-map-key]")?.getBoundingClientRect();
    if (kr && kr.width > 0) placed.push({ x0: kr.left - cr.left - 4, y0: kr.top - cr.top - 4, x1: kr.right - cr.left + 4, y1: kr.bottom - cr.top + 4 });
    placed.push({ x0: W - 44, y0: H - 90, x1: W, y1: H });

    const out: Item[] = [];
    const free = (b: Box) => b.x0 >= 2 && b.y0 >= 2 && b.x1 <= W - 2 && b.y1 <= H - 2 && !placed.some((q) => hit(q, b));
    const labelBoxes: Box[] = []; // other labels only (not the dots)
    const put = (b: Box) => { placed.push(b); labelBoxes.push(b); };

    /** A label beside a point: right, left, above, below. */
    const beside = (key: string, x: number, y: number, text: string, cls: string, opts: { bold?: boolean; level?: { text: string; color: string; dark: boolean }; gap?: number; dot?: boolean; force?: boolean; px?: number } = {}) => {
      if (!inView(x, y, 2)) return;
      const gap = opts.gap ?? 9;
      const lw = opts.level ? textW(opts.level.text, true) + 8 : 0;
      const w = textW(text, opts.bold, opts.px) + (opts.level ? lw + 4 : 0);
      const h = opts.level ? 16 : (opts.px ?? 11) + 3;
      const cands: [number, number][] = [
        [x + gap, y - h / 2], [x - gap - w, y - h / 2], [x - w / 2, y - gap - h + 2], [x - w / 2, y + gap - 2],
        [x + gap * 0.7, y - gap - h + 4], [x - gap * 0.7 - w, y - gap - h + 4], [x + gap * 0.7, y + gap - 4], [x - gap * 0.7 - w, y + gap - 4],
      ];
      const boxes = cands.map(([bx, by]) => ({ bx, by, b: { x0: bx - 1.5, y0: by - 1, x1: bx + w + 1.5, y1: by + h + 1 } }));
      let pick = boxes.find(({ b }) => free(b));
      // a data label must show: in a crowd of dots take the spot that covers the fewest dots, never another label
      if (!pick && opts.force) {
        const ok = boxes.filter(({ b }) => b.x0 >= 2 && b.y0 >= 2 && b.x1 <= W - 2 && b.y1 <= H - 2 && !labelBoxes.some((q) => hit(q, b)));
        const n = (b: Box) => placed.filter((q) => !labelBoxes.includes(q) && hit(q, b)).length;
        pick = ok.sort((a, c) => n(a.b) - n(c.b))[0];
      }
      if (pick) {
        const { bx, by, b } = pick;
        put(b);
        out.push({ kind: "text", key, x: bx, y: by, w, h, text, cls, level: opts.level, dot: opts.dot ? { x, y } : undefined });
        if (opts.dot) put({ x0: x - 4, y0: y - 4, x1: x + 4, y1: y + 4 });
        return;
      }
    };

    const hot = (s: HomeStation) => s.tier === "alert" || s.tier === "minor" || s.tier === "major";
    const gaugeLabel = (s: HomeStation) => {
      const p = P(s.latitude, s.longitude);
      const lvl = s.level != null && s.tier !== "stale" && s.tier !== "none" ? formatLevel(s.level, s.unit) : null;
      const key = `g:${s.basin}|${s.station}`;
      if (!hot(s)) {
        beside(key, p.x, p.y, stationDisplayName(s.station), phone ? "text-[10px] text-slate-700 dark:text-slate-300" : "text-[11.5px] font-medium text-slate-700 dark:text-slate-300", { gap: 10, px: gfs });
        return;
      }
      beside(key, p.x, p.y, stationDisplayName(s.station), "font-semibold text-slate-800 dark:text-slate-100", {
        bold: true,
        level: lvl ? { text: lvl, color: TIER_HEX[s.tier], dark: s.tier === "alert" } : undefined,
        gap: 13,
        force: true,
      });
    };

    // 1. gauges at watch or above, with their level
    for (const s of stations.filter(hot)) gaugeLabel(s);
    // 2. reservoirs releasing now
    for (const l of lakes) {
      const p = P(l.lat, l.lon);
      beside(`l:${l.slug}`, p.x, p.y, l.name, "font-medium text-sky-800 dark:text-sky-200", { gap: 12, force: true });
    }
    // 3. rivers: the name beside the line, turned with it, on the straightest stretch that is free
    const riverItem = (basin: string, pts: [number, number][]) => {
      const px = pts.map((q) => P(q[0], q[1]));
      const cum = [0];
      for (let i = 1; i < px.length; i++) cum.push(cum[i - 1] + Math.hypot(px[i].x - px[i - 1].x, px[i].y - px[i - 1].y));
      const total = cum[cum.length - 1];
      const nm = riverName(basin, lang);
      const full = nm.includes(" · ") ? nm.split(" · ")[1] : nm;
      const short = full.replace(/\s*(Ganga|Oya|Aru|Nadi|ගඟ|ඔය|ஆறு)$/i, "");
      const at = (d: number) => {
        let lo = 1, hi = cum.length - 1;
        while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < d) lo = m + 1; else hi = m; }
        const t = (d - cum[lo - 1]) / Math.max(cum[lo] - cum[lo - 1], 0.001);
        return { x: px[lo - 1].x + (px[lo].x - px[lo - 1].x) * t, y: px[lo - 1].y + (px[lo].y - px[lo - 1].y) * t };
      };
      // a river runs through its gauges, so a name may brush one plain dot; never another label
      const dots = (b: Box) => placed.filter((q) => !labelBoxes.includes(q) && hit(q, b)).length;
      const inB = (b: Box) => b.x0 >= 2 && b.y0 >= 2 && b.x1 <= W - 2 && b.y1 <= H - 2 && !labelBoxes.some((q) => hit(q, b)) && !solid.some((q) => hit(q, b));
      // a reservoir with the river's name is already labelled: don't say it twice
      if (lakes.some((l) => { const n = l.name.toLowerCase(), b = basin.trim().toLowerCase().replace(/\s+(ganga|oya)$/, ''); return n === basin.trim().toLowerCase() || n === b || n.startsWith(b + ' '); })) return;
      for (const text of short !== full ? [full, short] : [full]) {
        const w = textW(text, false, rfs) * 0.95 + 2;
        if (total < w + 16) continue;
        type Cand = { cx: number; cy: number; ang: number; bx: Box; straight: number };
        const cands: Cand[] = [];
        for (let d = w / 2 + 4; d <= total - w / 2 - 4; d += Math.max(6, w / 5)) {
          const a = at(d - w / 2), b = at(d + w / 2), c = at(d);
          const chord = Math.hypot(b.x - a.x, b.y - a.y);
          const straight = chord / w;
          if (straight < 0.65) continue;
          let ang = Math.atan2(b.y - a.y, b.x - a.x);
          if (ang > Math.PI / 2) ang -= Math.PI;
          if (ang < -Math.PI / 2) ang += Math.PI;
          for (const side of [-1, 1]) {
            const off = 7 * side;
            const cx = c.x - Math.sin(ang) * off, cy = c.y + Math.cos(ang) * off;
            if (!inView(cx, cy, 8)) continue;
            const hw = (Math.abs(Math.cos(ang)) * w + Math.abs(Math.sin(ang)) * 11) / 2;
            const hh = (Math.abs(Math.sin(ang)) * w + Math.abs(Math.cos(ang)) * 11) / 2;
            cands.push({ cx, cy, ang, straight, bx: { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh } });
          }
        }
        cands.sort((p, q) => q.straight - p.straight);
        const pick = cands.find((c) => inB(c.bx) && dots(c.bx) === 0) ?? cands.find((c) => inB(c.bx) && dots(c.bx) <= 2);
        if (!pick) continue;
        put(pick.bx);
        out.push({ kind: "text", key: `r:${basin}`, x: pick.cx - w / 2, y: pick.cy - 6, w, h: 12, text, cls: phone ? "italic text-[10px] font-medium text-sky-800 dark:text-sky-200" : "italic text-[11px] font-semibold text-sky-800 dark:text-sky-200", rot: (pick.ang * 180) / Math.PI });
        return;
      }
    };
    const rivers = RIVER_NAME_LINES;
    const nMajor = phone ? 5 : 10;
    for (const r of rivers.slice(0, nMajor)) riverItem(r.basin, r.pts);
    // 4. towns
    if (z >= 6.5) for (const [name, lat, lon] of TOWNS) {
      const p = P(lat, lon);
      beside(`t:${name}`, p.x, p.y, name, "text-slate-500 dark:text-slate-400", { gap: 6, dot: true });
    }
    // 5. every other gauge once zoomed in; the other rivers
    // the crowded south-west (Kelani, Kalu, Gin) names only a few anchor gauges until zoomed in
    const ANCHORS = new Set(["Hanwella", "Nagalagam Street", "Rathnapura", "Baddegama", "Glencourse"]);
    const crowded = (s: HomeStation) => s.latitude > 5.9 && s.latitude < 7.3 && s.longitude > 79.8 && s.longitude < 80.6;
    const plain = stations.filter((x) => !hot(x)).sort((a, b) => Number(ANCHORS.has(b.station)) - Number(ANCHORS.has(a.station)));
    if (!phone || z >= 9) for (const s of plain) if (z >= 9 || !crowded(s) || ANCHORS.has(s.station)) gaugeLabel(s);
    if (!phone) for (const r of rivers.slice(nMajor)) riverItem(r.basin, r.pts);
    else if (z >= 8) for (const r of rivers.slice(nMajor)) riverItem(r.basin, r.pts);
    setItems(out);
  }, [map, stations, lakes, user, lang]);

  const schedule = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(compute);
  }, [compute]);
  useMapEvents({ move: schedule, zoom: schedule, resize: schedule });
  useEffect(() => {
    schedule();
    // the key opens and closes: place the labels again around it
    const key = map.getContainer().parentElement?.querySelector("[data-map-key]");
    const ro = key && typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (key && ro) ro.observe(key);
    return () => {
      ro?.disconnect();
      cancelAnimationFrame(raf.current);
    };
  }, [schedule, map]);

  const halo = useMemo(
    () => (scheme === "dark" ? "0 0 3px #0f172a,0 0 3px #0f172a,0 0 3px #0f172a,0 0 2px #0f172a,0 0 2px #0f172a" : "0 0 3px #fff,0 0 3px #fff,0 0 3px #fff,0 0 2px #fff,0 0 2px #fff"),
    [scheme],
  );

  return createPortal(
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 620, fontSize: 11, lineHeight: "13px" }}>
      {items.map((it) => (
        <div key={it.key}>
          {it.dot && <span className="absolute size-[5px] rounded-full border border-slate-400 dark:border-slate-500" style={{ left: it.dot.x - 2.5, top: it.dot.y - 2.5 }} />}
          <span
            className={`absolute whitespace-nowrap ${it.cls}`}
            style={{ left: it.x, top: it.y, width: it.w, height: it.h, textShadow: halo, transform: it.rot != null ? `rotate(${it.rot}deg)` : undefined, display: "flex", alignItems: "center", gap: 4 }}
          >
            <span>{it.text}</span>
            {it.level && (
              <span className="rounded px-1 font-semibold" style={{ background: it.level.color, color: it.level.dark ? "#0f172a" : "#fff", textShadow: "none", lineHeight: "14px" }}>
                {it.level.text}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>,
    map.getContainer(),
  );
}
