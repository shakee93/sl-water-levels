"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { MapModel, MapNode } from "@/lib/riverMap";
import { TIER_HEX } from "./tierUi";

// The drawing for RiverMap (server). Plain SVG: the river line, dashed links from dams, a pulse of
// flow from a releasing dam down to its gauges, gauges coloured by level, dam icons, labels.
// On a touch screen the first tap on a point opens a small card under the map (name, state, link);
// a second tap, a mouse click or Enter follows the link. Every point is a real <a>.

export type MapStrings = {
  aria: string;
  hint: string;
  gauge: string;
  reservoir: string;
  release: string;
  simplified: string;
  list: string;
  openGauge: string;
  openReservoir: string;
};

const RES_FILL: Record<NonNullable<MapNode["status"]>, string> = {
  spilling: "#f59e0b",
  releasing: "#0ea5e9",
  holding: "#10b981",
  nodata: "#cbd5e1",
};

const num1 = (n: number) => Math.round(n * 10) / 10;
const halo = "stroke-white dark:stroke-slate-900 [paint-order:stroke]";
const labelCls = `fill-slate-700 dark:fill-slate-200 ${halo}`;
// on the real-geometry map the halo is the land colour (the sea label: the sea colour), so a label
// that has to cross a river still reads
const haloLand = "stroke-[#f6f5f1] dark:stroke-[#1a2433] [paint-order:stroke]";
const haloSea = "stroke-[#d6e8f5] dark:stroke-[#10263d] [paint-order:stroke]";

type SvgProps = {
  model: MapModel;
  cls: string;
  strings: MapStrings;
  sel: string | null;
  onSelect: (id: string) => void;
  onDown: (id: string) => void;
  onClick: (e: React.MouseEvent, id: string) => void;
};

function MapSvg({ model, cls, strings, sel, onSelect, onDown, onClick }: SvgProps) {
  const geo = model.geo;
  return (
      <svg
      viewBox={`0 0 ${model.w} ${model.h}`}
      className={`block w-full h-auto select-none ${geo ? "rounded" : "mx-auto max-w-[480px]"} ${cls}`}
      role="group"
      aria-label={strings.aria}
      style={{ fontSize: 10.5 }}
    >
      {geo && (
        <g aria-hidden>
          <rect width={model.w} height={model.h} className="fill-[#d6e8f5] dark:fill-[#10263d]" />
          {geo.land.map((d, i) => (
            <path key={i} d={d} strokeWidth={1} strokeLinejoin="round" className="fill-[#f6f5f1] stroke-[#7d9db8] dark:fill-[#1a2433] dark:stroke-[#5b7da0]" />
          ))}
          {geo.context.map((d, i) => (
            <path key={i} d={d} fill="none" strokeWidth={0.9} strokeLinecap="round" strokeLinejoin="round" className="stroke-sky-300/70 dark:stroke-slate-600/80" />
          ))}
        </g>
      )}
      {geo?.lakes.map((l) => (
        <path key={l.id} d={l.d} strokeWidth={1.6} strokeLinejoin="round" aria-hidden stroke={l.status === "nodata" ? "#94a3b8" : RES_FILL[l.status]} className="fill-sky-200 dark:fill-sky-900" />
      ))}
      {/* river */}
      {model.lines.map((l) => (
        <g key={l.id} aria-hidden>
          <path
            d={l.d}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={geo ? (l.trib ? 1.6 : 2.6) : l.trib ? 3 : 4.5}
            className={geo ? "stroke-sky-500 dark:stroke-sky-400" : "stroke-sky-200 dark:stroke-sky-900"}
          />
        </g>
      ))}
      {/* links from a dam to the river */}
      {model.links.map((l) => (
        <path key={l.id} d={l.d} fill="none" strokeWidth={1.4} strokeDasharray="3 3" strokeLinecap="round" aria-hidden className={l.active ? "stroke-amber-500" : "stroke-slate-400 dark:stroke-slate-500"} />
      ))}
      {/* water on the move */}
      {model.flows.map((f) => (
        <path key={f.id} d={f.d} fill="none" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 10" aria-hidden className="rm-flow stroke-amber-500 dark:stroke-amber-400" />
      ))}

      {model.nodes.map((n) => (
        <Node key={n.id} geo={!!geo} n={n} selected={sel === n.id} strings={strings} onSelect={() => onSelect(n.id)} onDown={() => onDown(n.id)} onClick={(e) => onClick(e, n.id)} />
      ))}

      {geo && (
        <g aria-hidden className="fill-slate-500 dark:fill-slate-400" fontSize={8.5}>
          {/* north arrow */}
          <g transform={`translate(${geo.northX} 14)`}>
            <path d="M0 -9L4.5 5L0 2.5L-4.5 5Z" className="fill-slate-600 dark:fill-slate-300" />
            <text y="16" textAnchor="middle" fontWeight={600} className={haloLand} strokeWidth={2.5}>N</text>
          </g>
          {geo.scale && (
            <g transform={`translate(${geo.scale.x} ${geo.scale.y})`}>
              <path d={`M0 -4V0H${num1(geo.scale.px)}V-4`} fill="none" strokeWidth={1.4} className="stroke-slate-600 dark:stroke-slate-300" />
              <text x={num1(geo.scale.px) / 2} y={-7} textAnchor="middle" className={haloLand} strokeWidth={2.5}>{geo.scale.label}</text>
            </g>
          )}
          <text x={model.w - 4} y={model.h - 5} textAnchor="end" fontSize={7.5} className={haloLand} strokeWidth={2.5}>© OpenStreetMap contributors; rivers: Irrigation Department</text>
        </g>
      )}
    </svg>
  );
}

export function RiverMapView({ model, wide = null, strings, extras = {} }: { model: MapModel; wide?: MapModel | null; strings: MapStrings; extras?: Record<string, React.ReactNode> }) {
  const [sel, setSel] = useState<string | null>(null);
  const wasSel = useRef<boolean | null>(null);
  const picked = model.nodes.find((n) => n.id === sel) ?? null;
  const interactive = model.nodes.filter((n) => n.href);

  function onClick(e: React.MouseEvent, id: string) {
    const was = wasSel.current ?? true; // null = keyboard: the card is already open from focus
    wasSel.current = null;
    if (!was && window.matchMedia("(pointer: coarse)").matches) {
      e.preventDefault();
      setSel(id);
    }
  }

  const svgProps = { strings, sel, onSelect: setSel, onDown: (id: string) => { wasSel.current = sel === id; }, onClick };

  return (
    <div>
      {wide ? (
        <>
          <MapSvg model={model} cls="sm:hidden" {...svgProps} />
          <MapSvg model={wide} cls="hidden sm:block" {...svgProps} />
        </>
      ) : (
        <MapSvg model={model} cls="" {...svgProps} />
      )}

      {/* legend + hint */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden><circle r="4.5" fill="#64748b" className="stroke-white dark:stroke-slate-900" strokeWidth="1.5" /></svg>
          {strings.gauge}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="14" height="12" viewBox="-7 -6 14 12" aria-hidden><Tank fill="#10b981" /></svg>
          {strings.reservoir}
        </span>
        {model.flows.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden><path d="M1 6H17" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 5" /></svg>
            {strings.release}
          </span>
        )}
        {!picked && <span className="sm:ml-auto">{strings.hint}{model.geo ? "" : ` ${strings.simplified}`}</span>}
      </div>

      <div aria-live="polite">
        {picked && picked.href && picked.kind !== "town" ? (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium truncate">{picked.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{picked.detail}</p>
              {extras[picked.id] && <div className="mt-1">{extras[picked.id]}</div>}
            </div>
            <Link href={picked.href} className="inline-flex shrink-0 items-center gap-1 min-h-11 text-sky-700 dark:text-sky-300 font-medium hover:underline">
              {picked.kind === "gauge" ? strings.openGauge : strings.openReservoir}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        ) : null}
      </div>

      {/* text version for screen readers: the order along the river and each state */}
      <div className="sr-only">
        <p>{strings.list}</p>
        <ul>
          {interactive.map((n) => (
            <li key={n.id}>{n.name}: {n.detail}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Tank({ fill }: { fill: string }) {
  // a small lake, not a box
  return (
    <>
      <path d="M-7 0.5C-7.5-4-2-6.5 2.5-5.5 7-5 8.5-1 6.5 3 4.5 6.5-3 6.8-5.8 4-6.8 2.6-7 1.4-7 0.5Z" fill={fill} className="stroke-white dark:stroke-slate-900" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M-4 0.4q2-2 4 0t4 0" fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity="0.9" />
    </>
  );
}

function Node({
  n, geo, selected, strings, onSelect, onDown, onClick,
}: {
  n: MapNode;
  geo: boolean;
  selected: boolean;
  strings: MapStrings;
  onSelect: () => void;
  onDown: () => void;
  onClick: (e: React.MouseEvent) => void;
}) {
  const label = n.label && (
    <text x={n.label.x} y={n.label.y} textAnchor={n.label.anchor} aria-hidden strokeWidth={geo ? 3.5 : 3} strokeLinejoin="round" className={n.kind === "sea" ? `fill-sky-700 dark:fill-sky-300 italic ${geo ? haloSea : halo}` : n.kind === "town" ? `${n.focus ? "fill-sky-800 dark:fill-sky-200" : "fill-slate-500 dark:fill-slate-400"} ${geo ? haloLand : halo}` : geo ? `fill-slate-700 dark:fill-slate-200 ${haloLand}` : labelCls} fontWeight={n.kind === "gauge" || n.highlight || n.focus ? 600 : 400}>
      {n.label.text}
      {n.label.sub && (
        <tspan x={n.label.x} dy={12} className="fill-slate-500 dark:fill-slate-400" fontWeight={400}>{n.label.sub}</tspan>
      )}
    </text>
  );

  if (n.kind === "sea") {
    return (
      <g aria-hidden>
        <path d={`M${n.x - 7} ${n.y}q3.5-4 7 0t7 0M${n.x - 7} ${n.y + 4}q3.5-4 7 0t7 0`} fill="none" strokeWidth="1.4" strokeLinecap="round" className="stroke-sky-500 dark:stroke-sky-400" />
        {label}
      </g>
    );
  }
  if (n.kind === "town") {
    return (
      <g aria-hidden>
        {n.focus ? (
          <>
            <circle cx={n.x} cy={n.y} r={9} fill="none" strokeWidth="1.6" className="stroke-sky-600 dark:stroke-sky-300" />
            <circle cx={n.x} cy={n.y} r={4.5} strokeWidth="1.6" className="fill-sky-600 dark:fill-sky-300 stroke-white dark:stroke-slate-900" />
          </>
        ) : (
          <circle cx={n.x} cy={n.y} r={2.4} fill="none" strokeWidth="1.2" className="stroke-slate-400 dark:stroke-slate-500" />
        )}
        {label}
      </g>
    );
  }

  const aria = `${n.name}, ${n.detail}. ${n.kind === "gauge" ? strings.openGauge : strings.openReservoir}`;
  return (
    <g>
      {label}
      <Link href={n.href!} aria-label={aria} className="outline-none group cursor-pointer" onFocus={onSelect} onPointerDown={onDown} onClick={onClick}>
        <title>{`${n.name} · ${n.detail}`}</title>
        {/* 32 px touch target */}
        <circle cx={n.x} cy={n.y} r={16} fill="transparent" />
        {(selected || n.highlight || n.focus) && <circle cx={n.x} cy={n.y} r={n.kind === "gauge" ? 9 : 11} fill="none" strokeWidth="1.6" className="stroke-sky-600 dark:stroke-sky-300" />}
        <circle cx={n.x} cy={n.y} r={13} fill="none" strokeWidth="2" className="stroke-sky-600 dark:stroke-sky-300 opacity-0 group-focus-visible:opacity-100" />
        {n.kind === "gauge" ? (
          <circle cx={n.x} cy={n.y} r={n.tier === "normal" || n.tier === "none" || n.tier === "stale" ? 5 : 6} fill={TIER_HEX[n.tier ?? "none"]} strokeWidth="1.6" className="stroke-white dark:stroke-slate-900" />
        ) : (
          <g transform={`translate(${n.x} ${n.y})`}>
            {n.active && <circle r={11} fill="none" strokeWidth="1.4" className="rm-ring stroke-amber-500 dark:stroke-amber-400" />}
            <Tank fill={RES_FILL[n.status ?? "nodata"]} />
          </g>
        )}
      </Link>
    </g>
  );
}
